/**
 * Cifrado de los tokens de Google.
 *
 * AES-GCM de 256 bits con un vector de inicialización distinto en cada
 * escritura. La llave sale de `GOOGLE_TOKEN_ENCRYPTION_KEY`, que vive solo en
 * los secretos de Supabase: no está en el repositorio, no está en la base de
 * datos y no llega jamás al navegador.
 *
 * Aunque alguien lograra leer la tabla `private.google_tokens` —cosa que
 * PostgREST no permite— vería base64 sin sentido.
 *
 * Para generar la llave:
 *   openssl rand -base64 32
 */
import { ErrorNexo } from './cors.ts';

let llaveCache: CryptoKey | null = null;

async function llave(): Promise<CryptoKey> {
  if (llaveCache) return llaveCache;
  const bruta = Deno.env.get('GOOGLE_TOKEN_ENCRYPTION_KEY');
  if (!bruta) {
    throw new ErrorNexo(
      'falta_llave',
      'Falta configurar la llave de cifrado en el servidor.',
      500,
      'Ejecuta: supabase secrets set GOOGLE_TOKEN_ENCRYPTION_KEY=$(openssl rand -base64 32)',
    );
  }
  let bytes: Uint8Array;
  try {
    bytes = Uint8Array.from(atob(bruta.trim()), (c) => c.charCodeAt(0));
  } catch {
    throw new ErrorNexo('llave_invalida', 'La llave de cifrado no está en base64.', 500);
  }
  if (bytes.length !== 32) {
    throw new ErrorNexo(
      'llave_invalida',
      'La llave de cifrado debe tener 32 bytes.',
      500,
      'Genera una nueva con: openssl rand -base64 32',
    );
  }
  llaveCache = await crypto.subtle.importKey('raw', bytes, 'AES-GCM', false, ['encrypt', 'decrypt']);
  return llaveCache;
}

const b64 = (b: ArrayBuffer) => btoa(String.fromCharCode(...new Uint8Array(b)));
const deB64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

export async function cifrar(texto: string): Promise<{ dato: string; iv: string }> {
  const k = await llave();
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const cifrado = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, k, new TextEncoder().encode(texto));
  return { dato: b64(cifrado), iv: b64(iv.buffer) };
}

export async function descifrar(dato: string | null, iv: string | null): Promise<string | null> {
  if (!dato || !iv) return null;
  const k = await llave();
  try {
    const claro = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: deB64(iv) }, k, deB64(dato));
    return new TextDecoder().decode(claro);
  } catch {
    /* Llave cambiada o dato alterado: se pide reconectar en vez de fallar raro. */
    throw new ErrorNexo(
      'token_ilegible',
      'No se pudo leer el permiso guardado de esta cuenta. Vuelve a conectarla.',
      409,
    );
  }
}

/* --- PKCE ----------------------------------------------------------------
   Aunque el intercambio ocurre en el servidor y con client secret, se usa
   PKCE igual: encarece cualquier intento de reutilizar un código robado. */
function urlSafe(b: ArrayBuffer | Uint8Array): string {
  const u8 = b instanceof Uint8Array ? b : new Uint8Array(b);
  return btoa(String.fromCharCode(...u8)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function nuevoVerificador(): string {
  return urlSafe(crypto.getRandomValues(new Uint8Array(48)));
}

export async function desafioDe(verificador: string): Promise<string> {
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verificador));
  return urlSafe(hash);
}

export function nuevoEstado(): string {
  return urlSafe(crypto.getRandomValues(new Uint8Array(32)));
}

/** Comparación en tiempo constante, para no filtrar información por el reloj. */
export function igualSeguro(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}
