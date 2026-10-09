// Regras da triagem: comparação com a média do BCB e pontos de atenção do contrato.
import { num, mesAno, taxaImplicita } from "./util.js";
import { mediaBcb, SERIES } from "./bcb.js";

export const AVISO = "Análise automatizada, de caráter exclusivamente informativo. Não constitui parecer jurídico nem garante resultado. A confirmação depende da análise do contrato por advogado.";
const LIMITE_ABUSIVO = 1.7; // 70% acima da média do BCB (critério do escritório; STJ REsp 1.061.530, Tema 27, fala em discrepância substancial)

const temKw = (lista, re) => (lista || []).filter((t) => re.test((t.nome || "").toLowerCase()));
const brl = (v) => "R$ " + Number(v).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmt = (v) => Number(v).toFixed(2).replace(".", ",");

/** Normaliza extração (strings) + dados digitados em um objeto numérico único. Documento prevalece. */
export function consolidar(extracao = {}, dados = {}) {
  const pick = (campo) => { const e = num(extracao[campo]); return e != null ? e : num(dados[campo]); };
  const tipoDoc = SERIES[extracao.tipo_contrato] && extracao.tipo_contrato !== "outro";
  const x = {
    instituicao: extracao.instituicao || dados.instituicao || "",
    tipo_contrato: tipoDoc ? extracao.tipo_contrato : (SERIES[dados.tipo_contrato] ? dados.tipo_contrato : "outro"),
    origemTipo: tipoDoc ? "contrato" : "informado",
    data_contrato: extracao.data_contrato || dados.data_contrato || "",
    valor_bem: pick("valor_bem"), valor_financiado: pick("valor_financiado"), valor_liberado: pick("valor_liberado"),
    numero_parcelas: pick("numero_parcelas"), valor_parcela: pick("valor_parcela"),
    taxa_juros_mensal: pick("taxa_juros_mensal"), taxa_juros_anual: pick("taxa_juros_anual"),
    cet_mensal: pick("cet_mensal"), cet_anual: pick("cet_anual"), iof: pick("iof"),
    tarifas: (extracao.tarifas || []).map((t) => ({ nome: t.nome, valor: num(t.valor) })),
    produtos_acessorios: (extracao.produtos_acessorios || []).map((t) => ({ nome: t.nome, valor: num(t.valor) })),
    garantia: extracao.garantia || "", capitalizacao_pactuada: extracao.capitalizacao_pactuada || "nao_identificado",
    legibilidade: extracao.legibilidade || "boa", observacoes: extracao.observacoes || "",
    campos_nao_encontrados: extracao.campos_nao_encontrados || [],
    taxa_estimada: false,
    origemDocumento: Boolean(extracao && extracao.legibilidade), // houve leitura de arquivo
    origem: extracao.origem || "",
  };
  if (x.taxa_juros_mensal == null && x.taxa_juros_anual != null)
    x.taxa_juros_mensal = Math.round((Math.pow(1 + x.taxa_juros_anual / 100, 1 / 12) - 1) * 10000) / 100;
  // Taxa ausente mas há valor, parcela e prazo: estima pela Tabela Price.
  if (x.taxa_juros_mensal == null) {
    const t = taxaImplicita(x.valor_financiado, x.valor_parcela, x.numero_parcelas);
    if (t != null) { x.taxa_juros_mensal = t; x.taxa_estimada = true; }
  }
  return x;
}

export async function analisar(x) {
  const achados = [];
  const push = (gravidade, titulo, descricao, base_legal) => achados.push({ gravidade, titulo, descricao, base_legal });

  // 1) Juros x média do BCB no mês da contratação
  let mercado = null, comparacao = null;
  if (x.taxa_juros_mensal != null) {
    try { mercado = await mediaBcb(x.tipo_contrato, mesAno(x.data_contrato) || undefined); } catch { mercado = null; }
    if (mercado) {
      const razao = Math.round((x.taxa_juros_mensal / mercado.taxaMensal) * 100) / 100;
      comparacao = { taxaContrato: x.taxa_juros_mensal, taxaMedia: mercado.taxaMensal, razao, referencia: mercado.dataReferencia, exata: mercado.exata, modalidade: mercado.nome, codigoSerie: mercado.codigo, origemTipo: x.origemTipo };
      const est = x.taxa_estimada ? " (taxa estimada a partir do valor, da parcela e do prazo, pela Tabela Price)" : "";
      const ref = `${mercado.nome}, ${mercado.dataReferencia.slice(3)}${mercado.exata ? "" : " (mês mais próximo disponível)"}`;
      const rz = String(razao).replace(".", ",");
      if (razao >= LIMITE_ABUSIVO)
        push("alta", `Juros ${rz}x acima da média de mercado`,
          `A taxa do contrato é de ${fmt(x.taxa_juros_mensal)}% ao mês${est}, contra média do Banco Central de ${fmt(mercado.taxaMensal)}% ao mês (${ref}). Juros mais de 70% acima da média caracterizam discrepância substancial, parâmetro para reconhecer abusividade e determinar a redução à média, com recálculo das parcelas e restituição do excesso.`,
          "CDC, art. 6º, V e art. 51, IV; STJ, REsp 1.061.530/RS (Tema 27); Súmula 530 do STJ; jurisprudência do TJRS");
      else if (razao >= 1.2)
        push("media", `Juros acima da média (${rz}x)`,
          `A taxa de ${fmt(x.taxa_juros_mensal)}% ao mês${est} supera a média do Banco Central de ${fmt(mercado.taxaMensal)}% (${ref}), mas fica abaixo do patamar de 70% acima da média (1,7x) adotado para revisão judicial da taxa. Os demais encargos do contrato podem, por si sós, caracterizar abusividade.`,
          "STJ, REsp 1.061.530/RS (Tema 27)");
      else
        push("info", "Juros dentro da média de mercado",
          `A taxa de ${fmt(x.taxa_juros_mensal)}% ao mês${est} está próxima ou abaixo da média do Banco Central de ${fmt(mercado.taxaMensal)}% (${ref}). Sozinha, não caracteriza abusividade.`, "");
    }
  }

  // 2) Venda casada: seguros e produtos acessórios
  const seguros = temKw(x.produtos_acessorios, /segur|prestamista|prote[çc][ãa]o|capitaliza|garantia estendida|assist[êe]ncia|previd/);
  if (seguros.length)
    push("alta", "Possível venda casada: " + seguros.map((s) => s.nome).join(", "),
      `Foram identificados produtos acessórios embutidos no financiamento (${seguros.map((s) => s.nome + (s.valor != null ? " " + brl(s.valor) : "")).join("; ")}). A contratação de seguro ou outro produto como condição do crédito, sem liberdade de escolha da seguradora, é venda casada. O valor pode ser devolvido com juros, retirado do saldo devedor e as parcelas recalculadas.`,
      "CDC, art. 39, I; STJ, REsp 1.639.259/SP (Tema 972); Súmula 532 do STJ");
  const rmc = temKw(x.produtos_acessorios, /rmc|cart[ãa]o consignado|reserva de margem|cart[ãa]o benef/).concat(temKw(x.tarifas, /rmc|cart[ãa]o consignado/));
  if (rmc.length)
    push("alta", "Cartão consignado (RMC/RCC) vinculado",
      "Há reserva de margem para cartão de crédito consignado. É comum o consumidor não saber que contratou cartão em vez de empréstimo, com descontos que nunca quitam a dívida. Cabe discutir a nulidade do cartão e a conversão em empréstimo consignado comum.",
      "CDC, art. 6º, III e art. 39, I; jurisprudência do TJRS e do STJ");

  // 3) Tarifas
  const cadastro = temKw(x.tarifas, /cadastro|abertura|\btac\b|confec/);
  if (cadastro.length)
    push("alta", "Tarifa de cadastro " + (cadastro[0].valor != null ? brl(cadastro[0].valor) : ""),
      "A tarifa de cadastro só é válida no início do relacionamento com a instituição. Se você já era cliente do banco, a cobrança é indevida e deve ser devolvida.",
      "STJ, REsp 1.578.553/SP (Tema 958); Resolução CMN 3.919/2010");
  const avaliacao = temKw(x.tarifas, /avalia[çc][ãa]o|vistoria/);
  if (avaliacao.length)
    push("alta", "Tarifa de avaliação do bem " + (avaliacao[0].valor != null ? brl(avaliacao[0].valor) : ""),
      "Só pode ser cobrada se a avaliação do veículo foi efetivamente realizada e com valor compatível com o serviço. Sem laudo, a cobrança é abusiva.",
      "STJ, REsp 1.578.553/SP (Tema 958)");
  const registro = temKw(x.tarifas, /registro|grav[aá]me/);
  if (registro.length)
    push("alta", "Registro de contrato / gravame " + (registro[0].valor != null ? brl(registro[0].valor) : ""),
      "A despesa de registro do contrato só é devida quando o registro foi comprovadamente feito, pelo valor efetivamente pago ao órgão. Valores acima disso ou sem comprovação devem ser devolvidos.",
      "STJ, REsp 1.578.553/SP (Tema 958)");
  const terceiros = temKw(x.tarifas, /terceir|comiss|correspondente|promotor|despachante|servi[çc]os? de/);
  if (terceiros.length)
    push("alta", "Serviços de terceiros / comissão repassada ao cliente",
      `Cobrança de ${terceiros.map((t) => t.nome).join(", ")}. A remuneração de correspondente bancário, despachante ou outros terceiros não pode ser repassada ao consumidor.`,
      "STJ, REsp 1.578.553/SP (Tema 958); Resolução CMN 3.954/2011");

  // 4) CET, IOF e valor liberado
  // Só quando a leitura foi completa (IA); a leitura por regras no navegador pode não localizar o CET mesmo que exista.
  if (x.cet_mensal == null && x.cet_anual == null && x.legibilidade !== "ruim" && x.origemDocumento && x.origem !== "navegador")
    push("media", "Custo Efetivo Total (CET) não informado",
      "O banco deve informar o CET de forma clara antes da contratação. A ausência indica falha no dever de informação e dificulta a comparação do custo real do crédito.",
      "CDC, art. 6º, III e art. 52; Resolução CMN 3.517/2007 e 4.881/2020");
  if (x.valor_financiado > 0 && x.valor_liberado > 0 && x.valor_liberado < x.valor_financiado * 0.9) {
    const perc = Math.round((1 - x.valor_liberado / x.valor_financiado) * 1000) / 10;
    push("info", `Encargos embutidos somam ${String(perc).replace(".", ",")}% do financiado`,
      `Do valor financiado de ${brl(x.valor_financiado)}, apenas ${brl(x.valor_liberado)} foram efetivamente liberados. A diferença (tarifas, seguros, IOF) também é financiada e paga com juros ao longo de todas as parcelas.`, "");
  }

  // 5) Capitalização
  if (x.taxa_juros_mensal != null && x.taxa_juros_anual != null && x.taxa_juros_anual > x.taxa_juros_mensal * 12 + 0.05 && x.capitalizacao_pactuada !== "sim")
    push("info", "Capitalização mensal de juros sem cláusula expressa identificada",
      `A taxa anual (${fmt(x.taxa_juros_anual)}%) é maior que doze vezes a mensal (${fmt(x.taxa_juros_mensal)}%), o que indica juros compostos. A capitalização só é válida se pactuada de forma expressa no contrato; vale conferir a cláusula.`,
      "STJ, Súmulas 539 e 541; MP 2.170-36/2001, art. 5º");

  if (x.legibilidade === "ruim")
    push("info", "Documento de leitura difícil", "Parte dos dados pode não ter sido lida. Uma foto mais nítida ou o PDF original melhora a análise.", "");

  const contagem = {
    alta: achados.filter((a) => a.gravidade === "alta").length,
    media: achados.filter((a) => a.gravidade === "media").length,
    info: achados.filter((a) => a.gravidade === "info").length,
    vendaCasada: seguros.length + rmc.length,
  };
  const semaforo = contagem.alta ? "vermelho" : contagem.media ? "amarelo" : "verde";
  const resumo = {
    vermelho: "Há indícios fortes de abusividade no seu contrato.",
    amarelo: "Há pontos de atenção que merecem conferência no seu contrato.",
    verde: "Não encontramos indícios relevantes de abusividade nos dados analisados.",
  }[semaforo];

  const resultado = { semaforo, resumo, achados, aviso: AVISO, tipoContratoConsiderado: x.tipo_contrato, comparacao };
  const publico = {
    semaforo, resumo, comparacao, contagem,
    titulosAchados: achados.filter((a) => a.gravidade !== "info").map((a) => ({ titulo: a.titulo, gravidade: a.gravidade })),
    instituicao: x.instituicao, tipoContrato: x.tipo_contrato, legibilidade: x.legibilidade, aviso: AVISO,
  };
  const mercadoPub = mercado ? { taxaMensal: mercado.taxaMensal, nome: mercado.nome, dataReferencia: mercado.dataReferencia, codigo: mercado.codigo } : null;
  return { publico, resultado, mercado: mercadoPub };
}
