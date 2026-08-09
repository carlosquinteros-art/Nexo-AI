/**
 * Cliente de Supabase.
 *
 * Solo se usan variables públicas (`VITE_*`). La anon key es pública por
 * diseño: la protección real la da Row Level Security en la base de datos.
 * Si alguna vez necesitas `service_role`, va en una Edge Function, jamás aquí.
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../types/database.types';

const url = import.meta.env.VITE_SUPABASE_URL;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!url || !anonKey) {
  throw new Error(
    'Faltan VITE_SUPABASE_URL o VITE_SUPABASE_ANON_KEY. ' +
      'Copia `.env.example` como `.env.local` y completa los valores.'
  );
}

// Salvaguarda: nunca aceptar una service_role en el navegador.
if (/service_role/i.test(anonKey)) {
  throw new Error('Se detectó una clave service_role en el frontend. Usa la anon key pública.');
}

export const supabase: SupabaseClient<Database> = createClient<Database>(url, anonKey, {
  auth: {
    persistSession: true,      // sesión persistente en localStorage
    autoRefreshToken: true,    // renueva el token antes de que expire
    detectSessionInUrl: true,  // procesa el enlace de confirmación / recuperación
    flowType: 'pkce',          // más seguro para apps de navegador
    storageKey: 'nexo.auth'
  },
  global: { headers: { 'x-application-name': 'nexo' } },
  db: { schema: 'public' }
});

export const AUTH_REDIRECT_URL =
  import.meta.env.VITE_AUTH_REDIRECT_URL ?? `${window.location.origin}/auth/callback`;

export const APP_TIMEZONE = import.meta.env.VITE_DEFAULT_TIMEZONE ?? 'America/Santiago';
export const APP_LOCALE = import.meta.env.VITE_DEFAULT_LOCALE ?? 'es-CL';
