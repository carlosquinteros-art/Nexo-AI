/**
 * Autenticación y perfil.
 *
 * Cubre registro, inicio y cierre de sesión, recuperación y cambio de
 * contraseña, sesión persistente y edición del perfil y las preferencias.
 */
import type { Session, User } from '@supabase/supabase-js';
import { supabase, AUTH_REDIRECT_URL } from '../lib/supabase';
import { traducirError, NexoError, ejecutar } from '../lib/errors';
import { validarCredenciales, validar, reglas } from '../lib/validation';
import type { Profile, ProfileUpdate, UserSettings, UserSettingsUpdate } from '../types/database.types';

export interface DatosRegistro {
  email: string;
  password: string;
  fullName: string;
}

export const authService = {
  /* ------------------------------------------------------------- Sesión --- */
  async sesionActual(): Promise<Session | null> {
    const { data, error } = await supabase.auth.getSession();
    if (error) throw traducirError(error, 'recuperar la sesión');
    return data.session;
  },

  async usuarioActual(): Promise<User | null> {
    const { data } = await supabase.auth.getUser();
    return data.user ?? null;
  },

  /** Se dispara en login, logout, refresco de token y recuperación de clave. */
  alCambiarSesion(callback: (session: Session | null, evento: string) => void) {
    const { data } = supabase.auth.onAuthStateChange((evento, session) => callback(session, evento));
    return () => data.subscription.unsubscribe();
  },

  /* ------------------------------------------------------------ Registro -- */
  async registrar({ email, password, fullName }: DatosRegistro): Promise<{ user: User | null; requiereConfirmacion: boolean }> {
    validarCredenciales(email, password);
    validar({ fullName: reglas.requerido(fullName, 'El nombre') ?? reglas.largo(fullName, 2, 120, 'El nombre') });

    const { data, error } = await supabase.auth.signUp({
      email: email.trim().toLowerCase(),
      password,
      options: { data: { full_name: fullName.trim() }, emailRedirectTo: AUTH_REDIRECT_URL }
    });
    if (error) throw traducirError(error, 'crear la cuenta');

    // Si el proyecto exige confirmar el correo, no viene sesión todavía.
    return { user: data.user, requiereConfirmacion: !data.session };
  },

  /* --------------------------------------------------------- Inicio/cierre */
  async iniciarSesion(email: string, password: string): Promise<Session> {
    validar({ email: reglas.requerido(email, 'El correo') ?? reglas.email(email), password: reglas.requerido(password, 'La contraseña') });
    const { data, error } = await supabase.auth.signInWithPassword({ email: email.trim().toLowerCase(), password });
    if (error) throw traducirError(error, 'iniciar sesión');
    if (!data.session) throw new NexoError('No se pudo iniciar la sesión.', 'auth');
    return data.session;
  },

  async cerrarSesion(): Promise<void> {
    const { error } = await supabase.auth.signOut();
    if (error) throw traducirError(error, 'cerrar sesión');
  },

  /* --------------------------------------------------- Recuperar contraseña */
  /** Envía el correo con el enlace de recuperación. */
  async solicitarRecuperacion(email: string): Promise<void> {
    validar({ email: reglas.requerido(email, 'El correo') ?? reglas.email(email) });
    const { error } = await supabase.auth.resetPasswordForEmail(email.trim().toLowerCase(), {
      redirectTo: `${AUTH_REDIRECT_URL}?modo=recuperar`
    });
    if (error) throw traducirError(error, 'enviar el correo de recuperación');
  },

  /**
   * Define la nueva contraseña. Solo funciona con la sesión temporal que crea
   * el enlace del correo (evento PASSWORD_RECOVERY) o con sesión iniciada.
   */
  async definirContrasena(nueva: string): Promise<void> {
    validar({ password: reglas.contrasena(nueva) });
    const { error } = await supabase.auth.updateUser({ password: nueva });
    if (error) throw traducirError(error, 'actualizar la contraseña');
  },

  /** Cambio de contraseña desde Configuración: revalida la actual primero. */
  async cambiarContrasena(actual: string, nueva: string): Promise<void> {
    const user = await this.usuarioActual();
    if (!user?.email) throw new NexoError('No hay una sesión activa.', 'unauthenticated');
    validar({ password: reglas.contrasena(nueva) });
    const { error: errVerif } = await supabase.auth.signInWithPassword({ email: user.email, password: actual });
    if (errVerif) throw new NexoError('La contraseña actual no es correcta.', 'auth');
    await this.definirContrasena(nueva);
  },

  async reenviarConfirmacion(email: string): Promise<void> {
    const { error } = await supabase.auth.resend({
      type: 'signup',
      email: email.trim().toLowerCase(),
      options: { emailRedirectTo: AUTH_REDIRECT_URL }
    });
    if (error) throw traducirError(error, 'reenviar el correo de confirmación');
  },

  /* -------------------------------------------------------------- Perfil -- */
  async obtenerPerfil(userId: string): Promise<Profile> {
    return (await ejecutar(
      supabase.from('profiles').select('*').eq('id', userId).single(),
      'cargar tu perfil'
    )) as Profile;
  },

  async actualizarPerfil(userId: string, cambios: ProfileUpdate): Promise<Profile> {
    if (cambios.full_name !== undefined) {
      validar({ full_name: reglas.requerido(cambios.full_name, 'El nombre') ?? reglas.largo(cambios.full_name, 2, 120, 'El nombre') });
    }
    return (await ejecutar(
      supabase.from('profiles').update(cambios).eq('id', userId).select().single(),
      'guardar tu perfil'
    )) as Profile;
  },

  async obtenerPreferencias(userId: string): Promise<UserSettings> {
    return (await ejecutar(
      supabase.from('user_settings').select('*').eq('user_id', userId).single(),
      'cargar tus preferencias'
    )) as UserSettings;
  },

  async actualizarPreferencias(userId: string, cambios: UserSettingsUpdate): Promise<UserSettings> {
    if (cambios.pass_grade !== undefined) validar({ pass_grade: reglas.rango(cambios.pass_grade, 1, 7, 'La nota de aprobación') });
    return (await ejecutar(
      supabase.from('user_settings').update(cambios).eq('user_id', userId).select().single(),
      'guardar tus preferencias'
    )) as UserSettings;
  },

  /* ---------------------------------------------------------- Utilidades -- */
  /** Carga los datos de ejemplo en la cuenta actual (función del servidor). */
  async cargarDatosDemo(): Promise<string> {
    const { data, error } = await supabase.rpc('seed_demo_data');
    if (error) throw traducirError(error, 'cargar los datos de ejemplo');
    return data as string;
  },

  /** Vacía la cuenta sin borrarla. */
  async vaciarCuenta(): Promise<string> {
    const { data, error } = await supabase.rpc('wipe_my_data');
    if (error) throw traducirError(error, 'vaciar la cuenta');
    return data as string;
  }
};
