"use strict";
// Roda o PortaLube.gs no Node com um Google de mentira (Utilities, CacheService, UrlFetchApp,
// HtmlService, PropertiesService) e a lógica de verdade da ponte (../../ponte/lib/ponte.js),
// com uma central de mentira. Prova a ida e a volta: passe bom abre, sem passe nega, e o
// navegador só chama as funções da lista, com a entrada válida.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const crypto = require("node:crypto");
const ponte = require("../../ponte/lib/ponte");

const CHAVE = "c".repeat(48);
const GS = fs.readFileSync(path.join(__dirname, "..", "PortaLube.gs"), "utf8");

function b64(o) { return Buffer.from(JSON.stringify(o)).toString("base64url"); }
function jwt(p) { return b64({ alg: "ES256" }) + "." + b64(p) + ".sig"; }
const OIDC = jwt({ iss: ponte.OIDC_ISS, exp: Math.floor(Date.now() / 1000) + 600 });

function montar({ chave = CHAVE, centralStatus = 200, sis = "operacao-logistica", usados } = {}) {
  const cache = new Map();
  const chamadas = { ponte: 0, salvar: [] };
  const jaUsados = usados || new Set();

  // a central de mentira: aceita o passe uma vez só
  async function central(url, init) {
    const { passe } = JSON.parse(init.body);
    if (centralStatus !== 200) return { status: centralStatus, ok: false, text: async () => JSON.stringify({ erro: "x" }) };
    if (jaUsados.has(passe) || !passe.startsWith("bom.")) {
      return { status: 401, ok: false, text: async () => JSON.stringify({ erro: "passe_invalido" }) };
    }
    jaUsados.add(passe);
    const sessao = jwt({ typ: "sessao", sis, email: "fulano@lube.com.br", nome: "Fulano </script>", exp: 9999999999 });
    return { status: 200, ok: true, text: async () => JSON.stringify({ ok: true, sessao, email: "fulano@lube.com.br" }) };
  }

  // UrlFetchApp síncrono: roda a ponte de verdade (a promessa resolve por fora, ver chamarPonte)
  let pendente = null;
  const sandbox = {
    console: { error() {}, warn() {}, log() {} },
    Date, JSON, Math, Object, Array, Error,
    PropertiesService: { getScriptProperties: () => ({ getProperty: (k) => (k === "PONTE_CHAVE" ? chave : null) }) },
    Utilities: {
      Charset: { UTF_8: "utf8" },
      computeHmacSha256Signature: (v, k) => Array.from(crypto.createHmac("sha256", k).update(v, "utf8").digest()).map((b) => (b > 127 ? b - 256 : b)),
      getUuid: () => crypto.randomUUID(),
    },
    CacheService: { getScriptCache: () => ({ put: (k, v) => cache.set(k, v), get: (k) => (cache.has(k) ? cache.get(k) : null) }) },
    UrlFetchApp: {
      fetch: (url, o) => {
        assert.equal(url, "https://sentinela-ponte-google.vercel.app/api/trocar");
        chamadas.ponte++;
        pendente = { headers: o.headers, payload: o.payload };
        return sandbox.__resposta;
      },
    },
    HtmlService: {
      XFrameOptionsMode: { ALLOWALL: "ALLOWALL" },
      createHtmlOutput: (html) => saida(html),
      createTemplateFromFile: (nome) => ({ evaluate() { return saida("NEGADO:" + nome + ":" + this.sistema + ":" + this.portal); } }),
    },
  };
  function saida(html, titulo) {
    const o = { html, titulo, xframe: null, getContent: () => html };
    o.getTitle = () => o.titulo;
    o.setTitle = (t) => { o.titulo = t; return o; };
    o.addMetaTag = () => o;
    o.setXFrameOptionsMode = (m) => { o.xframe = m; return o; };
    return o;
  }
  vm.createContext(sandbox);
  vm.runInContext(GS, sandbox);
  // o sistema do dono (o que existia antes), já adaptado
  vm.runInContext(`
    function doGetOriginal_(e) { return HtmlService.createHtmlOutput('<html><head><title>x</title></head><body>tela</body></html>').setTitle('Operação'); }
    function salvar_(a, b) { __salvos.push([a, b, portaLube_usuario().email]); return 'ok'; }
    function portaLube_funcoes_() { return { salvar: salvar_ }; }
  `, Object.assign(sandbox, { __salvos: chamadas.salvar }));

  // doGet que espera a ponte: a 1ª passada só monta o pedido; a resposta da ponte de verdade volta na 2ª
  async function doGet(params) {
    sandbox.__resposta = { getResponseCode: () => 0, getContentText: () => "" };
    pendente = null;
    let out = sandbox.doGet({ parameter: params });
    if (pendente) {
      const r = await ponte.trocar({
        chave: process.env.TESTE_CHAVE_PONTE || CHAVE,
        assinatura: pendente.headers["x-ponte-assinatura"],
        corpo: pendente.payload,
        oidc: OIDC,
        fetchFn: central,
        agoraS: Math.floor(Date.now() / 1000),
      });
      sandbox.__resposta = { getResponseCode: () => r.status, getContentText: () => JSON.stringify(r.corpo) };
      const p = pendente;
      sandbox.UrlFetchApp.fetch = (url, o) => {
        assert.equal(o.payload, p.payload);
        chamadas.ponte++;
        return sandbox.__resposta;
      };
      out = sandbox.doGet({ parameter: params });
    }
    return out;
  }
  return { sandbox, doGet, chamadas, cache };
}

function tokenDa(saida) {
  const m = /window\.PORTA_LUBE=(\{.*?\});/.exec(saida.html);
  return m ? JSON.parse(m[1]).token : null;
}

test("sem passe: página de acesso só pelo painel, sem chamar a ponte", async () => {
  const g = montar();
  const out = await g.doGet({});
  assert.match(out.html, /^NEGADO:PortaLube_Negado:OPERAÇÃO LOGÍSTICA:https:\/\/painel-lube-distribuidora/);
  assert.equal(g.chamadas.ponte, 0);
  assert.equal(out.xframe, "ALLOWALL");
});

test("passe bom abre a tela com a entrada; o mesmo passe de novo é negado", async () => {
  const usados = new Set();
  const g = montar({ usados });
  const out = await g.doGet({ sentinela_passe: "bom.passe.x" });
  assert.match(out.html, /<head><script>window\.PORTA_LUBE=/);
  assert.match(out.html, /<body>tela<\/body>/);
  assert.equal(out.titulo, "Operação");
  assert.equal(out.xframe, "ALLOWALL");
  assert.ok(!out.html.includes("</script>\"") && !out.html.includes("Fulano </script>"), "o nome não fecha o script");
  const token = tokenDa(out);
  assert.match(token, /^[0-9a-f]{64}$/);

  const g2 = montar({ usados });
  const de_novo = await g2.doGet({ sentinela_passe: "bom.passe.x" });
  assert.match(de_novo.html, /^NEGADO/);
});

test("passe ruim, central fora, sessão de outro sistema ou chave errada: negado", async () => {
  for (const op of [{}, { centralStatus: 500 }, { sis: "gestao-ti" }]) {
    const g = montar(op);
    const passe = op.centralStatus || op.sis ? "bom.passe.y" : "ruim.passe.x";
    assert.match((await g.doGet({ sentinela_passe: passe })).html, /^NEGADO/);
  }
  process.env.TESTE_CHAVE_PONTE = "d".repeat(48);   // a ponte com outra chave
  try {
    const g = montar();
    assert.match((await g.doGet({ sentinela_passe: "bom.passe.z" })).html, /^NEGADO/);
  } finally {
    delete process.env.TESTE_CHAVE_PONTE;
  }
});

test("sem PONTE_CHAVE nas propriedades: negado (e não quebra)", async () => {
  const g = montar({ chave: null });
  assert.match((await g.doGet({ sentinela_passe: "bom.passe.w" })).html, /^NEGADO/);
});

test("api: grava com a entrada boa, recusa sem entrada, com token falso ou função fora da lista", async () => {
  const g = montar();
  const token = tokenDa(await g.doGet({ sentinela_passe: "bom.passe.k" }));
  assert.equal(g.sandbox.api(token, "salvar", ["a", 2]), "ok");
  assert.equal(JSON.stringify(g.chamadas.salvar), JSON.stringify([["a", 2, "fulano@lube.com.br"]]));

  assert.throws(() => g.sandbox.api(undefined, "salvar", []), /PORTA_LUBE/);
  assert.throws(() => g.sandbox.api("f".repeat(64), "salvar", []), /venceu/);
  assert.throws(() => g.sandbox.api(token, "doGetOriginal_", []), /não liberada/);
  assert.throws(() => g.sandbox.api(token, "constructor", []), /não liberada/);
  assert.throws(() => g.sandbox.api(token, "toString", []), /não liberada/);
  assert.throws(() => g.sandbox.api(token, "salvar", "x"), /Argumentos/);
  assert.equal(g.chamadas.salvar.length, 1);
});

test("entrada vencida é recusada", async () => {
  const g = montar();
  const token = tokenDa(await g.doGet({ sentinela_passe: "bom.passe.v" }));
  const k = "porta_" + token;
  const e = JSON.parse(g.cache.get(k));
  e.ate = Date.now() - 1;
  g.cache.set(k, JSON.stringify(e));
  assert.throws(() => g.sandbox.api(token, "salvar", []), /venceu/);
});

test("link de dentro do sistema com ?porta_lube= reabre com a mesma entrada", async () => {
  const g = montar();
  const token = tokenDa(await g.doGet({ sentinela_passe: "bom.passe.l" }));
  const antes = g.chamadas.ponte;
  const out = await g.doGet({ porta_lube: token, pagina: "outra" });
  assert.equal(tokenDa(out), token);
  assert.equal(g.chamadas.ponte, antes, "não chama a ponte de novo");
  assert.match((await g.doGet({ porta_lube: "0".repeat(64) })).html, /^NEGADO/);
});
