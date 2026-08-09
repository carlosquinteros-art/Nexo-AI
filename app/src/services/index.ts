/** Punto único de entrada a la capa de datos. */
export { supabase, AUTH_REDIRECT_URL, APP_LOCALE, APP_TIMEZONE } from '../lib/supabase';
export { NexoError, traducirError, ejecutar, ejecutarVacio } from '../lib/errors';
export { ValidacionError, validar, reglas } from '../lib/validation';

export { crearServicio, requiereUsuario, registrarActividad, TABLAS_SOFT_DELETE } from './base.service';
export type { OpcionesLista } from './base.service';

export { authService } from './auth.service';
export type { DatosRegistro } from './auth.service';

export { tasksService } from './tasks.service';
export type { FiltroTareas, TareaConDetalle } from './tasks.service';

export {
  workService, brandsService, contactsService, storesService, peopleService,
  requestsService, incidentsService, meetingsService, agreementsService, templatesService
} from './work.service';

export {
  universityService, periodsService, coursesService, unitsService, classSessionsService,
  assessmentsService, readingsService, legalSourcesService, legalConceptsService,
  legalNotesService, flashcardsService, questionsService, caseBriefsService, AVANCE_POR_DOMINIO,
  academicService
} from './university.service';
export type { EscalaNotas } from './university.service';

export { studyService, plansService, sessionsService } from './study.service';
export { noteService, notesService } from './notes.service';
export type { DestinoConversion } from './notes.service';
export { searchService } from './search.service';
export type { ResultadoBusqueda } from './search.service';

/* Asistente */
export {
  assistantService, iaService, interpretarPorReglas, obtenerContexto, invalidarContexto,
  generarMensaje, EJEMPLOS_ASISTENTE, INTENCIONES, ETIQUETA_INTENCION, TEXTO_AVISO
} from './assistant';
export type { Propuesta, Intencion, CampoPropuesta, ContextoAsistente, ResultadoEjecucion, MensajeChat } from './assistant';
