# OPERAÇÃO LOGÍSTICA — porta pelo Painel Lube

O sistema OPERAÇÃO LOGÍSTICA é um app do **Google Apps Script**, de outro dono. Ele aparece no Painel Lube (categoria
LOGÍSTICA) e deve abrir **só** para quem entra pelo painel. A Sentinela protege os sites da Vercel com um guarda no próprio
site, e o Google não roda esse guarda. Por isso há duas peças:

| Pasta | O que é | Onde roda |
|---|---|---|
| `ponte/` | **Ponte da Sentinela para o Google**: recebe do script o passe do painel, assinado com a `PONTE_CHAVE`, troca na central da Sentinela pelo OIDC da Vercel e devolve só quem entrou | Vercel, projeto `sentinela-ponte-google` (diretório raiz `ponte`) |
| `apps-script/` | **Porta do script** (`PortaLube.gs` + página de acesso negado) e o passo a passo do dono (`LEIA-ME.md`) | No editor do Apps Script, colado pelo dono |

## O caminho
1. A pessoa abre o cartão no painel. O portal pede à central um passe de 90 s, que vale uma vez só, e abre o app com
   `?sentinela_passe=`.
2. O `doGet` do script manda o passe à ponte com `x-ponte-assinatura: t=<s>,v1=<HMAC-SHA256 de "t.corpo">`.
3. A ponte confere a assinatura (janela de 5 min) e chama `POST /sessao` na central com o token OIDC da Vercel. A
   central confere o passe (ES256, `aud` = este projeto), queima o `jti` e devolve a sessão. A ponte confere se `sis` é
   `operacao-logistica` e responde `{ok, email, nome, exp}`.
4. O script guarda uma entrada de 6 h no CacheService e injeta `PORTA_LUBE_TOKEN` na página. Toda chamada do navegador
   passa por `api(token, nome, args)`, que confere a entrada e só chama as funções de `portaLube_funcoes_()`.

## Chaves
- **`PONTE_CHAVE`** (32 caracteres ou mais), a mesma em dois lugares:
  - na Vercel, `sentinela-ponte-google`, Production, como **Sensitive**;
  - nas Propriedades do script.

  Quem cadastra é o Júlio. Ela só serve para este sistema: quem a tiver só consegue trocar passe do painel, que continua
  exigindo login e permissão.
- **A chave geral da Sentinela (`SENTINELA_CHAVE`) não entra aqui nem no script** (decisão do Júlio, 2026-10-29). A
  ponte fala com a central pelo OIDC, como os guardas da Vercel.

## Na Sentinela (projeto do Painel)
`sentinela.sistemas`:
- `projeto = 'sentinela-ponte-google'`;
- `projeto_id` = o `prj_` do projeto na Vercel;
- `url` = o `/exec` do app;
- `sistema_slug = 'operacao-logistica'`;
- `exige_login = true`;
- `ultimo_sinal` preenchido no cadastro, porque a ponte não manda eventos: ela não vê o IP de quem usa o app.

Sem `ultimo_sinal` a central entrega o link sem passe (`guarda_ativo = false`).

## Ordem da virada
1. A ponte no ar, com a `PONTE_CHAVE`.
2. O cadastro na Sentinela. O app antigo ignora o `?sentinela_passe=`.
3. O dono publica a versão com a porta (`apps-script/LEIA-ME.md`), no mesmo link.
4. `public.sistemas.abre_no_painel = true` (o app permite o quadro com `ALLOWALL`).
5. Conferir:
   - de fora, o link direto mostra "Este sistema abre só pelo Painel Lube";
   - pelo painel, abre e grava.

**Volta:** o dono publica a versão anterior no mesmo link, `abre_no_painel = false`, e o cadastro na Sentinela fica
`ativo = false`.

## Testes
```
cd ponte && npm test                         # 12: assinatura, janela, corpo, OIDC, central, sessão, prazo, handler
node --test apps-script/testes/porta.test.js # 7: o PortaLube.gs num Google de mentira com a ponte de verdade
```

O código do dono **não entra neste repositório** (`apps-script/codigo-do-dono/` fica no `.gitignore`).
