# Auditoria local

O módulo registra eventos importantes do protótipo:

- apresentação criada;
- nova versão salva;
- conteúdo Jump enviado para revisão;
- conteúdo aprovado ou rejeitado;
- job criado ou reutilizado;
- exportação concluída;
- download solicitado.

Exemplo:

```js
recordAudit({
  event: "jump_content_approved",
  actorId: "reviewer-01",
  resourceType: "jump_content",
  resourceId: "jump_001",
  details: { validUntil: "2027-12-31" }
});
```

No backend, os eventos devem ser gravados em uma tabela imutável e vinculados a `requestId` ou `traceId`.
