/**
 * PORTA LUBE — o sistema só abre para quem entra pelo Painel Lube.
 *
 * Como funciona:
 * 1. O Painel Lube abre este app com ?sentinela_passe=<passe> (vale 90 s e uma vez só).
 * 2. O doGet manda o passe para a ponte da Sentinela, assinado com a PONTE_CHAVE (Propriedades
 *    do script). A ponte confere com a central e devolve quem entrou.
 * 3. Com o passe bom, a página abre com uma entrada de 6 horas (PORTA_LUBE_TOKEN).
 *    Sem passe, ou com passe ruim, aparece a página "Acesso só pelo Painel Lube".
 * 4. Toda chamada do navegador passa por api(token, nome, args). Ela confere a entrada e só
 *    chama as funções da lista portaLube_funcoes_(). As funções do sistema terminam com "_",
 *    e o Google não deixa o navegador chamar função que termina com "_".
 *
 * Nunca escreva a PONTE_CHAVE aqui: ela fica só em Configurações do projeto › Propriedades do script.
 */
var PORTA_LUBE = {
  ponte: 'https://sentinela-ponte-google.vercel.app/api/trocar',
  portal: 'https://painel-lube-distribuidora.vercel.app/',
  sistema: 'OPERAÇÃO LOGÍSTICA',
  horas: 6 // tempo da entrada; 6 h é o máximo do CacheService
};

// quem está usando nesta chamada (preenchido pelo api); use portaLube_usuario() no lugar de Session.getActiveUser()
var PORTA_LUBE_ATUAL = null;

function doGet(e) {
  var s = null;
  try {
    s = portaLube_entrar_(e);
    // link de dentro do próprio sistema (?porta_lube=<token>): a entrada que já existe
    var tk = e && e.parameter ? e.parameter.porta_lube : null;
    if (!s && tk) {
      var u = portaLube_exigir_(tk);
      s = { token: tk, email: u.email, nome: u.nome };
    }
  } catch (erro) {
    console.error('PORTA LUBE: ' + erro);
    s = null;
  }
  if (!s) return portaLube_negado_();
  PORTA_LUBE_ATUAL = { email: s.email, nome: s.nome };
  return portaLube_embrulhar_(doGetOriginal_(e), s);
}

/** Chamada única do navegador: google.script.run.api(PORTA_LUBE_TOKEN, 'nome', [args]). */
function api(token, nome, args) {
  PORTA_LUBE_ATUAL = portaLube_exigir_(token);
  var funcoes = portaLube_funcoes_();
  if (typeof nome !== 'string' || !Object.prototype.hasOwnProperty.call(funcoes, nome) || typeof funcoes[nome] !== 'function') {
    throw new Error('Função não liberada: ' + nome);
  }
  if (args != null && !Array.isArray(args)) throw new Error('Argumentos inválidos.');
  return funcoes[nome].apply(null, args || []);
}

/** Quem está usando agora: { email, nome }. */
function portaLube_usuario() {
  return PORTA_LUBE_ATUAL;
}

// ------------------------------------------------------------------ por dentro

function portaLube_entrar_(e) {
  var passe = e && e.parameter ? e.parameter.sentinela_passe : null;
  if (typeof passe !== 'string' || !passe || passe.length > 4096) return null;

  var chave = PropertiesService.getScriptProperties().getProperty('PONTE_CHAVE');
  if (!chave) throw new Error('PONTE_CHAVE não cadastrada nas Propriedades do script.');

  var corpo = JSON.stringify({ passe: passe });
  var t = Math.floor(Date.now() / 1000);
  var assinatura = portaLube_hex_(Utilities.computeHmacSha256Signature(t + '.' + corpo, chave, Utilities.Charset.UTF_8));
  var r = UrlFetchApp.fetch(PORTA_LUBE.ponte, {
    method: 'post',
    contentType: 'application/json',
    payload: corpo,
    headers: { 'x-ponte-assinatura': 't=' + t + ',v1=' + assinatura },
    muteHttpExceptions: true,
    followRedirects: false
  });
  if (r.getResponseCode() !== 200) {
    console.warn('PORTA LUBE: a ponte respondeu ' + r.getResponseCode());
    return null;
  }
  var j = JSON.parse(r.getContentText());
  if (!j || j.ok !== true || typeof j.email !== 'string' || !j.email) return null;

  var token = Utilities.getUuid().replace(/-/g, '') + Utilities.getUuid().replace(/-/g, '');
  var entrada = { email: j.email, nome: j.nome || '', ate: Date.now() + PORTA_LUBE.horas * 3600 * 1000 };
  CacheService.getScriptCache().put('porta_' + token, JSON.stringify(entrada), PORTA_LUBE.horas * 3600);
  return { token: token, email: entrada.email, nome: entrada.nome };
}

function portaLube_exigir_(token) {
  if (typeof token !== 'string' || !/^[0-9a-f]{64}$/.test(token)) throw new Error('PORTA_LUBE: entre pelo Painel Lube.');
  var txt = CacheService.getScriptCache().get('porta_' + token);
  var entrada = txt ? JSON.parse(txt) : null;
  if (!entrada || !(entrada.ate > Date.now())) {
    throw new Error('PORTA_LUBE: sua entrada venceu. Recarregue o sistema pelo Painel Lube.');
  }
  return { email: entrada.email, nome: entrada.nome };
}

function portaLube_embrulhar_(saida, s) {
  var html = saida.getContent();
  var dados = JSON.stringify({ token: s.token, email: s.email, nome: s.nome }).replace(/</g, '\\u003c');
  var injetar = '<script>window.PORTA_LUBE=' + dados + ';window.PORTA_LUBE_TOKEN=window.PORTA_LUBE.token;</script>';
  html = /<head[^>]*>/i.test(html) ? html.replace(/<head[^>]*>/i, function (m) { return m + injetar; }) : injetar + html;
  return HtmlService.createHtmlOutput(html)
    .setTitle(saida.getTitle() || PORTA_LUBE.sistema)
    .addMetaTag('viewport', 'width=device-width, initial-scale=1')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

function portaLube_negado_() {
  var t = HtmlService.createTemplateFromFile('PortaLube_Negado');
  t.sistema = PORTA_LUBE.sistema;
  t.portal = PORTA_LUBE.portal;
  return t.evaluate()
    .setTitle(PORTA_LUBE.sistema + ' · acesso pelo Painel Lube')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

function portaLube_hex_(bytes) {
  return bytes.map(function (b) { return ('0' + (b & 0xff).toString(16)).slice(-2); }).join('');
}
