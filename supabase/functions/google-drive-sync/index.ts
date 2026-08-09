/**
 * google-drive-sync
 *
 * Refresca los metadatos de Drive. También permite marcar archivos concretos
 * como «seleccionados» —los que tú eliges expresamente— y clasificarlos en
 * trabajo, universidad o personal.
 *
 * Solo metadatos: nunca se descarga ni se guarda el contenido de un archivo.
 * Nada se modifica en tu Drive.
 *
 * Entrada:
 *   { connection_id? }                          → refrescar
 *   { seleccionar: [{ external_id, space? }] }  → marcar archivos elegidos
 *   { quitar: [external_id] }                   → dejar de seguirlos
 */
import { preflight, json, responderError, ErrorNexo } from '../_shared/cors.ts';
import { clienteAdmin, usuarioDeLaPeticion, abrirCorrida, cerrarCorrida } from '../_shared/supabase.ts';
import { sincronizarDrive } from '../_shared/drive.ts';

const ESPACIOS = ['work', 'university', 'personal'];

Deno.serve(async (req) => {
  const pre = preflight(req);
  if (pre) return pre;

  try {
    if (req.method !== 'POST') throw new ErrorNexo('metodo', 'Usa POST.', 405);
    const usuario = await usuarioDeLaPeticion(req);
    const cuerpo = await req.json().catch(() => ({}));
    const admin = clienteAdmin();

    /* Marcar archivos elegidos por ti. */
    if (Array.isArray(cuerpo.seleccionar) && cuerpo.seleccionar.length) {
      let n = 0;
      for (const item of cuerpo.seleccionar.slice(0, 100)) {
        if (!item?.external_id) continue;
        const parche: Record<string, unknown> = { is_selected: true, origin: 'selected' };
        if (ESPACIOS.includes(item.space)) parche.space = item.space;
        const { error } = await admin.from('google_drive_items').update(parche)
          .eq('user_id', usuario.id).eq('external_id', item.external_id);
        if (!error) n++;
      }
      return json(req, { ok: true, seleccionados: n });
    }

    if (Array.isArray(cuerpo.quitar) && cuerpo.quitar.length) {
      await admin.from('google_drive_items')
        .update({ is_selected: false, origin: 'recent' })
        .eq('user_id', usuario.id).in('external_id', cuerpo.quitar.slice(0, 100));
      return json(req, { ok: true, quitados: cuerpo.quitar.length });
    }

    let q = admin.from('google_connections').select('*')
      .eq('user_id', usuario.id).eq('drive_enabled', true)
      .in('status', ['active', 'reauth_required'])
      .is('deleted_at', null);
    if (cuerpo.connection_id) q = q.eq('id', cuerpo.connection_id);

    const { data: conexiones } = await q;
    if (!conexiones?.length) {
      return json(req, { ok: true, cuentas: [], mensaje: 'Ninguna cuenta tiene Drive autorizado.' });
    }

    const resumen: any[] = [];
    for (const c of conexiones) {
      const corrida = await abrirCorrida(admin, usuario.id, c.id, 'drive', 'manual');
      try {
        const r = await sincronizarDrive(admin, usuario.id, c);
        await cerrarCorrida(admin, corrida, { status: 'ok', items_new: r.nuevos, items_updated: r.actualizados });
        await admin.from('google_connections')
          .update({ last_sync_at: new Date().toISOString(), status: 'active', last_error: null, last_error_code: null })
          .eq('id', c.id).eq('user_id', usuario.id);
        resumen.push({ connection_id: c.id, email: c.email, estado: 'ok', ...r });
      } catch (e) {
        const err = e instanceof ErrorNexo ? e : new ErrorNexo('error_sync', 'No se pudo leer Drive.', 500);
        await cerrarCorrida(admin, corrida, { status: 'failed', error_code: err.codigo, error_message: err.message });
        resumen.push({ connection_id: c.id, email: c.email, estado: 'error', error: err.codigo, mensaje: err.message, ayuda: err.ayuda ?? null });
      }
    }

    return json(req, { ok: true, cuentas: resumen });
  } catch (e) {
    return responderError(req, e);
  }
});
