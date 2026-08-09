/**
 * Extracción de entidades.
 *
 * Regla central: solo se devuelven entidades que EXISTEN en el contexto del
 * usuario. Si la frase menciona algo que no está registrado, se informa como
 * `lugarDesconocido` o simplemente se deja en null para que el clasificador
 * formule una pregunta. Nunca se inventa.
 */
import type { AssessmentType, PriorityLevel, SpaceType } from '../../types/database.types';
import type { ContextoAsistente, EntidadesExtraidas } from './types';
import { ENTIDADES_VACIAS } from './types';
import {
  normalizar, numeroDe, PATRON_NUMERO, detectarFecha, detectarHora, detectarDuracion
} from './datetime';

/* --------------------------------------------------------------- Cantidades */
export function detectarPaginas(texto: string): number | null {
  const m = normalizar(texto).match(new RegExp(`${PATRON_NUMERO}\\s*(?:paginas?|pags?|pp)\\b`));
  return m ? Math.round(numeroDe(m[1]) ?? 0) || null : null;
}
export function detectarCantidadPedida(texto: string): number | null {
  const m = normalizar(texto).match(new RegExp(`(?:crea|genera|hazme|dame|quiero)\\s+${PATRON_NUMERO}`));
  return m ? Math.round(numeroDe(m[1]) ?? 0) || null : null;
}
export function detectarUnidades(texto: string): number | null {
  const m = normalizar(texto).match(new RegExp(`${PATRON_NUMERO}\\s*unidades?`));
  return m ? Math.round(numeroDe(m[1]) ?? 0) || null : null;
}
export function detectarPonderacion(texto: string): number | null {
  let m = texto.match(/(\d{1,3})\s*%/);
  if (m) return Math.min(100, Math.max(0, +m[1]));
  m = normalizar(texto).match(new RegExp(`(?:ponderacion|vale|pondera)\\s+(?:de\\s+|un\\s+)?${PATRON_NUMERO}`));
  return m ? Math.min(100, Math.max(0, numeroDe(m[1]) ?? 0)) : null;
}
export function detectarMonto(texto: string): number | null {
  const m = texto.match(/\$\s?([\d.]+(?:,\d+)?)|\b(\d{1,3}(?:\.\d{3})+)\b/);
  if (!m) return null;
  const v = Number((m[1] ?? m[2] ?? '').replace(/\./g, '').replace(',', '.'));
  return Number.isNaN(v) ? null : v;
}
/** Nota chilena. Se lee del texto original porque normalizar() borra el decimal. */
export function detectarNota(texto: string): number | null {
  const m = texto.match(/\b([1-7][.,]\d)\b/) ?? texto.match(/\bun\s+([1-7])\b/i) ?? texto.match(/\b([1-7])[.,]?0?\b/);
  return m ? Number(String(m[1]).replace(',', '.')) : null;
}
export function detectarPrioridad(texto: string): PriorityLevel | null {
  const n = normalizar(texto);
  if (/\burgente|urgencia|de inmediato|ahora mismo|lo antes posible\b/.test(n)) return 'urgent';
  if (/\bimportante|alta prioridad|prioritario\b/.test(n)) return 'high';
  if (/\bcuando pueda|sin apuro|baja prioridad\b/.test(n)) return 'low';
  return null;
}
export function detectarTipoEvaluacion(texto: string): AssessmentType | null {
  const n = normalizar(texto);
  if (/\bexamen\b/.test(n)) return 'exam';
  if (/\bcontrol\b/.test(n)) return 'quiz';
  if (/\bpresentacion\b/.test(n)) return 'presentation';
  if (/\btaller\b/.test(n)) return 'workshop';
  if (/\btrabajo (grupal|de investigacion|escrito)\b/.test(n)) return 'paper';
  if (/\bprueba|solemne|certamen\b/.test(n)) return 'test';
  return null;
}

/* ---------------------------------------------------- Entidades del usuario */
function buscarPorTokens<T extends { id: string; nombre: string }>(
  texto: string, lista: T[], minToken = 3
): T | null {
  const n = normalizar(texto);
  let mejor: T | null = null;
  for (const item of lista) {
    const tokens = normalizar(item.nombre).split(' ').filter((x) => x.length > minToken);
    for (const tok of tokens) {
      if (new RegExp(`\\b${tok}\\b`).test(n) && (!mejor || item.nombre.length > mejor.nombre.length)) mejor = item;
    }
  }
  return mejor;
}

export function detectarAsignatura(texto: string, ctx: ContextoAsistente) {
  const n = normalizar(texto);
  let mejor: { id: string; nombre: string } | null = null;
  for (const s of ctx.asignaturas) {
    const limpio = normalizar(s.nombre).replace(/\b(i|ii|iii|iv)\b/g, '').trim();
    const tokens = limpio.split(' ').filter((x) => x.length > 3 && x !== 'derecho');
    const ok = tokens.length ? tokens.every((t) => n.includes(t)) : n.includes(limpio);
    if (ok && (!mejor || limpio.length > normalizar(mejor.nombre).length)) mejor = s;
  }
  return mejor;
}

export function detectarPersona(texto: string, ctx: ContextoAsistente) {
  const n = normalizar(texto);
  return ctx.personas.find((p) => {
    const primero = normalizar(p.nombre).split(' ')[0];
    return primero.length > 3 && new RegExp(`\\b${primero}\\b`).test(n);
  }) ?? null;
}

export function detectarTienda(texto: string, ctx: ContextoAsistente) {
  const n = normalizar(texto);
  for (const s of ctx.tiendas) {
    for (const campo of [normalizar(s.nombre), normalizar(s.ciudad ?? '')]) {
      if (!campo) continue;
      for (const tok of campo.split(' ').filter((x) => x.length > 3)) {
        if (new RegExp(`\\b${tok}\\b`).test(n)) return s;
      }
    }
  }
  return null;
}

/** Lugar con mayúscula que no corresponde a ninguna tienda registrada. */
export function detectarLugarDesconocido(texto: string, ctx: ContextoAsistente): string | null {
  const m = texto.match(/\b(?:de|en)\s+([A-ZÁÉÍÓÚÑ][a-záéíóúñ]{3,})\b/);
  if (!m) return null;
  const cand = m[1];
  if (detectarTienda(cand, ctx) || buscarPorTokens(cand, ctx.marcas) ||
      detectarAsignatura(cand, ctx) || detectarPersona(cand, ctx)) return null;
  if (/^(Recursos|Gerencia|Operaciones|Marketing|Finanzas)$/.test(cand)) return null;
  return cand;
}

/** Espacio al que pertenece la instrucción. */
export function detectarEspacio(
  texto: string,
  hayMarca: boolean,
  hayAsignatura: boolean,
  hayPersona: boolean
): SpaceType {
  const n = normalizar(texto);
  if (hayAsignatura || /\b(prueba|examen|control|solemne|certamen|catedra|clase|estudiar|estudio|leer|lectura|apunte|jurisprudencia|sentencia|fallo|ley|articulo|codigo|universidad|ramo|asignatura|profesor|semestre|repaso|ficha|materia|unidad|unidades|aprobar)\b/.test(n)) {
    return 'university';
  }
  if (hayMarca || hayPersona || /\b(cliente|tienda|marca|venta|ventas|reporte|cobertura|turno|promotora|promotor|captadora|reunion|rrhh|recursos humanos|uniforme|pop|sell out|remuneracion|liquidacion|licencia|reemplaz|renuncia|jefatura|activacion|campana|colacion|neto|iva|meta)\b/.test(n)) {
    return 'work';
  }
  if (/\b(gimnasio|familia|cumpleanos|medico|dentista|casa|banco|cuentas|personal)\b/.test(n)) return 'personal';
  return 'work';
}

/** Responsable explícito, o la persona mencionada. */
export function detectarResponsable(texto: string, ctx: ContextoAsistente): string | null {
  const m = texto.match(/\bresponsable\s*:?\s*([A-ZÁÉÍÓÚÑ][\wáéíóúñ]+(?:\s+[A-ZÁÉÍÓÚÑ][\wáéíóúñ]+)?)/);
  if (m) return m[1];
  const p = detectarPersona(texto, ctx);
  return p ? p.nombre : null;
}

/** Extrae todas las entidades de una frase de una sola pasada. */
export function extraerEntidades(texto: string, ctx: ContextoAsistente): EntidadesExtraidas {
  const marca = buscarPorTokens(texto, ctx.marcas, 2);
  const asignatura = detectarAsignatura(texto, ctx);
  const persona = detectarPersona(texto, ctx);
  const tienda = detectarTienda(texto, ctx);
  const { fecha, esRango } = detectarFecha(texto, ctx.hoy);

  return {
    ...ENTIDADES_VACIAS,
    espacio: detectarEspacio(texto, !!marca, !!asignatura, !!persona),
    marcaId: marca?.id ?? null,
    marcaNombre: marca?.nombre ?? null,
    asignaturaId: asignatura?.id ?? null,
    asignaturaNombre: asignatura?.nombre ?? null,
    personaId: persona?.id ?? null,
    personaNombre: persona?.nombre ?? null,
    tiendaId: tienda?.id ?? null,
    tiendaNombre: tienda?.nombre ?? null,
    fecha,
    fechaFin: esRango ? fecha : null,
    hora: detectarHora(texto),
    prioridad: detectarPrioridad(texto),
    responsable: detectarResponsable(texto, ctx),
    tipoEvaluacion: detectarTipoEvaluacion(texto),
    ponderacion: detectarPonderacion(texto),
    paginas: detectarPaginas(texto),
    duracionMin: detectarDuracion(texto),
    tema: null,
    descripcion: null,
    lugarDesconocido: detectarLugarDesconocido(texto, ctx)
  };
}

/** Limpia del título las expresiones de fecha y hora ya interpretadas. */
export function limpiarTitulo(s: string): string {
  const hora = /\s*,?\s*(a\s+las?\s+[\wáéíóú]+([:.]\d{2})?\s*(hrs?|horas?)?(\s+de\s+la\s+(mañana|tarde|noche))?|\d{1,2}\s*hrs?)\s*$/i;
  const fecha = /\s*,?\s*(para\s+el\s+|para\s+|antes\s+del?\s+|hasta\s+el\s+|el\s+|este\s+|pr[oó]ximo\s+|la\s+pr[oó]xima\s+)?(hoy|ma[ñn]ana|pasado\s+ma[ñn]ana|lunes|martes|mi[eé]rcoles|jueves|viernes|s[aá]bado|domingo|fin de semana|semana|\d{1,2}\s+de\s+[a-zá-ú]+(\s+de\s+\d{4})?|\d{1,2}[/-]\d{1,2}([/-]\d{2,4})?|en\s+\w+\s+(d[ií]as?|semanas?|meses))\s*$/i;
  let out = s;
  for (let i = 0; i < 3; i++) out = out.replace(hora, '').replace(fecha, '').trim();
  return out.replace(/[\s,;:.]+$/, '').trim() || s;
}

/** Coincidencia por tokens con raíz simple, para buscar en material propio. */
export function coincideTema(tema: string, texto: string): boolean {
  const STOP = ['para', 'sobre', 'este', 'esta', 'esto', 'como', 'desde', 'entre', 'materia', 'temas'];
  const raiz = (w: string) => w.replace(/(es|s)$/, '');
  const tk = normalizar(tema).split(' ').filter((w) => w.length > 3 && !STOP.includes(w)).map(raiz);
  if (!tk.length) return true;
  const tx = normalizar(texto);
  return tk.filter((w) => tx.includes(w)).length / tk.length >= 0.5;
}
