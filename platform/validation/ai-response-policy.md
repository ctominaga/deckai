# Política de validação da IA

Antes de salvar uma resposta do Gemini, o backend deve validar:

1. schema e versão;
2. proporção 16:9;
3. layouts permitidos;
4. tipos de bloco conhecidos;
5. referências associadas a afirmações factuais;
6. existência dos assets citados;
7. ausência de campos inesperados;
8. limite de slides e tamanho de texto.

Uma resposta estruturalmente inválida não deve virar versão salva. Uma resposta estruturalmente válida, mas com afirmação sem referência, deve retornar warning ou `needs_confirmation`, conforme a regra do produto.

Executar localmente:

```text
node platform/validation/validate-ai-response.mjs platform/mock-api/presentation-response.json
```
