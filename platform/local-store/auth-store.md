# Autenticação e permissões locais

Este módulo simula autorização no navegador. Ele não substitui login real nem segurança de backend.

Papéis:

- `owner`: administra usuários, apresentações, conteúdo e exportações;
- `editor`: edita apresentações e cria exportações;
- `reviewer`: revisa e aprova conteúdo Jump;
- `viewer`: visualiza e baixa arquivos permitidos.

Exemplo:

```js
if (can(currentUser, "jump:approve")) {
  // exibir ação de aprovação
}
```

No backend real, toda permissão deverá ser validada novamente, mesmo que a interface esconda a ação.
