/**
 * Buscador global y agenda unificada.
 */
import { supabase } from '../lib/supabase';
import { ejecutar } from '../lib/errors';
import type { CalendarItem, EntityKind, SpaceType } from '../types/database.types';

export interface ResultadoBusqueda {
  tipo: EntityKind;
  etiqueta: string;
  id: string;
  titulo: string;
  subtitulo: string;
  ruta: string;
}

/** Escapa los comodines de PostgREST para que el texto se busque literal. */
function limpiar(texto: string): string {
  return texto.replace(/[%,()]/g, ' ').trim();
}

export const searchService = {
  async global(texto: string, limite = 6): Promise<ResultadoBusqueda[]> {
    const q = limpiar(texto);
    if (q.length < 2) return [];
    const like = `%${q}%`;

    const [tareas, notas, marcas, cursos, evaluaciones, conceptos, fuentes, personas] = await Promise.all([
      ejecutar(supabase.from('tasks').select('id,title,space,status,due_at').is('deleted_at', null)
        .or(`title.ilike.${like},description.ilike.${like}`).limit(limite), 'buscar tareas'),
      ejecutar(supabase.from('notes').select('id,title,space,type').is('deleted_at', null)
        .or(`title.ilike.${like},content.ilike.${like}`).limit(limite), 'buscar notas'),
      ejecutar(supabase.from('brands').select('id,name,client_name,status').is('deleted_at', null)
        .or(`name.ilike.${like},client_name.ilike.${like}`).limit(limite), 'buscar marcas'),
      ejecutar(supabase.from('courses').select('id,name,professor').is('deleted_at', null)
        .or(`name.ilike.${like},professor.ilike.${like}`).limit(limite), 'buscar asignaturas'),
      ejecutar(supabase.from('assessments').select('id,title,due_date,course_id,courses(name)').is('deleted_at', null)
        .ilike('title', like).limit(limite), 'buscar evaluaciones'),
      ejecutar(supabase.from('legal_concepts').select('id,term,definition,verification').is('deleted_at', null)
        .or(`term.ilike.${like},definition.ilike.${like}`).limit(limite), 'buscar conceptos'),
      ejecutar(supabase.from('legal_sources').select('id,identifier,subject_matter,verification').is('deleted_at', null)
        .or(`identifier.ilike.${like},title.ilike.${like}`).limit(limite), 'buscar fuentes'),
      ejecutar(supabase.from('people').select('id,full_name,role_title,brand_id').is('deleted_at', null)
        .ilike('full_name', like).limit(limite), 'buscar personas')
    ]);

    const out: ResultadoBusqueda[] = [];
    const push = (tipo: EntityKind, etiqueta: string, id: string, titulo: string, subtitulo: string, ruta: string) =>
      out.push({ tipo, etiqueta, id, titulo, subtitulo, ruta });

    (tareas as Array<Record<string, string>>).forEach((t) =>
      push('task', 'Tarea', t.id, t.title, `${t.space}${t.due_at ? ' · vence ' + t.due_at.slice(0, 10) : ''}`, `/tareas/${t.id}`));
    (notas as Array<Record<string, string>>).forEach((n) =>
      push('note', 'Nota', n.id, n.title, String(n.type), `/notas/${n.id}`));
    (marcas as Array<Record<string, string>>).forEach((b) =>
      push('brand', 'Marca', b.id, b.name, b.client_name ?? '', `/trabajo/${b.id}`));
    (cursos as Array<Record<string, string>>).forEach((c) =>
      push('course', 'Asignatura', c.id, c.name, c.professor ?? '', `/universidad/${c.id}`));
    (evaluaciones as Array<Record<string, unknown>>).forEach((e) =>
      push('assessment', 'Evaluación', String(e.id), String(e.title),
        `${(e.courses as { name?: string } | null)?.name ?? ''} · ${e.due_date ?? 'sin fecha'}`,
        `/universidad/${e.course_id}`));
    (conceptos as Array<Record<string, string>>).forEach((c) =>
      push('legal_concept', 'Concepto', c.id, c.term,
        c.verification === 'verified' ? 'verificado' : 'sin verificar', `/universidad/glosario`));
    (fuentes as Array<Record<string, string>>).forEach((f) =>
      push('legal_source', 'Fuente', f.id, f.identifier,
        f.verification === 'verified' ? 'verificada' : 'sin verificar', `/universidad/fuentes`));
    (personas as Array<Record<string, string>>).forEach((p) =>
      push('person', 'Persona', p.id, p.full_name, p.role_title ?? '', `/trabajo/${p.brand_id ?? ''}`));

    return out;
  },

  /** Agenda unificada de los tres espacios (vista `v_calendar`). */
  async agenda(desde: string, hasta: string, space?: SpaceType): Promise<CalendarItem[]> {
    let q = supabase.from('v_calendar').select('*').gte('starts_at', desde).lte('starts_at', hasta);
    if (space) q = q.eq('space', space);
    return (await ejecutar(q.order('starts_at'), 'cargar la agenda')) as CalendarItem[];
  }
};
