// Leitura do contrato no navegador, sem IA e sem custo: pdf.js extrai texto de PDF; Tesseract.js faz OCR de fotos
// e de PDFs escaneados ou com camada de texto corrompida (fontes sem mapa de caracteres, comum em CCBs).
// O arquivo não sai do aparelho do cliente; só os campos encontrados vão para a análise.
(function () {
  const PDFJS = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.10.38/pdf.min.mjs";
  const PDFJS_WORKER = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.10.38/pdf.worker.min.mjs";
  const TESS = "https://cdnjs.cloudflare.com/ajax/libs/tesseract.js/5.1.1/tesseract.min.js";
  const MAX_PAGINAS_OCR = 8;

  let pdfjs = null, worker = null;
  async function carregarPdfjs() {
    if (!pdfjs) { pdfjs = await import(PDFJS); pdfjs.GlobalWorkerOptions.workerSrc = PDFJS_WORKER; }
    return pdfjs;
  }
  function carregarScript(src) {
    return new Promise((res, rej) => { if (window.Tesseract) return res(); const s = document.createElement("script"); s.src = src; s.onload = res; s.onerror = () => rej(new Error("falha ao carregar OCR")); document.head.appendChild(s); });
  }
  async function ocrWorker(progresso) {
    if (worker) return worker;
    await carregarScript(TESS);
    worker = await Tesseract.createWorker("por", 1, { logger: (m) => { if (m.status === "recognizing text" && progresso) progresso(m.progress); } });
    await worker.setParameters({ tessedit_pageseg_mode: "3" }); // segmentação automática: lê tabelas (o padrão 6 pula linhas do quadro)
    return worker;
  }

  const b64ToBlob = (base64, mime) => { const bin = atob(base64); const u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i); return new Blob([u], { type: mime }); };

  /** Camada de texto legível? PDFs de banco às vezes trazem símbolos no lugar das letras. */
  function textoLegivel(t) {
    const util = t.replace(/\s/g, "");
    if (util.length < 80) return false;
    const bons = (util.match(/[A-Za-zÀ-ÿ0-9,.%$/:()-]/g) || []).length;
    return bons / util.length > 0.85 && /\b(valor|taxa|juros|parcela|contrato|banco|cr[ée]dito)\b/i.test(t);
  }
  const camposChave = (t) => { const x = extrairCampos(t); return !!(x.taxa_juros_mensal && x.numero_parcelas && (x.valor_parcela || x.valor_financiado)); };

  async function textoPdf(base64, status) {
    const lib = await carregarPdfjs();
    const doc = await lib.getDocument({ data: new Uint8Array(await b64ToBlob(base64, "application/pdf").arrayBuffer()) }).promise;
    let texto = "";
    const paginas = Math.min(doc.numPages, 30);
    for (let p = 1; p <= paginas; p++) {
      status(`Lendo PDF, página ${p} de ${paginas}…`);
      const page = await doc.getPage(p);
      const tc = await page.getTextContent();
      let linha = "", ultimoY = null;
      for (const it of tc.items) {
        if (ultimoY != null && Math.abs(it.transform[5] - ultimoY) > 3) { texto += linha + "\n"; linha = ""; }
        linha += (linha && !linha.endsWith(" ") ? " " : "") + it.str;
        ultimoY = it.transform[5];
      }
      texto += linha + "\n";
    }
    if (textoLegivel(texto)) return texto;
    // PDF escaneado ou com texto corrompido: OCR página a página até achar os dados principais
    texto = "";
    const max = Math.min(doc.numPages, MAX_PAGINAS_OCR);
    for (let p = 1; p <= max; p++) {
      status(`Reconhecendo a página ${p} de ${max} do PDF…`);
      const page = await doc.getPage(p);
      const vp = page.getViewport({ scale: 2.5 });
      const c = document.createElement("canvas"); c.width = vp.width; c.height = vp.height;
      await page.render({ canvasContext: c.getContext("2d"), viewport: vp, intent: "print" }).promise; // "print": não depende de requestAnimationFrame (trava em aba oculta)
      texto += (await textoImagem(c, status, `página ${p} de ${max}`)) + "\n";
      if (p >= 2 && camposChave(texto)) break;
    }
    return texto;
  }

  async function textoImagem(fonte, status, rotulo = "a foto") {
    const w = await ocrWorker((p) => status(`Reconhecendo ${rotulo}… ${Math.round(p * 100)}%`));
    const { data } = await w.recognize(fonte);
    return data.text || "";
  }

  /** arquivos: [{nome, mime, base64}] -> texto completo */
  async function lerArquivos(arquivos, status = () => {}) {
    let texto = "";
    for (const a of arquivos) {
      try {
        if (a.mime === "application/pdf" || /\.pdf$/i.test(a.nome)) texto += await textoPdf(a.base64, status);
        else if (/^image\//.test(a.mime)) { status("Reconhecendo o texto da foto…"); texto += await textoImagem(b64ToBlob(a.base64, a.mime), status); }
        else if (/^text\//.test(a.mime) || /\.txt$/i.test(a.nome)) texto += decodeURIComponent(escape(atob(a.base64)));
        else status(`Formato não lido: ${a.nome}. Envie PDF ou foto.`);
        texto += "\n";
      } catch (e) { console.warn("leitura", a.nome, e); status(`Não consegui ler ${a.nome}.`); }
    }
    return texto;
  }

  // ---------- extração por regras ----------
  const NUM = "(\\d{1,3}(?:\\.\\d{3})+,\\d{2}|\\d+,\\d{2,4}|\\d+\\.\\d{2})";
  const PCT = "(\\d{1,3}[,.]\\d{1,4})\\s*%";
  const norm = (t) => t.replace(/[ \t]+/g, " ").replace(/ +/g, " ");
  const re = (s, f = "i") => new RegExp(s, f);
  const toNum = (s) => (s == null ? null : String(s).replace(/\./g, "").replace(",", "."));
  const pv = (s) => Number(String(s).replace(",", "."));

  function acharPct(texto, rotulo, periodo = "m") {
    const per = periodo === "m" ? "(?:a\\.?\\s*m\\.?|ao m[êe]s|mensal|mês)" : "(?:a\\.?\\s*a\\.?|ao ano|anual|ano)";
    let m = texto.match(re(`${rotulo}[^\\n]{0,80}?${PCT}\\s*${per}`)); // "2,89% a.m."
    if (m) return m[1];
    m = texto.match(re(`${rotulo}[^\\n]{0,90}?${per}[^\\d\\n%]{0,20}${PCT}`)); // "mensal: 2,89%" / "% a.m.:4,54%"
    return m ? m[1] : null;
  }
  /** Linha com o rótulo e dois percentuais (mensal, anual) sem marcadores legíveis (OCR). */
  function parLinha(texto, rotulo) {
    for (const l of texto.split("\n")) {
      if (!re(rotulo).test(l)) continue;
      const ps = [...l.matchAll(re(PCT, "g"))].map((m) => m[1]).filter((p) => pv(p) > 0 && pv(p) < 400);
      if (ps.length >= 2 && pv(ps[0]) < 25 && pv(ps[1]) > pv(ps[0])) return { m: ps[0], a: ps[1] };
      if (ps.length === 1 && pv(ps[0]) < 25) return { m: ps[0], a: null };
    }
    return null;
  }
  function acharValor(texto, rotulo) {
    let m = texto.match(re(`${rotulo}[^\\n]{0,70}?R\\$\\s*${NUM}`)); // prefere valor com R$ (rótulos podem ter números, ex.: "(E.1 + E.3)")
    if (m) return m[1];
    m = texto.match(re(`${rotulo}[^\\d\\n]{0,45}${NUM}`));
    return m ? m[1] : null;
  }
  function limparNome(s) {
    return s.replace(/^[\s|\[\]jI!(]*(?:[A-Z]?\d{1,2}(?:[.)]\d{0,2})?|[A-Z][.)]\d{0,2})?\s*[|\[\]jI!/]*\s*/, "") // "D.1 [", "B9 ", "| B.8 ["
      .split(/[:(\[|—–/]|R\$| - | financiad| isenta| sim\b| n[ãa]o\b|\s\d/i)[0].replace(/[^\wÀ-ÿ ]+$/g, "").trim().slice(0, 60);
  }
  function itens(texto, kw) {
    const out = [], visto = new Set(), linhas = texto.split("\n");
    for (let i = 0; i < linhas.length; i++) {
      const l = linhas[i], mk = l.match(re(`(${kw})`));
      if (!mk) continue;
      let v = (l.match(re(`R\\$\\s*${NUM}`)) || [])[1];
      if (!v) v = (l.slice(mk.index).match(re(`[^\\d\\n]{0,60}?${NUM}`)) || [])[1];
      if (!v) { // valor na linha seguinte (ex.: "Seguro Prestamista [x] sim" e, abaixo, "Seguradora: X R$317,06")
        for (let k = i + 1, vistas = 0; k < linhas.length && vistas < 2; k++) {
          if (!linhas[k].trim()) continue; vistas++;
          if (re(kw).test(linhas[k])) break;
          v = (linhas[k].match(re(`R\\$\\s*${NUM}`)) || [])[1]; if (v) break;
        }
      }
      if (!v || pv(toNum(v)) <= 0) continue;
      if (/isenta:\s*\[x\]\s*sim|n[ãa]o financiad/i.test(l)) continue;
      const nome = limparNome(l.slice(mk.index)) || mk[1];
      const chave = nome.toLowerCase().slice(0, 25);
      if (visto.has(chave)) continue; visto.add(chave);
      out.push({ nome, valor: v });
    }
    return out;
  }

  function extrairCampos(bruto) {
    const t = norm(bruto);
    const x = { tarifas: [], produtos_acessorios: [], campos_nao_encontrados: [] };

    const J = "(?:taxa de juros|juros remunerat[óo]rios|taxa|juros)";
    const C = "(?:c\\.?e\\.?t\\b|custo efetivo total)";
    x.taxa_juros_mensal = acharPct(t, J);
    x.taxa_juros_anual = acharPct(t, J, "a");
    x.cet_mensal = acharPct(t, C);
    x.cet_anual = acharPct(t, C, "a");
    if (!x.taxa_juros_mensal) { const m = t.match(re(`${PCT}\\s*(?:a\\.?\\s*m\\.?|ao m[êe]s)`)); if (m) x.taxa_juros_mensal = m[1]; }
    if (!x.taxa_juros_anual) { const m = t.match(re(`${PCT}\\s*(?:a\\.?\\s*a\\.?|ao ano)`)); if (m) x.taxa_juros_anual = m[1]; }
    if (x.cet_mensal && x.taxa_juros_mensal === x.cet_mensal) { // rótulo "taxa" casou com a linha do CET
      const m = t.match(re(`(?:taxa de juros|juros)[^%\\n]{0,60}?${PCT}`)); if (m && m[1] !== x.cet_mensal) x.taxa_juros_mensal = m[1];
    }
    // Linha do rótulo com dois percentuais (OCR costuma estragar "a.m."/"a.a.")
    const pj = parLinha(t, "taxa de juros|juros remunerat"), pc = parLinha(t, "\\bcet\\b|custo efetivo");
    if (pj) { x.taxa_juros_mensal = x.taxa_juros_mensal || pj.m; if (!x.taxa_juros_anual || x.taxa_juros_anual === x.taxa_juros_mensal) x.taxa_juros_anual = pj.a; }
    if (pc) { x.cet_mensal = x.cet_mensal || pc.m; if (!x.cet_anual || x.cet_anual === x.cet_mensal) x.cet_anual = pc.a; }
    if (x.taxa_juros_anual && x.taxa_juros_mensal === x.taxa_juros_anual) x.taxa_juros_anual = null;
    // Layout em tabela (rótulos numa linha, valores noutra): pares "mensal anual" em que anual ≈ (1+mensal)^12-1.
    if (!x.taxa_juros_mensal) {
      const pcts = [...t.matchAll(re(PCT, "g"))].map((m) => ({ s: m[1], v: pv(m[1]) }));
      const pares = [];
      for (let i = 0; i + 1 < pcts.length; i++) {
        const m = pcts[i].v, a = pcts[i + 1].v;
        if (m > 0.3 && m < 25 && Math.abs((Math.pow(1 + m / 100, 12) - 1) * 100 - a) < Math.max(0.6, a * 0.03)) { pares.push([pcts[i].s, pcts[i + 1].s]); i++; }
      }
      if (pares[0]) { x.taxa_juros_mensal = pares[0][0]; x.taxa_juros_anual = x.taxa_juros_anual || pares[0][1]; }
      if (pares[1] && !x.cet_mensal) { x.cet_mensal = pares[1][0]; x.cet_anual = x.cet_anual || pares[1][1]; }
    }

    const np = t.match(/(?:n[º°o.]?\s*(?:de\s*)?parcelas|n[úu]mero de parcelas|quantidade de parcelas|prazo\s*(?:\(meses\)|em meses)?|parcelas?)[^\d\n]{0,20}?(\d{1,3})\b(?![.,/]\d)/i) || t.match(/\b(\d{1,3})\s*(?:x|parcelas|presta[çc][õo]es)\b/i);
    x.numero_parcelas = np ? np[1] : null;
    x.valor_parcela = acharValor(t, "valor (?:d[ae]s?|de cada|da) (?:parcela|presta[çc][ãa]o)s?(?: mensal)?") || acharValor(t, "parcelas? (?:de|no valor de)") || (t.match(re(`\\d{1,3}\\s*x\\s*(?:R\\$\\s*)?${NUM}`)) || [])[1] || null;
    x.valor_financiado = acharValor(t, "valor (?:total )?(?:financiado|a ser financiado|do (?:cr[ée]dito|empr[ée]stimo|financiamento)|principal|l[ií]quido do cr[ée]dito)");
    x.valor_liberado = acharValor(t, "valor (?:l[ií]quido )?(?:liberado|creditado|a ser liberado|l[ií]quido)");
    x.valor_bem = acharValor(t, "valor(?:\\(es\\))? (?:do |de |dos )?(?:bem|ve[ií]culo|compra|venda)");
    x.iof = acharValor(t, "\\biof\\b");

    // Data: prioridade para emissão/contratação/operação/"Data:"; nunca datas de vencimento.
    const linhasSemVenc = t.split("\n").filter((l) => !/vencimento|venc\./i.test(l)).join("\n");
    const d = linhasSemVenc.match(/(?:data d[aeo]\s*(?:contrata[çc][ãa]o|emiss[ãa]o|contrato|opera[çc][ãa]o|libera[çc][ãa]o|assinatura)|emitid[ao] em|contratad[ao] em|\bdata)\s*:?\D{0,25}?(\d{2})\/(\d{2})\/(\d{4})/i) || linhasSemVenc.match(/\b(\d{2})\/(\d{2})\/(20\d{2})\b/);
    if (d) x.data_contrato = `${d[3]}-${d[2]}`;
    else { const v = t.match(/(?:1[º°o]?\s*vencimento|primeira parcela)\D{0,25}(\d{2})\/(\d{2})\/(\d{4})/i); if (v) { const dt = new Date(+v[3], +v[2] - 2, 1); x.data_contrato = `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}`; } else x.data_contrato = null; }

    const inst = t.match(/(?:institui[çc][ãa]o credora|credor(?:a)?|financeira credora|mutuante)\s*:?\s*([A-ZÀ-Ü][^\n,;]{3,70})/i)
      || t.match(/\b(banco [a-zçãõáéíóúâêô&.\- ]{2,40}?(?:s\.?\s?a\.?)?)(?=[\s,;\n]|$)/i)
      || t.match(/\b((?!de |da |do )[a-zçãõáéíóúâêô&.\- ]{2,40}?(?:financeira|cr[ée]dito, financiamento e investimento|cfi)\b[a-z .]{0,12})/i);
    x.instituicao = inst ? inst[1].replace(/\s*(cnpj|inscrit[ao]).*$/i, "").trim().replace(/\s+/g, " ").slice(0, 60) : null;
    if (x.instituicao && /^(de |da |do )?responsabilidade/i.test(x.instituicao)) x.instituicao = null;

    x.tarifas = itens(t, "tarifa de cadastro|tarifa de abertura|tarifa de avalia[çc][ãa]o(?: d[eo] bem)?|cadastro|avalia[çc][ãa]o d[eo] bem|avalia[çc][ãa]o|registro d[eo] contrato|registro contrato|registro|grav[aá]me|servi[çc]os? de terceiros|despesas? de terceiros|despesas? com despachante|comiss[ãa]o|despachante|vistoria|confec[çc][ãa]o")
      .filter((i) => !/^total/i.test(i.nome));
    x.produtos_acessorios = itens(t, "seguro prestamista|prestamista|seguro prote[çc][ãa]o|prote[çc][ãa]o financeira|seguro|t[ií]tulo de capitaliza[çc][ãa]o|capitaliza[çc][ãa]o|garantia estendida|assist[êe]ncia|cart[ãa]o consignado|rmc|reserva de margem");
    const nomes = x.produtos_acessorios.map((p) => p.nome.toLowerCase());
    x.produtos_acessorios = x.produtos_acessorios.filter((p, i) => !nomes.some((n, j) => j < i && n.includes(p.nome.toLowerCase())));

    const tl = t.toLowerCase();
    if (/arrendamento|leasing/.test(tl)) x.tipo_contrato = "arrendamento_veiculo";
    else if (/ve[ií]culo|automotor|alienaç[ãa]o fiduci[áa]ria|renavam|chassi|placa/.test(tl)) x.tipo_contrato = "financiamento_veiculo";
    else if (/consignad/.test(tl) && /inss|aposentad|pension/.test(tl)) x.tipo_contrato = "consignado_inss";
    else if (/consignad/.test(tl) && /servidor|p[úu]blic|munic[ií]pio|estado/.test(tl)) x.tipo_contrato = "consignado_publico";
    else if (/consignad/.test(tl)) x.tipo_contrato = "consignado_privado";
    else if (/rotativo/.test(tl) && /cart[ãa]o/.test(tl)) x.tipo_contrato = "cartao_rotativo";
    else if (/cart[ãa]o/.test(tl) && /parcelad/.test(tl)) x.tipo_contrato = "cartao_parcelado";
    else if (/cheque especial/.test(tl)) x.tipo_contrato = "cheque_especial";
    else if (/composi[çc][ãa]o|renegocia|refinanc/.test(tl)) x.tipo_contrato = "composicao_dividas";
    else if (/empr[ée]stimo|cr[ée]dito pessoal|ccb|c[ée]dula de cr[ée]dito/.test(tl)) x.tipo_contrato = "credito_pessoal_nao_consignado";
    else x.tipo_contrato = null;

    x.capitalizacao_pactuada = /capitaliza[çc][ãa]o (?:mensal|di[áa]ria|de juros)|juros capitalizados|capitalizados mensalmente/.test(tl) ? "sim" : "nao_identificado";
    for (const k of ["taxa_juros_mensal", "numero_parcelas", "valor_parcela", "valor_financiado", "data_contrato", "cet_mensal", "instituicao"]) if (!x[k]) x.campos_nao_encontrados.push(k);
    x.legibilidade = t.replace(/\s/g, "").length < 200 ? "ruim" : x.campos_nao_encontrados.length > 4 ? "regular" : "boa";
    return x;
  }

  window.Leitor = { lerArquivos, extrairCampos, toNum, textoLegivel };
})();
