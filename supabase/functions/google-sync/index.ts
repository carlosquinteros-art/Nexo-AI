/**
 * google-sync
 *
 * Sincroniza una cuenta o todas. Es la que se llama al abrir Nexo, con el
 * botón «Sincronizar ahora» y desde el programador.
 *
 * Reglas de funcionamiento:
 *   · Solo lectura. Ninguna llamada de este archivo modifica nada en Google.
 *   · Las cuentas en pausa no se tocan.
 *   · Un fallo en una cuenta no cancela las demás.
 *   · Los errores se guardan con un código entendible y sin datos sensibles.
 *   · Si Google retiró el permiso, la cuenta queda como «Reconexión requerida»
 *     en vez de fallar en silencio cada cinco minutos.
 *   · Reintento con espera creciente: tras varios fallos seguidos la cuenta
 *     descansa antes del próximo intento.
 *
 * Entrada: { connection_id?, servicios?: ['gmail','calendar','drive'], origen? }
 */
import { preflight, json, responderError, ErrorNexo } from '../_shared/cors.ts';
import { clienteAdmin, usuarioDeLaPeticion, abrirCorrida, cerrarCorrida } from '../_shared/supabase.ts';
import { sincronizarGmail } from '../_shared/gmail.ts';
import { sincronizarCalendario } from '../_shared/calendario.ts';
import { sincronizarDrive } from '../_shared/drive.ts';
import { proponerDesdeCorreos, proponerDesdeEventos } from '../_shared/sugerencias.ts';

const TODOS = ['gmail', 'calendar', 'drive'] as const;

/** Espera creciente: 1, 2, 4, 8… minutos, con techo de una hora. */
function proximoIntento(fallos: number): string {
  const minutos = Math.min(60, Math.pow(2, Math.max(0, fallos - 1)));
  return new Date(Date.now() + minutos * 60000).toISOString();
}

Deno.serve(async (req) => {
  const pre = preflight(req);
  if (pre) return pre;

  try {
    if (req.method !== 'POST') throw new ErrorNexo('metodo', 'Usa POST.', 405);

    const usuario = await usuarioDeLaPeticion(req);
    const cuerpo = await req.json().catch(() => ({}));
    const origen = ['manual', 'open_app', 'schedule'].includes(cuerpo.origen) ? cuerpo.origen : 'manual';
    const pedidos: string[] = Array.isArray(cuerpo.servicios) && cuerpo.servicios.length
      ? cuerpo.servicios.filter((s: string) => (TODOS as readonly string[]).includes(s))
      : [...TODOS];

    const admin = clienteAdmin();

    let consulta = admin.from('google_connections')
      .select('*').eq('user_id', usuario.id).is('deleted_at', null);
    if (cuerpo.connection_id) consulta = consulta.eq('id', cuerpo.connection_id);
    const { data: conexiones, error } = await consulta;
    if (error) throw new ErrorNexo('error_bd', 'No se pudieron leer tus cuentas conectadas.', 500);

    if (!conexiones?.length) {
      return json(req, { ok: true, cuentas: [], mensaje: 'No tienes cuentas de Google conectadas.' });
    }

    const resumen: any[] = [];

    for (const c of conexiones) {
      /* Pausadas y revocadas no se sincronizan, a propósito. */
      if (c.status === 'paused') {
        resumen.push({ connection_id: c.id, email: c.email, estado: 'paused', omitida: 'La cuenta está en pausa.' });
        continue;
      }
      if (c.status === 'revoked') {
        resumen.push({ connection_id: c.id, email: c.email, estado: 'revoked', omitida: 'La cuenta fue desconectada.' });
        continue;
      }
      if (c.status === 'reauth_required' && origen !== 'manual') {
        resumen.push({ connection_id: c.id, email: c.email, estado: 'reauth_required', omitida: 'Hay que volver a conectarla.' });
        continue;
      }

      const detalle: any = { connection_id: c.id, email: c.email, tipo: c.account_type, servicios: {} };
      let algoFuncionó = false;
      let algoFalló = false;

      for (const servicio of pedidos) {
        const habilitado = servicio === 'gmail' ? c.gmail_enabled
          : servicio === 'calendar' ? c.calendar_enabled : c.drive_enabled;
        if (!habilitado) continue;

        /* ¿Le toca descansar por fallos anteriores? */
        const { data: est } = await admin.from('google_sync_state')
          .select('fail_count, next_retry_at')
          .eq('user_id', usuario.id).eq('connection_id', c.id).eq('service', servicio).maybeSingle();
        if (est?.next_retry_at && new Date(est.next_retry_at).getTime() > Date.now() && origen !== 'manual') {
          detalle.servicios[servicio] = { estado: 'esperando', reintenta: est.next_retry_at };
          continue;
        }

        const corrida = await abrirCorrida(admin, usuario.id, c.id, servicio, origen);
        try {
          let r: any;
          if (servicio === 'gmail') r = await sincronizarGmail(admin, usuario.id, c);
          else if (servicio === 'calendar') r = await sincronizarCalendario(admin, usuario.id, c);
          else r = await sincronizarDrive(admin, usuario.id, c);

          await cerrarCorrida(admin, corrida, {
            status: 'ok',
            items_new: r.nuevos ?? 0,
            items_updated: r.actualizados ?? 0,
            items_removed: r.borrados ?? 0,
          });
          detalle.servicios[servicio] = { estado: 'ok', nuevos: r.nuevos ?? 0, actualizados: r.actualizados ?? 0 };
          algoFuncionó = true;
        } catch (e) {
          algoFalló = true;
          const err = e instanceof ErrorNexo ? e : new ErrorNexo('error_sync', 'No se pudo sincronizar.', 500);
          const fallos = (est?.fail_count ?? 0) + 1;

          await admin.from('google_sync_state').upsert({
            user_id: usuario.id, connection_id: c.id, service: servicio,
            fail_count: fallos, next_retry_at: proximoIntento(fallos),
          }, { onConflict: 'user_id,connection_id,service' });

          await cerrarCorrida(admin, corrida, {
            status: 'failed',
            error_code: err.codigo,
            /* Mensaje para leer, no un volcado: sin tokens ni contenido. */
            error_message: err.message,
          });

          detalle.servicios[servicio] = { estado: 'error', error: err.codigo, mensaje: err.message, ayuda: err.ayuda ?? null };
        }
      }

      /* Propuestas de tareas: se generan pero no se aplican solas. */
      if (algoFuncionó) {
        try {
          const a = c.gmail_enabled ? await proponerDesdeCorreos(admin, usuario.id, c.id) : 0;
          const b = c.calendar_enabled ? await proponerDesdeEventos(admin, usuario.id, c.id) : 0;
          detalle.sugerencias_nuevas = a + b;
        } catch (e) {
          console.error('Sugerencias:', (e as Error).message);
          detalle.sugerencias_nuevas = 0;
        }

        await admin.from('google_connections').update({
          last_sync_at: new Date().toISOString(),
          status: algoFalló ? c.status : 'active',
          last_error: algoFalló ? c.last_error : null,
          last_error_code: algoFalló ? c.last_error_code : null,
        }).eq('id', c.id).eq('user_id', usuario.id);
      }

      detalle.estado = algoFuncionó ? (algoFalló ? 'partial' : 'ok') : 'error';
      resumen.push(detalle);
    }

    return json(req, { ok: true, sincronizado_en: new Date().toISOString(), cuentas: resumen });
  } catch (e) {
    return responderError(req, e);
  }
});
