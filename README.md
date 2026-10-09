# teixeiraefranzen.com.br

Site do escritório e ferramenta de análise de contratos (/analise), servidos pelo GitHub Pages a partir deste repositório (branch `main`, raiz; domínio em `CNAME`).

- Tudo é estático. A análise roda no navegador do cliente: `analise/leitor.js` lê PDF/foto (pdf.js + Tesseract.js), `analise/analise.js` + `analise/lib/` comparam com a média do Banco Central (API pública do BCB) e aplicam as regras.
- Contatos: quando `<meta name="drive">` e `<meta name="drive-token">` estiverem preenchidos nas páginas, o navegador envia contrato e dados para o Google Apps Script do escritório (código em `site-analise/drive/Code.gs` do projeto de trabalho). Sem isso, o lead chega pelo botão do WhatsApp.
- Publicar: `git add -A && git commit -m "..." && git push`. O GitHub Pages reconstrói em cerca de um minuto. Não há limite de créditos.
- Conteúdo (artigos, cidades, médias) é gerado por `site-analise/scripts/conteudo.mjs` no projeto de trabalho e copiado para `analise/`.
