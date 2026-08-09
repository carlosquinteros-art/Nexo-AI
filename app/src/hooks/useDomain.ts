/**
 * Hooks de dominio: tareas, trabajo, universidad, estudio, notas y búsqueda.
 * Todos devuelven { datos, cargando, error, recargar } y sus acciones.
 */
import { useMemo, useState } from 'react';
import { useAsyncData, useMutacion, useDebounce } from './useAsync';
import { useAuth } from './useAuth';
import { tasksService, type FiltroTareas, type TareaConDetalle } from '../services/tasks.service';
import { workService, brandsService, peopleService } from '../services/work.service';
import { universityService } from '../services/university.service';
import { studyService, plansService } from '../services/study.service';
import { noteService } from '../services/notes.service';
import { searchService } from '../services/search.service';
import type {
  Assessment, Brand, BrandLoad, CalendarItem, Course, CourseUnit, Flashcard, Grade,
  MasteryLevel, Note, Person, Reading, SpaceType, StudySession, Task
} from '../types/database.types';

/* ========================================================== TAREAS ======== */
export function useTareas(filtro: FiltroTareas = {}) {
  const { autenticado } = useAuth();
  const clave = JSON.stringify(filtro);

  const estado = useAsyncData<TareaConDetalle[]>(
    () => tasksService.buscar(filtro),
    [clave, autenticado],
    { activo: autenticado, inicial: [] }
  );

  const crear = useMutacion(
    (datos: Partial<Task> & { title: string }) => tasksService.crearTarea(datos),
    { alTerminar: () => void estado.recargar() }   // sin optimismo: el id lo asigna el servidor
  );

  const actualizar = useMutacion(
    ({ id, cambios }: { id: string; cambios: Partial<Task> }) => tasksService.actualizarTarea(id, cambios),
    { alTerminar: () => void estado.recargar() }
  );

  /** Cambio seguro de revertir: aplicamos optimismo. */
  const alternar = useMutacion(
    (tarea: Task) => tasksService.alternarCompletada(tarea),
    {
      optimista: (tarea) => {
        const previo = estado.datos;
        estado.setDatos((lista) =>
          (lista ?? []).map((t) =>
            t.id === tarea.id ? { ...t, status: t.status === 'done' ? 'pending' : 'done' } as TareaConDetalle : t
          )
        );
        return () => estado.setDatos(previo ?? []);
      },
      alTerminar: () => void estado.recargar()
    }
  );

  const eliminar = useMutacion(
    (id: string) => tasksService.eliminar(id),
    {
      optimista: (id) => {
        const previo = estado.datos;
        estado.setDatos((lista) => (lista ?? []).filter((t) => t.id !== id));
        return () => estado.setDatos(previo ?? []);
      }
    }
  );

  const duplicar = useMutacion((id: string) => tasksService.duplicar(id), { alTerminar: () => void estado.recargar() });

  return { ...estado, tareas: estado.datos ?? [], crear, actualizar, alternar, eliminar, duplicar };
}

export function useTarea(id: string | null) {
  const { autenticado } = useAuth();
  const estado = useAsyncData(
    async () => {
      if (!id) return null;
      const [tarea, subtareas, comentarios] = await Promise.all([
        tasksService.obtener(id), tasksService.listarSubtareas(id), tasksService.listarComentarios(id)
      ]);
      return { tarea: tarea as Task, subtareas, comentarios };
    },
    [id, autenticado],
    { activo: autenticado && !!id }
  );
  return estado;
}

/* ========================================================== TRABAJO ======= */
export function useMarcas() {
  const { autenticado } = useAuth();
  const estado = useAsyncData(
    async () => {
      const [marcas, carga] = await Promise.all([workService.listarMarcas(), workService.cargaPorMarca()]);
      const porId = new Map(carga.map((c) => [c.brand_id, c]));
      return marcas.map((m) => ({ ...m, carga: porId.get(m.id) ?? null })) as Array<Brand & { carga: BrandLoad | null }>;
    },
    [autenticado],
    { activo: autenticado, inicial: [] }
  );

  const crear = useMutacion((d: Partial<Brand> & { name: string }) => workService.crearMarca(d),
    { alTerminar: () => void estado.recargar() });
  const actualizar = useMutacion(({ id, cambios }: { id: string; cambios: Partial<Brand> }) =>
    workService.actualizarMarca(id, cambios), { alTerminar: () => void estado.recargar() });
  const eliminar = useMutacion((id: string) => brandsService.eliminar(id), { alTerminar: () => void estado.recargar() });

  return { ...estado, marcas: estado.datos ?? [], crear, actualizar, eliminar };
}

export function useFichaMarca(brandId: string | null) {
  const { autenticado } = useAuth();
  const estado = useAsyncData(
    () => (brandId ? workService.fichaMarca(brandId) : Promise.resolve(null)),
    [brandId, autenticado],
    { activo: autenticado && !!brandId }
  );

  const convertirAcuerdo = useMutacion(workService.convertirAcuerdoEnTarea, { alTerminar: () => void estado.recargar() });
  const registrarNovedad = useMutacion(workService.registrarNovedad, { alTerminar: () => void estado.recargar() });

  return { ...estado, convertirAcuerdo, registrarNovedad };
}

export function usePersonas(brandId?: string) {
  const { autenticado } = useAuth();
  const estado = useAsyncData(
    () => peopleService.listar({ filtros: brandId ? { brand_id: brandId } : {}, orden: { columna: 'full_name' } }) as Promise<Person[]>,
    [brandId, autenticado],
    { activo: autenticado, inicial: [] }
  );
  const crear = useMutacion((d: Partial<Person> & { full_name: string }) => workService.crearPersona(d),
    { alTerminar: () => void estado.recargar() });
  const actualizar = useMutacion(({ id, cambios }: { id: string; cambios: Partial<Person> }) =>
    workService.actualizarPersona(id, cambios), { alTerminar: () => void estado.recargar() });
  const eliminar = useMutacion((id: string) => peopleService.eliminar(id), { alTerminar: () => void estado.recargar() });

  return { ...estado, personas: estado.datos ?? [], crear, actualizar, eliminar };
}

/* ======================================================= UNIVERSIDAD ====== */
export function useAsignaturas() {
  const { autenticado } = useAuth();
  const estado = useAsyncData(
    async () => {
      const [cursos, promedios] = await Promise.all([universityService.asignaturas(), universityService.promedios()]);
      const porId = new Map(promedios.map((p) => [p.course_id, p]));
      return cursos.map((c) => ({ ...c, promedio: porId.get(c.id)?.partial_average ?? null }));
    },
    [autenticado],
    { activo: autenticado, inicial: [] }
  );
  const crear = useMutacion((d: Partial<Course> & { name: string }) => universityService.crearAsignatura(d),
    { alTerminar: () => void estado.recargar() });
  return { ...estado, asignaturas: estado.datos ?? [], crear };
}

export function useFichaAsignatura(courseId: string | null) {
  const { autenticado, preferencias } = useAuth();
  const estado = useAsyncData(
    () => (courseId ? universityService.fichaAsignatura(courseId) : Promise.resolve(null)),
    [courseId, autenticado],
    { activo: autenticado && !!courseId }
  );

  const notaAprobacion = preferencias?.pass_grade ?? 4.0;
  const calculos = useMemo(() => {
    const evs = estado.datos?.evaluaciones ?? [];
    return {
      promedio: universityService.promedioParcial(evs as Array<Assessment & { grades?: Grade[] }>),
      notaNecesaria: universityService.notaNecesaria(evs as Array<Assessment & { grades?: Grade[] }>, notaAprobacion),
      avance: estado.datos?.avance ?? 0
    };
  }, [estado.datos, notaAprobacion]);

  /** El dominio es un enum acotado y reversible: optimismo seguro. */
  const cambiarDominio = useMutacion(
    ({ unitId, mastery }: { unitId: string; mastery: MasteryLevel }) => universityService.cambiarDominio(unitId, mastery),
    {
      optimista: ({ unitId, mastery }) => {
        const previo = estado.datos;
        estado.setDatos((d) => (d ? {
          ...d, unidades: d.unidades.map((u: CourseUnit) => (u.id === unitId ? { ...u, mastery } : u))
        } : d) as never);
        return () => estado.setDatos(previo as never);
      },
      alTerminar: () => void estado.recargar()
    }
  );

  const crearEvaluacion = useMutacion(
    ({ datos, temas }: { datos: Partial<Assessment> & { course_id: string; title: string }; temas?: Array<{ title: string }> }) =>
      universityService.crearEvaluacion(datos, temas ?? []),
    { alTerminar: () => void estado.recargar() }
  );

  /** Registrar una nota dispara triggers en el servidor: sin optimismo. */
  const registrarNota = useMutacion(
    ({ assessmentId, score, comment }: { assessmentId: string; score: number; comment?: string }) =>
      universityService.registrarNota(assessmentId, score, comment),
    { alTerminar: () => void estado.recargar() }
  );

  const avanzarLectura = useMutacion(
    ({ lectura, paginas }: { lectura: Reading; paginas: number | 'todo' }) =>
      universityService.avanzarLectura(lectura, paginas),
    { alTerminar: () => void estado.recargar() }
  );

  return { ...estado, ...calculos, cambiarDominio, crearEvaluacion, registrarNota, avanzarLectura };
}

export function useFichasRepaso() {
  const { autenticado } = useAuth();
  const estado = useAsyncData(() => universityService.fichasParaHoy(), [autenticado], { activo: autenticado, inicial: [] });
  const [indice, setIndice] = useState(0);
  const actual: Flashcard | null = (estado.datos ?? [])[indice] ?? null;

  const responder = useMutacion(
    ({ ficha, acerto }: { ficha: Flashcard; acerto: boolean }) => universityService.responderFicha(ficha, acerto),
    { alTerminar: () => setIndice((i) => i + 1) }
  );

  return { ...estado, fichas: estado.datos ?? [], actual, siguiente: () => setIndice((i) => i + 1), responder };
}

/* ========================================================== ESTUDIO ======= */
export function useEstudio() {
  const { autenticado, preferencias } = useAuth();
  const disponibilidad = preferencias?.study_availability ?? [];

  const estado = useAsyncData(
    async () => {
      const [planes, hoy, atrasadas, semana] = await Promise.all([
        plansService.listar({ filtros: { status: 'active' }, orden: { columna: 'target_date' } }),
        studyService.sesionesDelDia(),
        studyService.sesionesAtrasadas(),
        studyService.sesionesDeLaSemana()
      ]);
      return {
        planes, hoy, atrasadas, semana,
        minutosSemana: semana.reduce((a: number, s: StudySession) => a + (s.effective_min ?? 0), 0)
      };
    },
    [autenticado],
    { activo: autenticado }
  );

  /** Generar un plan crea muchas filas en el servidor: sin optimismo. */
  const generarPlan = useMutacion(
    ({ assessment, unidades, horasSemana }: { assessment: Assessment; unidades: CourseUnit[]; horasSemana?: number }) =>
      studyService.generarPlan({ assessment, unidades, disponibilidad, horasSemana }),
    { alTerminar: () => void estado.recargar() }
  );

  const completarSesion = useMutacion(
    (sesion: StudySession) => studyService.completarSesion(sesion),
    {
      optimista: (sesion) => {
        const previo = estado.datos;
        estado.setDatos((d) => (d ? {
          ...d,
          hoy: d.hoy.map((s: StudySession) => (s.id === sesion.id ? { ...s, status: s.status === 'done' ? 'pending' : 'done' } : s))
        } : d) as never);
        return () => estado.setDatos(previo as never);
      },
      alTerminar: () => void estado.recargar()
    }
  );

  const reprogramar = useMutacion(
    () => studyService.reprogramarAtrasadas(disponibilidad),
    { alTerminar: () => void estado.recargar() }
  );

  const sumarTiempo = useMutacion(
    ({ sesionId, minutos }: { sesionId: string; minutos: number }) => studyService.sumarTiempo(sesionId, minutos),
    { alTerminar: () => void estado.recargar() }
  );

  return { ...estado, generarPlan, completarSesion, reprogramar, sumarTiempo };
}

/* ============================================================ NOTAS ======= */
export function useNotas(opciones: { space?: SpaceType | 'all'; courseId?: string; texto?: string } = {}) {
  const { autenticado } = useAuth();
  const texto = useDebounce(opciones.texto ?? '', 300);
  const estado = useAsyncData(
    () => noteService.buscar({ ...opciones, texto }),
    [opciones.space, opciones.courseId, texto, autenticado],
    { activo: autenticado, inicial: [] }
  );

  const crear = useMutacion((d: Partial<Note> & { title: string }) => noteService.crearNota(d),
    { alTerminar: () => void estado.recargar() });

  const fijar = useMutacion(
    ({ id, fijada }: { id: string; fijada: boolean }) => noteService.fijar(id, fijada),
    {
      optimista: ({ id, fijada }) => {
        const previo = estado.datos;
        estado.setDatos((l) => (l ?? []).map((n) => (n.id === id ? { ...n, is_pinned: fijada } : n)));
        return () => estado.setDatos(previo ?? []);
      }
    }
  );

  const convertir = useMutacion(
    ({ nota, destino, extra }: { nota: Note; destino: Parameters<typeof noteService.convertir>[1]; extra?: Record<string, unknown> }) =>
      noteService.convertir(nota, destino, extra ?? {})
  );

  const eliminar = useMutacion((id: string) => noteService.eliminar(id), { alTerminar: () => void estado.recargar() });

  return { ...estado, notas: estado.datos ?? [], crear, fijar, convertir, eliminar };
}

/* ========================================================= BUSCADOR ======= */
export function useBuscador() {
  const { autenticado } = useAuth();
  const [texto, setTexto] = useState('');
  const consulta = useDebounce(texto, 250);

  const estado = useAsyncData(
    () => (consulta.trim().length >= 2 ? searchService.global(consulta) : Promise.resolve([])),
    [consulta, autenticado],
    { activo: autenticado, inicial: [] }
  );

  return { texto, setTexto, resultados: estado.datos ?? [], cargando: estado.cargando, error: estado.error };
}

/* =========================================================== AGENDA ======= */
export function useAgenda(desde: string, hasta: string, space?: SpaceType) {
  const { autenticado } = useAuth();
  const estado = useAsyncData<CalendarItem[]>(
    () => searchService.agenda(desde, hasta, space),
    [desde, hasta, space, autenticado],
    { activo: autenticado, inicial: [] }
  );
  return { ...estado, eventos: estado.datos ?? [] };
}

/* ====================================================== INICIO / PANEL ==== */
export function usePanelInicio(space: SpaceType | 'all' = 'all') {
  const { autenticado } = useAuth();
  const hoy = new Date();
  const desde = new Date(hoy); desde.setHours(0, 0, 0, 0);
  const hasta = new Date(hoy); hasta.setHours(23, 59, 59, 999);

  return useAsyncData(
    async () => {
      const [resumen, prioridades, vencidas, agenda, evaluaciones, lecturas, cargaMarcas, sesiones] = await Promise.all([
        tasksService.resumen(space),
        tasksService.buscar({ space, limite: 3 }),
        tasksService.buscar({ space, vencidas: true, limite: 5 }),
        searchService.agenda(desde.toISOString(), hasta.toISOString(), space === 'all' ? undefined : space),
        universityService.proximasEvaluaciones(60),
        universityService.lecturasPendientes(),
        workService.cargaPorMarca(),
        studyService.sesionesDelDia()
      ]);
      return { resumen, prioridades, vencidas, agenda, evaluaciones, lecturas, cargaMarcas, sesiones };
    },
    [space, autenticado],
    { activo: autenticado }
  );
}
