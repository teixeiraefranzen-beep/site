#!/bin/sh
# Atualiza o ?v= dos scripts/CSS nas páginas do formulário (rodar antes de cada publicação que mude app.js, leitor.js, analise.js ou style.css)
V=$(date +%Y%m%d%H%M)
for f in analise/index.html analise/veiculos/index.html analise/consignado/index.html analise/emprestimo/index.html analise/cartao/index.html; do
  sed -i -E "s#(/analise/(app|leitor|analise)\.js)(\?v=[0-9]+)?\"#\1?v=$V\"#g; s#(/analise/style\.css)(\?v=[0-9]+)?\"#\1?v=$V\"#g" "$f"
done
echo "versão $V"
