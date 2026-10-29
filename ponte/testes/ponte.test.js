"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { Readable } = require("node:stream");
const crypto = require("node:crypto");
const P = require("../lib/ponte");

const CHAVE = "k".repeat(40);
const AGORA = 1793300000;

function b64(o) { return Buffer.from(JSON.stringify(o)).toString("base64url"); }
function jwt(payload) { return b64({ alg: "ES256", typ: "JWT" }) + "." + b64(payload) + ".assinatura"; }
const PASSE = jwt({ typ: "passe", sis: "operacao-logistica" });
const OIDC = jwt({ iss: P.OIDC_ISS, exp: AGORA + 600, owner_id: "team" });

function assinar(corpo, t = AGORA, chave = CHAVE) {
  return "t=" + t + ",v1=" + P.hmacHex(chave, t + "." + corpo);
}

function central(status, json, guardar) {
  return async (url, init) => {
    if (guardar) guardar.push({ url, init });
    return { status, ok: status >= 200 && status < 300, text: async () => (json === undefined ? "" : JSON.stringify(json)) };
  };
}

const SESSAO_OK = {
  ok: true,
  email: "fulano@lube.com.br",
  sessao: jwt({ typ: "sessao", sis: "operacao-logistica", email: "fulano@lube.com.br", nome: "Fulano", exp: AGORA + 28800 }),
};

function chamada(extra = {}) {
  const corpo = JSON.stringify({ passe: PASSE });
  return { chave: CHAVE, assinatura: assinar(corpo), corpo, oidc: OIDC, fetchFn: central(200, SESSAO_OK), agoraS: AGORA, ...extra };
}

test("sem PONTE_CHAVE (ou curta) responde 503 e não chama a central", async () => {
  const vistos = [];
  for (const chave of [undefined, "", "curta"]) {
    const r = await P.trocar(chamada({ chave, fetchFn: central(200, SESSAO_OK, vistos) }));
    assert.equal(r.status, 503);
    assert.equal(r.corpo.erro, "sem_chave");
  }
  assert.equal(vistos.length, 0);
});

test("assinatura errada, de outra chave, sem cabeçalho ou fora da janela dá 401", async () => {
  const corpo = JSON.stringify({ passe: PASSE });
  const casos = [
    undefined,
    "lixo",
    assinar(corpo, AGORA, "x".repeat(40)),
    assinar(corpo + " ", AGORA),
    assinar(corpo, AGORA - P.JANELA_S - 1),
    assinar(corpo, AGORA + P.JANELA_S + 1),
    "t=" + AGORA + ",v1=" + "0".repeat(64),
  ];
  for (const assinatura of casos) {
    const r = await P.trocar(chamada({ corpo, assinatura }));
    assert.equal(r.status, 401, String(assinatura));
    assert.equal(r.corpo.erro, "assinatura");
  }
  // na borda da janela ainda vale
  const r = await P.trocar(chamada({ corpo, assinatura: assinar(corpo, AGORA - P.JANELA_S) }));
  assert.equal(r.status, 200);
});

test("corpo sem passe, com passe estranho ou grande demais é recusado", async () => {
  for (const corpo of ["{}", "nao-e-json", JSON.stringify({ passe: "abc" }), JSON.stringify({ passe: 12 }), "[1]"]) {
    const r = await P.trocar(chamada({ corpo, assinatura: assinar(corpo) }));
    assert.equal(r.status, 400, corpo);
  }
  const grande = JSON.stringify({ passe: "a".repeat(9000) });
  const r = await P.trocar(chamada({ corpo: grande, assinatura: assinar(grande) }));
  assert.equal(r.status, 413);
});

test("sem token OIDC não chama a central", async () => {
  const vistos = [];
  const r = await P.trocar(chamada({ oidc: null, fetchFn: central(200, SESSAO_OK, vistos) }));
  assert.equal(r.status, 502);
  assert.equal(r.corpo.erro, "sem_oidc");
  assert.equal(vistos.length, 0);
});

test("troca certa: chama /sessao com o OIDC e devolve só quem entrou", async () => {
  const vistos = [];
  const r = await P.trocar(chamada({ fetchFn: central(200, SESSAO_OK, vistos) }));
  assert.equal(r.status, 200);
  assert.deepEqual(r.corpo, {
    ok: true, email: "fulano@lube.com.br", nome: "Fulano", sistema: "operacao-logistica",
    exp: new Date((AGORA + 28800) * 1000).toISOString(),
  });
  assert.equal(vistos.length, 1);
  assert.equal(vistos[0].url, P.CENTRAL + "/sessao");
  assert.equal(vistos[0].init.method, "POST");
  assert.equal(vistos[0].init.headers.authorization, "Bearer " + OIDC);
  assert.equal(vistos[0].init.headers["x-sentinela-guarda"], P.VERSAO);
  assert.deepEqual(JSON.parse(vistos[0].init.body), { passe: PASSE });
  // a sessão da central e a chave nunca vão para o script
  assert.ok(!JSON.stringify(r.corpo).includes(SESSAO_OK.sessao));
  assert.ok(!JSON.stringify(r.corpo).includes(CHAVE));
});

test("passe recusado pela central vira 401 passe_invalido", async () => {
  const r = await P.trocar(chamada({ fetchFn: central(401, { erro: "passe_invalido", detalhe: "ja_usado" }) }));
  assert.equal(r.status, 401);
  assert.equal(r.corpo.erro, "passe_invalido");
});

test("central fora, recusando a ponte ou respondendo estranho vira 502", async () => {
  const casos = [
    central(500, { erro: "x" }),
    central(401, { erro: "guarda_nao_autenticado" }),
    central(200, undefined),
    central(200, { ok: false }),
    async () => { throw new Error("rede"); },
  ];
  for (const fetchFn of casos) {
    const r = await P.trocar(chamada({ fetchFn }));
    assert.equal(r.status, 502);
  }
});

test("sessão de outro sistema, de outro tipo ou com e-mail diferente não passa", async () => {
  const ruins = [
    { ...SESSAO_OK, sessao: jwt({ typ: "sessao", sis: "gestao-ti", email: "fulano@lube.com.br" }) },
    { ...SESSAO_OK, sessao: jwt({ typ: "passe", sis: "operacao-logistica", email: "fulano@lube.com.br" }) },
    { ...SESSAO_OK, email: "outro@lube.com.br" },
    { ...SESSAO_OK, sessao: "nao-e-jwt" },
  ];
  for (const j of ruins) {
    const r = await P.trocar(chamada({ fetchFn: central(200, j) }));
    assert.equal(r.status, 502);
    assert.equal(r.corpo.erro, "sessao_estranha");
  }
});

test("central que demora além do prazo é abortada", async () => {
  const lenta = (url, init) => new Promise((ok, falha) => {
    init.signal.addEventListener("abort", () => falha(new Error("abortado")));
  });
  const r = await P.trocar(chamada({ fetchFn: lenta, prazoMs: 50 }));
  assert.equal(r.status, 502);
});

test("token OIDC: só o do time da Lube e ainda válido", () => {
  const vencido = jwt({ iss: P.OIDC_ISS, exp: AGORA - 1 });
  const outro = jwt({ iss: "https://oidc.vercel.com/outro-time", exp: AGORA + 600 });
  assert.equal(P.tokenOidc(OIDC, undefined, AGORA), OIDC);
  assert.equal(P.tokenOidc(vencido, OIDC, AGORA), OIDC);
  assert.equal(P.tokenOidc(outro, undefined, AGORA), null);
  assert.equal(P.tokenOidc(undefined, undefined, AGORA), null);
});

test("o hex do Apps Script (bytes com sinal) bate com o da ponte", () => {
  // o Utilities.computeHmacSha256Signature devolve bytes de -128 a 127; o PortaLube.gs converte assim
  function hexComoNoScript(bytes) {
    return bytes.map(function (b) { return ("0" + (b & 0xff).toString(16)).slice(-2); }).join("");
  }
  const texto = AGORA + "." + JSON.stringify({ passe: PASSE + "ção" });
  const comSinal = Array.from(crypto.createHmac("sha256", CHAVE).update(texto, "utf8").digest()).map((b) => (b > 127 ? b - 256 : b));
  assert.equal(hexComoNoScript(comSinal), P.hmacHex(CHAVE, texto));
});

test("handler: só POST, lê o corpo cru e responde JSON sem cache", async () => {
  const handler = require("../api/trocar");
  function res() {
    const r = { statusCode: 0, h: {}, corpo: "" };
    r.setHeader = (k, v) => { r.h[k.toLowerCase()] = v; };
    r.end = (c) => { r.corpo = c; };
    return r;
  }
  const g = res();
  await handler(Object.assign(Readable.from([]), { method: "GET", headers: {} }), g);
  assert.equal(g.statusCode, 405);

  const antes = process.env.PONTE_CHAVE;
  delete process.env.PONTE_CHAVE;
  const p = res();
  await handler(Object.assign(Readable.from([Buffer.from("{}")]), { method: "POST", headers: {} }), p);
  assert.equal(p.statusCode, 503);
  assert.equal(p.h["cache-control"], "no-store");
  assert.equal(JSON.parse(p.corpo).erro, "sem_chave");
  if (antes !== undefined) process.env.PONTE_CHAVE = antes;
});
