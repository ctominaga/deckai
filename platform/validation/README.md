# Validação de conteúdo Jump

Executa uma validação local antes de um conteúdo ser disponibilizado para a IA:

```text
node platform/validation/validate-jump-content.mjs platform/mock-data/jump-content-public.json
```

Regras principais:

- todo item precisa de título, categoria e fonte;
- status precisa ser conhecido;
- conteúdo aprovado precisa de validade e responsável pela aprovação;
- conteúdo em revisão não pode ser considerado elegível para a IA.

O conteúdo público coletado do site está em `in_review` até confirmação institucional.
