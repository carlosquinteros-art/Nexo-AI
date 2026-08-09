/**
 * Edge Function `nexo-ai`
 * --------------------------------------------------------------------------
 * Interpreta una instrucción en lenguaje natural y devuelve el MISMO contrato
 * JSON que produce el motor de reglas del cliente. Así la interfaz y la
 * ejecución no cambian: solo mejora la comprensión.
 *
 * POR QUÉ EXISTE ESTA FUNCIÓN
 *   La API key del modelo vive aquí, en el servidor, como secreto de Supabase.
 *   El navegador nunca la ve. El frontend solo llama a esta función con el
 *   token de sesión del usuario.
 *
 * DESPLIEGUE
 *   supabase functions deploy nexo-ai
 *   supabase secrets set ANTHROPIC_API_KEY=sk-ant-...
 *
 * PRUEBA
 *   supabase functions invoke nexo-ai --body '{"texto":"reunión con Luau el miércoles a las 15:00"}'
 *
 * SI NO ESTÁ DESPLEGADA, la app sigue funcionando con reglas locales.
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const INTENCIONES = [
  'crear_tarea', 'crear_reunion', 'crear_recordatorio', 'crear_evaluacion', 'crear_sesion_estudio',
  'registrar_nota', 'registrar_apunte_juridico', 'registrar_lectura', 'registrar_calificacion',
  'registrar_fuente_juridica', 'crear_ficha_caso', 'registrar_novedad_persona',
  'consultar_pendientes', 'consultar_agenda', 'consultar_evaluaciones',
  'calcular', 'generar_mensaje', 'generar_preguntas', 'crear_plan_estudio'
] as const;

const CORS = {
  'Access-Control-Allow-Origin': Deno.env.get('ALLOWED_ORIGIN') ?? '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS'
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });

/** Instrucciones del sistema. Las reglas del producto son innegociables. */
function promptSistema(contexto: Record<string, unknown>): string {
  return `Eres el motor de interpretación de Nexo, la app personal de Carlos: coordinador de Trade Marketing en Chile y estudiante de Derecho.

Tu ÚNICA salida es un objeto JSON válido. Sin texto antes ni después, sin markdown.

REGLAS INNEGOCIABLES
1. No inventes NUNCA marcas, personas, asignaturas, tiendas, profesores, leyes, artículos, sentencias, roles ni doctrina. Si algo no está en el contexto, deja el campo vacío y formula una pregunta breve en "pregunta".
2. Todo contenido jurídico se guarda como NO verificado. Nunca afirmes que una norma o fallo dice algo. Si el usuario pide información legal, indica que debe verificarla en BCN (bcn.cl/leychile), el Poder Judicial (pjud.cl) o el Diario Oficial. Esto es material de estudio, no asesoría legal.
3. Conserva el texto del usuario tal cual cuando se trate de apuntes, definiciones o resúmenes. No lo reescribas.
4. Nunca envíes correos ni mensajes: solo redactas borradores para que el usuario los revise.
5. Zona horaria America/Santiago. Hoy es ${contexto.hoy}. Resuelve fechas relativas (mañana, el próximo viernes, en dos semanas) a formato AAAA-MM-DD.
6. Si la instrucción es ambigua o falta un dato esencial, NO adivines: usa "faltantes" y "pregunta".

INTENCIONES VÁLIDAS
${INTENCIONES.join(', ')}

CONTEXTO DEL USUARIO (los únicos ids que puedes usar)
${JSON.stringify(contexto, null, 1)}

FORMATO DE SALIDA
{
  "intencion": "<una de las intenciones>",
  "espacio": "trabajo" | "universidad" | "personal",
  "confianza": 0.0-1.0,
  "titulo": "<etiqueta corta de la acción>",
  "resumen": "<qué va a pasar, en una frase>",
  "entidades": {
    "marca_id": null, "asignatura_id": null, "persona_id": null, "tienda_id": null,
    "fecha": null, "hora": null, "prioridad": null, "responsable": null,
    "tipo_evaluacion": null, "ponderacion": null, "paginas": null,
    "duracion_min": null, "tema": null, "descripcion": null
  },
  "campos": [ { "k": "titulo", "etiqueta": "Título", "valor": "...", "tipo": "texto|textarea|fecha|hora|numero|select|check", "requerido": true } ],
  "faltantes": ["fecha"],
  "pregunta": { "texto": "¿Qué día?", "opciones": [ { "etiqueta": "Mañana", "texto": "<frase completa reformulada>" } ] } | null,
  "avisos": ["verificacion_juridica"],
  "requiereConfirmacion": true
}

Para las intenciones de consulta y de cálculo usa "requiereConfirmacion": false y agrega
"respuesta": { "texto": "...", "detalle": ["..."] }. Si la respuesta depende de datos que no
tienes, devuelve la intención igual y deja que el cliente la resuelva con sus datos locales.`;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json({ error: 'Método no permitido' }, 405);

  try {
    /* ---- 1. Autenticación: solo usuarios con sesión válida ---------------- */
    const authHeader = req.headers.get('Authorization') ?? '';
    if (!authHeader.startsWith('Bearer ')) return json({ error: 'Falta el token de sesión.' }, 401);

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
      { global: { headers: { Authorization: authHeader } } }
    );
    const { data: { user }, error: errUser } = await supabase.auth.getUser();
    if (errUser || !user) return json({ error: 'Sesión inválida.' }, 401);

    /* ---- 2. Validación de la entrada ------------------------------------- */
    const body = await req.json().catch(() => null);
    const texto = String(body?.texto ?? '').trim();
    if (!texto) return json({ error: 'Falta el texto a interpretar.' }, 400);
    if (texto.length > 2000) return json({ error: 'El texto es demasiado largo.' }, 400);

    const contexto = body?.contexto ?? {};

    /* ---- 3. Límite de uso por usuario (60 llamadas por hora) -------------- */
    const haceUnaHora = new Date(Date.now() - 3600_000).toISOString();
    const { count } = await supabase
      .from('activity_log')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', user.id)
      .eq('entity_type', 'note')
      .eq('summary', 'nexo-ai')
      .gte('created_at', haceUnaHora);
    if ((count ?? 0) >= 60) {
      return json({ error: 'Alcanzaste el límite de interpretaciones por hora. El asistente sigue funcionando con reglas locales.' }, 429);
    }

    /* ---- 4. Llamada al modelo. La clave nunca sale del servidor ----------- */
    const apiKey = Deno.env.get('ANTHROPIC_API_KEY');
    if (!apiKey) {
      return json({ error: 'IA no configurada en el servidor. Se usarán reglas locales.', codigo: 'IA_NO_CONFIGURADA' }, 503);
    }

    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: Deno.env.get('NEXO_AI_MODEL') ?? 'claude-sonnet-5',
        max_tokens: 1500,
        temperature: 0,
        system: promptSistema(contexto),
        messages: [{ role: 'user', content: texto }]
      })
    });

    if (!r.ok) {
      const detalle = await r.text();
      console.error('Error del proveedor de IA:', r.status, detalle.slice(0, 500));
      return json({ error: 'El servicio de IA no respondió. Se usarán reglas locales.', codigo: 'IA_ERROR' }, 502);
    }

    const data = await r.json();
    const crudo = (data?.content ?? []).map((c: { text?: string }) => c.text ?? '').join('').trim();

    /* ---- 5. Validación de la salida antes de devolverla ------------------- */
    let propuesta: Record<string, unknown>;
    try {
      propuesta = JSON.parse(crudo.replace(/^```json\s*/i, '').replace(/```$/i, '').trim());
    } catch {
      console.error('La IA no devolvió JSON válido:', crudo.slice(0, 300));
      return json({ error: 'Respuesta no interpretable. Se usarán reglas locales.', codigo: 'IA_FORMATO' }, 502);
    }

    if (!INTENCIONES.includes(propuesta.intencion as typeof INTENCIONES[number])) {
      return json({ error: 'Intención desconocida. Se usarán reglas locales.', codigo: 'IA_INTENCION' }, 502);
    }

    /* Refuerzo de las reglas del producto por si el modelo las relajó. */
    const juridicas = ['registrar_fuente_juridica', 'registrar_apunte_juridico', 'crear_ficha_caso', 'generar_preguntas'];
    const avisos = new Set<string>(Array.isArray(propuesta.avisos) ? propuesta.avisos as string[] : []);
    if (juridicas.includes(propuesta.intencion as string)) {
      avisos.add('verificacion_juridica');
      if (propuesta.intencion === 'registrar_fuente_juridica') avisos.add('sin_verificar');
    }
    if (propuesta.intencion === 'registrar_novedad_persona') avisos.add('datos_minimos');

    /* Los ids deben existir en el contexto: si no, se descartan. */
    const idsValidos = (clave: string) =>
      new Set((((contexto as Record<string, Array<{ id: string }>>)[clave]) ?? []).map((x) => x.id));
    const ent = (propuesta.entidades ?? {}) as Record<string, unknown>;
    const limpiar = (campo: string, clave: string) => {
      if (ent[campo] && !idsValidos(clave).has(String(ent[campo]))) ent[campo] = null;
    };
    limpiar('marca_id', 'marcas');
    limpiar('asignatura_id', 'asignaturas');
    limpiar('persona_id', 'personas');
    limpiar('tienda_id', 'tiendas');

    /* Deja huella del uso para el límite por hora. */
    await supabase.from('activity_log').insert({
      user_id: user.id, entity_type: 'note', entity_id: user.id,
      action: 'create', summary: 'nexo-ai'
    });

    return json({
      ...propuesta,
      entidades: ent,
      avisos: [...avisos],
      origen: 'ia',
      version: 1,
      requiereConfirmacion: propuesta.requiereConfirmacion !== false
    });
  } catch (e) {
    console.error(e);
    return json({ error: 'Error inesperado en el servidor.', codigo: 'IA_EXCEPCION' }, 500);
  }
});
