/**
 * Validación en el cliente.
 *
 * Espeja las restricciones CHECK del esquema para que el usuario vea el error
 * antes de enviar el formulario. La base de datos sigue siendo la autoridad:
 * esto es comodidad, no seguridad.
 */
import { NexoError } from './errors';

export type ErroresCampo = Record<string, string>;

export class ValidacionError extends NexoError {
  readonly campos: ErroresCampo;
  constructor(campos: ErroresCampo) {
    const primero = Object.values(campos)[0] ?? 'Revisa los datos del formulario.';
    super(primero, 'validation');
    this.name = 'ValidacionError';
    this.campos = campos;
  }
}

/* --------------------------------------------------------- Comprobaciones - */
export const esVacio = (v: unknown) => v === null || v === undefined || String(v).trim() === '';

export const reglas = {
  requerido: (v: unknown, etiqueta: string) => (esVacio(v) ? `${etiqueta} es obligatorio.` : null),

  largo: (v: unknown, min: number, max: number, etiqueta: string) => {
    if (esVacio(v)) return null;
    const n = String(v).trim().length;
    if (n < min) return `${etiqueta} debe tener al menos ${min} caracteres.`;
    if (n > max) return `${etiqueta} no puede superar los ${max} caracteres.`;
    return null;
  },

  email: (v: unknown) =>
    esVacio(v) || /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(String(v)) ? null : 'El correo no tiene un formato válido.',

  url: (v: unknown) => {
    if (esVacio(v)) return null;
    try { new URL(String(v)); return null; } catch { return 'El enlace no es una URL válida.'; }
  },

  rango: (v: unknown, min: number, max: number, etiqueta: string) => {
    if (esVacio(v)) return null;
    const n = Number(v);
    if (Number.isNaN(n)) return `${etiqueta} debe ser un número.`;
    if (n < min || n > max) return `${etiqueta} debe estar entre ${min} y ${max}.`;
    return null;
  },

  entero: (v: unknown, etiqueta: string) =>
    esVacio(v) || Number.isInteger(Number(v)) ? null : `${etiqueta} debe ser un número entero.`,

  color: (v: unknown) =>
    esVacio(v) || /^#[0-9a-f]{6}$/i.test(String(v)) ? null : 'El color debe ir en formato #RRGGBB.',

  fechaOrden: (desde: unknown, hasta: unknown, mensaje: string) =>
    esVacio(desde) || esVacio(hasta) || String(hasta) >= String(desde) ? null : mensaje,

  nota: (v: unknown) => reglas.rango(v, 1, 7, 'La nota'),

  contrasena: (v: unknown) => {
    const s = String(v ?? '');
    if (s.length < 8) return 'La contraseña debe tener al menos 8 caracteres.';
    if (!/[a-zA-Z]/.test(s) || !/\d/.test(s)) return 'Incluye al menos una letra y un número.';
    return null;
  }
};

/** Junta los errores no nulos y lanza si hay alguno. */
export function validar(campos: Record<string, string | null>): void {
  const errores: ErroresCampo = {};
  for (const [k, v] of Object.entries(campos)) if (v) errores[k] = v;
  if (Object.keys(errores).length) throw new ValidacionError(errores);
}

/* ---------------------------------------------------- Validadores de alto nivel */
export const validarTarea = (t: { title?: string; due_at?: string | null; description?: string | null }) =>
  validar({
    title: reglas.requerido(t.title, 'El título') ?? reglas.largo(t.title, 1, 300, 'El título'),
    description: reglas.largo(t.description, 0, 5000, 'La descripción')
  });

export const validarMarca = (b: { name?: string; color?: string; client_name?: string | null }) =>
  validar({
    name: reglas.requerido(b.name, 'El nombre') ?? reglas.largo(b.name, 1, 120, 'El nombre'),
    client_name: reglas.largo(b.client_name, 0, 160, 'El cliente'),
    color: reglas.color(b.color)
  });

export const validarPersona = (p: { full_name?: string; email?: string | null }) =>
  validar({
    full_name: reglas.requerido(p.full_name, 'El nombre') ?? reglas.largo(p.full_name, 1, 120, 'El nombre'),
    email: reglas.email(p.email)
  });

export const validarAsignatura = (c: { name?: string; credits?: number | null; color?: string }) =>
  validar({
    name: reglas.requerido(c.name, 'El nombre') ?? reglas.largo(c.name, 1, 140, 'El nombre'),
    credits: reglas.rango(c.credits, 0, 60, 'Los créditos'),
    color: reglas.color(c.color)
  });

export const validarEvaluacion = (a: { title?: string; weight?: number; due_date?: string | null }) =>
  validar({
    title: reglas.requerido(a.title, 'El título') ?? reglas.largo(a.title, 1, 200, 'El título'),
    weight: reglas.rango(a.weight, 0, 100, 'La ponderación')
  });

export const validarNotaAcademica = (g: { score?: number }) =>
  validar({ score: reglas.requerido(g.score, 'La nota') ?? reglas.nota(g.score) });

export const validarLectura = (r: { title?: string; total_pages?: number; pages_read?: number }) =>
  validar({
    title: reglas.requerido(r.title, 'El título') ?? reglas.largo(r.title, 1, 200, 'El título'),
    total_pages: reglas.rango(r.total_pages, 0, 100000, 'El total de páginas'),
    pages_read:
      reglas.rango(r.pages_read, 0, 100000, 'Las páginas leídas') ??
      (Number(r.pages_read ?? 0) > Number(r.total_pages ?? 0)
        ? 'Las páginas leídas no pueden superar el total.'
        : null)
  });

export const validarSesionEstudio = (s: { title?: string; scheduled_date?: string; duration_min?: number }) =>
  validar({
    title: reglas.requerido(s.title, 'El título') ?? reglas.largo(s.title, 1, 200, 'El título'),
    scheduled_date: reglas.requerido(s.scheduled_date, 'La fecha'),
    duration_min: reglas.rango(s.duration_min, 5, 600, 'La duración')
  });

export const validarReunion = (m: { title?: string; starts_at?: string; ends_at?: string | null }) =>
  validar({
    title: reglas.requerido(m.title, 'El título') ?? reglas.largo(m.title, 1, 200, 'El título'),
    starts_at: reglas.requerido(m.starts_at, 'La fecha y hora de inicio'),
    ends_at: reglas.fechaOrden(m.starts_at, m.ends_at, 'El término no puede ser anterior al inicio.')
  });

export const validarNota = (n: { title?: string; course_id?: string | null; unit_id?: string | null }) =>
  validar({
    title: reglas.requerido(n.title, 'El título') ?? reglas.largo(n.title, 1, 250, 'El título'),
    unit_id: n.unit_id && !n.course_id ? 'Para elegir una unidad primero selecciona la asignatura.' : null
  });

export const validarFuenteJuridica = (s: { identifier?: string; official_url?: string | null }) =>
  validar({
    identifier: reglas.requerido(s.identifier, 'El identificador') ?? reglas.largo(s.identifier, 1, 200, 'El identificador'),
    official_url: reglas.url(s.official_url)
  });

export const validarCredenciales = (email: string, password: string) =>
  validar({ email: reglas.requerido(email, 'El correo') ?? reglas.email(email), password: reglas.contrasena(password) });
