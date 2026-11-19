# API persistente de desenvolvimento

Primeira fundação funcional do backend do Deck AI. Usa apenas recursos nativos do Node.js e persiste em `private-data/deckai-development.json`, arquivo ignorado pelo Git.

## Executar

```powershell
npm run api
```

A API fica em `http://127.0.0.1:8788`. Na primeira utilização, crie o gestor:

```http
POST /api/auth/bootstrap
{"name":"Gestor","email":"gestor@jump.local","password":"uma-senha-com-10-caracteres"}
```

Depois use `POST /api/auth/login` e envie o token como `Authorization: Bearer <token>`.

## Escopo entregue

- login, logout, sessão de oito horas e senhas com `scrypt`;
- papéis e permissões;
- apresentações com versões e proteção contra conflito de salvamento;
- conteúdo Jump com rascunho, revisão, aprovação, rejeição e arquivamento;
- filtro que entrega à IA somente conteúdo aprovado e dentro da validade;
- trilha básica de auditoria;
- persistência atômica em arquivo para desenvolvimento.

O armazenamento JSON não é a escolha de produção. Ele permite integrar e testar localmente enquanto o banco PostgreSQL e a hospedagem do backend não forem definidos.
