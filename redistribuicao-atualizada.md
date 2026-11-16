# Redistribuição atualizada — Desenvolvedor 3

## Nova responsabilidade

O Desenvolvedor 3 agora é responsável por quatro blocos:

1. Inteligência artificial e geração.
2. Backend e APIs.
3. Plataforma, dados e conteúdo Jump.
4. Exportações.

O Desenvolvedor 2 fica responsável pela experiência completa do usuário, editor, apresentação, HTML e integração visual com as APIs fornecidas pelo Dev 3.

## O que já estava preparado

As atividades abaixo já possuem planejamento, contratos ou protótipos locais:

- schema JSON versionado;
- apresentação e versões;
- conteúdo Jump e fontes;
- aprovação, validade e arquivamento;
- permissões locais;
- jobs e idempotência;
- auditoria;
- backup local;
- contratos de exportação;
- prévia funcional local;
- dados simulados para desenvolvimento paralelo.

## Novo escopo que entrou para o Dev 3

### IA e geração

- adaptador Gemini;
- interpretação de briefing;
- geração de roteiro;
- geração de JSON de apresentação;
- validação estrutural da resposta;
- bloqueio de claims sem fonte;
- regeneração localizada;
- reescrita de blocos;
- versionamento de prompts e modelos;
- registro de duração, consumo, custo e erros;
- jobs de geração;
- respostas simuladas para o Dev 2.

### Backend e APIs

- API de apresentações;
- API de versões;
- API de conteúdo Jump;
- API de geração;
- API de regeneração;
- API de exportações;
- autenticação e permissões no servidor;
- validação de entrada e saída;
- contratos de erro;
- integração com o frontend.

## Dependências com o Desenvolvedor 2

O Dev 2 precisa receber do Dev 3:

- endpoint para gerar roteiro;
- endpoint para aprovar roteiro;
- endpoint para gerar apresentação;
- endpoint para regenerar slide;
- endpoint para reescrever bloco;
- endpoint para consultar progresso;
- endpoint para listar referências;
- endpoint para salvar versões;
- endpoint para exportar;
- respostas simuladas estáveis enquanto o Gemini não estiver integrado.

O Dev 3 precisa receber do Dev 2:

- briefing estruturado;
- `presentationId` e `versionId`;
- `slideId` e `blockId` para alterações localizadas;
- formato dos comandos de edição;
- eventos de autosave;
- estados visuais esperados para carregamento, erro e retentativa.

## Ordem recomendada após a redistribuição

```text
1. congelar contratos compartilhados
2. criar respostas simuladas da API
3. criar API local de apresentações e versões
4. criar API local de conteúdo Jump
5. criar adaptador Gemini com resposta simulada
6. integrar validação de claims e referências
7. integrar geração de roteiro
8. integrar geração de apresentação
9. implementar regeneração localizada
10. implementar jobs reais de geração
11. implementar PDF e PPTX
12. integrar e testar com o editor do Dev 2
```

## Risco principal

A frente do Dev 3 ficou grande demais para duas pessoas e um piloto curto. O maior risco é tentar implementar Gemini, backend, banco, conteúdo, exportação PDF e PPTX simultaneamente.

Para manter o MVP viável, recomenda-se:

- começar com respostas simuladas e contratos estáveis;
- usar um único caso de uso;
- limitar os seis layouts;
- deixar a geração de imagens para depois;
- começar o PPTX com modelo híbrido;
- manter a aprovação de conteúdo simples;
- não implementar colaboração em tempo real.

## Novo critério de entrega do Dev 3

O Dev 3 estará pronto para integração quando o frontend conseguir:

1. enviar um briefing;
2. receber um roteiro;
3. aprovar o roteiro;
4. receber um JSON válido;
5. salvar uma versão;
6. regenerar somente um slide;
7. reescrever somente um bloco;
8. consultar referências;
9. acompanhar jobs;
10. solicitar uma exportação.
