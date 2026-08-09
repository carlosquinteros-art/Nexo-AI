/**
 * google-disconnect
 *
 * Desconecta una cuenta de Google, de verdad:
 *
 *   1. Revoca el permiso EN GOOGLE. No basta con borrar el token de nuestra
 *      base: hay que decirle a Google que ya no lo queremos, para que también
 *      desaparezca de tu lista de aplicaciones con acceso.
 *   2. Borra los tokens del esquema privado. Borrado real, no marcado.
 *   3. Marca la conexión como revocada y, si lo pides, borra también los
 *      correos, eventos y archivos que se habían traído.
 *
 * Lo que NO hace: tocar tus datos en Google. Nada se elimina de Gmail, de
 * Calendar ni de Drive.
 *
 * Entrada: { connection_id, borrar_datos?: boolean }
 */
import { preflight, json, responderError, ErrorNexo } from '../_shared/cors.ts';
import { clienteAdmin, usuarioDeLaPeticion, conexionDelUsuario } from '../_shared/supabase.ts';
import { descifrar } from '../_shared/crypto.ts';
import { revocar } from '../_shared/google.ts';

Deno.serve(async (req) => {
  const pre = preflight(req);
  if (pre) return pre;

  try {
    if (req.method !== 'POST') throw new ErrorNexo('metodo', 'Usa POST.', 405);

    const usuario = await usuarioDeLaPeticion(req);
    const { connection_id, borrar_datos } = await req.json().catch(() => ({}));
    if (!connection_id) throw new ErrorNexo('falta_conexion', 'Indica qué cuenta quieres desconectar.', 400);

    const admin = clienteAdmin();
    const conexion = await conexionDelUsuario(admin, usuario.id, connection_id);

    /* 1. Revocar en Google. Se intenta con el refresh token, que revoca todo
       el permiso de una vez; si no está, se usa el de acceso. */
    let revocadoEnGoogle = false;
    const { data: tokens } = await admin.schema('private').from('google_tokens')
      .select('*').eq('connection_id', connection_id).eq('user_id', usuario.id).maybeSingle();

    if (tokens) {
      try {
        const refresh = await descifrar(tokens.refresh_token_enc, tokens.refresh_token_iv);
        const acceso = await descifrar(tokens.access_token_enc, tokens.access_token_iv);
        const cual = refresh || acceso;
        if (cual) revocadoEnGoogle = await revocar(cual);
      } catch {
        /* Si el token ya no se puede leer o Google lo rechaza, se sigue: lo
           importante es que deje de existir de nuestro lado. */
        revocadoEnGoogle = false;
      }
    }

    /* 2. Borrado real de los tokens. */
    await admin.schema('private').from('google_tokens')
      .delete().eq('connection_id', connection_id).eq('user_id', usuario.id);

    /* 3. Estado de la conexión y cursores. */
    await admin.from('google_sync_state')
      .delete().eq('connection_id', connection_id).eq('user_id', usuario.id);

    if (borrar_datos === true) {
      const ahora = new Date().toISOString();
      for (const t of ['google_messages', 'google_calendar_events', 'google_drive_items']) {
        await admin.from(t).update({ deleted_at: ahora })
          .eq('connection_id', connection_id).eq('user_id', usuario.id);
      }
      await admin.from('suggested_actions')
        .update({ deleted_at: ahora })
        .eq('connection_id', connection_id).eq('user_id', usuario.id).eq('status', 'pending');

      await admin.from('google_connections')
        .update({ status: 'revoked', deleted_at: ahora, gmail_enabled: false, calendar_enabled: false, drive_enabled: false })
        .eq('id', connection_id).eq('user_id', usuario.id);
    } else {
      await admin.from('google_connections').update({
        status: 'revoked',
        gmail_enabled: false, calendar_enabled: false, drive_enabled: false,
        scopes: [], token_expires_at: null,
        last_error: null, last_error_code: null,
      }).eq('id', connection_id).eq('user_id', usuario.id);
    }

    return json(req, {
      ok: true,
      revocado_en_google: revocadoEnGoogle,
      datos_borrados: borrar_datos === true,
      mensaje: revocadoEnGoogle
        ? `Se revocó el acceso de Nexo a ${conexion.email} y se borraron los permisos guardados.`
        : `Se borraron los permisos guardados de ${conexion.email}. Google no confirmó la revocación: ` +
          'revísala también en tu cuenta, en «Seguridad → Tus conexiones con aplicaciones de terceros».',
    });
  } catch (e) {
    return responderError(req, e);
  }
});
