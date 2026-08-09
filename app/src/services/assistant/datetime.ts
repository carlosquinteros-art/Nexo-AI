/**
 * Fechas y horas en español de Chile, zona America/Santiago.
 *
 * Todo se resuelve contra "hoy" en Chile, no contra la hora del dispositivo:
 * si Carlos abre la app desde otro huso, "mañana" sigue siendo mañana en Chile.
 */

export const TZ = 'America/Santiago';

export const MESES = [
  'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
  'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'
];
export const DIAS_SEMANA = ['domingo', 'lunes', 'martes', 'miercoles', 'jueves', 'viernes', 'sabado'];

export const NUMEROS_ESCRITOS: Record<string, number> = {
  un: 1, uno: 1, una: 1, dos: 2, tres: 3, cuatro: 4, cinco: 5, seis: 6, siete: 7, ocho: 8,
  nueve: 9, diez: 10, once: 11, doce: 12, trece: 13, catorce: 14, quince: 15, dieciseis: 16,
  diecisiete: 17, dieciocho: 18, diecinueve: 19, veinte: 20, treinta: 30, cuarenta: 40,
  cincuenta: 50, sesenta: 60, media: 0.5, medio: 0.5
};

/** Texto sin acentos, en minúsculas y sin signos. */
export function normalizar(s: string): string {
  return String(s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, ' ').trim();
}

/** Desfase en minutos de una zona horaria para una fecha dada. */
function desfaseMin(fecha: Date, tz = TZ): number {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone: tz, hour12: false, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit'
  });
  const p: Record<string, string> = {};
  dtf.formatToParts(fecha).forEach((x) => { p[x.type] = x.value; });
  const comoUTC = Date.UTC(+p.year, +p.month - 1, +p.day, p.hour === '24' ? 0 : +p.hour, +p.minute, +p.second);
  return (comoUTC - fecha.getTime()) / 60000;
}

/** Fecha y hora actuales en Chile. */
export function ahoraCL(): Date {
  const d = new Date();
  return new Date(d.getTime() + desfaseMin(d) * 60000);
}
export const hoyISO = (): string => ahoraCL().toISOString().slice(0, 10);
export const ahoraNaive = (): string => ahoraCL().toISOString().slice(0, 16);

function aFecha(iso: string): Date {
  const [f, h] = String(iso).split('T');
  const [y, m, d] = f.split('-').map(Number);
  const [hh, mm] = (h || '00:00').split(':').map(Number);
  return new Date(Date.UTC(y, m - 1, d, hh || 0, mm || 0));
}
export function sumarDias(iso: string, n: number): string {
  const d = aFecha(iso);
  d.setUTCDate(d.getUTCDate() + n);
  return String(iso).length > 10 ? d.toISOString().slice(0, 16) : d.toISOString().slice(0, 10);
}
export function diferenciaDias(a: string, b: string): number {
  return Math.round((aFecha(a).getTime() - aFecha(b).getTime()) / 86400000);
}
export function diaDeLaSemana(iso: string): number {
  return aFecha(iso).getUTCDay();
}

/** Convierte texto naive de Chile a ISO con zona, para guardarlo en la base. */
export function aISOConZona(naive: string | null): string | null {
  if (!naive) return null;
  const estimado = aFecha(naive);
  return new Date(estimado.getTime() - desfaseMin(estimado) * 60000).toISOString();
}
/** Camino inverso: de timestamptz a texto naive en hora de Chile. */
export function aNaiveChile(iso: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  return new Date(d.getTime() + desfaseMin(d) * 60000).toISOString().slice(0, 16);
}

/** Número escrito con dígitos o con palabras («dos», «una hora y media»). */
export function numeroDe(txt: string | number | null): number | null {
  if (txt == null) return null;
  const s = String(txt).trim().toLowerCase().replace(/\./g, '').replace(',', '.');
  if (/^-?\d+(\.\d+)?$/.test(s)) return Number(s);
  if (NUMEROS_ESCRITOS[s] != null) return NUMEROS_ESCRITOS[s];
  const m = s.match(/^(\w+)\s+y\s+(media|medio)$/);
  if (m && NUMEROS_ESCRITOS[m[1]] != null) return NUMEROS_ESCRITOS[m[1]] + 0.5;
  return null;
}

export const PATRON_NUMERO = `(\\d+(?:[.,]\\d+)?|${Object.keys(NUMEROS_ESCRITOS).join('|')})`;

export interface FechaDetectada {
  fecha: string | null;
  esRango: boolean;
  etiqueta: string;
}

/**
 * Interpreta la fecha de una frase.
 * hoy · mañana · pasado mañana · el viernes · el próximo viernes · en dos
 * semanas · en 3 días · la próxima semana · el 2 de septiembre · 28/08 ·
 * este fin de semana · hasta el viernes · desde mañana
 */
export function detectarFecha(texto: string, hoy = hoyISO()): FechaDetectada {
  const n = ` ${normalizar(texto)} `;
  const esRango = /\b(hasta|antes del|antes de|para el|desde)\b/.test(n);
  let fecha: string | null = null;
  let etiqueta = '';
  const set = (v: string, e: string) => { if (!fecha) { fecha = v; etiqueta = e; } };

  if (/\bhoy\b/.test(n)) set(hoy, 'hoy');
  if (/pasado manana/.test(n)) set(sumarDias(hoy, 2), 'pasado mañana');
  /* "mañana" como día, no como franja horaria ("de la mañana"). */
  if (/\bmanana\b/.test(n) && !/(de|por|en)\s+la\s+manana/.test(n)) set(sumarDias(hoy, 1), 'mañana');

  if (/\bfin de semana\b/.test(n)) {
    const d = diaDeLaSemana(hoy);
    set(d === 6 || d === 0 ? hoy : sumarDias(hoy, 6 - d), 'este fin de semana');
  }
  if (/proxima semana|semana que viene|la otra semana/.test(n)) {
    set(sumarDias(hoy, ((1 - diaDeLaSemana(hoy) + 7) % 7) || 7), 'la próxima semana');
  }

  let m = n.match(new RegExp(`en\\s+${PATRON_NUMERO}\\s+(dias?|semanas?|meses|mes)`));
  if (m) {
    const k = numeroDe(m[1]) ?? 1;
    const dias = /semana/.test(m[2]) ? k * 7 : /mes/.test(m[2]) ? k * 30 : k;
    set(sumarDias(hoy, Math.round(dias)), `en ${m[1]} ${m[2]}`);
  }

  m = n.match(/\b(este|el|la|proximo|proxima|el proximo|la proxima)?\s*(lunes|martes|miercoles|jueves|viernes|sabado|domingo)\b/);
  if (m) {
    const idx = DIAS_SEMANA.indexOf(m[2]);
    let delta = (idx - diaDeLaSemana(hoy) + 7) % 7;
    if (delta === 0) delta = 7;
    if (/proxim/.test(m[1] ?? '') && delta < 7) delta += 7;
    set(sumarDias(hoy, delta), `${m[1] ? m[1] + ' ' : 'el '}${m[2]}`);
  }

  m = n.match(/\b(\d{1,2})\s+de\s+([a-z]+)(?:\s+(?:de\s+)?(\d{4}))?/);
  if (m) {
    const mi = MESES.findIndex((x) => normalizar(x) === m![2]);
    if (mi >= 0) {
      const y = m[3] ? Number(m[3]) : Number(hoy.slice(0, 4));
      let cand = `${y}-${String(mi + 1).padStart(2, '0')}-${String(+m[1]).padStart(2, '0')}`;
      if (!m[3] && cand < hoy) cand = `${y + 1}${cand.slice(4)}`;
      set(cand, `${m[1]} de ${m[2]}`);
    }
  }

  m = texto.match(/\b(\d{1,2})[/-](\d{1,2})(?:[/-](\d{2,4}))?\b/);
  if (m) {
    const y = m[3] ? (m[3].length === 2 ? `20${m[3]}` : m[3]) : hoy.slice(0, 4);
    set(`${y}-${String(+m[2]).padStart(2, '0')}-${String(+m[1]).padStart(2, '0')}`, m[0]);
  }

  return { fecha, esRango, etiqueta };
}

/**
 * Interpreta la hora. Sin franja explícita, las horas de 1 a 7 se entienden
 * como tarde, que es como se habla en Chile ("a las 3" es 15:00).
 */
export function detectarHora(texto: string): string | null {
  const t = texto.toLowerCase();
  const n = normalizar(texto);

  let m = t.match(/(\d{1,2})[:.](\d{2})/);
  if (m) return `${String(Math.min(23, Math.max(0, +m[1]))).padStart(2, '0')}:${m[2]}`;

  m = n.match(new RegExp(`a\\s+las?\\s+${PATRON_NUMERO}(?:\\s*(?:hrs?|horas?))?(?:\\s*(?:de|en)\\s+la\\s+(manana|tarde|noche))?`));
  if (m) {
    const base = numeroDe(m[1]);
    if (base == null) return null;
    let h = Math.round(base);
    const franja = m[2];
    if ((franja === 'tarde' || franja === 'noche') && h < 12) h += 12;
    else if (!franja && h >= 1 && h <= 7) h += 12;
    return `${String(Math.min(23, Math.max(0, h))).padStart(2, '0')}:00`;
  }

  m = n.match(/\b(\d{1,2})\s*(?:hrs|hr|horas)\b/);
  if (m && !/menos|mas|colacion|trabajad/.test(n)) {
    return `${String(Math.min(23, Math.max(0, +m[1]))).padStart(2, '0')}:00`;
  }
  return null;
}

/** Duración en minutos: «dos horas», «90 minutos», «una hora y media». */
export function detectarDuracion(texto: string): number | null {
  const n = normalizar(texto);
  let m = n.match(new RegExp(`(?:de\\s+)?${PATRON_NUMERO}\\s*(?:horas?|hrs?)\\s*(?:y\\s+(media|medio))?`));
  if (m && !/menos|colacion/.test(n)) {
    const h = numeroDe(m[1]);
    if (h != null) return Math.round((h + (m[2] ? 0.5 : 0)) * 60);
  }
  m = n.match(new RegExp(`${PATRON_NUMERO}\\s*(?:minutos?|min)\\b`));
  if (m) { const v = numeroDe(m[1]); if (v != null) return Math.round(v); }
  return null;
}

/** Formatea DD/MM/AAAA. */
export function fmtFecha(iso: string | null): string {
  if (!iso) return '—';
  const d = aFecha(iso);
  return `${String(d.getUTCDate()).padStart(2, '0')}/${String(d.getUTCMonth() + 1).padStart(2, '0')}/${d.getUTCFullYear()}`;
}
/** «hoy», «mañana», «en 4 días»… */
export function fmtRelativo(iso: string | null, hoy = hoyISO()): string {
  if (!iso) return '';
  const dd = diferenciaDias(String(iso).slice(0, 10), hoy);
  if (dd === 0) return 'hoy';
  if (dd === 1) return 'mañana';
  if (dd === -1) return 'ayer';
  if (dd > 1 && dd <= 7) return `en ${dd} días`;
  if (dd < -1) return `hace ${Math.abs(dd)} días`;
  return fmtFecha(iso);
}
