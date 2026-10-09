// Análise inteira no navegador (sem servidor): consolida os campos, consulta a média do Banco Central
// e aplica as regras de abusividade. Exposta em window.Analise para o app.js.
import { consolidar, analisar } from "./lib/regras.js";
import { texto } from "./lib/util.js";

const CAMPOS = ["tipo_contrato", "taxa_juros_mensal", "numero_parcelas", "valor_financiado", "valor_parcela", "data_contrato", "instituicao", "cidade"];
function sanitizar(d) {
  const out = {};
  for (const k of CAMPOS) if (d[k] != null && String(d[k]).trim() !== "") out[k] = texto(d[k], 120);
  if (out.taxa_juros_mensal === undefined) out.taxa_juros_mensal = null;
  return out;
}
const somenteInformados = (d) => Object.fromEntries(Object.entries(d).filter(([k, v]) => v != null && v !== "" && k !== "cidade"));

function sanitizarExtracao(e) {
  if (!e || typeof e !== "object") return null;
  const lista = (l) => (Array.isArray(l) ? l.slice(0, 20).map((t) => ({ nome: texto(t?.nome, 80), valor: texto(t?.valor, 30) })).filter((t) => t.nome) : []);
  const out = {};
  for (const k of ["instituicao", "tipo_contrato", "data_contrato", "valor_bem", "valor_financiado", "valor_liberado", "numero_parcelas", "valor_parcela",
    "taxa_juros_mensal", "taxa_juros_anual", "cet_mensal", "cet_anual", "iof", "garantia", "capitalizacao_pactuada", "legibilidade", "observacoes", "origem"])
    if (e[k] != null && e[k] !== "") out[k] = texto(e[k], 300);
  out.tarifas = lista(e.tarifas);
  out.produtos_acessorios = lista(e.produtos_acessorios);
  out.campos_nao_encontrados = Array.isArray(e.campos_nao_encontrados) ? e.campos_nao_encontrados.slice(0, 20).map((c) => texto(c, 40)) : [];
  out.arquivos = Array.isArray(e.arquivos) ? e.arquivos.slice(0, 8).map((n) => texto(n, 120)) : [];
  if (!["boa", "regular", "ruim"].includes(out.legibilidade)) out.legibilidade = "boa";
  return out;
}

/** dados = campos do formulário; extracao = campos lidos do arquivo (ou null). */
async function rodar(dadosBrutos, extracaoBruta) {
  const dados = sanitizar(dadosBrutos || {});
  const extracao = sanitizarExtracao(extracaoBruta);
  if (dados.taxa_juros_mensal == null && !(dados.valor_financiado && dados.valor_parcela && dados.numero_parcelas))
    throw new Error("informe a taxa de juros ou envie o contrato");
  const consolidado = consolidar(extracao ? { ...extracao, ...somenteInformados(dados) } : {}, dados);
  const { publico, resultado, mercado } = await analisar(consolidado);
  return { publico, completo: { resultado, extracao: consolidado, mercado }, dados };
}

window.Analise = { rodar };
