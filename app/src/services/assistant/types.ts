/**
 * Contrato del Asistente.
 *
 * Es el mismo objeto tanto si lo produce el motor de reglas local como si lo
 * devuelve la Edge Function con IA. La interfaz y el ejecutor no distinguen
 * el origen: solo leen `origen` para mostrarlo.
 */
import type { SpaceType, PriorityLevel, AssessmentType } from '../../types/database.types';

export type { SpaceType, PriorityLevel, AssessmentType };

/* ------------------------------------------------------------ Intenciones - */
export const INTENCIONES = [
  'crear_tarea',
  'crear_reunion',
  'crear_recordatorio',
  'crear_evaluacion',
  'crear_sesion_estudio',
  'registrar_nota',
  'registrar_apunte_juridico',
  'registrar_lectura',
  'registrar_calificacion',
  'registrar_fuente_juridica',
  'crear_ficha_caso',
  'registrar_novedad_persona',
  'consultar_pendientes',
  'consultar_agenda',
  'consultar_evaluaciones',
  'calcular',
  'generar_mensaje',
  'generar_preguntas',
  'crear_plan_estudio'
] as const;

export type Intencion = (typeof INTENCIONES)[number];

/** Intenciones que guardan datos: siempre requieren confirmación explícita. */
export const INTENCIONES_ESCRITURA: Intencion[] = [
  'crear_tarea', 'crear_reunion', 'crear_recordatorio', 'crear_evaluacion', 'crear_sesion_estudio',
  'registrar_nota', 'registrar_apunte_juridico', 'registrar_lectura', 'registrar_calificacion',
  'registrar_fuente_juridica', 'crear_ficha_caso', 'registrar_novedad_persona',
  'generar_preguntas', 'crear_plan_estudio'
];

export const ETIQUETA_INTENCION: Record<Intencion, string> = {
  crear_tarea: 'Crear tarea',
  crear_reunion: 'Crear reunión',
  crear_recordatorio: 'Crear recordatorio',
  crear_evaluacion: 'Crear evaluación',
  crear_sesion_estudio: 'Crear sesión de estudio',
  registrar_nota: 'Registrar nota',
  registrar_apunte_juridico: 'Registrar apunte jurídico',
  registrar_lectura: 'Registrar lectura',
  registrar_calificacion: 'Registrar calificación',
  registrar_fuente_juridica: 'Registrar fuente jurídica',
  crear_ficha_caso: 'Crear ficha de caso',
  registrar_novedad_persona: 'Registrar novedad de una persona',
  consultar_pendientes: 'Consultar pendientes',
  consultar_agenda: 'Consultar agenda',
  consultar_evaluaciones: 'Consultar evaluaciones',
  calcular: 'Realizar cálculo',
  generar_mensaje: 'Generar mensaje',
  generar_preguntas: 'Generar preguntas de estudio',
  crear_plan_estudio: 'Crear plan de estudio'
};

/* -------------------------------------------------------------- Entidades - */
export interface EntidadesExtraidas {
  espacio: SpaceType;
  marcaId: string | null;
  marcaNombre: string | null;
  asignaturaId: string | null;
  asignaturaNombre: string | null;
  personaId: string | null;
  personaNombre: string | null;
  tiendaId: string | null;
  tiendaNombre: string | null;
  /** AAAA-MM-DD en hora de Chile */
  fecha: string | null;
  /** HH:MM en 24 horas */
  hora: string | null;
  fechaFin: string | null;
  prioridad: PriorityLevel | null;
  responsable: string | null;
  tipoEvaluacion: AssessmentType | null;
  ponderacion: number | null;
  paginas: number | null;
  duracionMin: number | null;
  tema: string | null;
  descripcion: string | null;
  /** Lugar mencionado que no coincide con ninguna tienda registrada. */
  lugarDesconocido: string | null;
}

export const ENTIDADES_VACIAS: EntidadesExtraidas = {
  espacio: 'work', marcaId: null, marcaNombre: null, asignaturaId: null, asignaturaNombre: null,
  personaId: null, personaNombre: null, tiendaId: null, tiendaNombre: null,
  fecha: null, hora: null, fechaFin: null, prioridad: null, responsable: null,
  tipoEvaluacion: null, ponderacion: null, paginas: null, duracionMin: null,
  tema: null, descripcion: null, lugarDesconocido: null
};

/* ---------------------------------------------------- Campos de la tarjeta - */
export type TipoCampo = 'texto' | 'textarea' | 'fecha' | 'hora' | 'numero' | 'select' | 'check';

export interface CampoPropuesta {
  k: string;
  etiqueta: string;
  valor: string;
  tipo: TipoCampo;
  opciones?: Array<{ v: string; l: string }>;
  requerido?: boolean;
  bloqueado?: boolean;
  ayuda?: string;
}

/* ------------------------------------------------------------- Respuestas - */
export interface RespuestaConsulta {
  texto: string;
  subtitulo?: string;
  detalle?: string[];
  nota?: string;
  enlace?: string;
  copiable?: boolean;
  plantilla?: { titulo: string; tono: string; destinatario: string; cuerpo: string };
}

export interface PreguntaDesambiguacion {
  texto: string;
  /** Cada opción reescribe la frase completa para volver a interpretarla. */
  opciones?: Array<{ etiqueta: string; texto: string }>;
}

export type Aviso =
  | 'verificacion_juridica'
  | 'sin_verificar'
  | 'material_propio'
  | 'sin_material'
  | 'datos_minimos'
  | 'lugar_desconocido';

export const TEXTO_AVISO: Record<Aviso, string> = {
  verificacion_juridica:
    'Contenido jurídico: verifícalo en BCN, Poder Judicial o Diario Oficial antes de citarlo. Nexo no entrega asesoría legal.',
  sin_verificar: 'Se guardará marcado como no verificado hasta que tú confirmes la fuente.',
  material_propio: 'Las preguntas salen solo de tu glosario y tus apuntes. Nexo no genera contenido jurídico nuevo.',
  sin_material: 'No hay material propio sobre ese tema, así que no se generó nada.',
  datos_minimos: 'Solo se guardan tipo y fechas. Nexo no registra diagnósticos ni información de salud.',
  lugar_desconocido: 'Mencionaste un lugar que no está en tus tiendas registradas. No lo invento: elige uno o déjalo sin tienda.'
};

/* -------------------------------------------------------------- Propuesta - */
export interface AccionPropuesta {
  tipo: 'crear' | 'actualizar' | 'plan_estudio' | 'novedad' | 'calificacion' | 'crear_fichas';
  tabla?: string;
  datos?: Record<string, unknown>;
}

export interface Propuesta {
  version: 1;
  origen: 'reglas' | 'ia';
  textoOriginal: string;
  intencion: Intencion | null;
  espacio: SpaceType;
  confianza: number;
  titulo: string;
  resumen?: string;
  entidades: Partial<EntidadesExtraidas>;
  campos: CampoPropuesta[];
  faltantes: string[];
  pregunta: PreguntaDesambiguacion | null;
  respuesta: RespuestaConsulta | null;
  avisos: Aviso[];
  requiereConfirmacion: boolean;
  accion: AccionPropuesta | null;
}

/** Resultado de ejecutar una propuesta ya confirmada. */
export interface ResultadoEjecucion {
  ok: boolean;
  mensaje: string;
  ruta?: string;
  entidad?: string;
  id?: string;
}

/** Una entrada del historial reciente del chat. */
export interface EntradaHistorial {
  texto: string;
  resultado: string;
  cuando: string;
}

/** Mensaje del chat. */
export type MensajeChat =
  | { rol: 'usuario'; texto: string; cuando: string }
  | { rol: 'nexo'; tipo: 'respuesta'; titulo: string; respuesta: RespuestaConsulta; cuando: string }
  | { rol: 'nexo'; tipo: 'pregunta'; propuesta: Propuesta; cuando: string }
  | { rol: 'nexo'; tipo: 'resultado'; ok: boolean; texto: string; ruta?: string; cuando: string };

/** Datos que el motor necesita para no inventar nada. */
export interface ContextoAsistente {
  hoy: string;
  ahora: string;
  zona: string;
  marcas: Array<{ id: string; nombre: string }>;
  asignaturas: Array<{ id: string; nombre: string }>;
  personas: Array<{ id: string; nombre: string; marcaId: string | null }>;
  tiendas: Array<{ id: string; nombre: string; ciudad: string | null }>;
  notaAprobacion: number;
}
