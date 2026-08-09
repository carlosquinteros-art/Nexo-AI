/**
 * Detección determinística sobre lo que Gmail y Calendar entregan.
 *
 * Dos reglas mandan sobre todo lo demás:
 *
 *   1. NO SE INVENTA NADA. Si una fecha no está escrita en el asunto o en el
 *      fragmento, no existe. Cada detección guarda el trozo de texto exacto
 *      que la disparó, para que siempre se pueda comprobar.
 *
 *   2. TODO SE PUEDE EXPLICAR. No hay puntajes salidos de ninguna parte: cada
 *      punto viene de una regla con nombre, y la interfaz los muestra.
 *
 * Este módulo solo detecta hechos. Decidir qué es urgente es tarea del motor
 * de urgencia, que vive en la aplicación para que puedas ajustarlo y ver por
 * qué clasificó cada cosa.
 */

export interface Deteccion {
  tipo: string;
  etiqueta: string;
  evidencia: string;      // el texto literal que lo gatilló
  fecha?: string | null;  // ISO, solo si estaba escrita en la fuente
}

const sinTildes = (s: string) =>
  String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

/* Recorta el entorno de la coincidencia para poder mostrarlo como evidencia. */
function alrededor(texto: string, indice: number, largo = 90): string {
  const ini = Math.max(0, indice - 30);
  return (ini > 0 ? '…' : '') + texto.slice(ini, ini + largo).trim() + (ini + largo < texto.length ? '…' : '');
}

interface Patron { tipo: string; etiqueta: string; palabras: string[] }

const PATRONES: Patron[] = [
  { tipo: 'solicitud', etiqueta: 'Te piden algo', palabras: [
    'me puedes', 'puedes enviar', 'necesito que', 'te pido', 'favor enviar', 'favor confirmar',
    'porfavor', 'por favor envia', 'quedo atento', 'quedamos atentos', 'me confirmas',
    'necesitamos que', 'solicito', 'solicitamos', 'requiero', 'nos puedes'] },
  { tipo: 'compromiso', etiqueta: 'Compromiso adquirido', palabras: [
    'quedo en', 'me comprometo', 'lo envio', 'te envio', 'lo mando', 'quedamos en',
    'te lo hago llegar', 'lo tendre', 'me encargo'] },
  { tipo: 'plazo', etiqueta: 'Fecha límite', palabras: [
    'antes de', 'a mas tardar', 'plazo', 'ultimo dia', 'fecha limite', 'deadline',
    'vence', 'hasta el', 'no mas alla'] },
  { tipo: 'reunion', etiqueta: 'Reunión', palabras: [
    'reunion', 'meet', 'zoom', 'teams', 'agendemos', 'agendar', 'nos juntamos',
    'llamada', 'videollamada', 'calendario'] },
  { tipo: 'aprobacion', etiqueta: 'Aprobación pendiente', palabras: [
    'aprobacion', 'aprobar', 'visto bueno', 'vb', 'autorizar', 'validar', 'confirmar presupuesto'] },
  { tipo: 'documento', etiqueta: 'Documento solicitado', palabras: [
    'adjunto', 'adjuntar', 'enviar el archivo', 'planilla', 'informe', 'reporte', 'documento',
    'excel', 'pdf', 'formulario'] },
  { tipo: 'incidencia', etiqueta: 'Incidencia operacional', palabras: [
    'quiebre', 'sin stock', 'sin cobertura', 'no llego', 'falta personal', 'caida',
    'sin promotor', 'tienda cerrada', 'problema en tienda', 'no funciono'] },
  { tipo: 'reclamo', etiqueta: 'Reclamo', palabras: [
    'reclamo', 'molesto', 'inconformidad', 'queja', 'disconforme', 'mala atencion',
    'no conforme', 'insatisfecho'] },
  { tipo: 'pago', etiqueta: 'Pago', palabras: [
    'pago', 'factura', 'boleta', 'transferencia', 'abono', 'orden de compra', 'oc '] },
  { tipo: 'remuneracion', etiqueta: 'Remuneraciones', palabras: [
    'liquidacion', 'remuneracion', 'sueldo', 'finiquito', 'anticipo', 'bono'] },
  { tipo: 'contrato', etiqueta: 'Contrato o anexo', palabras: [
    'contrato', 'anexo', 'firma pendiente', 'firmar', 'buk', 'documento pendiente de firma'] },
  { tipo: 'evaluacion', etiqueta: 'Evaluación', palabras: [
    'prueba', 'examen', 'control', 'certamen', 'solemne', 'interrogacion', 'evaluacion'] },
  { tipo: 'lectura', etiqueta: 'Lectura', palabras: [
    'lectura', 'capitulo', 'texto obligatorio', 'bibliografia', 'apunte', 'paper'] },
  { tipo: 'entrega', etiqueta: 'Entrega académica', palabras: [
    'entrega', 'trabajo final', 'ensayo', 'informe grupal', 'exposicion', 'disertacion'] },
];

/* ---------------------------------------------------------------- Fechas --
   Solo se reconocen fechas escritas. Las relativas se anclan a la fecha del
   correo, nunca a "hoy": si te escribieron el lunes "para mañana", significa
   el martes de esa semana. */
const MESES: Record<string, number> = {
  enero: 0, febrero: 1, marzo: 2, abril: 3, mayo: 4, junio: 5, julio: 6,
  agosto: 7, septiembre: 8, setiembre: 8, octubre: 9, noviembre: 10, diciembre: 11,
};
const DIAS: Record<string, number> = {
  domingo: 0, lunes: 1, martes: 2, miercoles: 3, jueves: 4, viernes: 5, sabado: 6,
};

export function fechaEnTexto(texto: string, referencia: Date): { iso: string; evidencia: string } | null {
  const t = sinTildes(texto);

  /* 12/08 · 12-08-2026 · 12.08.26 */
  const numerica = t.match(/\b(\d{1,2})[\/\-.](\d{1,2})(?:[\/\-.](\d{2,4}))?\b/);
  if (numerica) {
    const d = +numerica[1], m = +numerica[2] - 1;
    let a = numerica[3] ? +numerica[3] : referencia.getFullYear();
    if (a < 100) a += 2000;
    if (d >= 1 && d <= 31 && m >= 0 && m <= 11) {
      const f = new Date(Date.UTC(a, m, d, 12, 0, 0));
      /* Sin año, si ya pasó hace mucho, se entiende el año siguiente. */
      if (!numerica[3] && f.getTime() < referencia.getTime() - 30 * 86400000) f.setUTCFullYear(a + 1);
      return { iso: f.toISOString(), evidencia: numerica[0] };
    }
  }

  /* 12 de agosto */
  const conMes = t.match(/\b(\d{1,2})\s+de\s+([a-z]+)\b/);
  if (conMes && conMes[2] in MESES) {
    const d = +conMes[1], m = MESES[conMes[2]];
    const f = new Date(Date.UTC(referencia.getFullYear(), m, d, 12, 0, 0));
    if (f.getTime() < referencia.getTime() - 30 * 86400000) f.setUTCFullYear(referencia.getFullYear() + 1);
    return { iso: f.toISOString(), evidencia: conMes[0] };
  }

  /* hoy · mañana · pasado mañana */
  if (/\bhoy\b/.test(t)) {
    const f = new Date(referencia); f.setUTCHours(23, 59, 0, 0);
    return { iso: f.toISOString(), evidencia: 'hoy' };
  }
  if (/\bpasado manana\b/.test(t)) {
    const f = new Date(referencia.getTime() + 2 * 86400000); f.setUTCHours(23, 59, 0, 0);
    return { iso: f.toISOString(), evidencia: 'pasado mañana' };
  }
  if (/\bmanana\b/.test(t)) {
    const f = new Date(referencia.getTime() + 86400000); f.setUTCHours(23, 59, 0, 0);
    return { iso: f.toISOString(), evidencia: 'mañana' };
  }

  /* el viernes · este lunes · el próximo martes */
  const dia = t.match(/\b(?:el\s+|este\s+|proximo\s+|el\s+proximo\s+)?(lunes|martes|miercoles|jueves|viernes|sabado|domingo)\b/);
  if (dia) {
    const objetivo = DIAS[dia[1]];
    const actual = referencia.getUTCDay();
    let delta = (objetivo - actual + 7) % 7;
    if (delta === 0) delta = 7;
    if (/proximo/.test(dia[0]) && delta < 7) delta += 7;
    const f = new Date(referencia.getTime() + delta * 86400000);
    f.setUTCHours(23, 59, 0, 0);
    return { iso: f.toISOString(), evidencia: dia[0].trim() };
  }

  return null;
}

/**
 * Analiza asunto y fragmento. Devuelve solo hechos comprobables.
 * `referencia` es la fecha del correo, no la de hoy.
 */
export function detectar(asunto: string, fragmento: string, referencia: Date): Deteccion[] {
  const original = `${asunto || ''}. ${fragmento || ''}`.trim();
  const plano = sinTildes(original);
  const salida: Deteccion[] = [];
  const vistos = new Set<string>();

  for (const p of PATRONES) {
    for (const palabra of p.palabras) {
      const i = plano.indexOf(sinTildes(palabra));
      if (i < 0) continue;
      if (vistos.has(p.tipo)) break;
      vistos.add(p.tipo);
      salida.push({ tipo: p.tipo, etiqueta: p.etiqueta, evidencia: alrededor(original, i) });
      break;
    }
  }

  /* La fecha se busca una sola vez y se adosa al plazo, si lo hay. */
  const f = fechaEnTexto(original, referencia);
  if (f) {
    const plazo = salida.find((d) => d.tipo === 'plazo');
    if (plazo) { plazo.fecha = f.iso; plazo.evidencia = `${plazo.evidencia} · «${f.evidencia}»`; }
    else salida.push({ tipo: 'fecha', etiqueta: 'Fecha mencionada', evidencia: `«${f.evidencia}»`, fecha: f.iso });
  }

  return salida;
}

/** Espacio probable a partir de la cuenta de origen y lo detectado. */
export function espacioDe(tipoCuenta: string, detecciones: Deteccion[]): string {
  const academico = detecciones.some((d) => ['evaluacion', 'lectura', 'entrega'].includes(d.tipo));
  if (tipoCuenta === 'university') return 'university';
  if (tipoCuenta === 'personal') return academico ? 'university' : 'personal';
  return academico ? 'university' : 'work';
}
