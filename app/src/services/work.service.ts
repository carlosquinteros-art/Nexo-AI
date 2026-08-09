/**
 * Espacio Trabajo: marcas, contactos, tiendas, personas, novedades,
 * solicitudes, incidencias, reuniones y acuerdos.
 */
import { supabase } from '../lib/supabase';
import { ejecutar } from '../lib/errors';
import { validarMarca, validarPersona, validarReunion } from '../lib/validation';
import { crearServicio, requiereUsuario, registrarActividad } from './base.service';
import { tasksService } from './tasks.service';
import type {
  Brand, BrandLoad, Contact, Store, Person, PersonEvent, PersonStatus, PersonEventType,
  Request, Incident, Meeting, MeetingParticipant, Agreement, MessageTemplate, Task
} from '../types/database.types';

export const brandsService = crearServicio('brands', 'brand');
export const contactsService = crearServicio('contacts', 'contact');
export const storesService = crearServicio('stores', 'store');
export const peopleService = crearServicio('people', 'person');
export const requestsService = crearServicio('requests', 'request');
export const incidentsService = crearServicio('incidents', 'incident');
export const meetingsService = crearServicio('meetings', 'meeting');
export const agreementsService = crearServicio('agreements', 'agreement');
export const templatesService = crearServicio('message_templates', 'agreement');

/** Estado de la persona derivado del tipo de novedad registrada. */
const ESTADO_POR_NOVEDAD: Record<PersonEventType, PersonStatus> = {
  onboarding: 'active',
  training: 'active',
  warning: 'active',
  sick_leave: 'sick_leave',
  vacation: 'vacation',
  replacement: 'replacement',
  resignation: 'resigned'
};

export const workService = {
  /* --------------------------------------------------------------- Marcas - */
  async listarMarcas(): Promise<Brand[]> {
    return (await brandsService.listar({ orden: { columna: 'name' } })) as Brand[];
  },

  async cargaPorMarca(): Promise<BrandLoad[]> {
    return (await ejecutar(supabase.from('v_brand_load').select('*'), 'cargar el resumen de marcas')) as BrandLoad[];
  },

  async crearMarca(datos: Partial<Brand> & { name: string }): Promise<Brand> {
    validarMarca(datos);
    const b = (await brandsService.crear(datos as never)) as Brand;
    void registrarActividad('brand', b.id, 'create', b.name);
    return b;
  },

  async actualizarMarca(id: string, cambios: Partial<Brand>): Promise<Brand> {
    if (cambios.name !== undefined) validarMarca(cambios);
    return (await brandsService.actualizar(id, cambios as never)) as Brand;
  },

  /** Ficha completa de una marca en una sola consulta. */
  async fichaMarca(brandId: string) {
    const [marca, contactos, tiendas, equipo, solicitudes, incidencias, reuniones, acuerdos, tareas] = await Promise.all([
      brandsService.obtener(brandId) as Promise<Brand>,
      contactsService.listar({ filtros: { brand_id: brandId }, orden: { columna: 'full_name' } }) as Promise<Contact[]>,
      storesService.listar({ filtros: { brand_id: brandId }, orden: { columna: 'name' } }) as Promise<Store[]>,
      peopleService.listar({ filtros: { brand_id: brandId }, orden: { columna: 'full_name' } }) as Promise<Person[]>,
      requestsService.listar({ filtros: { brand_id: brandId }, orden: { columna: 'requested_on', ascendente: false } }) as Promise<Request[]>,
      incidentsService.listar({ filtros: { brand_id: brandId }, orden: { columna: 'detected_at', ascendente: false } }) as Promise<Incident[]>,
      meetingsService.listar({ filtros: { brand_id: brandId }, orden: { columna: 'starts_at', ascendente: false }, limite: 20 }) as Promise<Meeting[]>,
      agreementsService.listar({ filtros: { brand_id: brandId }, orden: { columna: 'agreed_on', ascendente: false } }) as Promise<Agreement[]>,
      tasksService.buscar({ brandId })
    ]);
    return { marca, contactos, tiendas, equipo, solicitudes, incidencias, reuniones, acuerdos, tareas };
  },

  /* ------------------------------------------------------------- Personas - */
  async crearPersona(datos: Partial<Person> & { full_name: string }): Promise<Person> {
    validarPersona(datos);
    return (await peopleService.crear(datos as never)) as Person;
  },

  async actualizarPersona(id: string, cambios: Partial<Person>): Promise<Person> {
    if (cambios.full_name !== undefined) validarPersona(cambios);
    return (await peopleService.actualizar(id, cambios as never)) as Person;
  },

  /** Registra una novedad y deja el estado de la persona coherente. */
  async registrarNovedad(datos: {
    person_id: string; type: PersonEventType; starts_on: string; ends_on?: string | null;
    replaces_id?: string | null; note?: string | null;
  }): Promise<PersonEvent> {
    const user_id = await requiereUsuario();
    const evento = (await ejecutar(
      supabase.from('people_events').insert({ ...datos, user_id } as never).select().single(),
      'registrar la novedad'
    )) as PersonEvent;
    await peopleService.actualizar(datos.person_id, { status: ESTADO_POR_NOVEDAD[datos.type] } as never);
    return evento;
  },

  async novedadesDe(personId: string): Promise<PersonEvent[]> {
    return (await ejecutar(
      supabase.from('people_events').select('*').eq('person_id', personId).order('starts_on', { ascending: false }),
      'cargar las novedades'
    )) as PersonEvent[];
  },

  /* ------------------------------------------------------------- Reuniones */
  async crearReunion(datos: Partial<Meeting> & { title: string; starts_at: string },
                     participantes: Array<{ display_name: string; role_title?: string }> = []): Promise<Meeting> {
    validarReunion(datos);
    const reunion = (await meetingsService.crear(datos as never)) as Meeting;
    if (participantes.length) {
      const user_id = await requiereUsuario();
      await supabase.from('meeting_participants').insert(
        participantes.map((p) => ({ ...p, user_id, meeting_id: reunion.id })) as never
      );
    }
    return reunion;
  },

  async participantesDe(meetingId: string): Promise<MeetingParticipant[]> {
    return (await ejecutar(
      supabase.from('meeting_participants').select('*').eq('meeting_id', meetingId).order('display_name'),
      'cargar los participantes'
    )) as MeetingParticipant[];
  },

  async acuerdosDe(meetingId: string): Promise<Agreement[]> {
    return (await agreementsService.listar({ filtros: { meeting_id: meetingId }, orden: { columna: 'agreed_on' } })) as Agreement[];
  },

  /**
   * Convierte un acuerdo en tarea y deja los dos registros enlazados.
   * Si el acuerdo ya generó una tarea, devuelve la existente en vez de duplicar.
   */
  async convertirAcuerdoEnTarea(acuerdo: Agreement): Promise<Task> {
    if (acuerdo.task_id) {
      return (await tasksService.obtener(acuerdo.task_id)) as Task;
    }
    const tarea = await tasksService.crearTarea({
      space: 'work',
      title: acuerdo.title,
      description: acuerdo.detail ?? undefined,
      category: acuerdo.type === 'incident' ? 'Incidencia' : 'Acuerdo',
      assignee: acuerdo.owner_name ?? undefined,
      priority: acuerdo.impact === 'high' ? 'high' : 'medium',
      brand_id: acuerdo.brand_id,
      meeting_id: acuerdo.meeting_id,
      due_at: acuerdo.due_date ? new Date(`${acuerdo.due_date}T18:00:00`).toISOString() : null
    } as never);

    await agreementsService.actualizar(acuerdo.id, { task_id: tarea.id, status: 'in_progress' } as never);
    void registrarActividad('agreement', acuerdo.id, 'update', 'Convertido en tarea');
    return tarea;
  },

  /* ----------------------------------------------------------- Plantillas - */
  async plantillas(): Promise<MessageTemplate[]> {
    return (await templatesService.listar({ orden: { columna: 'title' } })) as MessageTemplate[];
  }
};
