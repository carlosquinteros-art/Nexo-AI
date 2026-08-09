/**
 * CRUD genérico sobre cualquier tabla del esquema.
 *
 * Reglas que aplica siempre:
 *  · `user_id` lo pone el servicio a partir de la sesión: nunca viene del
 *    formulario. Así un cliente manipulado no puede escribir para otro usuario
 *    (y si lo intentara, RLS lo rechazaría igual).
 *  · Borrado suave por defecto en las tablas con `deleted_at`; el borrado duro
 *    queda explícito y se usa solo en tablas hijas sin historia.
 *  · Las lecturas excluyen los registros borrados salvo que se pida lo contrario.
 */
import { supabase } from '../lib/supabase';
import { ejecutar, ejecutarVacio, NexoError, traducirError } from '../lib/errors';
import type { InsertOf, RowOf, TableName, UpdateOf, EntityKind } from '../types/database.types';

/** Tablas que soportan borrado suave. */
export const TABLAS_SOFT_DELETE = new Set<TableName>([
  'brands', 'contacts', 'stores', 'people', 'requests', 'incidents', 'meetings', 'message_templates',
  'courses', 'course_units', 'class_sessions', 'assessments', 'readings', 'study_plans', 'study_sessions',
  'legal_sources', 'legal_concepts', 'legal_notes', 'flashcards', 'practice_questions', 'case_briefs',
  'tasks', 'agreements', 'notes', 'personal_events'
]);

export interface OpcionesLista<T extends TableName> {
  columns?: string;
  filtros?: Partial<Record<string, unknown>>;
  /** Filtros avanzados: [columna, operador, valor] */
  where?: Array<[string, 'eq' | 'neq' | 'gt' | 'gte' | 'lt' | 'lte' | 'like' | 'ilike' | 'is' | 'in', unknown]>;
  orden?: { columna: string; ascendente?: boolean };
  limite?: number;
  desde?: number;
  incluirBorrados?: boolean;
  signal?: AbortSignal;
}

export async function requiereUsuario(): Promise<string> {
  const { data, error } = await supabase.auth.getSession();
  if (error) throw traducirError(error, 'verificar la sesión');
  const uid = data.session?.user?.id;
  if (!uid) throw new NexoError('Necesitas iniciar sesión para hacer esto.', 'unauthenticated');
  return uid;
}

export function crearServicio<T extends TableName>(tabla: T, entidad: EntityKind) {
  const soporta = TABLAS_SOFT_DELETE.has(tabla);

  return {
    tabla,
    entidad,

    /** Lista con filtros, orden y paginación. */
    async listar(opciones: OpcionesLista<T> = {}): Promise<RowOf<T>[]> {
      let q = supabase.from(tabla).select(opciones.columns ?? '*');

      if (soporta && !opciones.incluirBorrados) q = q.is('deleted_at', null);
      for (const [col, val] of Object.entries(opciones.filtros ?? {})) {
        q = val === null ? q.is(col, null) : q.eq(col, val as never);
      }
      for (const [col, op, val] of opciones.where ?? []) {
        /* El operador es dinámico por diseño; se acota con un mapa tipado
           para no perder la comprobación de TypeScript. */
        const filtros: Record<string, (c: string, v: never) => typeof q> = {
          eq: (c, v) => q.eq(c, v), neq: (c, v) => q.neq(c, v),
          gt: (c, v) => q.gt(c, v), gte: (c, v) => q.gte(c, v),
          lt: (c, v) => q.lt(c, v), lte: (c, v) => q.lte(c, v),
          like: (c, v) => q.like(c, String(v)), ilike: (c, v) => q.ilike(c, String(v)),
          is: (c, v) => q.is(c, v as never), in: (c, v) => q.in(c, v as never)
        };
        const aplicar = filtros[op];
        if (aplicar) q = aplicar(col, val as never);
      }
      if (opciones.orden) q = q.order(opciones.orden.columna, { ascending: opciones.orden.ascendente ?? true });
      if (opciones.limite) q = q.range(opciones.desde ?? 0, (opciones.desde ?? 0) + opciones.limite - 1);
      if (opciones.signal) q = q.abortSignal(opciones.signal);

      return (await ejecutar(q, `cargar ${tabla}`)) as unknown as RowOf<T>[];
    },

    async obtener(id: string): Promise<RowOf<T>> {
      const q = supabase.from(tabla).select('*').eq('id', id).single();
      return (await ejecutar(q, `cargar el registro de ${tabla}`)) as unknown as RowOf<T>;
    },

    async contar(filtros: Record<string, unknown> = {}): Promise<number> {
      let q = supabase.from(tabla).select('id', { count: 'exact', head: true });
      if (soporta) q = q.is('deleted_at', null);
      for (const [col, val] of Object.entries(filtros)) q = q.eq(col, val as never);
      const { count, error } = await q;
      if (error) throw traducirError(error, `contar ${tabla}`);
      return count ?? 0;
    },

    /** Crea un registro. `user_id` se toma de la sesión, nunca del formulario. */
    async crear(valores: InsertOf<T>): Promise<RowOf<T>> {
      const user_id = await requiereUsuario();
      const payload = { ...(valores as object), user_id } as never;
      const q = supabase.from(tabla).insert(payload).select().single();
      return (await ejecutar(q, `crear el registro en ${tabla}`)) as unknown as RowOf<T>;
    },

    async crearVarios(valores: InsertOf<T>[]): Promise<RowOf<T>[]> {
      if (!valores.length) return [];
      const user_id = await requiereUsuario();
      const payload = valores.map((v) => ({ ...(v as object), user_id })) as never;
      const q = supabase.from(tabla).insert(payload).select();
      return (await ejecutar(q, `crear registros en ${tabla}`)) as unknown as RowOf<T>[];
    },

    /** Actualiza. Se prohíbe cambiar id y user_id desde el cliente. */
    async actualizar(id: string, cambios: UpdateOf<T>): Promise<RowOf<T>> {
      await requiereUsuario();
      const limpio = { ...(cambios as Record<string, unknown>) };
      delete limpio.id; delete limpio.user_id; delete limpio.created_at; delete limpio.updated_at;
      const q = supabase.from(tabla).update(limpio as never).eq('id', id).select().single();
      return (await ejecutar(q, `guardar los cambios en ${tabla}`)) as unknown as RowOf<T>;
    },

    /** Borrado suave si la tabla lo soporta; duro en caso contrario. */
    async eliminar(id: string): Promise<void> {
      await requiereUsuario();
      if (soporta) {
        await ejecutarVacio(
          supabase.from(tabla).update({ deleted_at: new Date().toISOString() } as never).eq('id', id),
          `eliminar el registro de ${tabla}`
        );
      } else {
        await ejecutarVacio(supabase.from(tabla).delete().eq('id', id), `eliminar el registro de ${tabla}`);
      }
    },

    async restaurar(id: string): Promise<void> {
      if (!soporta) return;
      await requiereUsuario();
      await ejecutarVacio(
        supabase.from(tabla).update({ deleted_at: null } as never).eq('id', id),
        `restaurar el registro de ${tabla}`
      );
    },

    /** Borrado definitivo. Solo para vaciar la papelera de forma consciente. */
    async eliminarDefinitivo(id: string): Promise<void> {
      await requiereUsuario();
      await ejecutarVacio(supabase.from(tabla).delete().eq('id', id), `eliminar definitivamente en ${tabla}`);
    }
  };
}

/** Deja registro de una acción en `activity_log`. No interrumpe si falla. */
export async function registrarActividad(
  entity_type: EntityKind,
  entity_id: string,
  action: 'create' | 'update' | 'delete' | 'restore',
  summary?: string
): Promise<void> {
  try {
    const user_id = await requiereUsuario();
    await supabase.from('activity_log').insert({ user_id, entity_type, entity_id, action, summary } as never);
  } catch {
    /* el registro de actividad nunca debe romper la operación principal */
  }
}
