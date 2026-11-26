# Vertical slice 01 — organização, apresentação, editor e preview

## Diagnóstico

A base anterior comprova fluxos, mas não é a aplicação final: `preview-dev3` usa `localStorage`, e `platform/api` usa um arquivo JSON. A nova base mantém esses arquivos como referência e começa uma aplicação TypeScript integrada.

## Arquitetura concreta

Monólito modular em um repositório:

- `apps/api`: API REST Fastify, autenticação, autorização e módulos de apresentação;
- `apps/web`: interface TypeScript/Vite;
- `packages/contracts`: tipos e validações Zod compartilhados;
- `packages/renderer`: projeção HTML segura do JSON canônico;
- `db/migrations`: migrations SQL versionadas;
- `private-data`: banco PGlite local ignorado pelo Git.

O acesso a dados suporta dois modos:

1. sem `DATABASE_URL`: PostgreSQL local via PGlite, persistente em arquivo;
2. com `DATABASE_URL`: PostgreSQL servidor via pool `pg`.

PGlite é usado apenas para desenvolvimento reproduzível nesta máquina, que não possui Docker nem `psql`. PostgreSQL servidor continua sendo o alvo de homologação e produção.

Por segurança, a API local não usa reinicialização automática enquanto PGlite está aberto. Após alterar o backend ou criar uma migration, encerre `npm.cmd run dev`, execute a migration e inicie novamente.

## Decisões da slice

- JSON `schemaVersion: 1.0` é a fonte canônica.
- Slides e blocos ficam no JSONB, não em tabelas paralelas.
- Autosave atualiza `presentation_drafts` com revisão otimista.
- Checkpoint cria `presentation_versions` imutável.
- Conflitos retornam HTTP 409; não há merge automático no MVP.
- Toda consulta de apresentação inclui `organization_id`.
- Tokens de sessão são aleatórios e somente o SHA-256 é persistido.
- Senhas locais usam `scrypt`; OIDC continua como decisão futura.
- Novos membros recebem senha temporária e são obrigados a trocá-la no primeiro acesso.
- Somente `owner` gerencia membros; a organização sempre mantém ao menos um proprietário ativo.
- Integridade composta impede referências entre organizações no banco.
- Autosaves possuem idempotência persistente e auditoria na mesma transação.
- Migrations usam lock e checksum para evitar aplicação concorrente ou alteração silenciosa.
- Login possui limite de tentativas e derivação de senha assíncrona.
- Preview e editor usam o mesmo renderer HTML, com escape de conteúdo.
- IA, jobs executáveis, storage, PDF e PPTX ficam fora desta slice conforme a ordem aprovada.
- O editor permite renomear, duplicar, excluir e reordenar slides, gerenciar blocos e consultar checkpoints.
- Uma versão histórica pode ser restaurada como rascunho sem apagar versões posteriores.
- A biblioteca Jump possui versões imutáveis, fonte obrigatória, validade, busca, tags e workflow editorial auditado.
- A futura IA possui uma consulta separada que expõe somente conteúdo aprovado, vigente e sem alteração posterior à aprovação.
- Conteúdos arquivados podem ser restaurados como rascunho, sem recuperar automaticamente a aprovação anterior.
- Exemplos públicos podem ser carregados de forma idempotente, sempre como rascunhos sujeitos à revisão humana.
- A geração de roteiro com DeepSeek possui validação estrutural, idempotência, persistência de diagnóstico e acesso somente ao conteúdo Jump elegível.
- A chamada real de IA permanece desativada por padrão e exige chave fora do Git e habilitação explícita no ambiente.
- Um roteiro aprovado pode ser desenvolvido pela IA e convertido diretamente no mesmo JSON canônico usado pelo editor, autosave, preview e futuras exportações.

## Fluxo implementado

```text
bootstrap da organização
→ login
→ lista de apresentações
→ criação transacional
→ versão 1 + rascunho
→ edição de blocos
→ autosave persistente
→ checkpoint imutável
→ preview HTML 16:9
```

## Plano por fases

1. Fundação e contratos: TypeScript, contratos Zod, migrations e erro padrão.
2. Autenticação e organizações: bootstrap inicial, login, logout e isolamento.
3. Apresentações: criação, versão inicial, autosave, conflito e checkpoint.
4. Editor e preview: interface única, blocos, miniaturas e renderer 16:9.
5. IA: adaptadores, roteiro, validação factual e geração do JSON.
6. Jobs: fila PostgreSQL, lease, idempotência, tentativas e worker.
7. Exportações: HTML autônomo, PDF e PPTX editável.
8. Conteúdo Jump: workflow base, fontes, validade e auditoria concluídos; faltam escopo confidencial, assets e ingestão documental.
9. E2E e QA visual: Playwright, golden files e seis layouts.
10. Produção local/homologação: PostgreSQL servidor, S3, secrets e observabilidade.

## Limitações conhecidas

- O editor integra seis composições do Dev 2, edição direta, apresentação e HTML offline. Upload PNG/JPEG e assets privados estão implementados; detalhes em `docs/dev2-editor-images.md`.
- A suíte automatizada cobre contratos, renderer, autenticação, permissões, autosave, versionamento e política Jump; Playwright e QA visual automatizado ainda não foram adicionados.
- A criação de organização é um bootstrap único. Convites e múltiplas organizações por usuário não foram implementados.
- O renderer usa as seis composições visuais do Dev 2 no schema 1.0; a homologação visual em navegador e dos arquivos exportados ainda está pendente.
- A camada PostgreSQL servidor está implementada, mas não foi validada nesta máquina por ausência de servidor local.
- PDF/PPTX possuem endpoints e workers; imagens são incorporadas aos arquivos. O PDF exige navegador configurado e os controles de PDF/PPTX na interface ainda estão pendentes.
- O arquivo confidencial aprovado anteriormente não foi importado automaticamente: o modelo ainda precisa representar escopo por cliente antes de liberar esse material ao contexto da IA.
- O MVP atual permite que owner ou reviewer aprove conteúdo próprio; separação obrigatória entre autor e aprovador continua sendo uma decisão de governança.

## Comandos

```powershell
npm.cmd install
npm.cmd run db:migrate
npm.cmd run db:seed
npm.cmd run dev
```

API: `http://127.0.0.1:8788`
Web: `http://localhost:5173`
