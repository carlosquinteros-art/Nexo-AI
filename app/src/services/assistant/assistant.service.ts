/**
 * Servicio del Asistente.
 *
 * Une tres piezas:
 *   1. El contexto (nombres del usuario) para no inventar nada.
 *   2. La interpretación: IA si está disponible, reglas locales siempre.
 *   3. La ejecución, que solo ocurre después de que el usuario confirma.
 *
 * La API key del modelo NUNCA está aquí: vive como secreto en la Edge
 * Function `nexo-ai`. Este archivo solo la invoca con el token de sesión.
 */
import { supabase } from '../../lib/supabase';
import { traducirError, NexoError } from '../../lib/errors';
import { tasksService } from '../tasks.service';
import { workService } from '../work.service';
import {
  universityService, legalConceptsService, legalNotesService,
  caseBriefsService, unitsService, flashcardsService
} from '../university.service';
import { studyService } from '../study.service';
import { noteService } from '../notes.service';
import { searchService } from '../search.service';
import { registrarActividad, requiereUsuario } from '../base.service';
import { interpretarPorReglas } from './rules';
import { INTENCIONES, ETIQUETA_INTENCION } from './types';
import type { ContextoAsistente, Propuesta, ResultadoEjecucion, Intencion } from './types';
import { hoyISO, ahoraNaive, aISOConZona, TZ, fmtFecha } from './datetime';

/* ------------------------------------------------------------- Contexto --- */
let cacheContexto: { valor: ContextoAsistente; expira: number } | null = null;

/** Nombres e ids del usuario. Es lo único que se envía a la IA: sin contenidos. */
export async function obtenerContexto(forzar = false): Promise<ContextoAsistente> {
  if (!forzar && cacheContexto && cacheContexto.expira > Date.now()) return cacheContexto.valor;

  const [marcas, asignaturas, personas, tiendas, prefs] = await Promise.all([
    supabase.from('brands').select('id,name').is('deleted_at', null),
    supabase.from('courses').select('id,name').is('deleted_at', null),
    supabase.from('people').select('id,full_name,brand_id').is('deleted_at', null),
    supabase.from('stores').select('id,name,city').is('deleted_at', null),
    supabase.from('user_settings').select('pass_grade').maybeSingle()
  ]);

  const valor: ContextoAsistente = {
    hoy: hoyISO(),
    ahora: ahoraNaive(),
    zona: TZ,
    marcas: (marcas.data ?? []).map((b) => ({ id: b.id, nombre: b.name })),
    asignaturas: (asignaturas.data ?? []).map((c) => ({ id: c.id, nombre: c.name })),
    personas: (personas.data ?? []).map((p) => ({ id: p.id, nombre: p.full_name, marcaId: p.brand_id })),
    tiendas: (tiendas.data ?? []).map((s) => ({ id: s.id, nombre: s.name, ciudad: s.city })),
    notaAprobacion: Number(prefs.data?.pass_grade ?? 4)
  };
  cacheContexto = { valor, expira: Date.now() + 60_000 };
  return valor;
}

export function invalidarContexto(): void { cacheContexto = null; }

/* ------------------------------------------------------------ IA remota --- */
export const iaService = {
  /** La IA es opcional: si la función no está desplegada, no se usa. */
  async disponible(): Promise<boolean> {
    const { data } = await supabase.auth.getSession();
    return !!data.session;
  },

  async interpretar(texto: string, contexto: ContextoAsistente): Promise<Propuesta | null> {
    const { data, error } = await supabase.functions.invoke('nexo-ai', {
      body: { texto, contexto, version: 1 }
    });
    if (error) return null;                       // se cae a reglas, sin ruido
    if (!data || !INTENCIONES.includes(data.intencion)) return null;
    return {
      version: 1, origen: 'ia', textoOriginal: texto,
      intencion: data.intencion as Intencion,
      espacio: data.espacio ?? 'work',
      confianza: Number(data.confianza ?? 0.9),
      titulo: data.titulo ?? ETIQUETA_INTENCION[data.intencion as Intencion],
      resumen: data.resumen,
      entidades: data.entidades ?? {},
      campos: Array.isArray(data.campos) ? data.campos : [],
      faltantes: Array.isArray(data.faltantes) ? data.faltantes : [],
      pregunta: data.pregunta ?? null,
      respuesta: data.respuesta ?? null,
      avisos: Array.isArray(data.avisos) ? data.avisos : [],
      requiereConfirmacion: data.requiereConfirmacion !== false,
      accion: data.accion ?? null
    };
  }
};

/* --------------------------------------------------------- Interpretación - */
export const assistantService = {
  obtenerContexto,
  invalidarContexto,

  /**
   * Interpreta una instrucción. Intenta la IA y, si no está o falla, usa las
   * reglas locales. El resultado tiene siempre la misma forma.
   */
  async interpretar(texto: string, opciones: { usarIA?: boolean } = {}): Promise<Propuesta> {
    const t = texto.trim();
    if (!t) throw new NexoError('Escribe algo para que pueda ayudarte.', 'validation');

    const ctx = await obtenerContexto();

    if (opciones.usarIA) {
      try {
        const r = await iaService.interpretar(t, ctx);
        if (r) return await this.completarConDatos(r, ctx);
      } catch {
        /* silencioso: las reglas locales son el respaldo */
      }
    }
    return this.completarConDatos(interpretarPorReglas(t, ctx), ctx);
  },

  /**
   * Resuelve las consultas y cálculos que necesitan leer la base.
   * Las intenciones de escritura no tocan nada aquí.
   */
  async completarConDatos(p: Propuesta, ctx: ContextoAsistente): Promise<Propuesta> {
    /* `datos` es un saco heterogéneo por diseño (cada intención guarda lo
       suyo). Se lee con accesores tipados en vez de castear a `never`. */
    const datos = (p.accion?.datos ?? {}) as Record<string, unknown>;
    const d = {
      dias: datos.dias as number | undefined,
      courseId: datos.courseId as string | undefined,
      brandId: datos.brandId as string | undefined,
      calculo: datos.calculo as string | undefined,
      consulta: datos.consulta as string | undefined,
      cantidad: datos.cantidad as number | undefined,
      assessmentId: datos.assessmentId as string | undefined,
      mensaje: datos.mensaje as { tono: string; destinatario: string; asunto: string; marca?: string | null } | undefined
    };

    if (p.intencion === 'consultar_evaluaciones') {
      const evs = await universityService.proximasEvaluaciones(Number(d.dias ?? 30));
      const filtradas = d.courseId ? evs.filter((e) => e.course_id === d.courseId) : evs;
      return { ...p, respuesta: {
        texto: filtradas.length ? `${filtradas.length} evaluación(es)` : 'Sin evaluaciones en ese periodo',
        detalle: filtradas.map((e) => `• ${fmtFecha(e.due_date)} — ${e.title} · ${e.weight}%`),
        enlace: '/universidad'
      } };
    }

    if (p.intencion === 'consultar_agenda') {
      const dias = Number(d.dias ?? 1);
      const desde = new Date(); desde.setHours(0, 0, 0, 0);
      const hasta = new Date(); hasta.setDate(hasta.getDate() + dias - 1); hasta.setHours(23, 59, 59, 999);
      const items = await searchService.agenda(desde.toISOString(), hasta.toISOString());
      return { ...p, respuesta: {
        texto: `${items.length} compromiso(s)`,
        detalle: items.map((i) => `• ${new Date(i.starts_at).toLocaleString('es-CL', { timeZone: TZ, day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })} — ${i.title}`),
        enlace: '/agenda'
      } };
    }

    if (p.intencion === 'consultar_pendientes') {
      const tareas = await tasksService.buscar({
        brandId: d.brandId ?? undefined, courseId: d.courseId ?? undefined, limite: 12
      });
      return { ...p, respuesta: {
        texto: tareas.length ? `${tareas.length} pendiente(s)` : 'Nada pendiente por acá',
        detalle: tareas.map((x) => `• ${x.title}${x.due_at ? ` — ${fmtFecha(x.due_at.slice(0, 10))}` : ''}`),
        nota: 'Solo se muestra lo que está registrado en Nexo.',
        enlace: '/tareas'
      } };
    }

    if (p.intencion === 'calcular' && d.calculo === 'nota_necesaria') {
      const courseId = d.courseId ?? ctx.asignaturas[0]?.id;
      if (!courseId) return p;
      const evs = await universityService.evaluacionesDe(courseId);
      const necesaria = universityService.notaNecesaria(evs, ctx.notaAprobacion);
      const promedio = universityService.promedioParcial(evs);
      return { ...p, respuesta: {
        texto: necesaria == null ? 'Ya no queda ponderación pendiente' : necesaria.toFixed(1).replace('.', ','),
        subtitulo: 'Nota necesaria',
        detalle: [
          `Nota de aprobación: ${ctx.notaAprobacion}`,
          `Promedio parcial: ${promedio ?? 'sin notas'}`,
          ...(necesaria != null && necesaria > 7 ? ['Con lo que queda ya no alcanza la nota de aprobación.'] : [])
        ]
      } };
    }

    if (p.intencion === 'calcular' && d.calculo === 'paginas_pendientes') {
      const lecturas = await universityService.lecturasPendientes();
      const total = lecturas.reduce((a, r) => a + Math.max(0, r.total_pages - r.pages_read), 0);
      return { ...p, respuesta: {
        texto: `${total} páginas`, subtitulo: 'Páginas pendientes',
        detalle: lecturas.map((r) => `• ${r.title}: faltan ${r.total_pages - r.pages_read} de ${r.total_pages}`)
      } };
    }

    if (p.intencion === 'generar_mensaje' && d.mensaje) {
      const cuerpo = generarMensaje(d.mensaje);
      return { ...p, respuesta: {
        texto: cuerpo, copiable: true, plantilla: { titulo: `Mensaje: ${d.mensaje.asunto}`, tono: d.mensaje.tono, destinatario: d.mensaje.destinatario, cuerpo },
        nota: 'Nexo no envía nada por ti. Cópialo y revísalo antes de mandarlo.'
      } };
    }

    if (p.intencion === 'registrar_calificacion') {
      const evs = d.courseId ? await universityService.evaluacionesDe(d.courseId) : [];
      const opciones = evs.filter((e) => !e.grades?.length).map((e) => ({ v: e.id, l: e.title }));
      return { ...p, campos: p.campos.map((c) => c.k === 'assessment_id' ? { ...c, opciones, valor: opciones[0]?.v ?? '' } : c) };
    }

    if (p.intencion === 'generar_preguntas') {
      const conceptos = await universityService.conceptos(d.courseId);
      const cantidad = Number(d.cantidad ?? 10);
      if (!conceptos.length) {
        return { ...p, requiereConfirmacion: false, avisos: ['sin_material'], respuesta: {
          texto: 'Nexo no inventa contenido jurídico.',
          detalle: ['Necesito conceptos en tu glosario o apuntes tuyos sobre ese tema.',
            'Agrégalos en Universidad → Glosario y vuelve a pedírmelo.'],
          enlace: '/universidad'
        } };
      }
      const cards = conceptos.slice(0, cantidad).map((c) => ({
        front: `¿Qué es ${c.term}?`, back: c.definition, course_id: c.course_id, concept_id: c.id
      }));
      return { ...p, resumen: `Se crearán ${cards.length} ficha(s) desde tu propio glosario.`,
        accion: { tipo: 'crear_fichas', datos: { cards } } };
    }

    if (p.intencion === 'crear_plan_estudio' && !p.accion?.datos?.assessmentId) {
      const evs = await universityService.proximasEvaluaciones(120);
      const filtradas = d.courseId ? evs.filter((e) => e.course_id === d.courseId) : evs;
      if (!filtradas.length) {
        return { ...p, requiereConfirmacion: false, respuesta: {
          texto: 'Para planificar necesito una evaluación con fecha.',
          detalle: ['Registra primero la prueba y su fecha.'], enlace: '/universidad'
        } };
      }
      if (filtradas.length > 1 && !d.courseId) {
        return { ...p, requiereConfirmacion: false, pregunta: {
          texto: '¿Para qué evaluación armo el plan?',
          opciones: filtradas.slice(0, 4).map((e) => ({ etiqueta: `${e.title} · ${fmtFecha(e.due_date)}`, texto: `Crea un plan de estudio para ${e.title}` }))
        }, respuesta: { texto: '¿Para qué evaluación armo el plan?' } };
      }
      const ev = filtradas[0];
      return { ...p, resumen: `Plan para «${ev.title}», evaluación el ${fmtFecha(ev.due_date)}.`,
        accion: { tipo: 'plan_estudio', datos: { ...d, assessmentId: ev.id, courseId: ev.course_id } } };
    }

    return p;
  },

  /**
   * Ejecuta la propuesta con los valores que el usuario confirmó (o editó).
   * Registra la acción en `activity_log`.
   */
  async ejecutar(p: Propuesta, valores: Record<string, string>): Promise<ResultadoEjecucion> {
    if (!p.intencion) throw new NexoError('No hay ninguna acción que ejecutar.', 'validation');
    await requiereUsuario();

    const v = (k: string, def = '') => (valores[k] ?? '').toString().trim() || def;
    const num = (k: string, def: number) => { const x = Number(v(k)); return Number.isNaN(x) ? def : x; };
    const cuando = (fk: string, hk: string, hDef: string) => {
      const f = v(fk); return f ? aISOConZona(`${f}T${v(hk, hDef)}`) : null;
    };

    try {
      switch (p.intencion) {
        case 'crear_tarea':
        case 'crear_recordatorio': {
          const tarea = await tasksService.crearTarea({
            space: v('space', 'work') as never, title: v('title'), description: v('description') || null,
            priority: v('priority', 'medium') as never, status: v('status', 'pending') as never,
            due_at: cuando('fecha', 'hora', '18:00'), assignee: v('assignee') || null,
            brand_id: v('brand_id') || null, course_id: v('course_id') || null
          } as never);
          if (p.intencion === 'crear_recordatorio' && tarea.due_at) {
            await supabase.from('reminders').insert({
              user_id: tarea.user_id, entity_type: 'task', entity_id: tarea.id,
              remind_at: tarea.due_at, channel: 'in_app', message: tarea.title
            } as never);
          }
          return this.terminar('task', tarea.id, p.intencion === 'crear_recordatorio' ? 'Recordatorio creado' : 'Tarea creada', '/tareas');
        }

        case 'crear_reunion': {
          const inicio = cuando('fecha', 'hora', '10:00')!;
          const fin = new Date(new Date(inicio).getTime() + num('duracion_min', 60) * 60000).toISOString();
          const reunion = await workService.crearReunion(
            { title: v('title'), starts_at: inicio, ends_at: fin, location: v('location') || null,
              objective: v('objective') || null, brand_id: v('brand_id') || null } as never,
            v('participantes').split(',').map((s) => s.trim()).filter(Boolean).map((nombre) => ({ display_name: nombre }))
          );
          return this.terminar('meeting', reunion.id, 'Reunión agendada', '/agenda');
        }

        case 'crear_evaluacion': {
          const ev = await universityService.crearEvaluacion({
            course_id: v('course_id'), title: v('title'), type: v('type', 'test') as never,
            due_date: v('due_date') || null, due_time: v('due_time') || null,
            weight: num('weight', 25), syllabus: v('syllabus') || null
          } as never);
          return this.terminar('assessment', ev.id, 'Evaluación registrada', '/universidad');
        }

        case 'crear_sesion_estudio': {
          const s = await studyService.crearSesion({
            title: v('title'), scheduled_date: v('scheduled_date'), scheduled_time: v('scheduled_time') || null,
            duration_min: num('duration_min', 60), type: v('type', 'study') as never,
            course_id: v('course_id') || null
          } as never);
          return this.terminar('study_session', s.id, 'Sesión de estudio creada', '/estudio');
        }

        case 'registrar_nota': {
          const n = await noteService.crearNota({
            space: v('space', 'work') as never, title: v('title'), content: v('content') || null,
            brand_id: v('brand_id') || null, course_id: v('course_id') || null
          } as never);
          return this.terminar('note', n.id, 'Nota guardada', '/notas');
        }

        case 'registrar_apunte_juridico': {
          if (p.accion?.tabla === 'legal_concepts') {
            const c = await legalConceptsService.crear({
              term: v('term'), definition: v('definition'), course_id: v('course_id') || null,
              origin: v('origin', 'Apunte propio'), verification: 'unverified'
            } as never);
            return this.terminar('legal_concept', c.id, 'Concepto guardado (sin verificar)', '/universidad');
          }
          const nota = await legalNotesService.crear({
            title: v('title'), body: v('body'), course_id: v('course_id') || null, verification: 'unverified'
          } as never);
          return this.terminar('legal_note', nota.id, 'Apunte guardado sin modificar tu texto', '/universidad');
        }

        case 'registrar_lectura': {
          const r = await universityService.crearLectura({
            title: v('title'), course_id: v('course_id') || null, total_pages: num('total_pages', 0),
            due_date: v('due_date') || null, priority: v('priority', 'high') as never
          } as never);
          if (v('crear_tarea')) {
            await tasksService.crearTarea({
              space: 'university', title: `Leer ${r.total_pages} páginas: ${r.title}`,
              course_id: r.course_id, priority: r.priority,
              due_at: r.due_date ? aISOConZona(`${r.due_date}T22:00`) : null, category: 'Lectura'
            } as never);
          }
          return this.terminar('reading', r.id, 'Lectura registrada', '/universidad');
        }

        case 'registrar_calificacion': {
          const g = await universityService.registrarNota(v('assessment_id'), num('score', 4));
          return this.terminar('assessment', g.assessment_id, `Nota ${g.score} registrada`, '/universidad');
        }

        case 'registrar_fuente_juridica': {
          const f = await universityService.crearFuente({
            identifier: v('identifier'), type: v('type', 'ruling') as never, court: v('court') || null,
            docket: v('docket') || null, issued_on: v('issued_on') || null,
            official_url: v('official_url') || null, summary: v('summary') || null,
            course_id: v('course_id') || null
          } as never);
          return this.terminar('legal_source', f.id, 'Fuente registrada como NO verificada', '/universidad');
        }

        case 'crear_ficha_caso': {
          const c = await caseBriefsService.crear({
            title: v('title'), facts: v('facts') || null, legal_issue: v('legal_issue') || null,
            rules: v('rules') || null, conclusion: v('conclusion') || null, course_id: v('course_id') || null
          } as never);
          return this.terminar('case_brief', c.id, 'Ficha de caso creada', '/universidad');
        }

        case 'registrar_novedad_persona': {
          const ev = await workService.registrarNovedad({
            person_id: v('person_id'), type: v('type', 'sick_leave') as never,
            starts_on: v('starts_on', hoyISO()), ends_on: v('ends_on') || null, note: v('note') || null
          });
          return this.terminar('person', ev.person_id, 'Novedad registrada', '/trabajo');
        }

        case 'crear_plan_estudio': {
          const d = p.accion?.datos as Record<string, string>;
          const evs = await universityService.evaluacionesDe(d.courseId);
          const assessment = evs.find((e) => e.id === d.assessmentId) ?? evs[0];
          const unidades = (await unitsService.listar({ filtros: { course_id: d.courseId }, orden: { columna: 'position' } })) as never[];
          const prefs = await supabase.from('user_settings').select('study_availability').maybeSingle();
          const { plan, sesiones } = await studyService.generarPlan({
            assessment: assessment as never,
            unidades: (unidades as Array<{ mastery: string }>).filter((u) => u.mastery !== 'mastered') as never,
            disponibilidad: (prefs.data?.study_availability ?? []) as never,
            horasSemana: num('horas_semana', 6)
          });
          return this.terminar('study_plan', plan.id, `Plan creado con ${sesiones.length} sesión(es)`, '/estudio');
        }

        case 'generar_preguntas': {
          const cards = ((p.accion?.datos?.cards ?? []) as Array<Record<string, unknown>>)
            .slice(0, num('cantidad', 10));
          if (!cards.length) return { ok: false, mensaje: 'No hay material propio para generar preguntas.' };
          await flashcardsService.crearVarios(cards.map((c) => ({ ...c, next_review: hoyISO() })) as never);
          return this.terminar('flashcard', '', `${cards.length} ficha(s) creada(s) desde tu propio material`, '/estudio');
        }

        default:
          return { ok: false, mensaje: 'Esa acción no guarda datos.' };
      }
    } catch (e) {
      throw traducirError(e, 'guardar lo que interpretó el asistente');
    }
  },

  async terminar(entidad: string, id: string, mensaje: string, ruta: string): Promise<ResultadoEjecucion> {
    if (id) void registrarActividad(entidad as never, id, 'create', `${mensaje} · desde el asistente`);
    invalidarContexto();
    return { ok: true, mensaje, ruta, entidad, id };
  }
};

/* ------------------------------------------------- Generador de mensajes -- */
export function generarMensaje(o: { tono: string; destinatario: string; asunto: string; marca?: string | null }): string {
  const m = o.marca ? ` de ${o.marca}` : '';
  const saludos: Record<string, Record<string, string>> = {
    equipo: { cercano: 'Hola equipo, ¿cómo están?', ejecutivo: 'Estimado equipo:', firme: 'Equipo:', motivacional: '¡Hola equipo!', breve: 'Equipo:' },
    cliente: { cercano: 'Hola, ¿cómo estás?', ejecutivo: 'Estimado/a:', firme: 'Estimado/a:', motivacional: 'Hola, ¿cómo estás?', breve: 'Hola:' },
    rrhh: { cercano: 'Hola, ¿cómo estás?', ejecutivo: 'Estimados:', firme: 'Estimados:', motivacional: 'Hola:', breve: 'Hola:' }
  };
  const cuerpos: Record<string, string> = {
    cercano: `Les escribo para pedirles su apoyo con ${o.asunto}${m}. Es importante para cerrar la información a tiempo.`,
    ejecutivo: `Solicito su gestión respecto de ${o.asunto}${m}. Esta información es necesaria para consolidar el reporte.`,
    firme: `Necesito ${o.asunto}${m} con carácter prioritario. Este punto ya fue solicitado y su demora está afectando el compromiso con el cliente.`,
    motivacional: `Vamos avanzando bien y quiero pedirles un último empujón con ${o.asunto}${m}.`,
    breve: `Necesito ${o.asunto}${m}.`
  };
  const cierres: Record<string, string> = {
    cercano: 'Cualquier duda me avisan. ¡Gracias!',
    ejecutivo: 'Quedo atento a su confirmación.\n\nSaludos cordiales,\nCarlos Quinteros',
    firme: 'Agradeceré su respuesta hoy antes del cierre de jornada.\n\nSaludos,\nCarlos Quinteros',
    motivacional: '¡Gracias por el trabajo de siempre!',
    breve: 'Gracias.'
  };
  const s = saludos[o.destinatario] ?? saludos.equipo;
  return `${s[o.tono] ?? s.cercano}\n\n${cuerpos[o.tono] ?? cuerpos.cercano}\n\n${cierres[o.tono] ?? cierres.cercano}`;
}
