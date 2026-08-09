/**
 * Sincronización de Google Drive. Solo metadatos, solo lectura.
 *
 * Lo que se trae:
 *   · Documentos modificados hace poco (los últimos 30 días, máximo 100).
 *   · Archivos que tú elegiste expresamente.
 *   · Archivos enlazados desde correos o eventos ya guardados.
 *
 * Lo que NO se hace:
 *   · No se descarga ningún archivo.
 *   · No se lee el contenido.
 *   · No se pide acceso completo al Drive: el permiso es
 *     `drive.metadata.readonly`, que ve el nombre y la fecha pero no abre nada.
 *     Para trabajar con un archivo concreto se usa `drive.file`, que solo da
 *     acceso a lo que tú seleccionas en el selector de Google.
 */
import type { SupabaseClient } from 'jsr:@supabase/supabase-js@2';
import { apiGoogle } from './google.ts';

const API = 'https://www.googleapis.com/drive/v3';
const CAMPOS = 'nextPageToken, files(id,name,mimeType,iconLink,webViewLink,modifiedTime,size,owners(emailAddress),parents,trashed)';
const MAX = 100;

interface Resultado { nuevos: number; actualizados: number }

/* Clasificación por nombre. Es una pista, no una certeza: siempre se puede
   cambiar a mano desde la aplicación. */
const PISTAS_UNI = ['apunte', 'derecho', 'civil', 'penal', 'procesal', 'constitucional',
  'ensayo', 'control', 'prueba', 'examen', 'lectura', 'catedra', 'cátedra', 'universidad'];
const PISTAS_PERSONAL = ['personal', 'casa', 'familia', 'vacaciones', 'salud', 'gastos personales'];

function espacioPorNombre(nombre: string, tipoCuenta: string): string {
  const n = nombre.toLowerCase();
  if (PISTAS_UNI.some((p) => n.includes(p))) return 'university';
  if (PISTAS_PERSONAL.some((p) => n.includes(p))) return 'personal';
  if (tipoCuenta === 'university') return 'university';
  if (tipoCuenta === 'personal') return 'personal';
  return 'work';
}

export async function sincronizarDrive(
  admin: SupabaseClient,
  userId: string,
  conexion: any,
): Promise<Resultado> {
  const cid = conexion.id;
  const desde = new Date(Date.now() - 30 * 86400000).toISOString();

  const url = new URL(`${API}/files`);
  url.searchParams.set('q', `trashed = false and modifiedTime > '${desde}'`);
  url.searchParams.set('orderBy', 'modifiedTime desc');
  url.searchParams.set('pageSize', '100');
  url.searchParams.set('fields', CAMPOS);
  url.searchParams.set('supportsAllDrives', 'true');
  url.searchParams.set('includeItemsFromAllDrives', 'true');

  const r = await apiGoogle(admin, userId, cid, url.toString());
  const archivos = (r.files ?? []).slice(0, MAX);

  if (!archivos.length) {
    await guardarEstado(admin, userId, cid, r.nextPageToken ?? null);
    return { nuevos: 0, actualizados: 0 };
  }

  const { data: previos } = await admin.from('google_drive_items')
    .select('external_id, origin, is_selected, space')
    .eq('user_id', userId).eq('connection_id', cid)
    .in('external_id', archivos.map((f: any) => f.id));
  const antes = new Map((previos ?? []).map((x: any) => [x.external_id, x]));

  const filas = archivos.map((f: any) => {
    const anterior = antes.get(f.id);
    return {
      user_id: userId,
      connection_id: cid,
      external_id: f.id,
      name: f.name ?? '(sin nombre)',
      mime_type: f.mimeType ?? null,
      icon_link: f.iconLink ?? null,
      web_link: f.webViewLink ?? `https://drive.google.com/file/d/${f.id}/view`,
      owner_email: f.owners?.[0]?.emailAddress ?? null,
      modified_at: f.modifiedTime ?? null,
      size_bytes: f.size ? Number(f.size) : null,
      parent_id: f.parents?.[0] ?? null,
      /* Si tú lo marcaste como seleccionado, eso manda sobre "reciente". */
      origin: anterior?.origin === 'selected' ? 'selected' : (anterior?.origin ?? 'recent'),
      is_selected: anterior?.is_selected ?? false,
      space: anterior?.space ?? espacioPorNombre(f.name ?? '', conexion.account_type),
      deleted_at: null,
      updated_at: new Date().toISOString(),
    };
  });

  let nuevos = 0, actualizados = 0;
  for (let i = 0; i < filas.length; i += 50) {
    const lote = filas.slice(i, i + 50);
    const { error } = await admin.from('google_drive_items')
      .upsert(lote, { onConflict: 'user_id,connection_id,external_id' });
    if (error) throw new Error('google_drive_items: ' + error.message);
    lote.forEach((f) => (antes.has(f.external_id) ? actualizados++ : nuevos++));
  }

  /* Archivos mencionados en correos y eventos ya guardados: se marcan como
     enlazados para que aparezcan junto a su origen. */
  await marcarEnlazados(admin, userId, cid);

  await guardarEstado(admin, userId, cid, r.nextPageToken ?? null);
  return { nuevos, actualizados };
}

async function marcarEnlazados(admin: SupabaseClient, userId: string, cid: string) {
  const { data: eventos } = await admin.from('google_calendar_events')
    .select('description, title').eq('user_id', userId).eq('connection_id', cid)
    .is('deleted_at', null).limit(200);

  const ids = new Set<string>();
  for (const e of eventos ?? []) {
    const texto = `${e.description ?? ''} ${e.title ?? ''}`;
    for (const m of texto.matchAll(/drive\.google\.com\/[^\s"']*?\/d\/([A-Za-z0-9_-]{20,})/g)) ids.add(m[1]);
    for (const m of texto.matchAll(/docs\.google\.com\/[^\s"']*?\/d\/([A-Za-z0-9_-]{20,})/g)) ids.add(m[1]);
  }
  if (!ids.size) return;

  await admin.from('google_drive_items')
    .update({ origin: 'linked', linked_from: 'calendar' })
    .eq('user_id', userId).eq('connection_id', cid)
    .eq('origin', 'recent')
    .in('external_id', Array.from(ids).slice(0, 100));
}

async function guardarEstado(admin: SupabaseClient, userId: string, cid: string, pageToken: string | null) {
  await admin.from('google_sync_state').upsert({
    user_id: userId, connection_id: cid, service: 'drive',
    page_token: pageToken, full_done: true, fail_count: 0,
    last_ok_at: new Date().toISOString(), next_retry_at: null,
  }, { onConflict: 'user_id,connection_id,service' });
}
