/**
 * google-refresh-token
 *
 * Renueva el permiso de acceso de una cuenta. Normalmente no hace falta
 * llamarla a mano: `tokenVigente()` la hace sola cuando el token está por
 * vencer. Existe como función aparte para poder comprobar una conexión desde
 * la interfaz sin tener que sincronizar nada.
 *
 * Nunca devuelve el token. Solo dice si la cuenta sigue viva y hasta cuándo.
 */
import { preflight, json, responderError, ErrorNexo } from '../_shared/cors.ts';
import { clienteAdmin, usuarioDeLaPeticion, conexionDelUsuario } from '../_shared/supabase.ts';
import { tokenVigente } from '../_shared/google.ts';

Deno.serve(async (req) => {
  const pre = preflight(req);
  if (pre) return pre;

  try {
    if (req.method !== 'POST') throw new ErrorNexo('metodo', 'Usa POST.', 405);

    const usuario = await usuarioDeLaPeticion(req);
    const { connection_id } = await req.json().catch(() => ({}));
    if (!connection_id) throw new ErrorNexo('falta_conexion', 'Indica qué cuenta quieres revisar.', 400);

    const admin = clienteAdmin();
    await conexionDelUsuario(admin, usuario.id, connection_id);

    try {
      /* Fuerza la renovación si corresponde. El token se usa y se descarta:
         no sale de esta función. */
      await tokenVigente(admin, usuario.id, connection_id);
    } catch (e) {
      const err = e instanceof ErrorNexo ? e : new ErrorNexo('error_google', 'No se pudo renovar el permiso.', 401);
      return json(req, {
        ok: false,
        estado: 'reauth_required',
        error: err.codigo,
        mensaje: err.message,
        ayuda: err.ayuda ?? null,
      }, 200);
    }

    const { data } = await admin.from('google_connections')
      .select('token_expires_at, status').eq('id', connection_id).eq('user_id', usuario.id).maybeSingle();

    /* Si estaba marcada para reconectar y ahora funciona, se reactiva. */
    if (data?.status === 'reauth_required') {
      await admin.from('google_connections')
        .update({ status: 'active', last_error: null, last_error_code: null })
        .eq('id', connection_id).eq('user_id', usuario.id);
    }

    return json(req, { ok: true, estado: 'active', vence: data?.token_expires_at ?? null });
  } catch (e) {
    return responderError(req, e);
  }
});
