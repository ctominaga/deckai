# Exportações locais

O módulo simula o ciclo de exportação:

```text
requestExport → queued → completeExport
                         ↘ failExport
```

Cada solicitação fica vinculada a uma apresentação, uma versão e um formato. A chave de idempotência impede que o mesmo arquivo seja solicitado duas vezes.

Formatos aceitos:

- `html`: pacote offline;
- `pdf`: uma página por slide;
- `pptx`: PowerPoint híbrido, com edição limitada aos elementos suportados.

Os metadados do artefato incluem tipo MIME, tamanho, hash e expiração simulada do download.
