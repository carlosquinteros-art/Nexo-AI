/**
 * google-oauth-start
 *
 * Primer paso del flujo de autorización. NO toca ningún token: solo arma la
 * URL a la que hay que mandar a la persona y deja guardado el estado para
 * poder verificar la vuelta.
 *
 * Qué se protege acá:
 *   · Se exige el JWT de Supabase: sin sesión válida no se genera nada.
 *   · El `state` es aleatorio, se guarda en el esquema privado junto al
 *     `user_id` y caduca en 10 minutos. Así la respuesta de Google no puede
 *     ser reutilizada ni atribuida a otra cuenta.
 *   · Los permisos se piden de forma incremental: solo los servicios que
 *     marcaste en esta pasada.
 *
 * Entrada:  { servicios: ['gmail'|'calendar'|'drive'], tipo, color, cuerpoGmail?, archivosDrive?, connection_id? }
 * Salida:   { url, state }
 */
import { preflight, json, responderError, ErrorNexo } from '../_shared/cors.ts';
import { clienteAdmin, usuarioDeLaPeticion } from '../_shared/supabase.ts';
import { nuevoEstado, nuevoVerificador, desafioDe } from '../_shared/crypto.ts';
import { AUTORIZAR, armarScopes, credenciales } from '../_shared/google.ts';

const TIPOS = ['work', 'university', 'personal'];
const SERVICIOS = ['gmail', 'calendar', 'drive'];

Deno.serve(async (req) => {
  const pre = preflight(req);
  if (pre) return pre;

  try {
    if (req.method !== 'POST') throw new ErrorNexo('metodo', 'Usa POST.', 405);

    const usuario = await usuarioDeLaPeticion(req);
    const cuerpo = await req.json().catch(() => ({}));

    const servicios: string[] = Array.isArray(cuerpo.servicios)
      ? cuerpo.servicios.filter((s: string) => SERVICIOS.includes(s))
      : [];
    if (!servicios.length) {
      throw new ErrorNexo('sin_servicios', 'Elige al menos un servicio: Gmail, Calendar o Drive.', 400);
    }

    const tipo = TIPOS.includes(cuerpo.tipo) ? cuerpo.tipo : 'work';
    const { id, redirect } = credenciales();

    const state = nuevoEstado();
    const verificador = nuevoVerificador();
    const desafio = await desafioDe(verificador);

    const admin = clienteAdmin();
    await admin.schema('private').rpc('limpiar_oauth_states').catch(() => {});
    const { error } = await admin.schema('private').from('google_oauth_states').insert({
      state,
      user_id: usuario.id,
      code_verifier: verificador,
      account_type: tipo,
      services: servicios,
      connection_id: cuerpo.connection_id ?? null,
      redirect_to: typeof cuerpo.volver_a === 'string' ? cuerpo.volver_a.slice(0, 300) : null,
    });
    if (error) throw new ErrorNexo('error_bd', 'No se pudo iniciar la conexión. Inténtalo otra vez.', 500);

    const scopes = armarScopes(servicios, {
      cuerpoGmail: cuerpo.cuerpoGmail === true,
      archivosDrive: cuerpo.archivosDrive === true,
    });

    const url = new URL(AUTORIZAR);
    url.searchParams.set('client_id', id);
    url.searchParams.set('redirect_uri', redirect);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('scope', scopes.join(' '));
    url.searchParams.set('state', state);
    url.searchParams.set('code_challenge', desafio);
    url.searchParams.set('code_challenge_method', 'S256');
    /* `offline` es lo que entrega el refresh token; `consent` obliga a que lo
       vuelva a entregar aunque ya hubieras autorizado antes. */
    url.searchParams.set('access_type', 'offline');
    url.searchParams.set('prompt', 'consent select_account');
    url.searchParams.set('include_granted_scopes', 'true');
    if (typeof cuerpo.sugerir_correo === 'string' && cuerpo.sugerir_correo.includes('@')) {
      url.searchParams.set('login_hint', cuerpo.sugerir_correo);
    }

    return json(req, { url: url.toString(), state, scopes });
  } catch (e) {
    return responderError(req, e);
  }
});
