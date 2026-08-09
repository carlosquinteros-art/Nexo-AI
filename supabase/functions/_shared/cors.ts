/**
 * Cabeceras compartidas.
 *
 * `ORIGENES_PERMITIDOS` se lee de los secretos, separado por comas. Si no está
 * definido se cae a los orígenes conocidos de Nexo. Nunca se responde `*`
 * cuando hay credenciales de por medio.
 */
const PORDEFECTO = [
  'https://nexo-asistente.pages.dev',
  'http://localhost:5173',
  'http://127.0.0.1:5173',
];

function permitidos(): string[] {
  const s = Deno.env.get('ORIGENES_PERMITIDOS');
  if (!s) return PORDEFECTO;
  return s.split(',').map((x) => x.trim()).filter(Boolean);
}

export function cors(req: Request): Record<string, string> {
  const origen = req.headers.get('origin') || '';
  const lista = permitidos();
  const ok = lista.includes(origen);
  return {
    'Access-Control-Allow-Origin': ok ? origen : lista[0],
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
    'Access-Control-Max-Age': '86400',
    'Vary': 'Origin',
  };
}

export function json(req: Request, cuerpo: unknown, status = 200): Response {
  return new Response(JSON.stringify(cuerpo), {
    status,
    headers: { ...cors(req), 'Content-Type': 'application/json; charset=utf-8' },
  });
}

export function preflight(req: Request): Response | null {
  if (req.method !== 'OPTIONS') return null;
  return new Response('ok', { headers: cors(req) });
}

/**
 * Error entendible para la persona, sin filtrar detalles internos.
 * `codigo` es lo que la interfaz usa para decidir qué mensaje mostrar.
 */
export class ErrorNexo extends Error {
  constructor(
    public codigo: string,
    mensaje: string,
    public status = 400,
    public ayuda?: string,
  ) {
    super(mensaje);
  }
}

export function responderError(req: Request, e: unknown): Response {
  if (e instanceof ErrorNexo) {
    return json(req, { error: e.codigo, mensaje: e.message, ayuda: e.ayuda }, e.status);
  }
  console.error('Error no controlado:', e instanceof Error ? e.message : String(e));
  return json(req, {
    error: 'error_interno',
    mensaje: 'Algo falló en el servidor. Vuelve a intentarlo en un momento.',
  }, 500);
}
