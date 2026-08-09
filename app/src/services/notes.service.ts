/**
 * Notas y apuntes, con conversión a otros registros.
 *
 * Regla del producto: convertir NUNCA modifica ni borra la nota original.
 * Se crea el nuevo registro y la nota queda como fuente.
 */
import { supabase } from '../lib/supabase';
import { ejecutar } from '../lib/errors';
import { validarNota } from '../lib/validation';
import { crearServicio, registrarActividad } from './base.service';
import { tasksService } from './tasks.service';
import { workService, agreementsService } from './work.service';
import { universityService, flashcardsService, legalConceptsService } from './university.service';
import { studyService } from './study.service';
import type {
  Note, SpaceType, NoteType, Task, Meeting, StudySession, Flashcard, LegalConcept, Agreement
} from '../types/database.types';

export const notesService = crearServicio('notes', 'note');

export type DestinoConversion = 'task' | 'meeting' | 'study_session' | 'flashcard' | 'legal_concept' | 'agreement';

export const noteService = {
  ...notesService,

  async buscar(opciones: { space?: SpaceType | 'all'; type?: NoteType; courseId?: string; brandId?: string; texto?: string } = {}): Promise<Note[]> {
    let q = supabase.from('notes').select('*, courses(name), brands(name)').is('deleted_at', null);
    if (opciones.space && opciones.space !== 'all') q = q.eq('space', opciones.space);
    if (opciones.type) q = q.eq('type', opciones.type);
    if (opciones.courseId) q = q.eq('course_id', opciones.courseId);
    if (opciones.brandId) q = q.eq('brand_id', opciones.brandId);
    if (opciones.texto) q = q.or(`title.ilike.%${opciones.texto}%,content.ilike.%${opciones.texto}%,topic.ilike.%${opciones.texto}%`);
    q = q.order('is_pinned', { ascending: false }).order('created_at', { ascending: false });
    return (await ejecutar(q, 'cargar las notas')) as unknown as Note[];
  },

  async crearNota(datos: Partial<Note> & { title: string }): Promise<Note> {
    validarNota(datos);
    const n = (await notesService.crear(datos as never)) as Note;
    void registrarActividad('note', n.id, 'create', n.title);
    return n;
  },

  async actualizarNota(id: string, cambios: Partial<Note>): Promise<Note> {
    if (cambios.title !== undefined) validarNota(cambios);
    return (await notesService.actualizar(id, cambios as never)) as Note;
  },

  async fijar(id: string, is_pinned: boolean): Promise<Note> {
    return (await notesService.actualizar(id, { is_pinned } as never)) as Note;
  },

  /**
   * Convierte una nota en otro registro. Devuelve el objeto creado.
   * `extra` permite completar los campos que la nota no tiene (fecha, etc.).
   */
  async convertir(
    nota: Note,
    destino: DestinoConversion,
    extra: Record<string, unknown> = {}
  ): Promise<Task | Meeting | StudySession | Flashcard | LegalConcept | Agreement> {
    switch (destino) {
      case 'task': {
        const t = await tasksService.crearTarea({
          space: nota.space, title: nota.title, description: nota.content,
          brand_id: nota.brand_id, course_id: nota.course_id, ...extra
        } as never);
        void registrarActividad('note', nota.id, 'update', 'Convertida en tarea');
        return t;
      }
      case 'meeting':
        return workService.crearReunion({
          space: nota.space, title: nota.title, notes: nota.content,
          brand_id: nota.brand_id, starts_at: new Date().toISOString(), ...extra
        } as never);

      case 'study_session':
        return studyService.crearSesion({
          title: nota.title, notes: nota.content, course_id: nota.course_id, unit_id: nota.unit_id,
          scheduled_date: new Date().toISOString().slice(0, 10), ...extra
        } as never);

      case 'flashcard':
        return (await flashcardsService.crear({
          front: nota.title, back: nota.content ?? '', course_id: nota.course_id, unit_id: nota.unit_id, ...extra
        } as never)) as Flashcard;

      case 'legal_concept':
        // Siempre entra sin verificar: es material propio, no una fuente oficial.
        return (await legalConceptsService.crear({
          term: nota.title, definition: nota.content ?? '', course_id: nota.course_id,
          origin: 'Convertido desde una nota', verification: 'unverified', ...extra
        } as never)) as LegalConcept;

      case 'agreement':
        return (await agreementsService.crear({
          title: nota.title, detail: nota.content, brand_id: nota.brand_id,
          type: 'finding', ...extra
        } as never)) as Agreement;
    }
  },

  /** Crea fichas de repaso a partir de conceptos propios. Nunca inventa contenido. */
  async fichasDesdeConceptos(courseId?: string): Promise<number> {
    const conceptos = await universityService.conceptos(courseId);
    if (!conceptos.length) return 0;
    const filas = conceptos.map((c) => ({
      front: `¿Qué es ${c.term}?`, back: c.definition, course_id: c.course_id, concept_id: c.id,
      next_review: new Date().toISOString().slice(0, 10)
    }));
    await flashcardsService.crearVarios(filas as never);
    return filas.length;
  }
};
