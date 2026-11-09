# Local store de apresentações

Este módulo simula o comportamento de apresentações e versões no navegador usando `localStorage`.

## Operações

- `listPresentations()` lista apresentações locais;
- `getPresentation(id)` recupera uma apresentação;
- `createPresentation({ title, content })` cria a primeira versão;
- `saveVersion({ presentationId, baseVersionId, content })` cria uma nova versão;
- `clearLocalPresentations()` limpa os dados do protótipo.

## Regras simuladas

- uma apresentação começa na versão 1;
- versões anteriores são preservadas;
- `baseVersionId` evita salvar sobre uma versão desatualizada;
- conteúdo sem `slides` é rejeitado;
- o banco real deverá substituir este módulo depois.
