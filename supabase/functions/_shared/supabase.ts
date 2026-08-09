/**
 * Acceso a Supabase desde las Edge Functions.
 *
 * Dos clientes, con propósitos distintos y deliberadamente separados:
 *
 *   · `clienteUsuario(req)` usa el token de la persona. Sirve para saber quién
 *     está llamando. Si el token no vale, no hay usuario y no se hace nada.
 *
 *   · `clienteAdmin()` usa la clave de servicio. Es el único que puede tocar
 *     el esquema `private` donde viven los tokens de Google. Nunca se expone,
 *     nunca se devuelve al navegador y jamás se usa sin haber validado antes
 *     al usuario con el otro cliente.
 */
import { createClient, type SupabaseClient } from 'jsr:@supabase/supabase-js@2';
import { ErrorNexo } from './cors.ts';

const URL = Deno.env.get('SUPABASE_URL')!;
const ANON = Deno.env.get('SUPABASE_ANON_KEY')!;
const SERVICIO = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

export function clienteAdmin(): SupabaseClient {
  return createClient(URL, SERVICIO, { auth: { persistSession: false, autoRefreshToken: false } });
}

export interface Usuario { id: string; email: string | null }

/**
 * Valida el JWT de Supabase que viene en la cabecera y devuelve el usuario.
 * Todo lo que ocurra después queda amarrado a este `id`: es el `auth.uid()`
 * con el que se filtra cada consulta.
 */
export async function usuarioDeLaPeticion(req: Request): Promise<Usuario> {
  const cabecera = req.headers.get('Authorization') || '';
  const token = cabecera.startsWith('Bearer ') ? cabecera.slice(7) : '';
  if (!token) {
    throw new ErrorNexo('sin_sesion', 'Inicia sesión en Nexo antes de conectar una cuenta de Google.', 401);
  }
  const cliente = createClient(URL, ANON, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await cliente.auth.getUser();
  if (error || !data?.user) {
    throw new ErrorNexo('sesion_invalida', 'Tu sesión expiró. Vuelve a entrar a Nexo.', 401);
  }
  return { id: data.user.id, email: data.user.email ?? null };
}

/** Comprueba que la conexión sea de quien dice ser. */
export async function conexionDelUsuario(
  admin: SupabaseClient,
  userId: string,
  connectionId: string,
) {
  const { data, error } = await admin
    .from('google_connections')
    .select('*')
    .eq('id', connectionId)
    .eq('user_id', userId)
    .is('deleted_at', null)
    .maybeSingle();
  if (error) throw new ErrorNexo('error_bd', 'No se pudo leer la conexión.', 500);
  if (!data) throw new ErrorNexo('conexion_no_encontrada', 'Esa cuenta de Google no está conectada.', 404);
  return data;
}

/** Deja constancia de una sincronización, sin datos sensibles. */
export async function abrirCorrida(
  admin: SupabaseClient,
  userId: string,
  connectionId: string | null,
  service: string | null,
  origen: string,
): Promise<string> {
  const { data } = await admin.from('google_sync_runs').insert({
    user_id: userId,
    connection_id: connectionId,
    service,
    status: 'running',
    trigger_source: origen,
  }).select('id').maybeSingle();
  return data?.id ?? '';
}

export async function cerrarCorrida(
  admin: SupabaseClient,
  id: string,
  resumen: {
    status: string;
    items_new?: number;
    items_updated?: number;
    items_removed?: number;
    error_code?: string | null;
    error_message?: string | null;
  },
) {
  if (!id) return;
  await admin.from('google_sync_runs').update({
    ...resumen,
    /* Se recorta a propósito: la bitácora no es lugar para volcados. */
    error_message: resumen.error_message ? String(resumen.error_message).slice(0, 500) : null,
    finished_at: new Date().toISOString(),
  }).eq('id', id);
}
