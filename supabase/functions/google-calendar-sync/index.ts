/**
 * google-calendar-sync
 *
 * Sincroniza solo los calendarios. Existe aparte de `google-sync` para poder
 * refrescar la agenda sin esperar a Gmail ni a Drive, que son más lentos.
 *
 * Solo lectura: no crea, no modifica y no borra eventos en Google.
 *
 * Entrada: { connection_id? }  ·  sin ella, sincroniza todas las cuentas activas.
 */
import { preflight, json, responderError, ErrorNexo } from '../_shared/cors.ts';
import { clienteAdmin, usuarioDeLaPeticion, abrirCorrida, cerrarCorrida } from '../_shared/supabase.ts';
import { sincronizarCalendario } from '../_shared/calendario.ts';
import { proponerDesdeEventos } from '../_shared/sugerencias.ts';

Deno.serve(async (req) => {
  const pre = preflight(req);
  if (pre) return pre;

  try {
    if (req.method !== 'POST') throw new ErrorNexo('metodo', 'Usa POST.', 405);
    const usuario = await usuarioDeLaPeticion(req);
    const { connection_id } = await req.json().catch(() => ({}));

    const admin = clienteAdmin();
    let q = admin.from('google_connections').select('*')
      .eq('user_id', usuario.id).eq('calendar_enabled', true)
      .in('status', ['active', 'reauth_required'])
      .is('deleted_at', null);
    if (connection_id) q = q.eq('id', connection_id);

    const { data: conexiones } = await q;
    if (!conexiones?.length) {
      return json(req, { ok: true, cuentas: [], mensaje: 'Ninguna cuenta tiene Calendar autorizado.' });
    }

    const resumen: any[] = [];
    for (const c of conexiones) {
      const corrida = await abrirCorrida(admin, usuario.id, c.id, 'calendar', 'manual');
      try {
        const r = await sincronizarCalendario(admin, usuario.id, c);
        const sug = await proponerDesdeEventos(admin, usuario.id, c.id);
        await cerrarCorrida(admin, corrida, {
          status: 'ok', items_new: r.nuevos, items_updated: r.actualizados, items_removed: r.borrados,
        });
        await admin.from('google_connections')
          .update({ last_sync_at: new Date().toISOString(), status: 'active', last_error: null, last_error_code: null })
          .eq('id', c.id).eq('user_id', usuario.id);
        resumen.push({ connection_id: c.id, email: c.email, estado: 'ok', ...r, sugerencias_nuevas: sug });
      } catch (e) {
        const err = e instanceof ErrorNexo ? e : new ErrorNexo('error_sync', 'No se pudo leer el calendario.', 500);
        await cerrarCorrida(admin, corrida, { status: 'failed', error_code: err.codigo, error_message: err.message });
        resumen.push({ connection_id: c.id, email: c.email, estado: 'error', error: err.codigo, mensaje: err.message, ayuda: err.ayuda ?? null });
      }
    }

    return json(req, { ok: true, cuentas: resumen });
  } catch (e) {
    return responderError(req, e);
  }
});
