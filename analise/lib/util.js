// Utilidades de parsing (versão para navegador, sem armazenamento).
export const texto = (v, max = 200) => (v == null ? "" : String(v).trim().slice(0, max));

/** "1.890,55" -> 1890.55 | "2,89" -> 2.89 | "2.89" -> 2.89 | "55000" -> 55000 */
export function num(v) {
  if (v == null) return null;
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  let s = String(v).trim().replace(/[R$%\s]/g, "").replace(/a\.?[ma]\.?$/i, "");
  if (!s) return null;
  if (s.includes(",")) s = s.replace(/\./g, "").replace(",", ".");
  else if ((s.match(/\./g) || []).length > 1) s = s.replace(/\./g, "");
  else if (/\.\d{3}$/.test(s)) s = s.replace(".", "");
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

/** "2024-03" | "03/2024" | "15/03/2024" | "março de 2024" -> {ano, mes} */
export function mesAno(v) {
  if (!v) return null;
  const s = String(v).trim().toLowerCase();
  let m;
  if ((m = s.match(/^(\d{4})-(\d{1,2})/))) return { ano: +m[1], mes: +m[2] };
  if ((m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/))) return { ano: +m[3], mes: +m[2] };
  if ((m = s.match(/^(\d{1,2})\/(\d{4})/))) return { ano: +m[2], mes: +m[1] };
  const meses = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
  if ((m = s.match(/([a-zç]{3})[a-zç]*\.?\s*(?:de\s*)?\/?\s*(\d{4})/))) {
    const i = meses.indexOf(m[1].slice(0, 3)); if (i >= 0) return { ano: +m[2], mes: i + 1 };
  }
  return null;
}

/** Taxa mensal implícita (sistema Price) a partir de valor, parcela e prazo. */
export function taxaImplicita(valor, parcela, n) {
  if (!(valor > 0 && parcela > 0 && n > 0) || parcela * n <= valor) return null;
  let i = 0.02;
  for (let k = 0; k < 100; k++) {
    const p = Math.pow(1 + i, -n);
    const f = valor * i / (1 - p) - parcela;
    const df = valor * ((1 - p) - i * n * Math.pow(1 + i, -n - 1)) / Math.pow(1 - p, 2);
    const ni = i - f / df;
    if (!Number.isFinite(ni) || ni <= 0) return null;
    if (Math.abs(ni - i) < 1e-10) { i = ni; break; }
    i = ni;
  }
  return Math.round(i * 10000) / 100;
}
