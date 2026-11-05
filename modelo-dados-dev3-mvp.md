# Modelo de dados inicial — Deck AI

Modelo relacional proposto para discussão. Não é uma migration final.

## Entidades principais

### organizations

| Campo | Tipo | Regra |
|---|---|---|
| id | UUID | chave primária |
| name | texto | obrigatório |
| created_at | timestamp | obrigatório |

### users

| Campo | Tipo | Regra |
|---|---|---|
| id | UUID | chave primária |
| organization_id | UUID | obrigatório |
| email | texto | único por organização |
| name | texto | obrigatório |
| role | enum | owner, editor, reviewer, viewer |
| created_at | timestamp | obrigatório |

### presentations

| Campo | Tipo | Regra |
|---|---|---|
| id | UUID | chave primária |
| organization_id | UUID | obrigatório |
| title | texto | obrigatório |
| status | enum | draft, archived |
| current_version_id | UUID | versão atual |
| created_by | UUID | usuário autor |
| created_at | timestamp | obrigatório |
| updated_at | timestamp | obrigatório |

### presentation_versions

| Campo | Tipo | Regra |
|---|---|---|
| id | UUID | chave primária |
| presentation_id | UUID | obrigatório |
| version_number | inteiro | crescente por apresentação |
| schema_version | texto | exemplo: 1.0 |
| content_json | JSONB | apresentação completa |
| content_hash | texto | hash do JSON |
| base_version_id | UUID | versão de origem, opcional |
| created_by | UUID | obrigatório |
| created_at | timestamp | obrigatório |

Uma versão confirmada não deve ser atualizada. Alterações criam outra linha.

### assets

| Campo | Tipo | Regra |
|---|---|---|
| id | UUID | chave primária |
| organization_id | UUID | obrigatório |
| kind | enum | image, document, html, pdf, pptx |
| storage_key | texto | caminho privado no storage |
| media_type | texto | MIME type |
| size_bytes | inteiro | obrigatório |
| content_hash | texto | obrigatório |
| created_by | UUID | obrigatório |
| created_at | timestamp | obrigatório |

### jump_contents

| Campo | Tipo | Regra |
|---|---|---|
| id | UUID | chave primária |
| organization_id | UUID | obrigatório |
| title | texto | obrigatório |
| category | texto | obrigatório |
| body_json | JSONB | conteúdo estruturado |
| status | enum | draft, in_review, approved, rejected, expired, archived |
| valid_from | date | obrigatório para aprovação |
| valid_until | date | obrigatório para aprovação |
| version_number | inteiro | crescente por conteúdo |
| source_asset_id | UUID | documento ou imagem de origem |
| created_by | UUID | obrigatório |
| approved_by | UUID | obrigatório quando aprovado |
| approved_at | timestamp | obrigatório quando aprovado |
| created_at | timestamp | obrigatório |

### jump_tags

| Campo | Tipo |
|---|---|
| id | UUID |
| organization_id | UUID |
| name | texto |

### jump_content_tags

| Campo | Tipo |
|---|---|
| content_id | UUID |
| tag_id | UUID |

### references

| Campo | Tipo | Regra |
|---|---|---|
| id | UUID | chave primária |
| content_id | UUID | conteúdo Jump usado |
| claim_id | texto | identificação da afirmação |
| source_asset_id | UUID | origem rastreável |
| locator | JSONB | página, seção ou posição |
| excerpt | texto | trecho curto opcional |
| captured_at | timestamp | momento do registro |

### jobs

| Campo | Tipo | Regra |
|---|---|---|
| id | UUID | chave primária |
| organization_id | UUID | obrigatório |
| type | enum | generate, export_html, export_pdf, export_pptx |
| status | enum | queued, running, retrying, succeeded, failed, cancelled, dead_letter |
| idempotency_key | texto | único por operação lógica |
| attempt | inteiro | começa em 1 |
| max_attempts | inteiro | padrão 3 |
| available_at | timestamp | próxima tentativa |
| locked_until | timestamp | lease do worker |
| error_json | JSONB | código, mensagem e retryable |
| created_at | timestamp | obrigatório |
| updated_at | timestamp | obrigatório |

### exports

| Campo | Tipo | Regra |
|---|---|---|
| id | UUID | chave primária |
| presentation_id | UUID | obrigatório |
| version_id | UUID | versão exata exportada |
| format | enum | html, pdf, pptx |
| status | enum | queued, running, succeeded, failed |
| job_id | UUID | job responsável |
| artifact_asset_id | UUID | preenchido ao concluir |
| requested_by | UUID | obrigatório |
| created_at | timestamp | obrigatório |

## Relações essenciais

```text
organization 1──N users
organization 1──N presentations
presentation 1──N presentation_versions
organization 1──N jump_contents
jump_content N──N jump_tags
jump_content 1──N references
presentation_version 1──N exports
export 1──1 job
asset 1──N referências ou artefatos conforme o uso
```

## Índices mínimos

- `users(organization_id, email)`;
- `presentations(organization_id, updated_at)`;
- `presentation_versions(presentation_id, version_number)`;
- `jump_contents(organization_id, status, valid_from, valid_until)`;
- `jump_contents(organization_id, category)`;
- `jobs(status, available_at)`;
- `jobs(idempotency_key)` único;
- `exports(presentation_id, version_id, format)`.

## Regras de integridade

1. Nenhum recurso pode ser acessado fora da organização do usuário.
2. Conteúdo `approved` precisa ter fonte, aprovação e período de validade.
3. Conteúdo vencido não pode aparecer na consulta elegível da IA.
4. Versões não podem ser apagadas durante o MVP.
5. Um job com a mesma chave idempotente não deve gerar dois efeitos finais.
6. Uma exportação deve apontar para uma versão específica, nunca para “a versão atual” de forma ambígua.
7. Artefatos devem ser privados e baixados por URL temporária.

## Critérios de aceite desta etapa

- todas as entidades dos contratos possuem representação no modelo;
- apresentação e conteúdo Jump têm histórico sem sobrescrita;
- é possível filtrar conteúdo aprovado e vigente;
- jobs podem ser retomados após falha;
- exportações ficam vinculadas à versão correta;
- permissões podem ser verificadas por organização e papel.
