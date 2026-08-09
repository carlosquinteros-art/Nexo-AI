/**
 * Tareas: CRUD completo, subtareas, comentarios, filtros y recurrencia.
 */
import { supabase } from '../lib/supabase';
import { ejecutar, traducirError } from '../lib/errors';
import { validarTarea } from '../lib/validation';
import { crearServicio, requiereUsuario, registrarActividad } from './base.service';
import type {
  Task, Subtask, TaskComment, SpaceType, TaskStatus, PriorityLevel, RecurrenceType
} from '../types/database.types';

const base = crearServicio('tasks', 'task');

export interface FiltroTareas {
  space?: SpaceType | 'all';
  status?: TaskStatus[];
  priority?: PriorityLevel[];
  brandId?: string;
  courseId?: string;
  assessmentId?: string;
  personId?: string;
  texto?: string;
  vencidas?: boolean;
  desde?: string;
  hasta?: string;
  sinFecha?: boolean;
  incluirCompletadas?: boolean;
  limite?: number;
}

export interface TareaConDetalle extends Task {
  subtasks?: Subtask[];
  brands?: { name: string } | null;
  courses?: { name: string } | null;
}

const DIAS_RECURRENCIA: Record<RecurrenceType, number> = {
  none: 0, daily: 1, weekdays: 1, weekly: 7, biweekly: 14, monthly: 30
};

function siguienteVencimiento(due: string, recurrence: RecurrenceType): string {
  const d = new Date(due);
  d.setDate(d.getDate() + (DIAS_RECURRENCIA[recurrence] || 1));
  if (recurrence === 'weekdays') {
    while (d.getDay() === 0 || d.getDay() === 6) d.setDate(d.getDate() + 1);
  }
  return d.toISOString();
}

export const tasksService = {
  ...base,

  /** Lista con todos los filtros de la interfaz aplicados en el servidor. */
  async buscar(f: FiltroTareas = {}): Promise<TareaConDetalle[]> {
    let q = supabase
      .from('tasks')
      .select('*, subtasks(*), brands(name), courses(name)')
      .is('deleted_at', null);

    if (f.space && f.space !== 'all') q = q.eq('space', f.space);
    if (f.status?.length) q = q.in('status', f.status);
    else if (!f.incluirCompletadas) q = q.not('status', 'in', '("done","cancelled")');
    if (f.priority?.length) q = q.in('priority', f.priority);
    if (f.brandId) q = q.eq('brand_id', f.brandId);
    if (f.courseId) q = q.eq('course_id', f.courseId);
    if (f.assessmentId) q = q.eq('assessment_id', f.assessmentId);
    if (f.personId) q = q.eq('person_id', f.personId);
    if (f.texto) q = q.or(`title.ilike.%${f.texto}%,description.ilike.%${f.texto}%,category.ilike.%${f.texto}%`);
    if (f.vencidas) q = q.lt('due_at', new Date().toISOString());
    if (f.desde) q = q.gte('due_at', f.desde);
    if (f.hasta) q = q.lte('due_at', f.hasta);
    if (f.sinFecha) q = q.is('due_at', null);

    q = q.order('due_at', { ascending: true, nullsFirst: false }).order('priority', { ascending: false });
    if (f.limite) q = q.limit(f.limite);

    return (await ejecutar(q, 'cargar las tareas')) as unknown as TareaConDetalle[];
  },

  async crearTarea(datos: Partial<Task> & { title: string }): Promise<Task> {
    validarTarea(datos);
    const t = await base.crear(datos as never);
    void registrarActividad('task', t.id, 'create', t.title);
    return t as Task;
  },

  async actualizarTarea(id: string, cambios: Partial<Task>): Promise<Task> {
    if (cambios.title !== undefined) validarTarea(cambios);
    const t = await base.actualizar(id, cambios as never);
    void registrarActividad('task', id, 'update');
    return t as Task;
  },

  /**
   * Alterna completada / pendiente. Si la tarea es recurrente y se cierra,
   * genera automáticamente la siguiente ocurrencia con sus subtareas limpias.
   */
  async alternarCompletada(tarea: Task): Promise<{ actualizada: Task; siguiente: Task | null }> {
    const cerrando = tarea.status !== 'done';
    const actualizada = await base.actualizar(tarea.id, {
      status: cerrando ? 'done' : 'pending',
      completed_at: cerrando ? new Date().toISOString() : null
    } as never) as Task;

    let siguiente: Task | null = null;
    if (cerrando && tarea.recurrence !== 'none' && tarea.due_at) {
      const { id, created_at, updated_at, completed_at, ...resto } = tarea;
      siguiente = await base.crear({
        ...resto,
        status: 'pending',
        due_at: siguienteVencimiento(tarea.due_at, tarea.recurrence)
      } as never) as Task;

      const subs = await this.listarSubtareas(tarea.id);
      if (subs.length) {
        await supabase.from('subtasks').insert(
          subs.map((s) => ({
            user_id: siguiente!.user_id, task_id: siguiente!.id, title: s.title, is_done: false, position: s.position
          })) as never
        );
      }
    }
    return { actualizada, siguiente };
  },

  async duplicar(id: string): Promise<Task> {
    const original = await base.obtener(id) as Task;
    const { id: _i, created_at, updated_at, completed_at, ...resto } = original;
    const copia = await base.crear({ ...resto, title: `${original.title} (copia)`, status: 'pending' } as never) as Task;
    const subs = await this.listarSubtareas(id);
    if (subs.length) {
      await supabase.from('subtasks').insert(
        subs.map((s) => ({ user_id: copia.user_id, task_id: copia.id, title: s.title, is_done: false, position: s.position })) as never
      );
    }
    return copia;
  },

  /* ------------------------------------------------------------ Subtareas - */
  async listarSubtareas(taskId: string): Promise<Subtask[]> {
    return (await ejecutar(
      supabase.from('subtasks').select('*').eq('task_id', taskId).order('position'),
      'cargar las subtareas'
    )) as Subtask[];
  },

  async agregarSubtarea(taskId: string, title: string, position = 0): Promise<Subtask> {
    const user_id = await requiereUsuario();
    return (await ejecutar(
      supabase.from('subtasks').insert({ user_id, task_id: taskId, title, position } as never).select().single(),
      'agregar la subtarea'
    )) as Subtask;
  },

  async alternarSubtarea(id: string, is_done: boolean): Promise<void> {
    const { error } = await supabase.from('subtasks').update({ is_done }).eq('id', id);
    if (error) throw traducirError(error, 'actualizar la subtarea');
  },

  async eliminarSubtarea(id: string): Promise<void> {
    const { error } = await supabase.from('subtasks').delete().eq('id', id);
    if (error) throw traducirError(error, 'eliminar la subtarea');
  },

  /* ---------------------------------------------------------- Comentarios - */
  async listarComentarios(taskId: string): Promise<TaskComment[]> {
    return (await ejecutar(
      supabase.from('task_comments').select('*').eq('task_id', taskId).order('created_at'),
      'cargar los comentarios'
    )) as TaskComment[];
  },

  async comentar(taskId: string, body: string): Promise<TaskComment> {
    const user_id = await requiereUsuario();
    return (await ejecutar(
      supabase.from('task_comments').insert({ user_id, task_id: taskId, body } as never).select().single(),
      'guardar el comentario'
    )) as TaskComment;
  },

  /* ---------------------------------------------------------- Agregados --- */
  /** Conteos para el panel de inicio, resueltos en el servidor. */
  async resumen(space: SpaceType | 'all' = 'all'): Promise<{ abiertas: number; vencidas: number; hoy: number }> {
    const inicioDia = new Date(); inicioDia.setHours(0, 0, 0, 0);
    const finDia = new Date(); finDia.setHours(23, 59, 59, 999);
    const ahora = new Date().toISOString();

    const base = () => {
      const q = supabase.from('tasks').select('id', { count: 'exact', head: true })
        .is('deleted_at', null).not('status', 'in', '("done","cancelled")');
      return space === 'all' ? q : q.eq('space', space);
    };

    const [abiertas, vencidas, hoy] = await Promise.all([
      base(),
      base().lt('due_at', ahora),
      base().gte('due_at', inicioDia.toISOString()).lte('due_at', finDia.toISOString())
    ]);

    for (const r of [abiertas, vencidas, hoy]) {
      if (r.error) throw traducirError(r.error, 'calcular el resumen');
    }
    return {
      abiertas: abiertas.count ?? 0,
      vencidas: vencidas.count ?? 0,
      hoy: hoy.count ?? 0
    };
  }
};
