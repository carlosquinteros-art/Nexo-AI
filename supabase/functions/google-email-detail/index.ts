/**
 * google-email-detail
 *
 * Trae el contenido de UN correo, en el momento en que lo pides, y no lo
 * guarda en ninguna parte. Es la alternativa a archivar cuerpos de mensajes en
 * la base de datos: si quieres leerlo dentro de Nexo, se pide, se muestra y se
 * olvida.
 *
 * Requiere que la cuenta haya sido conectada con el permiso `gmail.readonly`.
 * Con el permiso mínimo (`gmail.metadata`) el cuerpo ni siquiera viaja, y en
 * ese caso se responde con una explicación y el enlace para abrirlo en Gmail.
 *
 * Solo lectura: esta función no marca como leído, no responde y no borra.
 *
 * Entrada: { connection_id, external_id }
 */
import { preflight, json, responderError, ErrorNexo } from '../_shared/cors.ts';
import { clienteAdmin, usuarioDeLaPeticion, conexionDelUsuario } from '../_shared/supabase.ts';
import { apiGoogle } from '../_shared/google.ts';

const API = 'https://gmail.googleapis.com/gmail/v1/users/me';
const MAX_CUERPO = 20000;   // suficiente para leer, sin volcar hilos enteros

function deBase64Url(s: string): string {
  try {
    const b = s.replace(/-/g, '+').replace(/_/g, '/');
    const bin = atob(b + '='.repeat((4 - (b.length % 4)) % 4));
    return new TextDecoder('utf-8').decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
  } catch { return ''; }
}

/** Busca la parte de texto plano; si no hay, cae al HTML limpiado. */
function extraerCuerpo(payload: any): { texto: string; formato: string } {
  const pila = [payload];
  let html = '';
  while (pila.length) {
    const p = pila.shift();
    if (!p) continue;
    const tipo = p.mimeType ?? '';
    const datos = p.body?.data;
    if (datos && tipo === 'text/plain') return { texto: deBase64Url(datos).slice(0, MAX_CUERPO), formato: 'texto' };
    if (datos && tipo === 'text/html' && !html) html = deBase64Url(datos);
    if (Array.isArray(p.parts)) pila.push(...p.parts);
  }
  if (html) {
    const limpio = html
      .replace(/<style[\s\S]*?<\/style>/gi, '')
      .replace(/<script[\s\S]*?<\/script>/gi, '')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/p>/gi, '\n\n')
      .replace(/<[^>]+>/g, '')
      .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
    return { texto: limpio.slice(0, MAX_CUERPO), formato: 'html-limpiado' };
  }
  return { texto: '', formato: 'sin-cuerpo' };
}

Deno.serve(async (req) => {
  const pre = preflight(req);
  if (pre) return pre;

  try {
    if (req.method !== 'POST') throw new ErrorNexo('metodo', 'Usa POST.', 405);

    const usuario = await usuarioDeLaPeticion(req);
    const { connection_id, external_id } = await req.json().catch(() => ({}));
    if (!connection_id || !external_id) {
      throw new ErrorNexo('faltan_datos', 'Indica la cuenta y el mensaje.', 400);
    }

    const admin = clienteAdmin();
    const conexion = await conexionDelUsuario(admin, usuario.id, connection_id);

    /* El mensaje tiene que ser uno que ya sincronizamos para esta cuenta:
       así nadie puede pedir un id arbitrario de otra bandeja. */
    const { data: guardado } = await admin.from('google_messages')
      .select('id, subject, from_email, from_name, sent_at, web_link, snippet')
      .eq('user_id', usuario.id).eq('connection_id', connection_id)
      .eq('external_id', external_id).is('deleted_at', null).maybeSingle();
    if (!guardado) throw new ErrorNexo('mensaje_no_encontrado', 'Ese correo no está en Nexo.', 404);

    const puedeLeerCuerpo = (conexion.scopes ?? []).some((s: string) => s.includes('gmail.readonly'));
    if (!puedeLeerCuerpo) {
      return json(req, {
        ok: true,
        cuerpo_disponible: false,
        motivo: 'permiso_minimo',
        mensaje: 'Esta cuenta está conectada con el permiso mínimo, que da acceso al asunto y al remitente pero no al ' +
          'contenido. Puedes abrir el correo en Gmail, o volver a conectar la cuenta autorizando la lectura completa.',
        ...guardado,
      });
    }

    const url = new URL(`${API}/messages/${encodeURIComponent(external_id)}`);
    url.searchParams.set('format', 'full');
    const m = await apiGoogle(admin, usuario.id, connection_id, url.toString());

    const cuerpo = extraerCuerpo(m.payload);
    const adjuntos = [];
    const pila = [m.payload];
    while (pila.length) {
      const p: any = pila.shift();
      if (!p) continue;
      if (p.filename) adjuntos.push({ nombre: p.filename, tipo: p.mimeType, bytes: p.body?.size ?? null });
      if (Array.isArray(p.parts)) pila.push(...p.parts);
    }

    /* Se devuelve, no se archiva: no hay ningún insert acá. */
    return json(req, {
      ok: true,
      cuerpo_disponible: true,
      ...guardado,
      cuerpo: cuerpo.texto,
      formato: cuerpo.formato,
      truncado: cuerpo.texto.length >= MAX_CUERPO,
      adjuntos: adjuntos.slice(0, 20),
      aviso: 'Este contenido se pidió en el momento y no queda guardado en Nexo.',
    });
  } catch (e) {
    return responderError(req, e);
  }
});
