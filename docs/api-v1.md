# API REST v1 — primeira vertical slice

Todas as respostas de erro seguem:

```json
{
  "error": {
    "code": "AUTOSAVE_CONFLICT",
    "message": "O rascunho foi alterado em outra sessão.",
    "details": {},
    "requestId": "uuid",
    "retryable": false
  }
}
```

Rotas protegidas exigem `Authorization: Bearer <token>`.

## Inicialização e sessão

### `POST /api/v1/bootstrap`

Cria a primeira organização, usuário owner e tema padrão. Só funciona se ainda não existir usuário. Em produção exige `ALLOW_BOOTSTRAP=true`.

```json
{
  "organizationName": "Jump Label",
  "name": "Pessoa gestora",
  "email": "gestor@jump.local",
  "password": "mínimo-10-caracteres"
}
```

### `POST /api/v1/auth/login`

Retorna token de oito horas, expiração e usuário.

### `GET /api/v1/auth/me`

Retorna usuário e organização da sessão.

### `POST /api/v1/auth/logout`

Revoga a sessão atual.

### `POST /api/v1/auth/change-password`

Troca a senha, remove a exigência de primeiro acesso e revoga as outras sessões do usuário.

## Pessoas e permissões

As rotas abaixo exigem papel `owner`.

### `GET /api/v1/members`

Lista membros da organização autenticada.

### `POST /api/v1/members`

Cria editor, revisor ou visualizador com senha temporária e troca obrigatória no primeiro acesso.

```json
{
  "name": "Pessoa editora",
  "email": "editor@jump.local",
  "role": "editor",
  "temporaryPassword": "mínimo-10-caracteres"
}
```

### `PATCH /api/v1/members/:id`

Altera papel ou status. O último proprietário ativo não pode ser removido, e um usuário não pode desativar a própria conta.

## Apresentações

### `GET /api/v1/presentations`

Lista apresentações não arquivadas da organização autenticada.

### `POST /api/v1/presentations`

```json
{ "title": "Proposta comercial" }
```

Cria atomicamente apresentação, primeira versão, rascunho e auditoria.

### `GET /api/v1/presentations/:id`

Retorna metadados, versão atual e rascunho persistido.

### `PATCH /api/v1/presentations/:id`

Altera o título da apresentação para owners e editores e registra auditoria.

### `PUT /api/v1/presentations/:id/draft`

```json
{
  "baseVersionId": "uuid",
  "expectedRevision": 1,
  "clientMutationId": "uuid",
  "content": {
    "schemaVersion": "1.0",
    "canvas": { "width": 1920, "height": 1080, "ratio": "16:9" },
    "themeId": "uuid",
    "slides": []
  }
}
```

Valida o JSON compartilhado, aplica idempotência e retorna a nova revisão. Conflitos retornam `409 AUTOSAVE_CONFLICT`.

### `POST /api/v1/presentations/:id/checkpoints`

```json
{
  "baseVersionId": "uuid",
  "draftRevision": 2,
  "clientMutationId": "uuid"
}
```

Cria uma versão imutável, atualiza a versão atual e reposiciona o rascunho.

### `GET /api/v1/presentations/:id/versions`

Lista checkpoints em ordem decrescente.

### `GET /api/v1/presentations/:id/preview`

Retorna `text/html` renderizado do rascunho atual. A autorização é verificada antes da renderização.

## Biblioteca Jump

Owners e revisores acessam e gerenciam a biblioteca administrativa. Os demais perfis não recebem rascunhos, rejeições ou fontes internas por essas rotas.

### `GET /api/v1/jump-contents`

Lista conteúdos da organização. Aceita os filtros `q`, `status` e `kind`.

### `POST /api/v1/jump-contents`

Cria um rascunho e sua primeira versão imutável.

```json
{
  "kind": "service",
  "title": "Modernização de plataformas",
  "text": "Descrição institucional validada.",
  "sourceLabel": "Apresentação institucional v4",
  "sourceUrl": "https://exemplo.interno/documento",
  "sourceLocator": "slide 4",
  "validFrom": "2026-01-01",
  "validUntil": "2026-12-31",
  "tags": ["modernização", "serviços"]
}
```

### `PUT /api/v1/jump-contents/:id`

Cria uma nova versão. Se o conteúdo estava aprovado, ele volta a rascunho e deixa de ser elegível para a IA até nova aprovação. Conteúdos em revisão ou arquivados não podem ser editados.

### `GET /api/v1/jump-contents/:id`

Retorna o conteúdo, todas as versões e o histórico de submissão, aprovação, rejeição e arquivamento.

### Transições

- `POST /api/v1/jump-contents/:id/submit`
- `POST /api/v1/jump-contents/:id/approve`
- `POST /api/v1/jump-contents/:id/reject` com `{"note":"motivo obrigatório"}`
- `POST /api/v1/jump-contents/:id/archive`
- `POST /api/v1/jump-contents/:id/restore`

A restauração transforma um item arquivado em rascunho e não recupera aprovação anterior. A aprovação exige fonte, início e fim de validade. Transições inválidas retornam HTTP 409.

### `POST /api/v1/jump-contents/examples`

Carrega seis exemplos extraídos do site institucional como rascunhos que ainda exigem revisão humana, definição de validade e aprovação. A operação é idempotente: chamadas posteriores ignoram os exemplos já existentes.

### `GET /api/v1/jump-context`

Contrato dedicado aos futuros jobs de IA. Retorna exclusivamente a versão atual de conteúdos aprovados, com fonte e vigentes na data da consulta. Aceita o filtro `q`; conteúdos vencidos, futuros, arquivados, rejeitados ou alterados depois da aprovação ficam de fora.

## Geração assistida por IA

### `POST /api/v1/ai/outlines`

Gera e persiste um roteiro usando DeepSeek. A solicitação exige `idempotencyKey` UUID e um briefing com prompt, objetivo, público, tom, idioma e quantidade de slides. O backend fornece ao modelo somente conteúdo Jump aprovado e vigente, rejeita referências desconhecidas e registra modelo, duração, uso e erro sanitizado.

```json
{
  "idempotencyKey": "uuid",
  "provider": "deepseek",
  "briefing": {
    "prompt": "Crie uma proposta institucional",
    "objective": "Apresentar a empresa",
    "audience": "Diretoria de tecnologia",
    "tone": "Executivo e consultivo",
    "language": "pt-BR",
    "slideCount": 6
  }
}
```

### `GET /api/v1/ai/outlines`

Lista os roteiros persistidos da organização.

### `GET /api/v1/ai/outlines/:id`

Consulta um roteiro da organização autenticada.

### `POST /api/v1/ai/outlines/:id/approve`

Aprova um roteiro em rascunho usando controle otimista por `expectedRevision`. A geração da apresentação completa permanece uma etapa separada.

### `POST /api/v1/ai/outlines/:id/presentation`

Desenvolve os slides de um roteiro aprovado, valida quantidade, ordem, layouts, títulos e referências e persiste uma apresentação canônica com versão inicial e rascunho editável. A solicitação exige uma nova `idempotencyKey`; repeti-la retorna a mesma apresentação sem nova chamada ao provedor.

### `POST /api/v1/presentations/:id/slides/:slideId/regenerate`

Owners e editores podem refazer o conteúdo de um slide do rascunho. Envie `idempotencyKey`, `baseVersionId`, `expectedRevision` e `instruction`. A operação mantém o layout, o título existente, as imagens e os demais slides. O retorno inclui `job`, `draft` atualizado e `regeneratedSlideId`. Se outra alteração mudar o rascunho durante a chamada, a API retorna `409 AUTOSAVE_CONFLICT`.

Para habilitar chamadas reais, crie `.env.local` fora do Git com `DEEPSEEK_API_KEY`, `DEEPSEEK_MODEL` e `DECKAI_ENABLE_REAL_DEEPSEEK=true`. Sem isso, o endpoint retorna erro controlado e não simula sucesso.
