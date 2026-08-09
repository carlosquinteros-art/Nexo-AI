/**
 * Contexto de autenticación.
 *
 * Mantiene sesión, perfil y preferencias sincronizados, y expone las acciones
 * de registro, inicio y cierre de sesión, recuperación y cambio de contraseña.
 * La sesión persiste sola: supabase-js la guarda y refresca el token.
 */
import {
  createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode
} from 'react';
import type { Session, User } from '@supabase/supabase-js';
import { authService, type DatosRegistro } from '../services/auth.service';
import { traducirError, NexoError } from '../lib/errors';
import type { Profile, UserSettings, ProfileUpdate, UserSettingsUpdate } from '../types/database.types';

interface EstadoAuth {
  cargando: boolean;
  session: Session | null;
  user: User | null;
  perfil: Profile | null;
  preferencias: UserSettings | null;
  error: NexoError | null;
  /** true cuando el usuario llegó desde el enlace de recuperación de contraseña */
  recuperandoContrasena: boolean;
}

interface ContextoAuth extends EstadoAuth {
  autenticado: boolean;
  registrar: (datos: DatosRegistro) => Promise<{ requiereConfirmacion: boolean }>;
  iniciarSesion: (email: string, password: string) => Promise<void>;
  cerrarSesion: () => Promise<void>;
  solicitarRecuperacion: (email: string) => Promise<void>;
  definirContrasena: (nueva: string) => Promise<void>;
  cambiarContrasena: (actual: string, nueva: string) => Promise<void>;
  reenviarConfirmacion: (email: string) => Promise<void>;
  guardarPerfil: (cambios: ProfileUpdate) => Promise<void>;
  guardarPreferencias: (cambios: UserSettingsUpdate) => Promise<void>;
  recargar: () => Promise<void>;
  limpiarError: () => void;
}

const Ctx = createContext<ContextoAuth | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [estado, setEstado] = useState<EstadoAuth>({
    cargando: true, session: null, user: null, perfil: null,
    preferencias: null, error: null, recuperandoContrasena: false
  });
  const montado = useRef(true);

  const cargarDatosUsuario = useCallback(async (session: Session | null) => {
    if (!session?.user) {
      if (montado.current) {
        setEstado((s) => ({ ...s, cargando: false, session: null, user: null, perfil: null, preferencias: null }));
      }
      return;
    }
    try {
      const [perfil, preferencias] = await Promise.all([
        authService.obtenerPerfil(session.user.id),
        authService.obtenerPreferencias(session.user.id)
      ]);
      if (montado.current) {
        setEstado((s) => ({ ...s, cargando: false, session, user: session.user, perfil, preferencias, error: null }));
      }
    } catch (e) {
      // El trigger de alta crea perfil y preferencias; si aún no existen no
      // bloqueamos la sesión, solo dejamos el error visible.
      if (montado.current) {
        setEstado((s) => ({ ...s, cargando: false, session, user: session.user, error: traducirError(e) }));
      }
    }
  }, []);

  useEffect(() => {
    montado.current = true;

    authService.sesionActual()
      .then(cargarDatosUsuario)
      .catch((e) => montado.current && setEstado((s) => ({ ...s, cargando: false, error: traducirError(e) })));

    const desuscribir = authService.alCambiarSesion((session, evento) => {
      if (evento === 'PASSWORD_RECOVERY') {
        setEstado((s) => ({ ...s, recuperandoContrasena: true, session, user: session?.user ?? null, cargando: false }));
        return;
      }
      if (evento === 'SIGNED_OUT') {
        setEstado({
          cargando: false, session: null, user: null, perfil: null,
          preferencias: null, error: null, recuperandoContrasena: false
        });
        return;
      }
      void cargarDatosUsuario(session);
    });

    return () => { montado.current = false; desuscribir(); };
  }, [cargarDatosUsuario]);

  const conError = useCallback(async <T,>(fn: () => Promise<T>): Promise<T> => {
    try {
      setEstado((s) => ({ ...s, error: null }));
      return await fn();
    } catch (e) {
      const err = traducirError(e);
      setEstado((s) => ({ ...s, error: err }));
      throw err;
    }
  }, []);

  const valor = useMemo<ContextoAuth>(() => ({
    ...estado,
    autenticado: !!estado.session,

    registrar: (datos) => conError(async () => {
      const r = await authService.registrar(datos);
      return { requiereConfirmacion: r.requiereConfirmacion };
    }),

    iniciarSesion: (email, password) => conError(async () => {
      const session = await authService.iniciarSesion(email, password);
      await cargarDatosUsuario(session);
    }),

    cerrarSesion: () => conError(async () => { await authService.cerrarSesion(); }),

    solicitarRecuperacion: (email) => conError(() => authService.solicitarRecuperacion(email)),

    definirContrasena: (nueva) => conError(async () => {
      await authService.definirContrasena(nueva);
      setEstado((s) => ({ ...s, recuperandoContrasena: false }));
    }),

    cambiarContrasena: (actual, nueva) => conError(() => authService.cambiarContrasena(actual, nueva)),

    reenviarConfirmacion: (email) => conError(() => authService.reenviarConfirmacion(email)),

    guardarPerfil: (cambios) => conError(async () => {
      if (!estado.user) throw new NexoError('No hay sesión activa.', 'unauthenticated');
      const perfil = await authService.actualizarPerfil(estado.user.id, cambios);
      setEstado((s) => ({ ...s, perfil }));
    }),

    guardarPreferencias: (cambios) => conError(async () => {
      if (!estado.user) throw new NexoError('No hay sesión activa.', 'unauthenticated');
      const preferencias = await authService.actualizarPreferencias(estado.user.id, cambios);
      setEstado((s) => ({ ...s, preferencias }));
    }),

    recargar: async () => { await cargarDatosUsuario(estado.session); },

    limpiarError: () => setEstado((s) => ({ ...s, error: null }))
  }), [estado, conError, cargarDatosUsuario]);

  return <Ctx.Provider value={valor}>{children}</Ctx.Provider>;
}

export function useAuth(): ContextoAuth {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useAuth debe usarse dentro de <AuthProvider>.');
  return ctx;
}

/** Id del usuario actual, o null. Útil para las claves de caché. */
export function useUserId(): string | null {
  return useAuth().user?.id ?? null;
}
