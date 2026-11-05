# Contratos compartilhados

Esta pasta contém estruturas que precisam ser usadas em conjunto pelos três desenvolvedores.

## Fonte principal

`presentation-schema.json` define a estrutura mínima da apresentação no MVP.

O mesmo JSON deve ser consumido por:

- geração da IA;
- editor;
- preview HTML;
- exportação PDF;
- exportação PPTX;
- salvamento de versões.

## Regras de mudança

1. Não alterar o schema sem registrar a decisão na reunião conjunta.
2. Mudanças incompatíveis devem criar nova versão, como `2.0`.
3. Novos campos devem ser opcionais quando possível.
4. Todo layout novo precisa de exemplo e critério de aceite.
5. Toda afirmação factual deve poder apontar para uma referência.
