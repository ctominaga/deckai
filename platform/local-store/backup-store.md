# Backup e recuperação local

O módulo cria um snapshot dos dados locais do protótipo:

- apresentações e versões;
- conteúdo Jump;
- jobs;
- usuários;
- auditoria.

Exemplo:

```js
const snapshot = createSnapshot();
downloadSnapshot();
restoreSnapshot(snapshot);
```

Este mecanismo é apenas uma simulação. Em produção, o banco e o storage precisarão de backup automático, retenção, criptografia e testes de restauração.
