// Front-end: upload -> função em segundo plano -> polling -> resultado -> lead -> demonstrativo.
const ADS_CONVERSION = ""; // ex.: "AW-123456789/AbCdEfGhIj" (rótulo de conversão do Google Ads para o lead)
const WHATSAPP = "5551994875212"; // WhatsApp que recebe os leads (DDI 55 + DDD + número)
const MAX_TOTAL = 4.5 * 1024 * 1024;
const MAX_FILES = 8;
const BASE = document.querySelector('meta[name="base"]')?.content || ""; // ex.: "/analise" (definido no build)
// Sem servidor: nada é chamado no Netlify.
// Sem servidor: a análise roda no navegador (analise.js) e os contatos vão para o Google Drive do escritório (drive/Code.gs), quando configurado.
const API = null;
const LEITURA = (document.querySelector('meta[name="leitura"]')?.content || "on") === "on"; // leitura de PDF/foto desligada = só dados digitados

const $ = (s) => document.querySelector(s);
const show = (el) => el.classList.remove("hidden");
const hide = (el) => el.classList.add("hidden");
const pct = (v) => (v == null ? "-" : Number(v).toFixed(2).replace(".", ",") + "%");
const brl = (v) => (v == null ? "-" : "R$ " + Number(v).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

const TIPOS = {
  financiamento_veiculo: "Financiamento de veículo", arrendamento_veiculo: "Leasing de veículo", credito_pessoal_nao_consignado: "Empréstimo pessoal",
  consignado_inss: "Consignado INSS", consignado_publico: "Consignado servidor público", consignado_privado: "Consignado CLT", consignado_total: "Consignado",
  composicao_dividas: "Composição de dívidas", financiamento_outros_bens: "Financiamento de outros bens", cartao_rotativo: "Cartão rotativo",
  cartao_parcelado: "Cartão parcelado", cheque_especial: "Cheque especial", credito_pessoal_total: "Crédito pessoal", outro: "Outro",
};

// Variantes de campanha: /veiculos, /consignado, /emprestimo, /cartao (netlify.toml redireciona para index.html?c=...)
const CAMPANHAS = {
  veiculos: { tipo: "financiamento_veiculo", titulo: "Os juros do financiamento do seu carro estão acima da média do Banco Central?", sub: "Mande uma foto ou o PDF do contrato do financiamento. Em poucos minutos comparamos a taxa com a média oficial do Banco Central e verificamos seguro embutido e tarifas..", outros: "Serve também para empréstimo pessoal, consignado, cartão e cheque especial." },
  consignado: { tipo: "consignado_inss", titulo: "Os descontos do seu consignado estão acima da média do Banco Central?", sub: "Mande uma foto ou o PDF do contrato (ou do extrato de empréstimos do INSS). Comparamos a taxa com a média oficial e verificamos cartão consignado embutido (RMC) e seguros..", outros: "Serve também para financiamento de veículo, empréstimo pessoal e cartão." },
  emprestimo: { tipo: "credito_pessoal_nao_consignado", titulo: "Os juros do seu empréstimo pessoal estão acima da média do Banco Central?", sub: "Mande uma foto ou o PDF do contrato. Em poucos minutos comparamos a taxa com a média oficial do Banco Central e verificamos tarifas e seguros embutidos..", outros: "Serve também para financiamento de veículo, consignado e cartão." },
  cartao: { tipo: "cartao_rotativo", titulo: "Os juros do seu cartão de crédito estão acima da média do Banco Central?", sub: "Mande um print da fatura ou do contrato. Comparamos os juros do rotativo e do parcelamento com a média oficial do Banco Central..", outros: "Serve também para financiamento de veículo, empréstimo pessoal e consignado." },
};
(function aplicarCampanha() {
  // As páginas /veiculos/, /consignado/... já são estáticas (npm run build); o parâmetro ?c= serve para testes e links de campanha avulsos.
  const c = CAMPANHAS[new URLSearchParams(location.search).get("c")];
  if (!c) return;
  document.getElementById("hero-titulo").textContent = c.titulo;
  document.getElementById("hero-sub").textContent = c.sub;
  document.getElementById("hero-outros").textContent = c.outros;
  document.title = c.titulo;
  document.getElementById("tipo_contrato").value = c.tipo;
})();

// Origem da campanha (UTM, gclid)
const utm = {};
new URLSearchParams(location.search).forEach((v, k) => { if (/^(utm_|gclid|fbclid)/.test(k)) utm[k] = v.slice(0, 200); });
try { if (Object.keys(utm).length) sessionStorage.setItem("utm", JSON.stringify(utm)); } catch {}
function getUtm() { try { return JSON.parse(sessionStorage.getItem("utm") || "{}"); } catch { return {}; } }

// ---------- modo sem leitura de arquivo ----------
if (!LEITURA) {
  document.getElementById("dropzone").classList.add("hidden");
  document.getElementById("filelist").classList.add("hidden");
  const man = document.getElementById("manual");
  man.open = true; man.classList.add("sempre");
  man.querySelector("summary").textContent = "Taxa, parcelas e valores";
  const help = document.querySelector("#telefone + .help"); if (help) help.textContent = "Para enviarmos o resultado e tirar dúvidas.";
  const hintMan = man.querySelector("p.hint"); if (hintMan) hintMan.textContent = "A análise compara a taxa com a média do Banco Central do mês da contratação. Seguros e tarifas são conferidos na conversa com a equipe.";
  const prazo = document.querySelector("#btn-analisar + .hint"); if (prazo) prazo.textContent = "Resultado em segundos.";
  const intro = document.querySelector("#analise .intro");
  if (intro) intro.textContent = "Informe a taxa de juros e os dados do contrato. Você encontra no quadro-resumo do contrato ou no aplicativo do banco.";
  document.getElementById("proc-titulo").textContent = "Consultando o Banco Central…";
}

// ---------- arquivos ----------
let arquivos = [];
const dz = $("#dropzone"), inputArq = $("#arquivos"), inputCam = $("#camera"), lista = $("#filelist");
$("#btn-arquivo").onclick = () => inputArq.click();
$("#btn-camera").onclick = () => inputCam.click();
inputArq.onchange = () => addFiles(inputArq.files);
inputCam.onchange = () => addFiles(inputCam.files);
["dragenter", "dragover"].forEach((e) => dz.addEventListener(e, (ev) => { ev.preventDefault(); dz.classList.add("drag"); }));
["dragleave", "drop"].forEach((e) => dz.addEventListener(e, (ev) => { ev.preventDefault(); dz.classList.remove("drag"); }));
dz.addEventListener("drop", (ev) => addFiles(ev.dataTransfer.files));

async function addFiles(files) {
  for (const f of files) {
    if (arquivos.length >= MAX_FILES) break;
    arquivos.push(await prepararArquivo(f));
  }
  inputArq.value = ""; inputCam.value = "";
  renderLista();
  lerNoNavegador();
}

// ---------- leitura no navegador (sem IA, sem custo): pdf.js + OCR; só os campos vão ao servidor ----------
let extracao = null;
const statusLeitura = document.getElementById("leitura-status");
function setStatus(msg) { if (statusLeitura) { statusLeitura.textContent = msg; statusLeitura.classList.toggle("hidden", !msg); } }
async function lerNoNavegador() {
  extracao = null;
  if (!arquivos.length || !window.Leitor) { setStatus(""); return; }
  $("#btn-analisar").disabled = true;
  try {
    const texto = await Leitor.lerArquivos(arquivos, setStatus);
    const x = Leitor.extrairCampos(texto);
    extracao = x;
    window.__textoLido = texto; // diagnóstico: ?debug=1 mostra o texto extraído
    if (new URLSearchParams(location.search).get("debug")) {
      let ta = document.getElementById("debug-texto");
      if (!ta) { ta = document.createElement("textarea"); ta.id = "debug-texto"; ta.style.cssText = "width:100%;height:260px;font:12px monospace;margin-top:8px"; statusLeitura.after(ta); }
      ta.value = `[${texto.length} caracteres lidos]
` + texto;
    }
    const def = (sel, v) => { const el = $(sel); if (el && v && !el.value) el.value = v; };
    def("#taxa_juros_mensal", x.taxa_juros_mensal); def("#numero_parcelas", x.numero_parcelas); def("#valor_financiado", x.valor_financiado);
    def("#valor_parcela", x.valor_parcela); def("#data_contrato", x.data_contrato); def("#instituicao", x.instituicao);
    if (x.tipo_contrato && $("#tipo_contrato").value === "financiamento_veiculo") $("#tipo_contrato").value = x.tipo_contrato;
    const achou = ["taxa_juros_mensal", "numero_parcelas", "valor_parcela", "valor_financiado", "data_contrato"].filter((k) => x[k]).length;
    const extras = [...x.tarifas.map((t) => t.nome), ...x.produtos_acessorios.map((t) => t.nome)];
    $("#manual").open = true;
    if (achou === 0) setStatus("Não consegui ler os dados do arquivo. Tente uma foto mais nítida do quadro-resumo ou informe a taxa abaixo.");
    else setStatus(`Leitura concluída: ${achou} de 5 dados principais encontrados${extras.length ? ` e ${extras.length} cobrança(s): ${extras.slice(0, 4).join(", ")}` : ""}. Confira os campos abaixo e corrija se precisar.`);
  } catch (e) {
    console.warn(e); setStatus("Não foi possível ler o arquivo neste aparelho. Informe os dados abaixo.");
  } finally { $("#btn-analisar").disabled = false; }
}
function renderLista() {
  lista.innerHTML = arquivos.map((a, i) => `<li>${esc(a.nome)} <small>(${(a.bytes / 1024).toFixed(0)} KB)</small><button type="button" data-i="${i}" aria-label="Remover">×</button></li>`).join("");
  lista.querySelectorAll("button").forEach((b) => (b.onclick = () => { arquivos.splice(+b.dataset.i, 1); renderLista(); }));
}

// Imagens são redimensionadas no navegador (máx. 2000 px, JPEG 85%) para caber no limite e acelerar a leitura.
async function prepararArquivo(file) {
  let blob = file, mime = file.type || mimePorNome(file.name), nome = file.name;
  if (/^image\//.test(file.type)) {
    try {
      const bmp = await createImageBitmap(file);
      const k = Math.min(1, 2000 / Math.max(bmp.width, bmp.height));
      const c = document.createElement("canvas");
      c.width = Math.round(bmp.width * k); c.height = Math.round(bmp.height * k);
      c.getContext("2d").drawImage(bmp, 0, 0, c.width, c.height);
      blob = await new Promise((r) => c.toBlob(r, "image/jpeg", 0.85));
      mime = "image/jpeg"; nome = nome.replace(/\.[^.]+$/, "") + ".jpg";
    } catch { /* formato sem suporte no canvas (ex.: HEIC): envia como está */ }
  }
  const base64 = await new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result).split(",")[1]); r.onerror = rej; r.readAsDataURL(blob); });
  return { nome, mime, base64, bytes: blob.size };
}
function mimePorNome(n) {
  if (/\.pdf$/i.test(n)) return "application/pdf";
  if (/\.docx$/i.test(n)) return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
  if (/\.txt$/i.test(n)) return "text/plain";
  if (/\.jpe?g$/i.test(n)) return "image/jpeg";
  if (/\.png$/i.test(n)) return "image/png";
  if (/\.webp$/i.test(n)) return "image/webp";
  return "";
}

// ---------- análise ----------
let analiseId = crypto.randomUUID();
let publico = null;
let dadosPre = { nome: "", telefone: "" };

// ---------- pré-cadastro (follow-up): salva assim que nome e WhatsApp estiverem preenchidos ----------
const telValido = (t) => /^[\d\s()+-]{10,20}$/.test(t) && t.replace(/\D/g, "").length >= 10;
let preTimer = null, ultimoPre = "";
async function salvarPreCadastro(etapa = "pre_cadastro") {
  const nome = $("#nome").value.trim(), telefone = $("#telefone").value.trim();
  if (nome.length < 2 || !telValido(telefone)) return false;
  dadosPre = { nome, telefone };
  const chave = etapa + "|" + nome + "|" + telefone;
  if (chave === ultimoPre) return true;
  ultimoPre = chave;
  enviarEtapa(etapa);
  if (window.gtag && etapa === "pre_cadastro") gtag("event", "pre_cadastro");
  return true;
}
["#nome", "#telefone"].forEach((sel) => {
  $(sel).addEventListener("blur", () => salvarPreCadastro());
  $(sel).addEventListener("input", () => { clearTimeout(preTimer); preTimer = setTimeout(() => salvarPreCadastro(), 1500); });
});
window.addEventListener("pagehide", () => { salvarPreCadastro(); });

$("#form-analise").addEventListener("submit", async (ev) => {
  ev.preventDefault();
  const erro = $("#erro-analise"); hide(erro);
  const fd = new FormData(ev.target);
  const dados = Object.fromEntries(fd.entries());
  delete dados.site;
  const manual = !!dados.taxa_juros_mensal || !!(dados.valor_financiado && dados.valor_parcela && dados.numero_parcelas);

  if (!manual) {
    $("#manual").open = true;
    return mostrarErro(erro, LEITURA && arquivos.length ? "Não encontrei a taxa de juros no arquivo. Informe a taxa ao mês (está no quadro-resumo do contrato)." : LEITURA ? "Envie uma foto ou PDF do contrato, ou informe pelo menos a taxa de juros ao mês." : "Informe pelo menos a taxa de juros ao mês.");
  }
  if (dados.nome.trim().length < 2 || !telValido(dados.telefone.trim())) return mostrarErro(erro, "Informe seu nome e um WhatsApp válido para enviarmos o resultado.");
  if (!$("#consent_analise").checked) return mostrarErro(erro, "É preciso autorizar o uso dos dados para analisar.");
  if ($("#site").value) return; // honeypot

  await salvarPreCadastro("analise_enviada");
  delete dados.nome; delete dados.telefone;
  $("#btn-analisar").disabled = true;
  hide($("#resultado")); hide($("#lead")); hide($("#demonstrativo"));
  $("#proc-titulo").textContent = "Consultando o Banco Central…";
  show($("#processando")); $("#processando").scrollIntoView({ behavior: "smooth" });
  setStep(1);

  try {
    if (!window.Analise) await new Promise((r) => setTimeout(r, 800));
    if (!window.Analise) throw new Error("módulo de análise não carregou; recarregue a página");
    setStep(2);
    const res = await Analise.rodar(dados, extracao ? { ...extracao, origem: "navegador", arquivos: arquivos.map((a) => a.nome) } : null);
    setStep(4);
    publico = res.publico; completoLocal = res.completo;
    renderResultado(res);
    enviarParaDrive(dados, res.publico);
  } catch (e) {
    hide($("#processando"));
    mostrarErro(erro, "Não foi possível concluir a análise: " + (e.message || e) + ". Tente de novo ou envie uma foto mais nítida.");
    enviarParaDrive(dados, null);
  } finally {
    $("#btn-analisar").disabled = false;
  }
});
// Nova análise na mesma página usa um id novo (o pré-cadastro é refeito automaticamente)
$("#form-analise").addEventListener("input", (e) => { if (publico && ["arquivos", "camera", "tipo_contrato", "taxa_juros_mensal"].includes(e.target.id)) { analiseId = crypto.randomUUID(); ultimoPre = ""; publico = null; } });

// ---------- cópia do contrato e dos dados para o Google Drive do escritório (Apps Script; ver drive/Code.gs) ----------
const DRIVE_URL = document.querySelector('meta[name="drive"]')?.content || "";
const DRIVE_TOKEN = document.querySelector('meta[name="drive-token"]')?.content || "";
let driveEnviado = "";
let completoLocal = null;
// Etapas do funil (pré-cadastro, lead, pediu_valor): registradas no Drive quando o script estiver configurado.
function enviarEtapa(etapa, extra = {}) {
  if (!DRIVE_URL || !dadosPre.nome) return;
  const corpo = { token: DRIVE_TOKEN, id: analiseId, etapa, nome: dadosPre.nome, telefone: dadosPre.telefone, tipoInformado: $("#tipo_contrato").value, utm: getUtm(), soEtapa: true, ...extra };
  fetch(DRIVE_URL, { method: "POST", body: JSON.stringify(corpo), redirect: "follow", keepalive: true }).catch(() => {});
}
function enviarParaDrive(dados, resultado) {
  if (!DRIVE_URL || driveEnviado === analiseId) return;
  driveEnviado = analiseId;
  const corpo = { token: DRIVE_TOKEN, id: analiseId, nome: dadosPre.nome, telefone: dadosPre.telefone, email: $("#email")?.value || "", cidade: $("#cidade_lead")?.value || dados.cidade || "",
    tipoInformado: dados.tipo_contrato, utm: getUtm(), dados, extracao, resultado,
    arquivos: arquivos.map(({ nome, mime, base64 }) => ({ nome, mime, base64 })) };
  // text/plain evita o preflight CORS, que o Apps Script não responde
  fetch(DRIVE_URL, { method: "POST", body: JSON.stringify(corpo), redirect: "follow" }).then((r) => r.json()).then((j) => { if (!j.ok) console.warn("drive", j.erro); }).catch((e) => console.warn("drive", e));
}

function setStep(n) { for (let i = 1; i <= 4; i++) $("#ps" + i).classList.toggle("on", i <= n); }
function mostrarErro(el, msg) { el.textContent = msg; show(el); el.scrollIntoView({ behavior: "smooth", block: "center" }); }


function renderResultado(res) {
  const p = res.publico;
  hide($("#processando"));
  const titulo = { vermelho: "Indícios fortes de abusividade", amarelo: "Pontos de atenção", verde: "Sem indícios relevantes" }[p.semaforo];
  $("#res-semaforo").innerHTML = `<div class="semaforo ${p.semaforo}"><div class="luz"></div><div><h3>${titulo}</h3><p>${esc(p.resumo)}</p></div></div>`;

  const c = p.comparacao;
  let html = "";
  if (c) {
    const largura = Math.min(100, (c.razao / 2.55) * 100); // a marca de 2/3 da barra = 1,7x
    html += `<div class="compare">
      <div class="box"><small>Taxa do seu contrato</small><b>${pct(c.taxaContrato)} a.m.</b></div>
      <div class="vs">vs</div>
      <div class="box"><small>Média do Banco Central<br>${esc(c.modalidade)}, ${esc((c.referencia || "").slice(3))}</small><b>${pct(c.taxaMedia)} a.m.</b></div>
    </div>
    <div class="bar"><i style="width:${largura}%"></i></div>
    <p class="hint">Sua taxa equivale a <b>${String(c.razao).replace(".", ",")}x</b> a média. A linha marca 1,7x (70% acima da média), parâmetro de abusividade adotado na análise. Venda casada e tarifas indevidas são indícios por si sós.${c.exata ? "" : " Média do mês mais próximo disponível."}${c.origemTipo === "contrato" ? "" : " Modalidade considerada a partir da sua escolha."}</p>`;
  } else {
    html += `<p class="hint">Não foi possível comparar a taxa com a média do Banco Central (taxa não identificada ou série indisponível).</p>`;
  }
  const extras = [];
  if (p.instituicao) extras.push(`Instituição: <b>${esc(p.instituicao)}</b>`);
  if (p.tipoContrato) extras.push(`Modalidade: <b>${esc(TIPOS[p.tipoContrato] || p.tipoContrato)}</b>`);
  if (p.legibilidade && p.legibilidade !== "boa") extras.push(`Leitura do documento: <b>${p.legibilidade}</b> (uma foto mais nítida melhora o resultado)`);
  if (extras.length) html += `<p class="hint">${extras.join(" · ")}</p>`;
  $("#res-comparacao").innerHTML = html;

  const ach = p.titulosAchados || [];
  $("#res-achados").innerHTML = ach.length
    ? ach.map((a) => `<li class="${a.gravidade}"><b>${esc(a.titulo)}</b><p>Detalhes, base legal e o que fazer estão no demonstrativo completo.</p></li>`).join("")
    : `<li class="info"><b>Nenhum ponto de atenção além da comparação de juros.</b><p>O demonstrativo traz os dados lidos e as observações.</p></li>`;
  $("#lock-titulo").textContent = ach.length
    ? `${ach.length} ponto${ach.length > 1 ? "s" : ""} encontrado${ach.length > 1 ? "s" : ""}${p.contagem?.vendaCasada ? ", incluindo possível venda casada" : ""}`
    : "Demonstrativo completo";
  $("#res-aviso").textContent = p.aviso;
  show($("#resultado")); show($("#lead"));
  $("#resultado").scrollIntoView({ behavior: "smooth" });
  if (window.gtag) gtag("event", "analise_concluida", { semaforo: p.semaforo });
}

// ---------- lead ----------
$("#form-lead").addEventListener("submit", async (ev) => {
  ev.preventDefault();
  const erro = $("#erro-lead"); hide(erro);
  const body = Object.fromEntries(new FormData(ev.target).entries());
  body.id = analiseId; body.nome = dadosPre.nome; body.telefone = dadosPre.telefone; body.consentimento = $("#consentimento").checked; body.utm = getUtm(); body.site = $("#site").value;
  if (!body.consentimento) return mostrarErro(erro, "É preciso autorizar o contato para liberar o demonstrativo.");
  $("#btn-lead").disabled = true;
  try {
    if (!completoLocal) throw new Error("faça a análise primeiro");
    enviarEtapa("lead", { email: body.email || "", cidade: body.cidade || "" });
    renderDemonstrativo(completoLocal, body);
    if (window.gtag) {
      gtag("event", "generate_lead", { semaforo: publico?.semaforo });
      if (ADS_CONVERSION) gtag("event", "conversion", { send_to: ADS_CONVERSION });
    }
  } catch (e) {
    mostrarErro(erro, "Não foi possível registrar: " + e.message);
  } finally {
    $("#btn-lead").disabled = false;
  }
});

function renderDemonstrativo(c, lead) {
  const r = c.resultado, x = c.extracao || {};
  hide($("#lead"));
  $("#res-achados").classList.remove("blur");
  $("#res-achados-box").querySelector(".overlay")?.remove();
  $("#dem-intro").textContent = `${lead.nome.trim().split(" ")[0]}, este é o demonstrativo da análise automatizada. Ele serve para orientar a conversa com a equipe, se você quiser esclarecer os pontos encontrados.`;


  $("#dem-achados").innerHTML = r.achados.map((a) => `<li class="${a.gravidade}"><b>${esc(a.titulo)}</b><p>${esc(a.descricao)}</p>${a.base_legal ? `<p class="base">Base: ${esc(a.base_legal)}</p>` : ""}</li>`).join("");

  const linhas = [
    ["Instituição", x.instituicao], ["Modalidade", TIPOS[x.tipo_contrato] || x.tipo_contrato], ["Mês da contratação", x.data_contrato],
    ["Valor financiado", x.valor_financiado != null ? brl(x.valor_financiado) : null], ["Valor liberado", x.valor_liberado != null ? brl(x.valor_liberado) : null],
    ["Parcelas", x.numero_parcelas], ["Valor da parcela", x.valor_parcela != null ? brl(x.valor_parcela) : null],
    ["Taxa de juros", x.taxa_juros_mensal != null ? `${pct(x.taxa_juros_mensal)} a.m.` + (x.taxa_juros_anual != null ? ` / ${pct(x.taxa_juros_anual)} a.a.` : "") : null],
    ["CET", x.cet_mensal != null ? `${pct(x.cet_mensal)} a.m.` + (x.cet_anual != null ? ` / ${pct(x.cet_anual)} a.a.` : "") : null],
    ["Tarifas", (x.tarifas || []).map((t) => `${t.nome}${t.valor != null ? " " + brl(t.valor) : ""}`).join("; ") || null],
    ["Produtos embutidos", (x.produtos_acessorios || []).map((t) => `${t.nome}${t.valor != null ? " " + brl(t.valor) : ""}`).join("; ") || null],
    ["Garantia", x.garantia],
    ["Média BCB usada", c.mercado ? `${pct(c.mercado.taxaMensal)} a.m. (${c.mercado.nome}, ${c.mercado.dataReferencia}, série SGS ${c.mercado.codigo})` : null],
  ].filter(([, v]) => v != null && v !== "");
  $("#dem-dados").innerHTML = linhas.map(([k, v]) => `<tr><td>${k}</td><td>${esc(v)}</td></tr>`).join("");
  $("#dem-obs").textContent = [x.observacoes, x.campos_nao_encontrados?.length ? "Não identificado no documento: " + x.campos_nao_encontrados.join(", ") : ""].filter(Boolean).join(" ");
  $("#dem-aviso").textContent = r.aviso;

  const msg = encodeURIComponent(`Olá! Fiz a análise do meu contrato no site (${TIPOS[r.tipoContratoConsiderado] || "contrato"}, resultado: ${r.semaforo}) e quero saber o valor. Meu nome é ${lead.nome}.`);
  const btn = $("#btn-whats");
  btn.href = `https://wa.me/${WHATSAPP}?text=${msg}`;
  btn.onclick = () => {
    const interesse = $("#interesse_rep").checked;
    enviarEtapa("pediu_valor", { interesseRepresentacao: interesse });
    if (window.gtag) gtag("event", "pediu_valor", { interesse_representacao: interesse });
  };
  show($("#demonstrativo"));
  $("#demonstrativo").scrollIntoView({ behavior: "smooth" });
}
