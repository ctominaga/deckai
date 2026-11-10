# Política de conteúdo Jump

## Conteúdo institucional geral

Pode ser usado em mais de uma apresentação depois de aprovado, desde que esteja válido e sem conflito.

Exemplos: história, serviços, produtos, certificações e identidade visual.

## Conteúdo específico de cliente

Deve ficar restrito ao contexto autorizado do cliente e não pode ser usado como informação geral da Jump.

Exemplos: proposta comercial, valores, condições de pagamento, cronograma, nomes de cliente e cláusulas contratuais.

## Elegibilidade para a IA

```text
approved
AND source exists
AND validFrom <= hoje
AND validUntil >= hoje
AND approvedBy exists
AND access scope permite o contexto atual
```

Se uma condição falhar, o conteúdo pode ser exibido como pendência ou solicitação de confirmação, mas não como fato institucional aprovado.
