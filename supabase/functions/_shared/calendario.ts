/**
 * Sincronización de Google Calendar. Solo lectura.
 *
 * Se traen los eventos de los últimos 7 días y los próximos 60, de todos los
 * calendarios de la cuenta. Después se usa el `syncToken` de Google para pedir
 * únicamente lo que cambió.
 *
 * El evento se guarda con la cuenta y el color de origen, para que en la vista
 * consolidada siempre se sepa de dónde viene cada cosa.
 */
import type { SupabaseClient } from 'jsr:@supabase/supabase-js@2';
import { apiGoogle } from './google.ts';

const API = 'https://www.googleapis.com/calendar/v3';
const MAX_EVENTOS = 400;

interface Resultado { nuevos: number; actualizados: number; borrados: number }

/** Frases que indican que hay que preparar algo antes de la reunión. */
const PREPARAR = ['preparar', 'llevar', 'traer', 'revisar antes', 'enviar antes', 'presentar',
  'exponer', 'agenda:', 'tener listo', 'material', 'propuesta'];

function esUniversidad(texto: string, tipoCuenta: string): boolean {
  if (tipoCuenta === 'university') return true;
  const t = texto.toLowerCase();
  return ['clase', 'catedra', 'cátedra', 'ayudantia', 'ayudantía', 'prueba', 'examen',
    'certamen', 'solemne', 'universidad', 'facultad', 'derecho'].some((p) => t.includes(p));
}

export async function sincronizarCalendario(
  admin: SupabaseClient,
  userId: string,
  conexion: any,
): Promise<Resultado> {
  const cid = conexion.id;

  const { data: estado } = await admin.from('google_sync_state')
    .select('*').eq('user_id', userId).eq('connection_id', cid).eq('service', 'calendar').maybeSingle();

  /* Lista de calendarios de la cuenta. */
  const lista = await apiGoogle(admin, userId, cid, `${API}/users/me/calendarList?maxResults=50`);
  const calendarios = (lista.items ?? []).filter((c: any) => !c.deleted && c.selected !== false);

  let nuevos = 0, actualizados = 0, borrados = 0;
  const cursores: Record<string, string> = estado?.cursor_value ? safeJson(estado.cursor_value) : {};

  for (const cal of calendarios) {
    const calId = cal.id;
    let pagina: string | null = null;
    let vueltas = 0;
    let cursorNuevo: string | null = null;
    let leidos = 0;

    do {
      const url = new URL(`${API}/calendars/${encodeURIComponent(calId)}/events`);
      url.searchParams.set('maxResults', '250');
      url.searchParams.set('singleEvents', 'true');

      if (cursores[calId] && !pagina) {
        url.searchParams.set('syncToken', cursores[calId]);
      } else if (!pagina) {
        url.searchParams.set('timeMin', new Date(Date.now() - 7 * 86400000).toISOString());
        url.searchParams.set('timeMax', new Date(Date.now() + 60 * 86400000).toISOString());
        url.searchParams.set('orderBy', 'startTime');
      }
      if (pagina) url.searchParams.set('pageToken', pagina);

      let r: any;
      try {
        r = await apiGoogle(admin, userId, cid, url.toString());
      } catch (e) {
        /* Un syncToken caducado obliga a rehacer la ventana completa. */
        if (String((e as Error).message).includes('410') || (e as any).codigo === 'error_google') {
          delete cursores[calId];
          break;
        }
        throw e;
      }

      const filas: any[] = [];
      for (const ev of r.items ?? []) {
        if (ev.status === 'cancelled') {
          await admin.from('google_calendar_events')
            .update({ deleted_at: new Date().toISOString() })
            .eq('user_id', userId).eq('connection_id', cid).eq('calendar_id', calId).eq('external_id', ev.id);
          borrados++;
          continue;
        }

        const todoElDia = !!ev.start?.date;
        const inicio = ev.start?.dateTime ?? (ev.start?.date ? `${ev.start.date}T00:00:00-04:00` : null);
        const fin = ev.end?.dateTime ?? (ev.end?.date ? `${ev.end.date}T23:59:00-04:00` : null);
        if (!inicio) continue;

        const descripcion = String(ev.description ?? '').slice(0, 1000);
        const texto = `${ev.summary ?? ''} ${descripcion}`;
        const asistentes = (ev.attendees ?? []).slice(0, 25).map((a: any) => ({
          email: a.email, nombre: a.displayName ?? null, respuesta: a.responseStatus ?? null,
        }));
        const mio = (ev.attendees ?? []).find((a: any) => a.self);

        filas.push({
          user_id: userId,
          connection_id: cid,
          calendar_id: calId,
          calendar_name: cal.summary ?? null,
          external_id: ev.id,
          ical_uid: ev.iCalUID ?? null,
          title: ev.summary ?? '(sin título)',
          description: descripcion || null,
          location: ev.location ?? null,
          meeting_link: ev.hangoutLink ?? ev.conferenceData?.entryPoints?.[0]?.uri ?? null,
          starts_at: new Date(inicio).toISOString(),
          ends_at: fin ? new Date(fin).toISOString() : null,
          all_day: todoElDia,
          organizer_email: ev.organizer?.email ?? null,
          attendees: asistentes,
          attendees_count: (ev.attendees ?? []).length,
          response_status: mio?.responseStatus ?? null,
          event_status: ev.status ?? 'confirmed',
          recurring_id: ev.recurringEventId ?? null,
          web_link: ev.htmlLink ?? null,
          color: cal.backgroundColor ?? conexion.color,
          space: esUniversidad(texto, conexion.account_type) ? 'university'
            : conexion.account_type === 'personal' ? 'personal' : 'work',
          needs_prep: PREPARAR.some((p) => texto.toLowerCase().includes(p)),
          deleted_at: null,
          updated_at: new Date().toISOString(),
        });
        leidos++;
      }

      if (filas.length) {
        const { data: previos } = await admin.from('google_calendar_events')
          .select('external_id').eq('user_id', userId).eq('connection_id', cid)
          .eq('calendar_id', calId).in('external_id', filas.map((f) => f.external_id));
        const conocidos = new Set((previos ?? []).map((x: any) => x.external_id));

        const { error } = await admin.from('google_calendar_events')
          .upsert(filas, { onConflict: 'user_id,connection_id,calendar_id,external_id' });
        if (error) throw new Error('google_calendar_events: ' + error.message);
        filas.forEach((f) => (conocidos.has(f.external_id) ? actualizados++ : nuevos++));
      }

      pagina = r.nextPageToken ?? null;
      if (r.nextSyncToken) cursorNuevo = r.nextSyncToken;
      vueltas++;
    } while (pagina && vueltas < 4 && leidos < MAX_EVENTOS);

    if (cursorNuevo) cursores[calId] = cursorNuevo;
  }

  await admin.from('google_sync_state').upsert({
    user_id: userId, connection_id: cid, service: 'calendar',
    cursor_value: JSON.stringify(cursores), full_done: true, fail_count: 0,
    last_ok_at: new Date().toISOString(), next_retry_at: null,
  }, { onConflict: 'user_id,connection_id,service' });

  return { nuevos, actualizados, borrados };
}

function safeJson(s: string): Record<string, string> {
  try { const v = JSON.parse(s); return v && typeof v === 'object' ? v : {}; } catch { return {}; }
}
