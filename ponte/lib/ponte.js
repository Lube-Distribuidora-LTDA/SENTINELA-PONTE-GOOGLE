/**
 * PONTE DA SENTINELA PARA O GOOGLE — a lógica, sem rede (os testes rodam no Node puro).
 *
 * O sistema OPERAÇÃO LOGÍSTICA é um app do Google Apps Script. O Google não roda o guarda da
 * Sentinela, e o script não consegue conferir sozinho o passe do painel (ES256). Então o script
 * manda o passe para esta ponte, assinado com uma chave que só serve para este sistema
 * (PONTE_CHAVE). A ponte se identifica na central da Sentinela pelo OIDC da Vercel, como
 * qualquer guarda, troca o passe pela sessão e devolve ao script só quem entrou.
 *
 * A chave geral da Sentinela (SENTINELA_CHAVE) nunca passa por aqui nem pelo script.
 */
"use strict";
const crypto = require("crypto");

const CENTRAL = "https://wkkdcsqwlxjxorutrbnx.supabase.co/functions/v1/sentinela";
const SISTEMA = "operacao-logistica";       // o único sistema que esta ponte atende (sis do passe)
const VERSAO = "ponte-google/1.0.0";
const JANELA_S = 300;                       // assinatura vale 5 min para cada lado
const CHAVE_MIN = 32;
const CORPO_MAX = 8192;
const PASSE_MAX = 4096;
const OIDC_ISS = "https://oidc.vercel.com/lube-distribuidora-ltda";

/** Lê "t=<segundos>,v1=<hex>" do cabeçalho x-ponte-assinatura. */
function lerAssinatura(cabecalho) {
  if (typeof cabecalho !== "string" || cabecalho.length > 200) return null;
  const partes = {};
  for (const p of cabecalho.split(",")) {
    const i = p.indexOf("=");
    if (i > 0) partes[p.slice(0, i).trim()] = p.slice(i + 1).trim();
  }
  if (!/^\d{9,11}$/.test(partes.t || "") || !/^[0-9a-f]{64}$/.test(partes.v1 || "")) return null;
  return { t: Number(partes.t), v1: partes.v1 };
}

function hmacHex(chave, texto) {
  return crypto.createHmac("sha256", Buffer.from(chave, "utf8")).update(Buffer.from(texto, "utf8")).digest("hex");
}

/** true se a assinatura bate com a chave e está dentro da janela. */
function assinaturaValida(chave, cabecalho, corpo, agoraS) {
  const a = lerAssinatura(cabecalho);
  if (!a || Math.abs(agoraS - a.t) > JANELA_S) return false;
  const esperado = Buffer.from(hmacHex(chave, a.t + "." + corpo), "hex");
  const veio = Buffer.from(a.v1, "hex");
  return esperado.length === veio.length && crypto.timingSafeEqual(esperado, veio);
}

/** O passe que veio no corpo, ou null. */
function lerPasse(corpo) {
  let j;
  try { j = JSON.parse(corpo); } catch { return null; }
  if (!j || typeof j !== "object" || Array.isArray(j)) return null;
  const p = j.passe;
  if (typeof p !== "string" || !p || p.length > PASSE_MAX || !/^[A-Za-z0-9_\-]+\.[A-Za-z0-9_\-]+\.[A-Za-z0-9_\-]+$/.test(p)) return null;
  return p;
}

/** Payload de um JWT sem verificar a assinatura (a sessão veio da central, por TLS). */
function payloadJwt(t) {
  if (typeof t !== "string") return null;
  const partes = t.split(".");
  if (partes.length !== 3) return null;
  try {
    const p = JSON.parse(Buffer.from(partes[1], "base64url").toString("utf8"));
    return p && typeof p === "object" ? p : null;
  } catch {
    return null;
  }
}

/** O token OIDC da Vercel desta função (cabeçalho da requisição ou ambiente), se for do time da Lube. */
function tokenOidc(cabecalho, ambiente, agoraS) {
  for (const t of [cabecalho, ambiente]) {
    if (typeof t !== "string" || !t || t.length > 8192) continue;
    const p = payloadJwt(t);
    if (p && p.iss === OIDC_ISS && typeof p.exp === "number" && p.exp > agoraS + 5) return t;
  }
  return null;
}

/**
 * Troca o passe na central. Devolve { status, corpo } para responder ao script.
 * fetchFn e agoraS entram por fora para os testes.
 */
async function trocar({ chave, assinatura, corpo, oidc, fetchFn, agoraS, prazoMs = 5000 }) {
  if (typeof chave !== "string" || chave.length < CHAVE_MIN) {
    return { status: 503, corpo: { ok: false, erro: "sem_chave", mensagem: "A PONTE_CHAVE não está cadastrada na Vercel." } };
  }
  if (typeof corpo !== "string" || corpo.length > CORPO_MAX) return { status: 413, corpo: { ok: false, erro: "corpo" } };
  if (!assinaturaValida(chave, assinatura, corpo, agoraS)) return { status: 401, corpo: { ok: false, erro: "assinatura" } };
  const passe = lerPasse(corpo);
  if (!passe) return { status: 400, corpo: { ok: false, erro: "corpo" } };
  if (!oidc) return { status: 502, corpo: { ok: false, erro: "sem_oidc" } };

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), prazoMs);
  let r, j;
  try {
    r = await fetchFn(CENTRAL + "/sessao", {
      method: "POST",
      headers: {
        authorization: "Bearer " + oidc,
        "content-type": "application/json",
        "x-sentinela-guarda": VERSAO,
        "x-sentinela-runtime": "node",
      },
      body: JSON.stringify({ passe }),
      signal: ctrl.signal,
    });
    const txt = await r.text();
    try { j = txt ? JSON.parse(txt) : null; } catch { j = null; }
  } catch {
    return { status: 502, corpo: { ok: false, erro: "central" } };
  } finally {
    clearTimeout(timer);
  }

  if (r.status === 401 && j && j.erro === "passe_invalido") return { status: 401, corpo: { ok: false, erro: "passe_invalido" } };
  if (!r.ok || !j || j.ok !== true) return { status: 502, corpo: { ok: false, erro: "central", status_central: r.status } };

  const s = payloadJwt(j.sessao);
  const email = s && typeof s.email === "string" ? s.email.toLowerCase() : "";
  if (!s || s.typ !== "sessao" || s.sis !== SISTEMA || !email || email !== String(j.email || "").toLowerCase()) {
    return { status: 502, corpo: { ok: false, erro: "sessao_estranha" } };
  }
  return {
    status: 200,
    corpo: {
      ok: true,
      email,
      nome: typeof s.nome === "string" ? s.nome.slice(0, 120) : "",
      sistema: SISTEMA,
      exp: typeof s.exp === "number" ? new Date(s.exp * 1000).toISOString() : null,
    },
  };
}

/**
 * Saúde da ponte, sem segredo: a PONTE_CHAVE está cadastrada? a central aceita esta ponte
 * (GET /lista com o OIDC)? Não devolve nada da lista. A resposta da central fica 60 s guardada
 * na instância, para ninguém usar esta rota para martelar a central.
 */
let saudeGuardada = null;
async function saude({ chave, oidc, fetchFn, agoraMs, prazoMs = 4000 }) {
  const chaveOk = typeof chave === "string" && chave.length >= CHAVE_MIN;
  if (saudeGuardada && agoraMs - saudeGuardada.em < 60000) {
    return { ok: true, versao: VERSAO, chave_cadastrada: chaveOk, central: saudeGuardada.central };
  }
  let central = "sem_oidc";
  if (oidc) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), prazoMs);
    try {
      const r = await fetchFn(CENTRAL + "/lista", {
        method: "GET",
        headers: { authorization: "Bearer " + oidc, "x-sentinela-guarda": VERSAO, "x-sentinela-runtime": "node" },
        signal: ctrl.signal,
      });
      await r.text().catch(() => "");
      central = r.ok ? "aceitou" : r.status === 401 || r.status === 403 ? "recusou" : "fora";
    } catch {
      central = "fora";
    } finally {
      clearTimeout(timer);
    }
  }
  saudeGuardada = { em: agoraMs, central };
  return { ok: true, versao: VERSAO, chave_cadastrada: chaveOk, central };
}
function _esquecerSaude() { saudeGuardada = null; }

module.exports = { trocar, saude, _esquecerSaude, assinaturaValida, lerAssinatura, lerPasse, payloadJwt, tokenOidc, hmacHex, CENTRAL, SISTEMA, VERSAO, JANELA_S, OIDC_ISS };
