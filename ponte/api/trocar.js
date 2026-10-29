/**
 * /api/trocar (POST) — o script do Google manda o passe do painel e recebe quem entrou.
 * Cabeçalho: x-ponte-assinatura: t=<segundos>,v1=<HMAC-SHA256 hex de "t.corpo" com a PONTE_CHAVE>.
 * Corpo: {"passe":"<jwt>"}. Resposta: {ok, email, nome, sistema, exp} ou {ok:false, erro}.
 */
"use strict";
const { trocar, tokenOidc } = require("../lib/ponte");

function responder(res, status, corpo) {
  res.statusCode = status;
  res.setHeader("content-type", "application/json; charset=utf-8");
  res.setHeader("cache-control", "no-store");
  res.end(JSON.stringify(corpo));
}

function lerCorpo(req, max) {
  return new Promise((ok, falha) => {
    let tam = 0;
    const partes = [];
    req.on("data", (c) => {
      tam += c.length;
      if (tam > max) { falha(new Error("grande")); req.destroy(); return; }
      partes.push(c);
    });
    req.on("end", () => ok(Buffer.concat(partes).toString("utf8")));
    req.on("error", falha);
  });
}

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("allow", "POST");
    return responder(res, 405, { ok: false, erro: "metodo" });
  }
  let corpo;
  try {
    corpo = await lerCorpo(req, 8192);
  } catch {
    return responder(res, 413, { ok: false, erro: "corpo" });
  }
  const agoraS = Math.floor(Date.now() / 1000);
  const r = await trocar({
    chave: process.env.PONTE_CHAVE,
    assinatura: req.headers["x-ponte-assinatura"],
    corpo,
    oidc: tokenOidc(req.headers["x-vercel-oidc-token"], process.env.VERCEL_OIDC_TOKEN, agoraS),
    fetchFn: fetch,
    agoraS,
  });
  responder(res, r.status, r.corpo);
};
