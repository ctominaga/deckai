# Contratos iniciais — Deck AI / Dev 3

Documento de discussão para o MVP. Ainda não representa decisões finais.

## 1. Apresentação e versão

```json
{
  "presentationId": "pres_001",
  "title": "Apresentação institucional",
  "status": "draft",
  "currentVersionId": "ver_001",
  "version": {
    "versionId": "ver_001",
    "schemaVersion": "1.0",
    "createdBy": "user_001",
    "createdAt": "2026-11-05T12:00:00Z",
    "content": {
      "canvas": { "width": 1920, "height": 1080, "ratio": "16:9" },
      "themeId": "jump-default",
      "slides": [
        {
          "slideId": "slide_001",
          "layout": "cover",
          "blocks": [
            { "id": "block_001", "type": "text", "role": "title", "text": "Título" },
            { "id": "block_002", "type": "text", "role": "subtitle", "text": "Subtítulo" }
          ],
          "references": []
        }
      ]
    }
  }
}
```

Regra: uma versão confirmada não é sobrescrita. Uma alteração cria uma nova versão baseada em `baseVersionId`.

## 2. Conteúdo Jump

```json
{
  "contentId": "jump_001",
  "title": "Descrição do serviço X",
  "category": "servicos",
  "tags": ["institucional", "produto"],
  "body": "Texto aprovado pela Jump.",
  "status": "approved",
  "validFrom": "2026-01-01",
  "validUntil": "2027-01-01",
  "source": {
    "type": "document",
    "label": "Manual institucional",
    "assetId": "asset_001",
    "locator": "página 4"
  },
  "version": 1,
  "approvedBy": "user_reviewer",
  "approvedAt": "2026-11-05T12:00:00Z"
}
```

Estados: `draft`, `in_review`, `approved`, `rejected`, `expired`, `archived`.

Regra de elegibilidade para a IA:

```text
status = approved
AND validFrom <= hoje
AND validUntil >= hoje
AND source existe
AND não há conflito aberto
```

## 3. Referências

```json
{
  "referenceId": "ref_001",
  "contentId": "jump_001",
  "claimId": "claim_001",
  "sourceLabel": "Manual institucional",
  "locator": "página 4",
  "capturedAt": "2026-11-05T12:00:00Z"
}
```

Toda afirmação factual de um slide deve poder apontar para uma referência ou ser marcada como dado fornecido pelo usuário.

## 4. Permissões

Papéis iniciais:

| Papel | Ações |
|---|---|
| `owner` | gerenciar organização, usuários e apresentações |
| `editor` | criar, editar, gerar e exportar |
| `reviewer` | revisar e aprovar conteúdo Jump |
| `viewer` | visualizar e baixar quando permitido |

```json
{
  "organizationId": "org_001",
  "userId": "user_001",
  "resourceType": "presentation",
  "resourceId": "pres_001",
  "role": "editor"
}
```

## 5. Jobs

```json
{
  "jobId": "job_001",
  "type": "export_pptx",
  "status": "queued",
  "attempt": 1,
  "maxAttempts": 3,
  "idempotencyKey": "ver_001:pptx",
  "error": null
}
```

Estados: `queued`, `running`, `retrying`, `succeeded`, `failed`, `cancelled`, `dead_letter`.

Erros transitórios podem ser retentados. Erros de validação, como layout inválido ou fonte ausente, devem falhar sem repetir automaticamente.

## 6. Exportações

```json
{
  "exportId": "export_001",
  "presentationId": "pres_001",
  "versionId": "ver_001",
  "format": "pdf",
  "status": "queued",
  "jobId": "job_001",
  "artifact": null
}
```

Formato do artefato concluído:

```json
{
  "assetId": "asset_export_001",
  "format": "pdf",
  "mediaType": "application/pdf",
  "sizeBytes": 182000,
  "contentHash": "sha256:...",
  "downloadExpiresAt": "2026-11-05T13:00:00Z"
}
```

## 7. Endpoints iniciais

```text
POST /presentations
GET  /presentations/{id}
POST /presentations/{id}/versions
GET  /presentations/{id}/versions

POST /jump-content
POST /jump-content/{id}/submit-review
POST /jump-content/{id}/approve
GET  /jump-content?status=approved&validAt=2026-11-05

POST /exports
GET  /exports/{id}
POST /exports/{id}/download
```

## 8. Próximas decisões

1. O autosave cria rascunho ou nova versão?
2. O usuário pode editar conteúdo aprovado ou precisa criar nova versão?
3. O HTML será um arquivo único ou um pacote `.zip` offline?
4. Quais elementos do PPTX precisam ser editáveis no MVP?
5. Qual política será usada para conflito entre fontes?
6. Qual será o limite de tamanho e tempo de cada exportação?
