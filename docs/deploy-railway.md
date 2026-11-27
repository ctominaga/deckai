# Deck AI no Railway

O `Dockerfile` serve a interface compilada e a API no mesmo domínio. A aplicação executa as migrations antes de aceitar requisições. Fora do ambiente local, mantenha os dados no serviço PostgreSQL do projeto.

## Configurar o serviço

1. No projeto do Railway, adicione um serviço PostgreSQL privado e um serviço conectado ao repositório `ctominaga/deckai`. Use a raiz do repositório e a branch aprovada para homologação.
2. Nas variáveis da aplicação, referencie o `DATABASE_URL` do serviço PostgreSQL. Para um serviço chamado `Postgres`, a referência é `${{Postgres.DATABASE_URL}}`. Use o nome real se ele for diferente.
3. Configure `/health` como caminho de verificação no painel. O Dockerfile usa o `PORT` injetado pelo Railway e escuta em `0.0.0.0`.
4. Para habilitar IA, configure `DEEPSEEK_API_KEY` e `DECKAI_ENABLE_REAL_DEEPSEEK=true` como variáveis privadas do serviço. Mantenha `ALLOW_BOOTSTRAP=false`.

## Criar a conta inicial

Adicione temporariamente as variáveis `BOOTSTRAP_ORGANIZATION`, `BOOTSTRAP_OWNER_NAME`, `BOOTSTRAP_OWNER_EMAIL` e `BOOTSTRAP_OWNER_PASSWORD` ao serviço. Use uma senha exclusiva para homologação. Depois que o deploy tiver as variáveis, acesse o shell privado do serviço e execute:

```sh
node --import=tsx apps/api/src/scripts/bootstrap-owner.ts
```

Remova essas quatro variáveis após criar a conta. O script usa o processo local e não abre uma rota pública para criação do gestor. O login de desenvolvimento não é criado nesse banco.

## Validar antes de compartilhar

- Abra o domínio do serviço, verifique `/health` e entre com a conta criada.
- Crie e reabra uma apresentação. Envie uma imagem sintética e confira a apresentação e o HTML offline.
- Gere e baixe PDF e PPTX pelo editor. O container instala Chromium e executa como usuário sem privilégios. Verifique a primeira exportação de PDF no Railway, pois o navegador depende do suporte do ambiente ao sandbox.
- Se ativar IA, faça o primeiro teste com um briefing fictício.

Referências oficiais: [PostgreSQL](https://docs.railway.com/databases/postgresql), [Dockerfiles](https://docs.railway.com/builds/dockerfiles) e [healthchecks](https://docs.railway.com/deployments/healthchecks).
