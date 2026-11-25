# Deck AI

O Deck AI é uma aplicação em desenvolvimento para criar apresentações editáveis com IA e conteúdo institucional rastreável. A aplicação integrada fica em `apps/` e é o ponto de partida para desenvolvimento e testes.

## Executar localmente

Use Node.js 24 e npm. A partir da raiz do repositório, instale as dependências e prepare o banco local antes de iniciar a aplicação.

```powershell
npm.cmd ci
npm.cmd run db:migrate
npm.cmd run db:seed
npm.cmd run dev
```

Abra [a aplicação local](http://localhost:5173/). Em uma instalação nova, o seed de desenvolvimento cria o acesso `dev@deckai.local` com a senha `DeckAI-dev-2026`. Se o banco já tiver usuários, o seed preserva os acessos existentes.

O ambiente padrão usa PGlite persistente em `private-data/`. Para homologação, a API aceita PostgreSQL servidor via `DATABASE_URL`. Use a [referência de configuração](.env.example) para configurar o ambiente. Para chamadas locais ao DeepSeek, configure a chave, o modelo e a habilitação do provedor no arquivo `.env.local`, que fica fora do Git.

## O que está disponível na aplicação

- Login, organizações, membros e permissões aplicadas no servidor.
- Criação de apresentações, edição básica de texto e indicadores, autosave, versões, restauração de rascunho e visualização HTML 16:9.
- Biblioteca Jump com busca, tipos, tags, fontes, validade e histórico de aprovação. Os exemplos públicos entram como rascunhos. A consulta de contexto da IA seleciona conteúdo aprovado e vigente.
- Geração de roteiro com DeepSeek, aprovação do roteiro e geração de slides salvos no editor. Esse fluxo foi testado com o provedor real.
- Regeneração do slide selecionado pelo editor. A API preserva os demais slides e recusa gravações sobre rascunhos que mudaram. O fluxo passou com provedor de teste e segue em validação com o DeepSeek real.

## Frentes de trabalho

O **Dev 3** conduz API, autenticação e permissões, banco, versões, Biblioteca Jump, integração de IA no servidor, filas, armazenamento e exportações PDF/PPTX. Os próximos itens dessa frente são validar a regeneração real, implementar a reescrita de blocos e avançar na fila persistente, no armazenamento privado e nas exportações com downloads autorizados.

O **Dev 2** conduz a experiência de criação e revisão, o editor, o modo de apresentação e o HTML autônomo. A integração passa pelo JSON versionado da apresentação, pelos seis layouts e pelos contratos REST. Consulte a [referência da API](docs/api-v1.md) e a [arquitetura da primeira entrega](docs/vertical-slice-01.md).

A homologação externa, o PostgreSQL em servidor, o backup automatizado e os testes de fidelidade PDF/PPTX seguem pendentes.

## Onde fica cada coisa

| Caminho | Uso |
| --- | --- |
| `apps/web` e `apps/api` | Aplicação integrada e API |
| `packages/contracts` e `packages/renderer` | Contratos TypeScript e renderização HTML compartilhada |
| `db/migrations` | Migrations versionadas |
| `preview-dev3` e `platform` | Protótipos históricos e módulos de demonstração |
| `proof`, `examples` e `assets` | Prova de editor e HTML offline do Dev 2 |

A prévia cotidiana é a aplicação rodando com `npm.cmd run dev`. Os protótipos e a prova do Dev 2 continuam disponíveis para comparar layouts, edição, apresentação e HTML offline. A prova é independente da API e usa conteúdo sintético. Veja [como abrir e testar a prova](proof/README.md).

## Validação

```powershell
npm.cmd test
npm.cmd run build
```

A suíte legada pode ser executada separadamente com `npm.cmd run test:legacy`.

## Segurança

Mantenha chaves, banco local e materiais confidenciais de clientes fora do Git. Use o seed apenas no ambiente de desenvolvimento.
