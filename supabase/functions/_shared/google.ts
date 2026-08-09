/**
 * Todo lo que toca las APIs de Google.
 *
 * Reglas que se cumplen en este archivo, sin excepción:
 *   · Los permisos son de SOLO LECTURA. Aquí no hay ninguna llamada que envíe,
 *     borre o modifique nada en Gmail, Calendar o Drive.
 *   · El `client_secret` solo se usa acá, en el servidor.
 *   · Los reintentos usan espera creciente y respetan `Retry-After`.
 *   · Los errores que se registran nunca incluyen tokens ni contenido.
 */
import type { SupabaseClient } from 'jsr:@supabase/supabase-js@2';
import { ErrorNexo } from './cors.ts';
import { cifrar, descifrar } from './crypto.ts';

/* -------------------------------------------------------------- Permisos -- */
export const SCOPES_BASE = ['openid', 'email', 'profile'];

/**
 * Permisos por servicio, elegidos por ser los mínimos que hacen el trabajo.
 *
 *   gmail.metadata   → remitente, asunto, fecha, etiquetas y estado. NO da
 *                      acceso al cuerpo. Es menos de lo que pide readonly y
 *                      alcanza para priorizar la bandeja.
 *   gmail.readonly   → solo si activas "leer el mensaje dentro de Nexo".
 *   calendar.events.readonly → leer eventos, nada de crear ni modificar.
 *   drive.metadata.readonly  → nombre, tipo, dueño y fecha. No abre archivos.
 *   drive.file       → solo los archivos que TÚ eliges explícitamente.
 */
export const SCOPES: Record<string, string[]> = {
  gmail: ['https://www.googleapis.com/auth/gmail.metadata'],
  gmail_cuerpo: ['https://www.googleapis.com/auth/gmail.readonly'],
  calendar: ['https://www.googleapis.com/auth/calendar.events.readonly'],
  drive: ['https://www.googleapis.com/auth/drive.metadata.readonly'],
  drive_archivos: ['https://www.googleapis.com/auth/drive.file'],
};

export function armarScopes(servicios: string[], opciones?: { cuerpoGmail?: boolean; archivosDrive?: boolean }) {
  const s = new Set(SCOPES_BASE);
  if (servicios.includes('gmail')) {
    (opciones?.cuerpoGmail ? SCOPES.gmail_cuerpo : SCOPES.gmail).forEach((x) => s.add(x));
  }
  if (servicios.includes('calendar')) SCOPES.calendar.forEach((x) => s.add(x));
  if (servicios.includes('drive')) {
    SCOPES.drive.forEach((x) => s.add(x));
    if (opciones?.archivosDrive) SCOPES.drive_archivos.forEach((x) => s.add(x));
  }
  return Array.from(s);
}

/* ------------------------------------------------------------- Endpoints -- */
export const AUTORIZAR = 'https://accounts.google.com/o/oauth2/v2/auth';
export const TOKEN = 'https://oauth2.googleapis.com/token';
export const REVOCAR = 'https://oauth2.googleapis.com/revoke';
export const USERINFO = 'https://openidconnect.googleapis.com/v1/userinfo';

export function credenciales() {
  const id = Deno.env.get('GOOGLE_CLIENT_ID');
  const secreto = Deno.env.get('GOOGLE_CLIENT_SECRET');
  const redirect = Deno.env.get('GOOGLE_REDIRECT_URI');
  if (!id || !secreto || !redirect) {
    throw new ErrorNexo(
      'falta_configuracion',
      'Falta configurar las credenciales de Google en el servidor.',
      500,
      'Revisa GOOGLE_SETUP.md, sección 7: secretos de Supabase.',
    );
  }
  return { id, secreto, redirect };
}

/* --------------------------------------------------- Errores entendibles -- */
/**
 * Traduce lo que responde Google a algo que se pueda leer y actuar.
 * El caso importante es `admin_policy_enforced`: no es un error de Nexo, es el
 * administrador de Google Workspace bloqueando la aplicación.
 */
export function traducirErrorGoogle(estado: number, cuerpo: unknown): ErrorNexo {
  const c = (cuerpo ?? {}) as Record<string, unknown>;
  const err = String(c.error ?? '');
  const desc = String(c.error_description ?? '');
  const detalle = (c.error as Record<string, unknown>) ?? {};
  const mensajeApi = String(detalle.message ?? '');
  const todo = `${err} ${desc} ${mensajeApi}`.toLowerCase();

  if (todo.includes('admin_policy_enforced')) {
    return new ErrorNexo(
      'admin_policy_enforced',
      'El administrador de tu Google Workspace tiene bloqueado el acceso de aplicaciones externas a esta cuenta.',
      403,
      'Pídele que autorice la aplicación en la Consola de Administración de Google → Seguridad → Controles de API → ' +
      'Administrar el acceso de apps de terceros, agregándola como “de confianza” con el ID de cliente de OAuth. ' +
      'Mientras tanto puedes conectar tu cuenta personal o la de la universidad, si esa sí lo permite.',
    );
  }
  if (todo.includes('access_denied')) {
    return new ErrorNexo('acceso_denegado', 'Cancelaste el permiso o Google lo rechazó. No se conectó nada.', 403);
  }
  if (todo.includes('invalid_grant')) {
    return new ErrorNexo(
      'reautorizacion_requerida',
      'Google canceló el permiso de esta cuenta. Hay que volver a conectarla.',
      401,
      'Suele pasar si cambiaste la contraseña, revocaste el acceso desde tu cuenta de Google o pasaron meses sin usarla.',
    );
  }
  if (todo.includes('org_internal') || todo.includes('disallowed_useragent')) {
    return new ErrorNexo('cuenta_no_permitida', 'Esta cuenta no está autorizada para usar la aplicación.', 403,
      'Si la pantalla de consentimiento está en modo “Interna”, solo funcionan las cuentas del mismo dominio.');
  }
  if (estado === 429 || todo.includes('rate') || todo.includes('quota')) {
    return new ErrorNexo('limite_google', 'Google está limitando las consultas. Se reintentará solo en unos minutos.', 429);
  }
  if (estado === 401) {
    return new ErrorNexo('reautorizacion_requerida', 'El permiso de esta cuenta ya no es válido. Vuelve a conectarla.', 401);
  }
  if (estado === 403 && todo.includes('has not been used')) {
    return new ErrorNexo('api_desactivada', 'Falta habilitar esa API en el proyecto de Google Cloud.', 403,
      'Ve a Google Cloud → APIs y servicios → Biblioteca y habilita Gmail API, Calendar API y Drive API.');
  }
  return new ErrorNexo('error_google', 'Google respondió con un error al sincronizar.', estado >= 400 && estado < 600 ? estado : 502);
}

/* --------------------------------------------- Llamadas con reintentos --- */
const dormir = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * `fetch` con espera creciente: 1 s, 2 s, 4 s. Solo reintenta lo que tiene
 * sentido reintentar (límite de cuota o fallo temporal del servidor).
 */
export async function pedirAGoogle(
  url: string,
  init: RequestInit,
  intentos = 3,
): Promise<{ ok: boolean; estado: number; cuerpo: any }> {
  let ultimo: { ok: boolean; estado: number; cuerpo: any } = { ok: false, estado: 0, cuerpo: null };
  for (let i = 0; i < intentos; i++) {
    let r: Response;
    try {
      r = await fetch(url, init);
    } catch {
      ultimo = { ok: false, estado: 0, cuerpo: { error: 'red' } };
      await dormir(1000 * Math.pow(2, i));
      continue;
    }
    let cuerpo: any = null;
    const texto = await r.text();
    try { cuerpo = texto ? JSON.parse(texto) : null; } catch { cuerpo = { raw: texto.slice(0, 200) }; }
    ultimo = { ok: r.ok, estado: r.status, cuerpo };
    if (r.ok) return ultimo;

    const reintentable = r.status === 429 || r.status === 500 || r.status === 502 || r.status === 503;
    if (!reintentable || i === intentos - 1) return ultimo;

    const retryAfter = Number(r.headers.get('retry-after') || 0);
    await dormir(retryAfter > 0 ? retryAfter * 1000 : 1000 * Math.pow(2, i));
  }
  return ultimo;
}

/* ----------------------------------------------------- Tokens de acceso -- */
export interface TokensGoogle {
  access_token: string;
  refresh_token?: string;
  expires_in?: number;
  scope?: string;
  token_type?: string;
  id_token?: string;
}

export async function canjearCodigo(codigo: string, verificador: string): Promise<TokensGoogle> {
  const { id, secreto, redirect } = credenciales();
  const cuerpo = new URLSearchParams({
    code: codigo,
    client_id: id,
    client_secret: secreto,      // solo aquí, en el servidor
    redirect_uri: redirect,
    grant_type: 'authorization_code',
    code_verifier: verificador,
  });
  const r = await pedirAGoogle(TOKEN, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: cuerpo.toString(),
  });
  if (!r.ok) throw traducirErrorGoogle(r.estado, r.cuerpo);
  return r.cuerpo as TokensGoogle;
}

export async function refrescar(refreshToken: string): Promise<TokensGoogle> {
  const { id, secreto } = credenciales();
  const cuerpo = new URLSearchParams({
    refresh_token: refreshToken,
    client_id: id,
    client_secret: secreto,
    grant_type: 'refresh_token',
  });
  const r = await pedirAGoogle(TOKEN, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: cuerpo.toString(),
  });
  if (!r.ok) throw traducirErrorGoogle(r.estado, r.cuerpo);
  return r.cuerpo as TokensGoogle;
}

export async function revocar(token: string): Promise<boolean> {
  const r = await pedirAGoogle(`${REVOCAR}?token=${encodeURIComponent(token)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  }, 1);
  /* Si ya estaba revocado, Google devuelve 400: para nosotros es éxito igual. */
  return r.ok || r.estado === 400;
}

export async function guardarTokens(
  admin: SupabaseClient,
  userId: string,
  connectionId: string,
  t: TokensGoogle,
  refreshPrevio?: string | null,
) {
  const acceso = await cifrar(t.access_token);
  /* Google solo manda el refresh token la primera vez: si no viene, se conserva. */
  const refresh = t.refresh_token
    ? await cifrar(t.refresh_token)
    : (refreshPrevio ? await cifrar(refreshPrevio) : null);

  const expira = new Date(Date.now() + ((t.expires_in ?? 3600) - 60) * 1000).toISOString();

  await admin.schema('private').from('google_tokens').upsert({
    connection_id: connectionId,
    user_id: userId,
    access_token_enc: acceso.dato,
    access_token_iv: acceso.iv,
    refresh_token_enc: refresh ? refresh.dato : null,
    refresh_token_iv: refresh ? refresh.iv : null,
    token_type: t.token_type ?? 'Bearer',
    scope: t.scope ?? null,
    expires_at: expira,
    updated_at: new Date().toISOString(),
  });

  await admin.from('google_connections')
    .update({ token_expires_at: expira })
    .eq('id', connectionId).eq('user_id', userId);
}

/**
 * Devuelve un access token válido, refrescándolo si hace falta.
 * Si Google ya no acepta el refresh token, marca la conexión como
 * "Reconexión requerida" en vez de fallar en silencio.
 */
export async function tokenVigente(
  admin: SupabaseClient,
  userId: string,
  connectionId: string,
): Promise<string> {
  const { data, error } = await admin.schema('private').from('google_tokens')
    .select('*').eq('connection_id', connectionId).eq('user_id', userId).maybeSingle();
  if (error || !data) {
    throw new ErrorNexo('sin_token', 'Esta cuenta no tiene un permiso guardado. Vuelve a conectarla.', 409);
  }

  const vence = data.expires_at ? new Date(data.expires_at).getTime() : 0;
  if (vence > Date.now() + 30000) {
    const t = await descifrar(data.access_token_enc, data.access_token_iv);
    if (t) return t;
  }

  const refresh = await descifrar(data.refresh_token_enc, data.refresh_token_iv);
  if (!refresh) {
    await marcarReconexion(admin, userId, connectionId, 'sin_refresh_token',
      'Google no entregó un permiso renovable. Vuelve a conectar la cuenta.');
    throw new ErrorNexo('reautorizacion_requerida', 'Vuelve a conectar esta cuenta de Google.', 401);
  }

  try {
    const nuevos = await refrescar(refresh);
    await guardarTokens(admin, userId, connectionId, nuevos, refresh);
    return nuevos.access_token;
  } catch (e) {
    const err = e instanceof ErrorNexo ? e : new ErrorNexo('error_google', 'No se pudo renovar el permiso.', 401);
    await marcarReconexion(admin, userId, connectionId, err.codigo, err.message);
    throw err;
  }
}

export async function marcarReconexion(
  admin: SupabaseClient,
  userId: string,
  connectionId: string,
  codigo: string,
  mensaje: string,
) {
  await admin.from('google_connections').update({
    status: codigo === 'admin_policy_enforced' ? 'error' : 'reauth_required',
    last_error_code: codigo,
    last_error: String(mensaje).slice(0, 400),
  }).eq('id', connectionId).eq('user_id', userId);
}

/** Llamada autenticada a una API de Google, con renovación automática. */
export async function apiGoogle(
  admin: SupabaseClient,
  userId: string,
  connectionId: string,
  url: string,
): Promise<any> {
  const token = await tokenVigente(admin, userId, connectionId);
  const r = await pedirAGoogle(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!r.ok) {
    const err = traducirErrorGoogle(r.estado, r.cuerpo);
    if (err.codigo === 'reautorizacion_requerida' || err.codigo === 'admin_policy_enforced') {
      await marcarReconexion(admin, userId, connectionId, err.codigo, err.message);
    }
    throw err;
  }
  return r.cuerpo;
}

export async function perfilDe(accessToken: string) {
  const r = await pedirAGoogle(USERINFO, { headers: { Authorization: `Bearer ${accessToken}` } });
  if (!r.ok) throw traducirErrorGoogle(r.estado, r.cuerpo);
  return r.cuerpo as { sub: string; email: string; name?: string; picture?: string; hd?: string };
}
