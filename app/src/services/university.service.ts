/**
 * Espacio Universidad: asignaturas, unidades, evaluaciones, notas, lecturas,
 * material jurídico y cálculo de promedios.
 */
import { supabase } from '../lib/supabase';
import { ejecutar } from '../lib/errors';
import {
  validarAsignatura, validarEvaluacion, validarNotaAcademica, validarLectura, validarFuenteJuridica
} from '../lib/validation';
import { crearServicio, requiereUsuario, registrarActividad } from './base.service';
import type {
  AcademicPeriod, Assessment, AssessmentPanel, AssessmentTopic, AvailabilitySlot, ClassSession,
  Course, CourseAverage, CourseUnit, Flashcard, Grade, LegalConcept, LegalNote, LegalSource,
  MasteryLevel, PracticeQuestion, Reading, ReadingNote, CaseBrief, StudyWeek, UnitProgress, WeakTopic
} from '../types/database.types';

export const periodsService = crearServicio('academic_periods', 'course');
export const coursesService = crearServicio('courses', 'course');
export const unitsService = crearServicio('course_units', 'course_unit');
export const classSessionsService = crearServicio('class_sessions', 'course');
export const assessmentsService = crearServicio('assessments', 'assessment');
export const readingsService = crearServicio('readings', 'reading');
export const legalSourcesService = crearServicio('legal_sources', 'legal_source');
export const legalConceptsService = crearServicio('legal_concepts', 'legal_concept');
export const legalNotesService = crearServicio('legal_notes', 'legal_note');
export const flashcardsService = crearServicio('flashcards', 'flashcard');
export const questionsService = crearServicio('practice_questions', 'practice_question');
export const caseBriefsService = crearServicio('case_briefs', 'case_brief');

/** Porcentaje de avance que representa cada nivel de dominio. */
export const AVANCE_POR_DOMINIO: Record<MasteryLevel, number> = {
  not_started: 0, initial: 33, in_progress: 66, mastered: 100
};

export const universityService = {
  /* ------------------------------------------------------------- Periodos - */
  async periodos(): Promise<AcademicPeriod[]> {
    return (await periodsService.listar({ orden: { columna: 'starts_on', ascendente: false } })) as AcademicPeriod[];
  },

  /* ---------------------------------------------------------- Asignaturas - */
  async asignaturas(soloActivas = true): Promise<Course[]> {
    return (await coursesService.listar({
      filtros: soloActivas ? { is_active: true } : {},
      orden: { columna: 'name' }
    })) as Course[];
  },

  async crearAsignatura(datos: Partial<Course> & { name: string }): Promise<Course> {
    validarAsignatura(datos);
    const c = (await coursesService.crear(datos as never)) as Course;
    void registrarActividad('course', c.id, 'create', c.name);
    return c;
  },

  async actualizarAsignatura(id: string, cambios: Partial<Course>): Promise<Course> {
    if (cambios.name !== undefined) validarAsignatura(cambios);
    return (await coursesService.actualizar(id, cambios as never)) as Course;
  },

  /** Ficha completa de la asignatura. */
  async fichaAsignatura(courseId: string) {
    const [curso, unidades, evaluaciones, lecturas, clases, fuentes] = await Promise.all([
      coursesService.obtener(courseId) as Promise<Course>,
      unitsService.listar({ filtros: { course_id: courseId }, orden: { columna: 'position' } }) as Promise<CourseUnit[]>,
      this.evaluacionesDe(courseId),
      readingsService.listar({ filtros: { course_id: courseId }, orden: { columna: 'due_date' } }) as Promise<Reading[]>,
      classSessionsService.listar({ filtros: { course_id: courseId }, orden: { columna: 'starts_at' } }) as Promise<ClassSession[]>,
      legalSourcesService.listar({ filtros: { course_id: courseId }, orden: { columna: 'identifier' } }) as Promise<LegalSource[]>
    ]);
    return { curso, unidades, evaluaciones, lecturas, clases, fuentes, avance: this.avanceDe(unidades) };
  },

  /** Porcentaje de avance del programa según el dominio de sus unidades. */
  avanceDe(unidades: CourseUnit[]): number {
    if (!unidades.length) return 0;
    return Math.round(unidades.reduce((a, u) => a + AVANCE_POR_DOMINIO[u.mastery], 0) / unidades.length);
  },

  async cambiarDominio(unitId: string, mastery: MasteryLevel): Promise<CourseUnit> {
    return (await unitsService.actualizar(unitId, { mastery } as never)) as CourseUnit;
  },

  /* -------------------------------------------------------- Evaluaciones -- */
  async evaluacionesDe(courseId: string): Promise<Array<Assessment & { grades: Grade[] }>> {
    return (await ejecutar(
      supabase.from('assessments').select('*, grades(*)').eq('course_id', courseId).is('deleted_at', null).order('due_date'),
      'cargar las evaluaciones'
    )) as unknown as Array<Assessment & { grades: Grade[] }>;
  },

  async proximasEvaluaciones(dias = 60): Promise<Assessment[]> {
    const hasta = new Date(); hasta.setDate(hasta.getDate() + dias);
    return (await ejecutar(
      supabase.from('assessments').select('*, courses(name)')
        .is('deleted_at', null).eq('status', 'pending')
        .gte('due_date', new Date().toISOString().slice(0, 10))
        .lte('due_date', hasta.toISOString().slice(0, 10))
        .order('due_date'),
      'cargar las próximas evaluaciones'
    )) as unknown as Assessment[];
  },

  async crearEvaluacion(datos: Partial<Assessment> & { course_id: string; title: string },
                        temas: Array<{ title: string; unit_id?: string | null }> = []): Promise<Assessment> {
    validarEvaluacion(datos);
    const ev = (await assessmentsService.crear(datos as never)) as Assessment;
    if (temas.length) {
      const user_id = await requiereUsuario();
      await supabase.from('assessment_topics').insert(
        temas.map((t, i) => ({ ...t, user_id, assessment_id: ev.id, position: i + 1 })) as never
      );
    }
    void registrarActividad('assessment', ev.id, 'create', ev.title);
    return ev;
  },

  async temasDe(assessmentId: string): Promise<AssessmentTopic[]> {
    return (await ejecutar(
      supabase.from('assessment_topics').select('*').eq('assessment_id', assessmentId).order('position'),
      'cargar los temas'
    )) as AssessmentTopic[];
  },

  /* --------------------------------------------------------------- Notas -- */
  /** Registra una nota. El trigger de la base marca la evaluación como calificada. */
  async registrarNota(assessmentId: string, score: number, comment?: string, attempt = 1): Promise<Grade> {
    validarNotaAcademica({ score });
    const user_id = await requiereUsuario();
    return (await ejecutar(
      supabase.from('grades').insert({ user_id, assessment_id: assessmentId, score, comment, attempt } as never)
        .select().single(),
      'registrar la nota'
    )) as Grade;
  },

  async promedios(): Promise<CourseAverage[]> {
    return (await ejecutar(supabase.from('v_course_average').select('*'), 'calcular los promedios')) as CourseAverage[];
  },

  /**
   * Nota necesaria en lo que falta para alcanzar la nota de aprobación.
   * Devuelve null si ya no queda ponderación pendiente.
   */
  notaNecesaria(evaluaciones: Array<Assessment & { grades?: Grade[] }>, notaAprobacion = 4.0): number | null {
    let acumulado = 0;
    let pendiente = 0;
    for (const ev of evaluaciones) {
      const nota = ev.grades?.length ? ev.grades[ev.grades.length - 1].score : null;
      if (nota != null) acumulado += (nota * ev.weight) / 100;
      else pendiente += ev.weight / 100;
    }
    if (pendiente <= 0) return null;
    return Number(((notaAprobacion - acumulado) / pendiente).toFixed(2));
  },

  /** Promedio ponderado con lo ya calificado. */
  promedioParcial(evaluaciones: Array<Assessment & { grades?: Grade[] }>): number | null {
    let suma = 0, peso = 0;
    for (const ev of evaluaciones) {
      const nota = ev.grades?.length ? ev.grades[ev.grades.length - 1].score : null;
      if (nota != null) { suma += nota * ev.weight; peso += ev.weight; }
    }
    return peso ? Number((suma / peso).toFixed(2)) : null;
  },

  /* ------------------------------------------------------------ Lecturas -- */
  async lecturasPendientes(): Promise<Reading[]> {
    return (await ejecutar(
      supabase.from('readings').select('*, courses(name)')
        .is('deleted_at', null).filter('pages_read', 'lt', 'total_pages')
        .order('due_date', { nullsFirst: false }),
      'cargar las lecturas'
    )) as unknown as Reading[];
  },

  async crearLectura(datos: Partial<Reading> & { title: string }): Promise<Reading> {
    validarLectura(datos);
    return (await readingsService.crear(datos as never)) as Reading;
  },

  /** Avanza páginas sin pasarse del total (la base también lo valida). */
  async avanzarLectura(lectura: Reading, paginas: number | 'todo'): Promise<Reading> {
    const nuevas = paginas === 'todo'
      ? lectura.total_pages
      : Math.min(lectura.total_pages, lectura.pages_read + paginas);
    return (await readingsService.actualizar(lectura.id, { pages_read: nuevas } as never)) as Reading;
  },

  /* ------------------------------------------------- Material jurídico ---- */
  /** Las fuentes se guardan siempre como no verificadas. */
  async crearFuente(datos: Partial<LegalSource> & { identifier: string }): Promise<LegalSource> {
    validarFuenteJuridica(datos);
    return (await legalSourcesService.crear({ ...datos, verification: 'unverified' } as never)) as LegalSource;
  },

  async marcarFuenteVerificada(id: string, verificada: boolean): Promise<LegalSource> {
    return (await legalSourcesService.actualizar(id, {
      verification: verificada ? 'verified' : 'unverified'
    } as never)) as LegalSource;
  },

  async conceptos(courseId?: string): Promise<LegalConcept[]> {
    return (await legalConceptsService.listar({
      filtros: courseId ? { course_id: courseId } : {},
      orden: { columna: 'term' }
    })) as LegalConcept[];
  },

  async apuntesJuridicos(courseId?: string): Promise<LegalNote[]> {
    return (await legalNotesService.listar({
      filtros: courseId ? { course_id: courseId } : {},
      orden: { columna: 'created_at', ascendente: false }
    })) as LegalNote[];
  },

  async casos(courseId?: string): Promise<CaseBrief[]> {
    return (await caseBriefsService.listar({
      filtros: courseId ? { course_id: courseId } : {},
      orden: { columna: 'created_at', ascendente: false }
    })) as CaseBrief[];
  },

  /* --------------------------------------------------- Fichas y preguntas - */
  async fichasParaHoy(): Promise<Flashcard[]> {
    const hoy = new Date().toISOString().slice(0, 10);
    return (await ejecutar(
      supabase.from('flashcards').select('*').is('deleted_at', null)
        .or(`next_review.is.null,next_review.lte.${hoy}`).order('next_review', { nullsFirst: true }),
      'cargar las fichas de repaso'
    )) as Flashcard[];
  },

  /** Repetición espaciada simple: duplica el intervalo al acertar, reinicia al fallar. */
  async responderFicha(ficha: Flashcard, acerto: boolean): Promise<Flashcard> {
    const intervalo = acerto ? Math.min(30, Math.max(1, ficha.interval_days * 2)) : 1;
    const proxima = new Date(); proxima.setDate(proxima.getDate() + intervalo);
    const dominio: MasteryLevel = acerto
      ? (ficha.mastery === 'not_started' ? 'initial' : ficha.mastery === 'initial' ? 'in_progress' : 'mastered')
      : 'initial';
    return (await flashcardsService.actualizar(ficha.id, {
      hits: ficha.hits + (acerto ? 1 : 0),
      misses: ficha.misses + (acerto ? 0 : 1),
      interval_days: intervalo,
      mastery: dominio,
      next_review: proxima.toISOString().slice(0, 10)
    } as never)) as Flashcard;
  },

  async preguntas(courseId?: string): Promise<PracticeQuestion[]> {
    return (await questionsService.listar({
      filtros: courseId ? { course_id: courseId } : {},
      orden: { columna: 'created_at', ascendente: false }
    })) as PracticeQuestion[];
  }
};

/* ==========================================================================
   Motor académico: escala configurable, progreso, temas débiles y realismo.
   Espeja lo que hace el prototipo, pero leyendo de las vistas de la base.
   ========================================================================== */
export interface EscalaNotas {
  min: number; max: number; aprobacion: number; decimales: number; nombre: string;
}

export const academicService = {
  /** Escala vigente del usuario. Por defecto la chilena 1,0 – 7,0. */
  async escala(): Promise<EscalaNotas> {
    const { data } = await supabase.from('user_settings')
      .select('min_grade,max_grade,pass_grade,grade_decimals,grade_scale_name').maybeSingle();
    return {
      min: Number(data?.min_grade ?? 1),
      max: Number(data?.max_grade ?? 7),
      aprobacion: Number(data?.pass_grade ?? 4),
      decimales: Number(data?.grade_decimals ?? 1),
      nombre: data?.grade_scale_name ?? 'Escala chilena 1,0 – 7,0'
    };
  },

  formatearNota(n: number | null, esc: EscalaNotas): string {
    return n == null ? '—' : n.toFixed(esc.decimales).replace('.', ',');
  },

  /** ¿La nota necesaria cabe dentro de la escala? */
  alcanzable(nota: number | null, esc: EscalaNotas): boolean {
    return nota != null && nota <= esc.max + 0.001;
  },

  /** Progreso por unidad, con precisión de repaso incluida. */
  async progresoUnidades(courseId?: string): Promise<UnitProgress[]> {
    let q = supabase.from('v_unit_progress').select('*');
    if (courseId) q = q.eq('course_id', courseId);
    return (await ejecutar(q.order('name'), 'cargar el progreso por unidad')) as UnitProgress[];
  },

  /** Temas ordenados por urgencia de refuerzo. */
  async temasDebiles(courseId?: string, limite = 8): Promise<WeakTopic[]> {
    let q = supabase.from('v_weak_topics').select('*');
    if (courseId) q = q.eq('course_id', courseId);
    return (await ejecutar(
      q.order('reinforcement_score', { ascending: false }).limit(limite),
      'cargar los temas a reforzar'
    )) as WeakTopic[];
  },

  /** Horas de estudio de la semana en curso. */
  async semanaEstudio(): Promise<StudyWeek | null> {
    const hoy = new Date();
    const lunes = new Date(hoy);
    lunes.setDate(hoy.getDate() - ((hoy.getDay() + 6) % 7));
    const { data } = await supabase.from('v_study_week').select('*')
      .eq('week_start', lunes.toISOString().slice(0, 10)).maybeSingle();
    return (data as StudyWeek) ?? null;
  },

  /** Panel de evaluaciones con días restantes, preparación y plan asociado. */
  async panelEvaluaciones(courseId?: string): Promise<AssessmentPanel[]> {
    let q = supabase.from('v_assessment_panel').select('*');
    if (courseId) q = q.eq('course_id', courseId);
    return (await ejecutar(q.order('due_date'), 'cargar el panel de evaluaciones')) as AssessmentPanel[];
  },

  /** Minutos estimados de lectura restante. */
  minutosLectura(r: Reading): number {
    return Math.round(Math.max(0, r.total_pages - r.pages_read) * Number(r.estimated_min_per_page ?? 2.5));
  },
  avanceLectura(r: Reading): number {
    return r.total_pages ? Math.round((r.pages_read / r.total_pages) * 100) : 0;
  },

  /**
   * ¿El plan cabe en el tiempo disponible?
   * Cruza la disponibilidad declarada con clases y sesiones ya agendadas.
   */
  async realismo(fechaObjetivo: string, minutosNecesarios: number): Promise<{
    dias: number; disponible: number; necesario: number; ratio: number;
    nivel: 'holgado' | 'ajustado' | 'irreal'; mensaje: string;
  }> {
    const hoy = new Date().toISOString().slice(0, 10);
    const dias = Math.max(0, Math.round(
      (new Date(`${fechaObjetivo}T12:00:00Z`).getTime() - new Date(`${hoy}T12:00:00Z`).getTime()) / 86400000
    ));
    const [{ data: prefs }, clases, sesiones] = await Promise.all([
      supabase.from('user_settings').select('study_availability').maybeSingle(),
      supabase.from('class_sessions').select('starts_at,ends_at').is('deleted_at', null)
        .gte('starts_at', hoy).lte('starts_at', fechaObjetivo),
      supabase.from('study_sessions').select('scheduled_date,duration_min').is('deleted_at', null)
        .eq('status', 'pending').gte('scheduled_date', hoy).lte('scheduled_date', fechaObjetivo)
    ]);
    const disp = (prefs?.study_availability ?? []) as AvailabilitySlot[];

    let disponible = 0;
    for (let i = 0; i < dias; i++) {
      const f = new Date(`${hoy}T12:00:00Z`);
      f.setUTCDate(f.getUTCDate() + i);
      const dow = f.getUTCDay();
      disp.filter((d) => Number(d.day) === dow).forEach((v) => {
        const largo = (Number(v.end.slice(0, 2)) * 60 + Number(v.end.slice(3, 5)))
                    - (Number(v.start.slice(0, 2)) * 60 + Number(v.start.slice(3, 5)));
        disponible += Math.max(0, largo);
      });
    }
    (clases.data ?? []).forEach((c) => {
      disponible -= c.ends_at
        ? Math.max(0, (new Date(c.ends_at).getTime() - new Date(c.starts_at).getTime()) / 60000)
        : 90;
    });
    (sesiones.data ?? []).forEach((s) => { disponible -= s.duration_min ?? 60; });
    disponible = Math.max(0, Math.round(disponible));

    const ratio = minutosNecesarios ? disponible / minutosNecesarios : 2;
    const nivel = ratio >= 1.4 ? 'holgado' : ratio >= 1 ? 'ajustado' : 'irreal';
    return {
      dias, disponible, necesario: minutosNecesarios, ratio, nivel,
      mensaje: nivel === 'holgado'
        ? 'El plan cabe con holgura en tu disponibilidad.'
        : nivel === 'ajustado'
          ? 'El plan cabe, pero justo: cualquier imprevisto te deja atrás.'
          : 'No alcanza. Necesitas más bloques disponibles, menos materia o empezar antes.'
    };
  },

  /** Registra un intento de repaso y aplica repetición espaciada 1-3-7-14-30. */
  async responderFicha2(ficha: Flashcard, correcto: boolean, segundos = 0): Promise<number> {
    const pasos = [1, 3, 7, 14, 30];
    const actual = pasos.indexOf(ficha.interval_days);
    const idx = correcto ? Math.min(pasos.length - 1, (actual < 0 ? 0 : actual) + 1) : 0;
    const proxima = new Date();
    proxima.setDate(proxima.getDate() + pasos[idx]);

    await flashcardsService.actualizar(ficha.id, {
      hits: ficha.hits + (correcto ? 1 : 0),
      misses: ficha.misses + (correcto ? 0 : 1),
      interval_days: pasos[idx],
      mastery: correcto
        ? (ficha.mastery === 'not_started' ? 'initial' : ficha.mastery === 'initial' ? 'in_progress' : 'mastered')
        : 'initial',
      next_review: proxima.toISOString().slice(0, 10)
    } as never);

    const user_id = await requiereUsuario();
    await supabase.from('review_attempts').insert({
      user_id, item_type: 'flashcard', item_id: ficha.id,
      course_id: ficha.course_id, unit_id: ficha.unit_id,
      result: correcto ? 'correct' : 'incorrect', seconds: Math.round(segundos)
    } as never);

    return pasos[idx];
  },

  /** Citas y comentarios de una lectura. */
  async citasDe(readingId: string): Promise<ReadingNote[]> {
    return (await ejecutar(
      supabase.from('reading_notes').select('*').eq('reading_id', readingId).order('page'),
      'cargar las citas'
    )) as ReadingNote[];
  },

  /**
   * Guarda el contenido derivado de un apunte SIN tocar el texto original.
   * `body` nunca se toca desde aquí: es una garantía del producto.
   */
  async derivarApunte(noteId: string, derivado: {
    summary?: string; key_concepts?: string[]; norms_mentioned?: string[]; case_law_mentioned?: string[];
  }, quien: 'usuario' | 'reglas' | 'ia' = 'usuario'): Promise<LegalNote> {
    return (await legalNotesService.actualizar(noteId, {
      ...derivado, derived_at: new Date().toISOString(), derived_by: quien
    } as never)) as LegalNote;
  }
};
