/**
 * /api/saude (GET) — a ponte está pronta? Sem segredo nenhum: diz se a PONTE_CHAVE está
 * cadastrada e se a central da Sentinela aceita esta ponte. Serve para conferir de fora.
 */
"use strict";
const { saude, tokenOidc } = require("../lib/ponte");

module.exports = async function handler(req, res) {
  res.setHeader("content-type", "application/json; charset=utf-8");
  res.setHeader("cache-control", "no-store");
  if (req.method !== "GET") {
    res.statusCode = 405;
    res.setHeader("allow", "GET");
    return res.end(JSON.stringify({ ok: false, erro: "metodo" }));
  }
  const agoraMs = Date.now();
  const r = await saude({
    chave: process.env.PONTE_CHAVE,
    oidc: tokenOidc(req.headers["x-vercel-oidc-token"], process.env.VERCEL_OIDC_TOKEN, Math.floor(agoraMs / 1000)),
    fetchFn: fetch,
    agoraMs,
  });
  res.statusCode = 200;
  res.end(JSON.stringify(r));
};
