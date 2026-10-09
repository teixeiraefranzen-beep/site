// Séries SGS do Banco Central: taxa média mensal de juros, recursos livres, pessoas físicas (% a.m.)
export const SERIES = {
  financiamento_veiculo:          { codigo: 25471, nome: "Aquisição de veículos" },
  arrendamento_veiculo:           { codigo: 25474, nome: "Arrendamento mercantil de veículos" },
  credito_pessoal_nao_consignado: { codigo: 25464, nome: "Crédito pessoal não consignado" },
  credito_pessoal_total:          { codigo: 25470, nome: "Crédito pessoal total" },
  consignado_inss:                { codigo: 25468, nome: "Consignado INSS" },
  consignado_publico:             { codigo: 25467, nome: "Consignado servidor público" },
  consignado_privado:             { codigo: 25466, nome: "Consignado setor privado" },
  consignado_total:               { codigo: 25469, nome: "Consignado total" },
  composicao_dividas:             { codigo: 25465, nome: "Composição de dívidas" },
  financiamento_outros_bens:      { codigo: 25472, nome: "Aquisição de outros bens" },
  cartao_rotativo:                { codigo: 25477, nome: "Cartão de crédito rotativo" },
  cartao_parcelado:               { codigo: 25478, nome: "Cartão de crédito parcelado" },
  cheque_especial:                { codigo: 25463, nome: "Cheque especial" },
  outro:                          { codigo: 25462, nome: "Pessoas físicas – total" },
};

const API = "https://api.bcb.gov.br/dados/serie/bcdata.sgs";
const pad = (n) => String(n).padStart(2, "0");
const ultimoDia = (ano, mes) => new Date(ano, mes, 0).getDate();

async function buscar(codigo, ini, fim) {
  const url = `${API}.${codigo}/dados?formato=json&dataInicial=${ini}&dataFinal=${fim}`;
  const r = await fetch(url, { signal: AbortSignal.timeout(25000) });
  if (!r.ok) throw new Error(`BCB ${r.status}`);
  const d = await r.json();
  return (Array.isArray(d) ? d : []).map((x) => ({ data: x.data, valor: Number(String(x.valor).replace(",", ".")) })).filter((x) => x.valor > 0);
}

/**
 * Média do mês da contratação. Se o mês não estiver disponível (série ainda não publicada
 * ou contrato muito antigo), usa o mês mais próximo dentro de 18 meses e marca exata=false.
 */
export async function mediaBcb(tipo, { ano, mes } = {}) {
  const serie = SERIES[tipo] || SERIES.outro;
  const hoje = new Date();
  if (!ano || !mes) { ano = hoje.getFullYear(); mes = hoje.getMonth() + 1; }
  try {
    const exato = await buscar(serie.codigo, `01/${pad(mes)}/${ano}`, `${ultimoDia(ano, mes)}/${pad(mes)}/${ano}`);
    if (exato.length) return { ...serie, taxaMensal: exato[0].valor, dataReferencia: exato[0].data, exata: true };
  } catch {}
  const ini = new Date(ano, mes - 1 - 18, 1), fim = new Date(ano, mes - 1 + 18, 1);
  const lista = await buscar(serie.codigo, `01/${pad(ini.getMonth() + 1)}/${ini.getFullYear()}`, `${ultimoDia(fim.getFullYear(), fim.getMonth() + 1)}/${pad(fim.getMonth() + 1)}/${fim.getFullYear()}`);
  if (!lista.length) return null;
  const alvo = ano * 12 + mes;
  const dist = (d) => { const [, m, a] = d.data.split("/"); return Math.abs(+a * 12 + +m - alvo); };
  const prox = lista.reduce((a, b) => (dist(b) < dist(a) ? b : a));
  return { ...serie, taxaMensal: prox.valor, dataReferencia: prox.data, exata: false };
}
