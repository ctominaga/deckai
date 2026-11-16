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
