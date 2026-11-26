# Editor integrado e imagens

O editor em `apps/web` usa as composições visuais da prova Dev 2 diretamente no JSON canônico `schemaVersion: 1.0`. A prova em `proof/` continua como referência histórica independente; não é necessário converter apresentações salvas para o contrato provisório.

## Usar

1. Execute as migrations e inicie a API e o frontend com os comandos do README.
2. Abra ou crie uma apresentação. Em **Adicionar slide**, escolha entre capa, texto e imagem, duas colunas, indicadores, case e encerramento.
3. Edite os textos no slide ou no painel lateral. Autosave, conflitos de revisão e checkpoints usam a API existente.
4. Use **Imagem** para enviar um PNG/JPEG ou reutilizar um arquivo da organização. **Trocar imagem** preserva o bloco; **Excluir** remove a referência do slide. A imagem original permanece disponível para outros slides e checkpoints.
5. **Apresentar** abre a navegação com Anterior/Próximo, setas do teclado, Home/End e tela cheia. Escape fecha o modo apresentação quando o navegador não está em tela cheia.
6. **Baixar HTML** aguarda o salvamento, usa uma cópia do JSON e incorpora as imagens. O arquivo abre offline, com navegação e impressão 16:9.

## API e armazenamento

- `POST /api/v1/assets?name=arquivo.png`: corpo binário, `Content-Type: image/png` ou `image/jpeg`; exige owner/editor autenticado. Retorna ID, nome, tipo, tamanho e dimensões. Reenvios idênticos na mesma organização reutilizam o ID.
- `GET /api/v1/assets`: lista os 200 uploads mais recentes da organização.
- `GET /api/v1/assets/:id/file`: download autenticado, limitado à organização da sessão e com `Cache-Control: private, no-store`.
- Limites: 5 MiB por arquivo, 12.000 pixels por lado, 40 megapixels e 24 MiB de imagens distintas por apresentação. SVG e URLs externas não são aceitos como imagem de exportação.
- A migration `011_image_assets.sql` guarda bytes privados no PostgreSQL/PGlite, fora dos arquivos públicos e do Git. A autoria possui chave composta para impedir vínculos entre organizações.
- O JSON guarda somente `assetId` e texto alternativo. O autosave rejeita imagens inexistentes ou de outra organização. Os bytes dos assets são imutáveis, preservando checkpoints anteriores ao trocar uma imagem.
- Preview e worker resolvem as imagens no escopo da organização. HTML/PDF recebem data URLs; PPTX incorpora a mídia e mantém textos e indicadores editáveis. As composições PPTX são nativas e podem apresentar diferenças de fontes/espaçamento em relação ao HTML.

O worker PDF ainda depende de um navegador configurado em `PDF_BROWSER_PATH`. O menu de exportações PDF/PPTX continua dependendo da integração de interface tratada no item 1 do backlog; os endpoints existentes já recebem as imagens.

## Validação

- Suíte Vitest: contratos, renderer e API, incluindo upload autenticado, reenvio, arquivo inválido, limite de tamanho, persistência, checkpoint, isolamento entre organizações e permissão de viewer.
- O teste PPTX abre o ZIP gerado e verifica os bytes da imagem, a referência do slide à mídia e o texto editável.
- O teste do renderer cobre os seis layouts, preservação de todos os IDs dos blocos, escape de texto/alt e bloqueio de URLs externas.
- Com `PDF_BROWSER_PATH` configurado, a suíte também tenta renderizar um PDF real e verificar a presença da imagem. Nesta máquina, o Chromium localizado falhou por permissão do sandbox; o PDF real não foi homologado nesta entrega.
- A automação do navegador não ficou disponível nesta sessão. Revisão visual, responsividade e interação em tela cheia ainda precisam de homologação em navegador.

Para configurar um backend diferente na prévia Vite, use `DECKAI_API_URL`; o padrão continua `http://127.0.0.1:8788`.
