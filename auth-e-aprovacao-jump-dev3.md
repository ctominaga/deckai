# Autenticação, permissões e aprovação Jump — Deck AI

Especificação inicial do MVP para discussão e futura implementação.

## 1. Autenticação

Recomendação: usar um provedor de identidade externo compatível com OIDC. O Deck AI não deve armazenar senhas no MVP.

Fluxo:

```text
usuário acessa o Deck AI
        ↓
login no provedor de identidade
        ↓
API valida o token
        ↓
API encontra ou cria o usuário local
        ↓
API verifica organização e papel
        ↓
usuário acessa somente recursos permitidos
```

Dados locais mínimos:

```json
{
  "userId": "user_001",
  "identityProviderId": "oidc_abc",
  "organizationId": "org_001",
  "email": "pessoa@jump.com",
  "name": "Pessoa Jump",
  "role": "editor",
  "status": "active"
}
```

## 2. Papéis

| Papel | Apresentações | Conteúdo Jump | Exportação | Usuários |
|---|---|---|---|---|
| `owner` | gerenciar tudo | gerenciar tudo | gerar/baixar | gerenciar |
| `editor` | criar e editar | consultar aprovado | gerar/baixar | não gerenciar |
| `reviewer` | visualizar | revisar/aprovar | visualizar/baixar | não gerenciar |
| `viewer` | visualizar | consultar aprovado | baixar se permitido | não gerenciar |

Todo endpoint deve verificar o papel no servidor. Esconder um botão na interface não é controle de segurança.

## 3. Regras de acesso

1. Cada recurso pertence a uma organização.
2. O usuário só pode acessar recursos da própria organização.
3. Permissões específicas podem restringir uma apresentação, se necessário.
4. Conteúdo aprovado não pode ser editado diretamente; alterações criam nova versão.
5. Aprovação e rejeição precisam registrar usuário, data e motivo.
6. Download de arquivo exige permissão no recurso original.
7. Ações administrativas entram na auditoria.

## 4. Fluxo de conteúdo Jump

```text
draft → in_review → approved
                 ↘ rejected → draft

approved → expired ou archived
```

Ao criar um rascunho, o autor informa título, categoria, texto, tags e fonte. O sistema valida tamanho, tipo de arquivo e campos obrigatórios.

Ao enviar para revisão, o conteúdo precisa ter pelo menos uma fonte. O status muda para `in_review`.

Para aprovar, o reviewer confirma texto, fonte, validade, categoria e ausência de conflito. A aprovação registra `approvedBy`, `approvedAt`, `validFrom` e `validUntil`.

A rejeição exige um motivo. O autor pode corrigir e enviar novamente, criando uma nova revisão.

## 5. Consulta elegível para a IA

```text
GET /jump-content/eligible
```

Filtros obrigatórios no servidor:

```text
organization_id = organização do usuário
status = approved
valid_from <= data atual
valid_until >= data atual
source_asset_id não é nulo
sem conflito aberto
```

Se não houver conteúdo elegível:

```json
{
  "items": [],
  "warnings": [
    {
      "code": "NO_APPROVED_SOURCE",
      "message": "Não há conteúdo aprovado para responder a esta afirmação."
    }
  ]
}
```

## 6. Conteúdo vencido ou contraditório

- vencido não entra automaticamente no contexto da IA;
- sem fonte pode ser tratado apenas como informação fornecida pelo usuário, com aviso;
- contraditório exige confirmação ou exibição do conflito;
- rejeitado não pode ser usado como conteúdo institucional aprovado;
- arquivado não aparece em consultas normais.

## 7. Auditoria

```json
{
  "event": "jump_content_approved",
  "actorId": "user_reviewer",
  "resourceId": "jump_001",
  "previousStatus": "in_review",
  "newStatus": "approved",
  "timestamp": "2026-11-05T12:00:00Z",
  "requestId": "req_001"
}
```

Eventos importantes: login, alteração de permissões, upload, download, envio para revisão, aprovação, rejeição, expiração, arquivamento, consulta pela IA e exportação.

## 8. Critérios de aceite

- usuário não autenticado não acessa dados;
- usuário de uma organização não acessa outra;
- editor não aprova conteúdo;
- reviewer aprova conteúdo com fonte e validade;
- conteúdo sem fonte não pode ser aprovado;
- conteúdo vencido não é retornado como elegível;
- toda aprovação registra autor e horário;
- alterações preservam a versão anterior;
- tentativas negadas geram erro consistente e auditoria;
- a IA recebe referências junto com o conteúdo aprovado.

## 9. Decisões pendentes

1. Qual provedor OIDC será usado?
2. Uma pessoa pode ter mais de um papel?
3. O papel vale para toda a organização ou também por apresentação?
4. Quem pode alterar a validade depois da aprovação?
5. Como os reviewers serão notificados?
6. Quais tipos de documento entram no primeiro kit?
