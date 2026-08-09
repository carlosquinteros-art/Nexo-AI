/**
 * Traducción de errores de Postgres y Supabase a mensajes en español que una
 * persona pueda entender y accionar.
 *
 * Motivo: un "duplicate key value violates unique constraint
 * academic_periods_name_uk" no le sirve a nadie. Aquí se convierte en
 * "Ya tienes un periodo académico con ese nombre".
 */
import type { PostgrestError } from '@supabase/supabase-js';

export class NexoError extends Error {
  readonly code: string;
  readonly detail?: string;
  readonly retriable: boolean;
  constructor(message: string, code = 'unknown', detail?: string, retriable = false) {
    super(message);
    this.name = 'NexoError';
    this.code = code;
    this.detail = detail;
    this.retriable = retriable;
  }
}

/** Constraint → mensaje humano. Se amplía a medida que aparecen casos. */
const POR_CONSTRAINT: Record<string, string> = {
  academic_periods_name_uk: 'Ya tienes un periodo académico con ese nombre.',
  tags_user_name_uk: 'Ya existe una etiqueta con ese nombre.',
  grades_assessment_attempt_uk: 'Ya registraste una nota para ese intento de la evaluación.',
  entity_tags_uk: 'Esa etiqueta ya está aplicada a este registro.',
  readings_pages_chk: 'Las páginas leídas no pueden superar el total de la lectura.',
  requests_dates_chk: 'La fecha comprometida no puede ser anterior a la de solicitud.',
  people_events_range_chk: 'La fecha de término no puede ser anterior a la de inicio.',
  meetings_range_chk: 'La hora de término no puede ser anterior a la de inicio.',
  personal_events_range_chk: 'La hora de término no puede ser anterior a la de inicio.',
  class_sessions_range_chk: 'La hora de término no puede ser anterior a la de inicio.',
  time_blocks_range_chk: 'El bloque debe terminar después de haber empezado.',
  notes_unit_requires_course_chk: 'Para asociar una unidad primero debes elegir la asignatura.',
  pq_options_chk: 'Una pregunta de selección múltiple necesita al menos dos alternativas.',
  ls_verified_chk: 'Para marcar una fuente como verificada hay que registrar cuándo se verificó.',
  tasks_done_chk: 'No se pudo cerrar la tarea. Vuelve a intentarlo.',
  incidents_resolved_chk: 'Para cerrar una incidencia hay que registrar cuándo se resolvió.'
};

/** Código de Postgres → mensaje genérico. */
const POR_CODIGO: Record<string, string> = {
  '23505': 'Ese registro ya existe.',
  '23503': 'No se puede completar: el registro está relacionado con otro que ya no existe.',
  '23514': 'Alguno de los datos no cumple las reglas de validación.',
  '23502': 'Falta completar un campo obligatorio.',
  '22001': 'Uno de los textos es más largo de lo permitido.',
  '22P02': 'Uno de los valores tiene un formato inválido.',
  '42501': 'No tienes permisos sobre este registro.',
  '42P01': 'Falta una tabla en la base de datos. ¿Ejecutaste el archivo de esquema?',
  PGRST116: 'No se encontró el registro.',
  PGRST301: 'Tu sesión expiró. Vuelve a iniciar sesión.'
};

/** Mensajes de autenticación de Supabase. */
const POR_AUTH: Array<[RegExp, string]> = [
  [/invalid login credentials/i, 'Correo o contraseña incorrectos.'],
  [/email not confirmed/i, 'Tienes que confirmar tu correo antes de entrar. Revisa tu bandeja.'],
  [/user already registered/i, 'Ya existe una cuenta con ese correo. Prueba iniciar sesión o recuperar la contraseña.'],
  [/password should be at least/i, 'La contraseña debe tener al menos 8 caracteres.'],
  [/weak password|password is too weak/i, 'La contraseña es demasiado débil. Combina letras, números y símbolos.'],
  [/rate limit|too many requests/i, 'Demasiados intentos seguidos. Espera un minuto y vuelve a probar.'],
  [/token has expired|invalid or has expired/i, 'El enlace ya venció. Solicita uno nuevo.'],
  [/same password/i, 'La nueva contraseña debe ser distinta a la anterior.'],
  [/unable to validate email address/i, 'El correo no tiene un formato válido.'],
  [/signups not allowed|signup is disabled/i, 'El registro está deshabilitado en este proyecto.']
];

function nombreConstraint(err: PostgrestError): string | undefined {
  const fuentes = [err.message, err.details, err.hint].filter(Boolean).join(' ');
  for (const clave of Object.keys(POR_CONSTRAINT)) {
    if (fuentes.includes(clave)) return clave;
  }
  return undefined;
}

/** Convierte cualquier error en un NexoError con mensaje en español. */
export function traducirError(error: unknown, contexto?: string): NexoError {
  if (error instanceof NexoError) return error;

  if (!navigator.onLine) {
    return new NexoError(
      'Estás sin conexión. Los cambios se guardarán cuando vuelvas a estar en línea.',
      'offline', undefined, true
    );
  }

  const e = error as Partial<PostgrestError> & { status?: number; name?: string; message?: string };
  const mensaje = e?.message ?? '';

  // Autenticación
  for (const [patron, texto] of POR_AUTH) {
    if (patron.test(mensaje)) return new NexoError(texto, 'auth');
  }

  // Constraints con nombre propio
  if (e?.code || e?.details) {
    const c = nombreConstraint(e as PostgrestError);
    if (c) return new NexoError(POR_CONSTRAINT[c], e.code ?? 'constraint', mensaje);
  }

  // Códigos de Postgres / PostgREST
  if (e?.code && POR_CODIGO[e.code]) {
    return new NexoError(POR_CODIGO[e.code], e.code, mensaje);
  }

  // Errores de red
  if (e?.name === 'TypeError' || /failed to fetch|network/i.test(mensaje)) {
    return new NexoError('No pudimos conectarnos con el servidor. Revisa tu conexión.', 'network', mensaje, true);
  }
  if (e?.status === 401 || /jwt|not authenticated/i.test(mensaje)) {
    return new NexoError('Tu sesión expiró. Vuelve a iniciar sesión.', 'unauthenticated', mensaje);
  }

  return new NexoError(
    contexto ? `No se pudo ${contexto}. Vuelve a intentarlo.` : 'Ocurrió un error inesperado.',
    'unknown',
    mensaje
  );
}

/** Envuelve una promesa de Supabase y lanza NexoError si algo falla. */
export async function ejecutar<T>(
  promesa: PromiseLike<{ data: T | null; error: PostgrestError | null }>,
  contexto: string
): Promise<T> {
  const { data, error } = await promesa;
  if (error) throw traducirError(error, contexto);
  if (data === null) throw new NexoError(`No se pudo ${contexto}.`, 'empty');
  return data;
}

/** Igual que `ejecutar`, pero acepta resultados vacíos (delete, update sin select). */
export async function ejecutarVacio(
  promesa: PromiseLike<{ error: PostgrestError | null }>,
  contexto: string
): Promise<void> {
  const { error } = await promesa;
  if (error) throw traducirError(error, contexto);
}
