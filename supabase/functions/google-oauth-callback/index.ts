/**
 * google-oauth-callback
 *
 * A esta dirección vuelve Google después de que autorizas. Es la única función
 * sin JWT, porque quien llama es el navegador siguiendo un redirect de Google.
 * La identidad se recupera del `state`, que se generó con tu sesión y se
 * guardó en el esquema privado.
 *
 * El canje del código por los tokens ocurre en el servidor, dentro de
 * `_shared/google.ts`, que es el único archivo que lee el secreto de cliente.
 * El navegador nunca ve el código de autorización, ni los tokens, ni el
 * secreto: recibe una página que se cierra sola y avisa a Nexo con un
 * `postMessage` que dice, como mucho, el correo conectado.
 *
 * IMPORTANTE: esta función debe desplegarse con `--no-verify-jwt`.
 */
import { clienteAdmin } from '../_shared/supabase.ts';
import { canjearCodigo, guardarTokens, perfilDe, traducirErrorGoogle } from '../_shared/google.ts';
import { ErrorNexo } from '../_shared/cors.ts';

const esc = (s: string) =>
  String(s ?? '').replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' } as Record<string, string>)[c]);

/** Página mínima que informa el resultado y cierra la ventana emergente. */
function pagina(ok: boolean, titulo: string, detalle: string, datos: Record<string, unknown>, ayuda = '') {
  const carga = JSON.stringify({ fuente: 'nexo-google', ok, ...datos });
  return new Response(
    `<!doctype html><html lang="es"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(titulo)}</title>
<style>
  :root { color-scheme: light dark; }
  body { margin:0; min-height:100vh; display:grid; place-items:center;
         font:15px/1.55 -apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;
         background:#F4F6F9; color:#1B2733; padding:24px; }
  @media (prefers-color-scheme: dark) { body { background:#111820; color:#E7ECF2; } }
  .caja { max-width:440px; text-align:center; background:#fff; border-radius:18px; padding:32px 28px;
          box-shadow:0 8px 30px rgba(16,32,48,.10); }
  @media (prefers-color-scheme: dark) { .caja { background:#1A222C; } }
  .icono { width:56px; height:56px; border-radius:16px; display:grid; place-items:center; margin:0 auto 16px;
           font-size:26px; background:${ok ? '#DCF5E7' : '#FDE4E4'}; color:${ok ? '#0F7A4A' : '#B23B3B'}; }
  h1 { font-size:18px; margin:0 0 8px; }
  p { margin:0 0 6px; font-size:13.5px; color:#5A6B7C; }
  .ayuda { margin-top:14px; font-size:12.5px; text-align:left; background:#F4F6F9; border-radius:12px; padding:12px 14px; color:#3C4C5C; }
  @media (prefers-color-scheme: dark) { .ayuda { background:#232D38; color:#C3CDD8; } p { color:#93A2B1; } }
</style></head><body>
<div class="caja">
  <div class="icono">${ok ? '✓' : '!'}</div>
  <h1>${esc(titulo)}</h1>
  <p>${esc(detalle)}</p>
  ${ayuda ? `<div class="ayuda">${esc(ayuda)}</div>` : ''}
  <p style="margin-top:14px;font-size:12px">Puedes cerrar esta ventana.</p>
</div>
<script>
  try { if (window.opener) window.opener.postMessage(${carga}, '*'); } catch (e) {}
  setTimeout(function () { try { window.close(); } catch (e) {} }, ${ok ? 1200 : 6000});
</script>
</body></html>`,
    { status: ok ? 200 : 400, headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' } },
  );
}

Deno.serve(async (req) => {
  const url = new URL(req.url);
  const codigo = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  const errorGoogle = url.searchParams.get('error');

  const admin = clienteAdmin();

  /* Google puede volver con error antes de entregar cualquier código. */
  if (errorGoogle) {
    const e = traducirErrorGoogle(403, { error: errorGoogle, error_description: url.searchParams.get('error_description') ?? '' });
    if (state) await admin.schema('private').from('google_oauth_states').delete().eq('state', state);
    return pagina(false, 'No se pudo conectar', e.message, { error: e.codigo }, e.ayuda ?? '');
  }

  if (!codigo || !state) {
    return pagina(false, 'Enlace incompleto', 'Faltan datos en la respuesta de Google. Vuelve a intentarlo desde Nexo.', { error: 'respuesta_incompleta' });
  }

  try {
    /* El state se consume una sola vez. */
    const { data: est } = await admin.schema('private').from('google_oauth_states')
      .select('*').eq('state', state).maybeSingle();
    if (!est) {
      return pagina(false, 'La conexión expiró', 'Pasaron más de 10 minutos o el enlace ya se usó. Empieza de nuevo desde Nexo.', { error: 'estado_invalido' });
    }
    await admin.schema('private').from('google_oauth_states').delete().eq('state', state);

    if (new Date(est.expires_at).getTime() < Date.now()) {
      return pagina(false, 'La conexión expiró', 'Vuelve a intentarlo desde Nexo.', { error: 'estado_expirado' });
    }

    const tokens = await canjearCodigo(codigo, est.code_verifier);
    const perfil = await perfilDe(tokens.access_token);

    const otorgados = (tokens.scope ?? '').split(' ').filter(Boolean);
    const tieneGmail = otorgados.some((s) => s.includes('gmail'));
    const tieneCal = otorgados.some((s) => s.includes('calendar'));
    const tieneDrive = otorgados.some((s) => s.includes('drive'));

    /* Una fila por cuenta de Google y usuario de Nexo. Reconectar actualiza,
       no duplica: la clave única es (user_id, google_sub). */
    const { data: existente } = await admin.from('google_connections')
      .select('id, gmail_enabled, calendar_enabled, drive_enabled')
      .eq('user_id', est.user_id).eq('google_sub', perfil.sub).maybeSingle();

    const fila = {
      user_id: est.user_id,
      google_sub: perfil.sub,
      email: perfil.email,
      display_name: perfil.name ?? perfil.email,
      avatar_url: perfil.picture ?? null,
      account_type: est.account_type,
      status: 'active',
      /* Los permisos se suman: si ya tenías Calendar y ahora agregas Gmail,
         quedan los dos. */
      gmail_enabled: tieneGmail || (existente?.gmail_enabled ?? false),
      calendar_enabled: tieneCal || (existente?.calendar_enabled ?? false),
      drive_enabled: tieneDrive || (existente?.drive_enabled ?? false),
      scopes: otorgados,
      last_error: null,
      last_error_code: null,
      deleted_at: null,
      updated_at: new Date().toISOString(),
    };

    let connectionId = existente?.id ?? '';
    if (connectionId) {
      await admin.from('google_connections').update(fila).eq('id', connectionId).eq('user_id', est.user_id);
    } else {
      const colores: Record<string, string> = { work: '#0D5C63', university: '#4F46E5', personal: '#0F7A4A' };
      const { data, error } = await admin.from('google_connections')
        .insert({ ...fila, color: colores[est.account_type] ?? '#0D5C63' })
        .select('id').maybeSingle();
      if (error || !data) throw new ErrorNexo('error_bd', 'No se pudo guardar la conexión.', 500);
      connectionId = data.id;
    }

    await guardarTokens(admin, est.user_id, connectionId, tokens);

    /* Estado inicial de cursores para cada servicio autorizado. */
    const desde = new Date(Date.now() - 30 * 86400000).toISOString();
    for (const s of ['gmail', 'calendar', 'drive'] as const) {
      const activo = s === 'gmail' ? fila.gmail_enabled : s === 'calendar' ? fila.calendar_enabled : fila.drive_enabled;
      if (!activo) continue;
      await admin.from('google_sync_state').upsert({
        user_id: est.user_id, connection_id: connectionId, service: s,
        window_start: desde, full_done: false, fail_count: 0,
      }, { onConflict: 'user_id,connection_id,service' });
    }

    const faltantes = (est.services as string[]).filter((s) =>
      (s === 'gmail' && !tieneGmail) || (s === 'calendar' && !tieneCal) || (s === 'drive' && !tieneDrive));

    return pagina(
      true,
      'Cuenta conectada',
      `${perfil.email} quedó conectada a Nexo.`,
      { connection_id: connectionId, email: perfil.email, tipo: est.account_type },
      faltantes.length
        ? `No otorgaste permiso para: ${faltantes.join(', ')}. Puedes agregarlo después desde Configuración → Cuentas conectadas.`
        : '',
    );
  } catch (e) {
    const err = e instanceof ErrorNexo
      ? e
      : new ErrorNexo('error_interno', 'Algo falló al conectar la cuenta.', 500);
    /* Se registra el código, nunca el token ni el código de autorización. */
    console.error('Callback OAuth:', err.codigo);
    return pagina(false, 'No se pudo conectar', err.message, { error: err.codigo }, err.ayuda ?? '');
  }
});
