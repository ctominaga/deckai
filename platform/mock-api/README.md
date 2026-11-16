# APIs simuladas de IA

Estas respostas permitem desenvolver o editor antes da integração real com o Gemini.

## Fluxo

```text
briefing → roteiro → aprovação → apresentação → alteração localizada
```

## Endpoints previstos

```text
POST /api/ai/outline
POST /api/ai/outline/{id}/approve
POST /api/ai/presentation
POST /api/ai/slides/{slideId}/regenerate
POST /api/ai/blocks/{blockId}/rewrite
GET  /api/jobs/{jobId}
```

Todas as respostas devem incluir `requestId`, `jobId` quando assíncronas e referências quando houver conteúdo factual.

## Executar a API local

Sem instalar dependências:

```text
node platform/mock-api/server.mjs
```

Health check:

```text
GET http://127.0.0.1:8787/health
```

Exemplo de geração de roteiro:

```text
POST http://127.0.0.1:8787/api/ai/outline
Content-Type: application/json
```
