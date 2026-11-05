# Backlog priorizado — Desenvolvedor 3 / Deck AI

Este backlog transforma os contratos e modelos iniciais em etapas de execução. As estimativas são aproximadas e dependem da escolha de tecnologias e do repositório.

## P0 — Bloqueadores do MVP

| ID | Tarefa | Dependência | Aceite |
|---|---|---|---|
| P0-01 | Confirmar PostgreSQL, storage privado, fila e OIDC | decisão conjunta | tecnologias escolhidas e registradas |
| P0-02 | Criar migrações de organizações e usuários | P0-01 | usuário pertence a uma organização |
| P0-03 | Implementar autenticação OIDC | P0-02 | API identifica usuário autenticado |
| P0-04 | Implementar autorização por organização e papel | P0-03 | acesso indevido retorna 403 |
| P0-05 | Criar tabelas de apresentações e versões | contrato JSON | versões antigas não são sobrescritas |
| P0-06 | Criar upload e metadados de assets | storage | arquivo privado com hash e MIME validados |
| P0-07 | Criar CRUD de conteúdo Jump | P0-02, P0-06 | criar, editar e arquivar conteúdo |
| P0-08 | Criar revisão e aprovação Jump | P0-07 | aprovado exige fonte, validade e reviewer |
| P0-09 | Criar consulta de conteúdo elegível para IA | P0-08 | retorna somente aprovado e vigente |
| P0-10 | Criar tabela e worker de jobs | P0-01 | job possui lease, tentativa e estado |
| P0-11 | Implementar idempotência e retentativas | P0-10 | duplicata não gera dois efeitos |
| P0-12 | Criar exportação HTML offline | renderer compartilhado | pacote abre sem internet |
| P0-13 | Criar exportação PDF | HTML/renderer | uma página por slide |
| P0-14 | Fazer prova técnica de PPTX | layouts e renderer | arquivo abre e edição mínima é confirmada |
| P0-15 | Implementar download com URL temporária | storage e autorização | usuário não autorizado não baixa |
| P0-16 | Criar auditoria e logs básicos | todos os fluxos | aprovação, exportação e download rastreáveis |

## P1 — Necessário para um piloto utilizável

| ID | Tarefa | Dependência | Aceite |
|---|---|---|---|
| P1-01 | Área administrativa Jump | P0-07, P0-08 | reviewer lista pendências e decide |
| P1-02 | Busca textual por título, categoria e tags | P0-07 | resultados filtrados por organização |
| P1-03 | Expiração automática ou consulta por data | P0-08 | vencidos não aparecem como aprovados |
| P1-04 | Histórico de ações | P0-16 | linha do tempo por recurso |
| P1-05 | Reprocessamento de dead letter | P0-10 | job falho pode ser retomado com segurança |
| P1-06 | Métricas de jobs e exportações | P0-10 | duração, falha e retry visíveis |
| P1-07 | Backup e teste de restauração | banco/storage | restauração documentada |
| P1-08 | Testes de fidelidade HTML/PDF/PPTX | P0-12, P0-13, P0-14 | critérios por formato atendidos |
| P1-09 | Limites de tamanho, timeout e retenção | P0-06, P0-10 | recursos abusivos são rejeitados |

## P2 — Depois do piloto

- múltiplos kits com regras próprias;
- aprovação multinível;
- busca semântica;
- OCR e extração avançada de documentos;
- colaboração simultânea;
- permissões por bloco ou slide;
- retenção configurável por organização;
- processamento distribuído para grande volume;
- PowerPoint completamente editável;
- gestão avançada de custos e quotas.

## Ordem prática de execução

```text
1. decisões técnicas
2. organizações, usuários e permissões
3. apresentações e versões
4. assets e storage
5. Jump e aprovação
6. jobs e idempotência
7. HTML e PDF
8. prova de PPTX
9. downloads e auditoria
10. testes e recuperação
```

## Bloqueios atuais

1. Repositório Git ainda não está disponível localmente.
2. Provedor OIDC não escolhido.
3. Provedor de storage e fila não escolhido.
4. Nível de edição do PPTX ainda não aprovado.
5. Definição de HTML autônomo ainda precisa ser aceita pelo grupo.
6. Não há conteúdo Jump real aprovado para homologação nesta pasta.
7. Critérios de fidelidade visual ainda precisam de exemplos de referência.

## Resultado esperado do MVP

Um usuário autorizado consegue criar uma apresentação, salvar versões, usar conteúdo Jump aprovado, gerar um job de exportação, acompanhar o estado, baixar HTML/PDF/PPTX e recuperar-se de falhas sem perder o histórico.
