# OPERAÇÃO LOGÍSTICA — como fechar o sistema para abrir só pelo Painel Lube

Para quem é o dono do script do Google (o editor do Apps Script). Nada disso apaga dado.
Tempo: uns 20 minutos. Se preferir, mande o código para o TI e a adaptação (passos 3 a 7) vem pronta.

## Por quê
Hoje quem tem o link e uma conta Google consegue abrir o sistema e mexer. Depois destes passos:
- o sistema só abre pelo cartão **OPERAÇÃO LOGÍSTICA** do Painel Lube (quem o TI liberou);
- quem abrir o link direto vê "Este sistema abre só pelo Painel Lube";
- toda gravação confere se a pessoa entrou pelo painel.

## Antes (TI)
O TI já deixou a ponte no ar (`sentinela-ponte-google.vercel.app`) e o sistema cadastrado na Sentinela. O Júlio passa a
**PONTE_CHAVE** para você por um canal seguro, nunca pelo grupo.

## Passo a passo no editor do Apps Script
1. **A chave:** Configurações do projeto (engrenagem) › Propriedades do script › Adicionar propriedade.
   Nome `PONTE_CHAVE`, valor: a chave que o Júlio passou. Nunca escreva a chave dentro do código.
2. **Os dois arquivos novos:** crie o arquivo de script `PortaLube` e cole o conteúdo de `PortaLube.gs`. Crie o arquivo
   HTML `PortaLube_Negado` e cole o conteúdo de `PortaLube_Negado.html`.
3. **O doGet antigo:** no seu código, troque o nome `function doGet(e)` para `function doGetOriginal_(e)`. O `doGet` agora
   é o do PortaLube, que confere a entrada e depois chama o seu.
4. **As funções que o navegador chama** (as que aparecem em `google.script.run.X(...)`): acrescente `_` no fim do nome
   (`salvar` vira `salvar_`) e liste todas assim, num arquivo seu:
   ```js
   function portaLube_funcoes_() {
     return { salvar: salvar_, listar: listar_ };   // nome que o navegador usa : função de verdade
   }
   ```
   Função que termina com `_` o Google não deixa o navegador chamar direto.
5. **No HTML**, troque cada chamada:
   `google.script.run.withSuccessHandler(ok).salvar(a, b)` por
   `google.script.run.withSuccessHandler(ok).api(PORTA_LUBE_TOKEN, 'salvar', [a, b])`.
6. **Links de uma página para outra do próprio sistema** (se houver `?pagina=...`): acrescente
   `&porta_lube=` + `PORTA_LUBE_TOKEN`, senão a outra página pede o painel de novo.
7. **Quem mexeu:** se o código usa `Session.getActiveUser().getEmail()`, troque por `portaLube_usuario().email`. Esse é o
   e-mail de quem entrou pelo painel. Se houver `doPost`, avise o TI antes de publicar: ele também precisa de porta.
8. **Publicar no mesmo link:** Implantar › Gerenciar implantações › lápis na implantação atual.
   - Versão: **Nova versão**.
   - Executar como: **Eu** (o dono).
   - Quem pode acessar: **Qualquer pessoa**.
   - Clique em Implantar. O link não muda.
   - Não crie uma implantação nova: ela gera outro link.
9. **A planilha:** como o sistema passa a rodar com a sua conta, ninguém mais precisa de acesso à planilha. Em
   Compartilhar, tire "Qualquer pessoa com o link" e quem não precisa editar direto nela.
10. **Avise o TI.** O Claude confere de fora que o link direto está fechado e que pelo painel abre e grava.

## Depois de fechado: como continuar mexendo no sistema
Você continua sendo o dono: mexe no código e na planilha como hoje. A cada mudança:
1. **Não tire a porta.** O arquivo `PortaLube` e o nome `doGetOriginal_` ficam como estão. Sem eles o link volta a abrir
   para qualquer um.
2. **Função nova que o navegador chama:**
   - nome terminando em `_`;
   - entrada na lista `portaLube_funcoes_`;
   - chamada por `api(PORTA_LUBE_TOKEN, 'nome', [...])`.

   Se esquecer a lista, o botão dá "Função não liberada" (falha, mas fechado). Se criar sem o `_` no fim, a função fica
   aberta para quem tiver o link: é o cuidado principal.
3. **Publique sempre na implantação atual:** Gerenciar implantações › lápis › Nova versão. Uma implantação nova gera
   outro link, fora do painel.
4. **Para testar:** o link de teste do Google (`/dev`) também mostra "abre só pelo Painel Lube", porque não recebe o passe.
   Peça ao TI o cartão OPERAÇÃO LOGÍSTICA no painel, publique a nova versão e confira por lá. Para desfazer, volte à
   versão anterior (abaixo).

## Se der errado
Implantar › Gerenciar implantações › lápis › Versão: escolha a versão anterior › Implantar. Volta como era, no mesmo link.
