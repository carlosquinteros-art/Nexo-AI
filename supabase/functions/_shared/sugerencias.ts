/**
 * Propuestas de tareas a partir de lo detectado.
 *
 * Nexo NO crea tareas solo. Escribe una fila en `suggested_actions` con estado
 * `pending` y ahí se queda hasta que tú la aceptes o la descartes desde la
 * aplicación.
 *
 * Contra los duplicados: `dedupe_key` es única por usuario y se arma con el
 * origen y el tipo de sugerencia. Reprocesar el mismo correo cien veces deja
 * una sola fila, y si ya la aceptaste o la descartaste, no vuelve a aparecer.
 *
 * Cada sugerencia guarda por qué se hizo. Si no hay motivo que mostrar, no se
 * propone nada.
 */
import type { SupabaseClient } from 'jsr:@supabase/supabase-js@2';

/* Qué detecciones ameritan proponer algo y con qué texto. */
const PROPUESTAS: Record<string, { kind: string; verbo: string; prioridad: string }> = {
  solicitud:    { kind: 'task',  verbo: 'Responder la solicitud de',      prioridad: 'high' },
  aprobacion:   { kind: 'task',  verbo: 'Revisar y aprobar lo pedido por', prioridad: 'high' },
  documento:    { kind: 'document', verbo: 'Enviar el documento pedido por', prioridad: 'medium' },
  plazo:        { kind: 'deadline', verbo: 'Cumplir el plazo de',          prioridad: 'high' },
  incidencia:   { kind: 'task',  verbo: 'Gestionar la incidencia de',      prioridad: 'urgent' },
  reclamo:      { kind: 'task',  verbo: 'Responder el reclamo de',         prioridad: 'urgent' },
  compromiso:   { kind: 'task',  verbo: 'Cumplir lo que comprometiste con', prioridad: 'high' },
  contrato:     { kind: 'task',  verbo: 'Revisar el contrato o anexo de',  prioridad: 'medium' },
  pago:         { kind: 'task',  verbo: 'Revisar el pago informado por',   prioridad: 'medium' },
  remuneracion: { kind: 'task',  verbo: 'Revisar la remuneración de',      prioridad: 'medium' },
  evaluacion:   { kind: 'deadline', verbo: 'Preparar la evaluación de',    prioridad: 'high' },
  entrega:      { kind: 'deadline', verbo: 'Preparar la entrega de',       prioridad: 'high' },
  lectura:      { kind: 'task',  verbo: 'Hacer la lectura indicada en',    prioridad: 'medium' },
};

/** Identificador estable: mismo origen y mismo tipo, misma llave. */
export function llaveDedupe(origen: string, idExterno: string, tipo: string): string {
  return `${origen}:${idExterno}:${tipo}`;
}

export async function proponerDesdeCorreos(
  admin: SupabaseClient,
  userId: string,
  connectionId: string,
): Promise<number> {
  const { data: mensajes } = await admin.from('google_messages')
    .select('id, external_id, subject, from_name, from_email, sent_at, detected, space, snippet')
    .eq('user_id', userId).eq('connection_id', connectionId)
    .is('deleted_at', null)
    .gte('sent_at', new Date(Date.now() - 30 * 86400000).toISOString())
    .order('sent_at', { ascending: false })
    .limit(200);

  if (!mensajes?.length) return 0;

  const filas: any[] = [];
  for (const m of mensajes) {
    const detecciones = Array.isArray(m.detected) ? m.detected : [];
    if (!detecciones.length) continue;

    /* Una sugerencia por mensaje: la detección más relevante manda. */
    const orden = Object.keys(PROPUESTAS);
    const principal = detecciones
      .filter((d: any) => orden.includes(d.tipo))
      .sort((a: any, b: any) => orden.indexOf(a.tipo) - orden.indexOf(b.tipo))[0];
    if (!principal) continue;

    const plantilla = PROPUESTAS[principal.tipo];
    const quien = m.from_name || m.from_email || 'un remitente';
    const conFecha = detecciones.find((d: any) => d.fecha);

    filas.push({
      user_id: userId,
      dedupe_key: llaveDedupe('message', m.external_id, principal.tipo),
      kind: plantilla.kind,
      status: 'pending',
      source_type: 'message',
      source_id: m.id,
      source_external_id: m.external_id,
      connection_id: connectionId,
      title: `${plantilla.verbo} ${quien}`.slice(0, 250),
      detail: m.subject ?? null,
      reason: principal.etiqueta,
      /* La evidencia es literal: el trozo del correo que lo gatilló. */
      reasons: detecciones.slice(0, 4).map((d: any) => ({
        regla: d.tipo, texto: d.etiqueta, evidencia: d.evidencia,
      })),
      due_at: conFecha?.fecha ?? null,
      space: m.space ?? 'work',
      priority: plantilla.prioridad,
      confidence: conFecha ? 75 : 55,
    });
  }

  if (!filas.length) return 0;

  /* `ignoreDuplicates` es la clave: si la sugerencia ya existe —aunque la
     hayas descartado— no se toca. Nunca reaparece lo que ya decidiste. */
  let creadas = 0;
  for (let i = 0; i < filas.length; i += 50) {
    const { data, error } = await admin.from('suggested_actions')
      .upsert(filas.slice(i, i + 50), { onConflict: 'user_id,dedupe_key', ignoreDuplicates: true })
      .select('id');
    if (error) throw new Error('suggested_actions: ' + error.message);
    creadas += (data ?? []).length;
  }
  return creadas;
}

export async function proponerDesdeEventos(
  admin: SupabaseClient,
  userId: string,
  connectionId: string,
): Promise<number> {
  const ahora = Date.now();
  const { data: eventos } = await admin.from('google_calendar_events')
    .select('id, external_id, title, starts_at, needs_prep, space, location, meeting_link')
    .eq('user_id', userId).eq('connection_id', connectionId)
    .is('deleted_at', null)
    .gte('starts_at', new Date(ahora).toISOString())
    .lte('starts_at', new Date(ahora + 14 * 86400000).toISOString())
    .eq('needs_prep', true)
    .limit(50);

  if (!eventos?.length) return 0;

  const filas = eventos.map((e: any) => ({
    user_id: userId,
    dedupe_key: llaveDedupe('event', e.external_id, 'meeting_prep'),
    kind: 'meeting_prep',
    status: 'pending',
    source_type: 'event',
    source_id: e.id,
    source_external_id: e.external_id,
    connection_id: connectionId,
    title: `Preparar: ${e.title}`.slice(0, 250),
    detail: e.location || e.meeting_link || null,
    reason: 'La descripción del evento pide preparar material',
    reasons: [{ regla: 'evento_sin_preparar', texto: 'La descripción menciona material o preparación previa' }],
    /* La preparación se propone para el día anterior, nunca después. */
    due_at: new Date(new Date(e.starts_at).getTime() - 86400000).toISOString(),
    space: e.space ?? 'work',
    priority: 'medium',
    confidence: 60,
  }));

  const { data, error } = await admin.from('suggested_actions')
    .upsert(filas, { onConflict: 'user_id,dedupe_key', ignoreDuplicates: true })
    .select('id');
  if (error) throw new Error('suggested_actions: ' + error.message);
  return (data ?? []).length;
}
