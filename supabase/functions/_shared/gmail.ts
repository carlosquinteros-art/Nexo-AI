/**
 * Sincronización de Gmail. Solo lectura.
 *
 * Qué se guarda y qué no:
 *
 *   SE GUARDA   remitente, destinatarios, asunto, fecha, etiquetas, leído/no
 *               leído, importancia y el fragmento corto que Gmail ya entrega.
 *   NO SE GUARDA el cuerpo del mensaje, ni los adjuntos, ni los encabezados
 *               completos. Para leer un correo, Nexo abre el original en Gmail
 *               o lo pide al momento con `google-email-detail` y no lo archiva.
 *
 * Estrategia: la primera vez se traen los últimos 30 días. Después solo lo
 * nuevo o modificado, usando el `historyId` como cursor.
 */
import type { SupabaseClient } from 'jsr:@supabase/supabase-js@2';
import { apiGoogle } from './google.ts';
import { detectar, espacioDe } from './deteccion.ts';

const API = 'https://gmail.googleapis.com/gmail/v1/users/me';
const MAX_MENSAJES = 150;          // por corrida, para no agotar la cuota
const LARGO_SNIPPET = 300;

interface Resultado { nuevos: number; actualizados: number; cursor: string | null }

function cabecera(payload: any, nombre: string): string {
  const h = payload?.headers?.find((x: any) => String(x.name).toLowerCase() === nombre.toLowerCase());
  return h?.value ?? '';
}

/** «Carlos Quinteros <carlos@touch-jobs.com>» → nombre y correo por separado. */
function partirRemitente(valor: string): { nombre: string; email: string } {
  const m = valor.match(/^\s*"?([^"<]*?)"?\s*<([^>]+)>\s*$/);
  if (m) return { nombre: m[1].trim(), email: m[2].trim().toLowerCase() };
  return { nombre: '', email: valor.trim().toLowerCase() };
}

function listaCorreos(valor: string): string[] {
  if (!valor) return [];
  return valor.split(',').map((x) => partirRemitente(x).email).filter((x) => x.includes('@')).slice(0, 20);
}

export async function sincronizarGmail(
  admin: SupabaseClient,
  userId: string,
  conexion: any,
): Promise<Resultado> {
  const cid = conexion.id;

  const { data: estado } = await admin.from('google_sync_state')
    .select('*').eq('user_id', userId).eq('connection_id', cid).eq('service', 'gmail').maybeSingle();

  let ids: string[] = [];
  let cursorNuevo: string | null = estado?.cursor_value ?? null;

  if (estado?.full_done && estado?.cursor_value) {
    /* Incremental: solo lo que cambió desde el último historyId. */
    let pagina: string | null = null;
    let vueltas = 0;
    do {
      const url = new URL(`${API}/history`);
      url.searchParams.set('startHistoryId', estado.cursor_value);
      url.searchParams.set('maxResults', '200');
      if (pagina) url.searchParams.set('pageToken', pagina);
      const r = await apiGoogle(admin, userId, cid, url.toString());
      cursorNuevo = r.historyId ?? cursorNuevo;
      for (const h of r.history ?? []) {
        for (const grupo of ['messagesAdded', 'messagesDeleted', 'labelsAdded', 'labelsRemoved']) {
          for (const item of h[grupo] ?? []) {
            const id = item.message?.id;
            if (id && !ids.includes(id)) ids.push(id);
          }
        }
      }
      pagina = r.nextPageToken ?? null;
      vueltas++;
    } while (pagina && vueltas < 5 && ids.length < MAX_MENSAJES);
  } else {
    /* Primera vez: últimos 30 días. */
    const desde = new Date(Date.now() - 30 * 86400000);
    const q = `after:${Math.floor(desde.getTime() / 1000)}`;
    let pagina: string | null = null;
    let vueltas = 0;
    do {
      const url = new URL(`${API}/messages`);
      url.searchParams.set('q', q);
      url.searchParams.set('maxResults', '100');
      if (pagina) url.searchParams.set('pageToken', pagina);
      const r = await apiGoogle(admin, userId, cid, url.toString());
      for (const m of r.messages ?? []) if (!ids.includes(m.id)) ids.push(m.id);
      pagina = r.nextPageToken ?? null;
      vueltas++;
    } while (pagina && vueltas < 3 && ids.length < MAX_MENSAJES);

    const perfil = await apiGoogle(admin, userId, cid, `${API}/profile`);
    cursorNuevo = perfil?.historyId ?? null;
  }

  ids = ids.slice(0, MAX_MENSAJES);
  if (!ids.length) {
    await guardarCursor(admin, userId, cid, cursorNuevo, true);
    return { nuevos: 0, actualizados: 0, cursor: cursorNuevo };
  }

  /* Remitentes prioritarios y correos ya conocidos, para no repetir trabajo. */
  const { data: yaGuardados } = await admin.from('google_messages')
    .select('external_id').eq('user_id', userId).eq('connection_id', cid).in('external_id', ids);
  const conocidos = new Set((yaGuardados ?? []).map((x: any) => x.external_id));

  const filas: any[] = [];
  for (const id of ids) {
    /* `format=metadata` es deliberado: pide solo los encabezados que se
       necesitan. Con el permiso gmail.metadata el cuerpo ni siquiera viaja. */
    const url = new URL(`${API}/messages/${id}`);
    url.searchParams.set('format', 'metadata');
    ['From', 'To', 'Cc', 'Subject', 'Date'].forEach((h) => url.searchParams.append('metadataHeaders', h));

    let m: any;
    try {
      m = await apiGoogle(admin, userId, cid, url.toString());
    } catch {
      continue;   // un mensaje borrado entre medio no debe romper la corrida
    }
    if (!m?.id) continue;

    const de = partirRemitente(cabecera(m.payload, 'From'));
    const asunto = cabecera(m.payload, 'Subject');
    const fecha = m.internalDate ? new Date(Number(m.internalDate)) : new Date();
    const etiquetas: string[] = m.labelIds ?? [];
    const snippet = String(m.snippet ?? '').slice(0, LARGO_SNIPPET);

    const detecciones = detectar(asunto, snippet, fecha);

    filas.push({
      user_id: userId,
      connection_id: cid,
      external_id: m.id,
      thread_id: m.threadId ?? null,
      from_name: de.nombre || null,
      from_email: de.email || null,
      to_emails: listaCorreos(cabecera(m.payload, 'To')),
      cc_emails: listaCorreos(cabecera(m.payload, 'Cc')),
      subject: asunto || '(sin asunto)',
      sent_at: fecha.toISOString(),
      labels: etiquetas,
      is_unread: etiquetas.includes('UNREAD'),
      is_important: etiquetas.includes('IMPORTANT'),
      is_starred: etiquetas.includes('STARRED'),
      snippet,
      web_link: `https://mail.google.com/mail/u/${encodeURIComponent(conexion.email)}/#all/${m.id}`,
      detected: detecciones,
      space: espacioDe(conexion.account_type, detecciones),
      deleted_at: null,
      updated_at: new Date().toISOString(),
    });
  }

  let nuevos = 0, actualizados = 0;
  for (let i = 0; i < filas.length; i += 50) {
    const lote = filas.slice(i, i + 50);
    const { error } = await admin.from('google_messages')
      .upsert(lote, { onConflict: 'user_id,connection_id,external_id' });
    if (error) throw new Error('google_messages: ' + error.message);
    lote.forEach((f) => (conocidos.has(f.external_id) ? actualizados++ : nuevos++));
  }

  await guardarCursor(admin, userId, cid, cursorNuevo, true);
  return { nuevos, actualizados, cursor: cursorNuevo };
}

async function guardarCursor(
  admin: SupabaseClient, userId: string, cid: string, cursor: string | null, completo: boolean,
) {
  await admin.from('google_sync_state').upsert({
    user_id: userId, connection_id: cid, service: 'gmail',
    cursor_value: cursor, full_done: completo, fail_count: 0,
    last_ok_at: new Date().toISOString(), next_retry_at: null,
  }, { onConflict: 'user_id,connection_id,service' });
}
