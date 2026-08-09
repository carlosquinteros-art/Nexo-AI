/**
 * Planificador de estudio: genera sesiones desde una evaluación, respetando la
 * disponibilidad declarada, y registra el tiempo efectivo.
 */
import { supabase } from '../lib/supabase';
import { ejecutar } from '../lib/errors';
import { validarSesionEstudio } from '../lib/validation';
import { crearServicio, requiereUsuario } from './base.service';
import { AVANCE_POR_DOMINIO } from './university.service';
import type {
  AvailabilitySlot, Assessment, CourseUnit, StudyPlan, StudySession, StudySessionType
} from '../types/database.types';

export const plansService = crearServicio('study_plans', 'study_plan');
export const sessionsService = crearServicio('study_sessions', 'study_session');

interface Hueco { fecha: string; hora: string; minutos: number }

function iso(d: Date): string { return d.toISOString().slice(0, 10); }
function sumarDias(fecha: string, n: number): string {
  const d = new Date(`${fecha}T12:00:00`); d.setDate(d.getDate() + n); return iso(d);
}
function diaSemana(fecha: string): number { return new Date(`${fecha}T12:00:00`).getDay(); }

export const studyService = {
  /**
   * Huecos libres a partir de una fecha, según la disponibilidad del usuario.
   * Como máximo dos bloques por día para que el plan sea realista.
   */
  huecosLibres(desde: string, dias: number, cantidad: number, disponibilidad: AvailabilitySlot[]): Hueco[] {
    const huecos: Hueco[] = [];
    for (let i = 0; i < dias && huecos.length < cantidad; i++) {
      const fecha = sumarDias(desde, i);
      const ventanas = disponibilidad.filter((d) => Number(d.day) === diaSemana(fecha));
      let usados = 0;
      for (const v of ventanas) {
        if (huecos.length >= cantidad || usados >= 2) break;
        const minutos = Math.min(120, Math.max(45,
          (Number(v.end.slice(0, 2)) - Number(v.start.slice(0, 2))) * 60));
        huecos.push({ fecha, hora: v.start, minutos });
        usados++;
      }
    }
    return huecos;
  },

  /**
   * Genera el plan completo. Reparte más sesiones a las unidades con menor
   * dominio y mayor dificultad, agrega repasos a 3 y 7 días y un simulacro
   * la víspera.
   */
  async generarPlan(opciones: {
    assessment: Assessment;
    unidades: CourseUnit[];
    disponibilidad: AvailabilitySlot[];
    horasSemana?: number;
    nombre?: string;
  }): Promise<{ plan: StudyPlan; sesiones: StudySession[] }> {
    const { assessment, unidades, disponibilidad } = opciones;
    if (!assessment.due_date) throw new Error('La evaluación necesita una fecha para poder planificar.');
    if (!unidades.length) throw new Error('Selecciona al menos una unidad para estudiar.');
    if (!disponibilidad.length) throw new Error('Declara tu disponibilidad de estudio en Configuración.');

    const user_id = await requiereUsuario();
    const hoy = iso(new Date());
    const diasDisponibles = Math.max(1, Math.round(
      (new Date(`${assessment.due_date}T12:00:00`).getTime() - new Date(`${hoy}T12:00:00`).getTime()) / 86400000
    ));

    const plan = (await plansService.crear({
      course_id: assessment.course_id,
      assessment_id: assessment.id,
      name: opciones.nombre ?? `Plan: ${assessment.title}`,
      target_date: assessment.due_date,
      hours_per_week: opciones.horasSemana ?? 6
    } as never)) as StudyPlan;

    const peso = (u: CourseUnit) => (5 - AVANCE_POR_DOMINIO[u.mastery] / 25) + u.difficulty;
    const total = unidades.reduce((a, u) => a + peso(u), 0) || 1;
    const huecos = this.huecosLibres(hoy, diasDisponibles, 40, disponibilidad);
    const cupoEstudio = Math.max(unidades.length, Math.floor(huecos.length * 0.75));

    const filas: Array<Record<string, unknown>> = [];
    let i = 0;
    const primeraPorUnidad = new Map<string, Hueco>();

    for (const u of unidades) {
      const n = Math.max(1, Math.round((peso(u) / total) * cupoEstudio));
      for (let k = 0; k < n && i < huecos.length; k++, i++) {
        const h = huecos[i];
        if (k === 0) primeraPorUnidad.set(u.id, h);
        filas.push({
          user_id, plan_id: plan.id, course_id: assessment.course_id, unit_id: u.id,
          assessment_id: assessment.id,
          title: `${k === 0 ? 'Estudio' : 'Profundizar'}: ${u.name}`,
          scheduled_date: h.fecha, scheduled_time: h.hora, duration_min: h.minutos,
          type: (k === 0 ? 'study' : 'practice') as StudySessionType, status: 'pending'
        });
      }
    }

    // Repasos espaciados
    for (const [unitId, h] of primeraPorUnidad) {
      const unidad = unidades.find((u) => u.id === unitId);
      for (const d of [3, 7]) {
        const fecha = sumarDias(h.fecha, d);
        if (fecha < assessment.due_date) {
          filas.push({
            user_id, plan_id: plan.id, course_id: assessment.course_id, unit_id: unitId,
            assessment_id: assessment.id, title: `Repaso (${d} días): ${unidad?.name ?? ''}`,
            scheduled_date: fecha, scheduled_time: h.hora, duration_min: 45,
            type: 'review' as StudySessionType, status: 'pending'
          });
        }
      }
    }

    // Simulacro la víspera
    const vispera = sumarDias(assessment.due_date, -1);
    if (vispera >= hoy) {
      filas.push({
        user_id, plan_id: plan.id, course_id: assessment.course_id, assessment_id: assessment.id,
        title: 'Simulacro y repaso general', scheduled_date: vispera,
        scheduled_time: huecos[0]?.hora ?? '20:30', duration_min: 90,
        type: 'practice' as StudySessionType, status: 'pending'
      });
    }

    const sesiones = (await ejecutar(
      supabase.from('study_sessions').insert(filas as never).select(),
      'generar las sesiones del plan'
    )) as StudySession[];

    return { plan, sesiones };
  },

  /* ------------------------------------------------------------- Sesiones - */
  async sesionesDe(planId: string): Promise<StudySession[]> {
    return (await sessionsService.listar({ filtros: { plan_id: planId }, orden: { columna: 'scheduled_date' } })) as StudySession[];
  },

  async sesionesDelDia(fecha = iso(new Date())): Promise<StudySession[]> {
    return (await sessionsService.listar({ filtros: { scheduled_date: fecha }, orden: { columna: 'scheduled_time' } })) as StudySession[];
  },

  async sesionesAtrasadas(): Promise<StudySession[]> {
    return (await sessionsService.listar({
      filtros: { status: 'pending' },
      where: [['scheduled_date', 'lt', iso(new Date())]],
      orden: { columna: 'scheduled_date' }
    })) as StudySession[];
  },

  async sesionesDeLaSemana(): Promise<StudySession[]> {
    const hoy = new Date();
    const lunes = sumarDias(iso(hoy), -((hoy.getDay() + 6) % 7));
    return (await sessionsService.listar({
      where: [['scheduled_date', 'gte', lunes], ['scheduled_date', 'lte', sumarDias(lunes, 6)]],
      orden: { columna: 'scheduled_date' }
    })) as StudySession[];
  },

  async crearSesion(datos: Partial<StudySession> & { title: string; scheduled_date: string }): Promise<StudySession> {
    validarSesionEstudio(datos);
    return (await sessionsService.crear(datos as never)) as StudySession;
  },

  async completarSesion(sesion: StudySession, minutosEfectivos?: number): Promise<StudySession> {
    const hecha = sesion.status === 'done';
    return (await sessionsService.actualizar(sesion.id, {
      status: hecha ? 'pending' : 'done',
      effective_min: hecha ? 0 : (minutosEfectivos ?? sesion.effective_min ?? sesion.duration_min)
    } as never)) as StudySession;
  },

  /** Suma minutos reales trabajados (Pomodoro). */
  async sumarTiempo(sesionId: string, minutos: number): Promise<StudySession> {
    const actual = (await sessionsService.obtener(sesionId)) as StudySession;
    return (await sessionsService.actualizar(sesionId, {
      effective_min: (actual.effective_min ?? 0) + Math.max(0, Math.round(minutos))
    } as never)) as StudySession;
  },

  /** Reprograma en bloque las sesiones atrasadas sobre los próximos huecos. */
  async reprogramarAtrasadas(disponibilidad: AvailabilitySlot[]): Promise<number> {
    const atrasadas = await this.sesionesAtrasadas();
    if (!atrasadas.length) return 0;
    const huecos = this.huecosLibres(iso(new Date()), 21, atrasadas.length, disponibilidad);
    await Promise.all(atrasadas.map((s, i) => {
      const h = huecos[i] ?? { fecha: sumarDias(iso(new Date()), i + 1), hora: '20:30' };
      return sessionsService.actualizar(s.id, {
        scheduled_date: h.fecha, scheduled_time: h.hora, status: 'pending'
      } as never);
    }));
    return atrasadas.length;
  },

  /** Minutos efectivos de la semana en curso. */
  async tiempoSemanal(): Promise<number> {
    const sesiones = await this.sesionesDeLaSemana();
    return sesiones.reduce((a, s) => a + (s.effective_min ?? 0), 0);
  }
};
