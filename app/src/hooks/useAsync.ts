/**
 * Primitivas de acceso a datos: carga con estados y mutaciones.
 *
 * Sobre las actualizaciones optimistas: solo se aplican cuando el cambio es
 * reversible y no depende de cálculos del servidor. Marcar una tarea como
 * hecha, fijar una nota o cambiar el dominio de una unidad sí lo son. Crear
 * registros, generar planes o registrar notas académicas NO lo son, porque el
 * servidor asigna ids, dispara triggers y recalcula estados; en esos casos se
 * espera la respuesta real.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { NexoError, traducirError } from '../lib/errors';

export interface EstadoCarga<T> {
  datos: T | null;
  cargando: boolean;
  error: NexoError | null;
  /** true en recargas posteriores (no en la primera) */
  refrescando: boolean;
  recargar: () => Promise<void>;
  setDatos: (actualizar: T | ((previo: T | null) => T)) => void;
}

/**
 * Carga datos y expone cargando / error / recargar.
 * `deps` funciona como el array de dependencias de useEffect.
 */
export function useAsyncData<T>(
  cargar: (signal: AbortSignal) => Promise<T>,
  deps: unknown[] = [],
  opciones: { activo?: boolean; inicial?: T | null } = {}
): EstadoCarga<T> {
  const { activo = true, inicial = null } = opciones;
  const [datos, setDatosEstado] = useState<T | null>(inicial);
  const [cargando, setCargando] = useState(activo);
  const [refrescando, setRefrescando] = useState(false);
  const [error, setError] = useState<NexoError | null>(null);
  const yaCargo = useRef(false);
  const abortRef = useRef<AbortController | null>(null);

  const ejecutar = useCallback(async () => {
    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;

    yaCargo.current ? setRefrescando(true) : setCargando(true);
    setError(null);
    try {
      const r = await cargar(ctrl.signal);
      if (!ctrl.signal.aborted) { setDatosEstado(r); yaCargo.current = true; }
    } catch (e) {
      if (!ctrl.signal.aborted) setError(traducirError(e));
    } finally {
      if (!ctrl.signal.aborted) { setCargando(false); setRefrescando(false); }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  useEffect(() => {
    if (!activo) { setCargando(false); return; }
    void ejecutar();
    return () => abortRef.current?.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ejecutar, activo]);

  const setDatos = useCallback((v: T | ((previo: T | null) => T)) => {
    setDatosEstado((previo) => (typeof v === 'function' ? (v as (p: T | null) => T)(previo) : v));
  }, []);

  return { datos, cargando, error, refrescando, recargar: ejecutar, setDatos };
}

export interface EstadoMutacion<A, R> {
  ejecutar: (args: A) => Promise<R>;
  enviando: boolean;
  error: NexoError | null;
  limpiarError: () => void;
}

/**
 * Mutación con control de estado. `optimista` recibe el argumento y devuelve
 * el rollback: solo pásalo cuando el cambio sea seguro de revertir.
 */
export function useMutacion<A, R>(
  accion: (args: A) => Promise<R>,
  opciones: {
    alTerminar?: (resultado: R, args: A) => void;
    alFallar?: (error: NexoError, args: A) => void;
    optimista?: (args: A) => (() => void) | void;
  } = {}
): EstadoMutacion<A, R> {
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState<NexoError | null>(null);

  const ejecutar = useCallback(async (args: A): Promise<R> => {
    setEnviando(true);
    setError(null);
    const revertir = opciones.optimista?.(args);
    try {
      const r = await accion(args);
      opciones.alTerminar?.(r, args);
      return r;
    } catch (e) {
      const err = traducirError(e);
      revertir?.();          // se deshace el cambio optimista
      setError(err);
      opciones.alFallar?.(err, args);
      throw err;
    } finally {
      setEnviando(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accion, opciones.alTerminar, opciones.alFallar, opciones.optimista]);

  return { ejecutar, enviando, error, limpiarError: () => setError(null) };
}

/** Retrasa un valor: útil para buscadores sin castigar la red. */
export function useDebounce<T>(valor: T, ms = 300): T {
  const [retrasado, setRetrasado] = useState(valor);
  useEffect(() => {
    const id = setTimeout(() => setRetrasado(valor), ms);
    return () => clearTimeout(id);
  }, [valor, ms]);
  return retrasado;
}
