/**
 * Hook del Asistente: conversación, propuesta pendiente, confirmación e
 * historial reciente.
 *
 * Nada se guarda sin `confirmar()`. Y no se usan actualizaciones optimistas:
 * el asistente crea registros con ids del servidor y dispara triggers, así que
 * siempre se espera la respuesta real.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useAuth } from './useAuth';
import { assistantService, iaService } from '../services/assistant';
import type {
  Propuesta, MensajeChat, EntradaHistorial, ResultadoEjecucion, CampoPropuesta
} from '../services/assistant/types';
import { NexoError, traducirError } from '../lib/errors';

const CLAVE_HISTORIAL = 'nexo.asistente.historial.v1';
const MAX_HISTORIAL = 12;

function leerHistorial(): EntradaHistorial[] {
  try { return JSON.parse(localStorage.getItem(CLAVE_HISTORIAL) ?? '[]'); } catch { return []; }
}
function escribirHistorial(h: EntradaHistorial[]): void {
  try { localStorage.setItem(CLAVE_HISTORIAL, JSON.stringify(h.slice(0, MAX_HISTORIAL))); } catch { /* cuota llena */ }
}

export interface EstadoAsistente {
  mensajes: MensajeChat[];
  propuesta: Propuesta | null;
  /** Valores actuales de la tarjeta, editables por el usuario. */
  valores: Record<string, string>;
  editando: boolean;
  interpretando: boolean;
  guardando: boolean;
  error: NexoError | null;
  historial: EntradaHistorial[];
  iaActiva: boolean;

  enviar: (texto: string) => Promise<void>;
  cambiarCampo: (k: string, v: string) => void;
  alternarEdicion: () => void;
  confirmar: () => Promise<ResultadoEjecucion | null>;
  descartar: () => void;
  limpiar: () => void;
  borrarHistorial: () => void;
}

export function useAssistant(): EstadoAsistente {
  const { autenticado } = useAuth();
  const [mensajes, setMensajes] = useState<MensajeChat[]>([]);
  const [propuesta, setPropuesta] = useState<Propuesta | null>(null);
  const [valores, setValores] = useState<Record<string, string>>({});
  const [editando, setEditando] = useState(false);
  const [interpretando, setInterpretando] = useState(false);
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<NexoError | null>(null);
  const [historial, setHistorial] = useState<EntradaHistorial[]>(leerHistorial);
  const [iaActiva, setIaActiva] = useState(false);
  const vivo = useRef(true);

  useEffect(() => {
    vivo.current = true;
    if (autenticado) void iaService.disponible().then((d) => vivo.current && setIaActiva(d));
    return () => { vivo.current = false; };
  }, [autenticado]);

  const anotar = useCallback((texto: string, resultado: string) => {
    setHistorial((prev) => {
      const nuevo = [{ texto, resultado, cuando: new Date().toISOString() },
        ...prev.filter((h) => h.texto !== texto)].slice(0, MAX_HISTORIAL);
      escribirHistorial(nuevo);
      return nuevo;
    });
  }, []);

  const valoresIniciales = (campos: CampoPropuesta[]) =>
    Object.fromEntries(campos.map((c) => [c.k, c.valor ?? '']));

  const enviar = useCallback(async (texto: string) => {
    const t = texto.trim();
    if (!t) return;
    const cuando = new Date().toISOString();
    setMensajes((m) => [...m, { rol: 'usuario', texto: t, cuando }]);
    setPropuesta(null); setEditando(false); setError(null); setInterpretando(true);

    try {
      const p = await assistantService.interpretar(t, { usarIA: iaActiva });
      if (!vivo.current) return;

      if (p.requiereConfirmacion && p.intencion) {
        setPropuesta(p);
        setValores(valoresIniciales(p.campos));
        /* Si falta un dato, la pregunta va también al hilo del chat. */
        if (p.pregunta) setMensajes((m) => [...m, { rol: 'nexo', tipo: 'pregunta', propuesta: p, cuando }]);
      } else if (p.pregunta) {
        setMensajes((m) => [...m, { rol: 'nexo', tipo: 'pregunta', propuesta: p, cuando }]);
        anotar(t, 'Pregunta pendiente');
      } else {
        setMensajes((m) => [...m, {
          rol: 'nexo', tipo: 'respuesta', titulo: p.titulo,
          respuesta: p.respuesta ?? { texto: 'Listo' }, cuando
        }]);
        anotar(t, p.titulo);
      }
    } catch (e) {
      if (vivo.current) setError(traducirError(e, 'interpretar tu instrucción'));
    } finally {
      if (vivo.current) setInterpretando(false);
    }
  }, [iaActiva, anotar]);

  const cambiarCampo = useCallback((k: string, v: string) => {
    setValores((prev) => ({ ...prev, [k]: v }));
  }, []);

  const confirmar = useCallback(async (): Promise<ResultadoEjecucion | null> => {
    if (!propuesta) return null;
    const faltan = propuesta.campos
      .filter((c) => c.requerido && !(valores[c.k] ?? '').trim())
      .map((c) => c.etiqueta);
    if (faltan.length) {
      setEditando(true);
      setError(new NexoError(`Falta completar: ${faltan.join(', ')}`, 'validation'));
      return null;
    }

    setGuardando(true); setError(null);
    try {
      const r = await assistantService.ejecutar(propuesta, valores);
      const cuando = new Date().toISOString();
      setMensajes((m) => [...m, { rol: 'nexo', tipo: 'resultado', ok: r.ok, texto: r.mensaje, ruta: r.ruta, cuando }]);
      anotar(propuesta.textoOriginal, r.mensaje);
      setPropuesta(null); setValores({}); setEditando(false);
      return r;
    } catch (e) {
      const err = traducirError(e, 'guardar la acción');
      setError(err);
      setMensajes((m) => [...m, { rol: 'nexo', tipo: 'resultado', ok: false, texto: err.message, cuando: new Date().toISOString() }]);
      return null;
    } finally {
      setGuardando(false);
    }
  }, [propuesta, valores, anotar]);

  const descartar = useCallback(() => {
    setMensajes((m) => [...m, { rol: 'nexo', tipo: 'resultado', ok: false, texto: 'Descartado, no se guardó nada', cuando: new Date().toISOString() }]);
    setPropuesta(null); setValores({}); setEditando(false); setError(null);
  }, []);

  return useMemo<EstadoAsistente>(() => ({
    mensajes, propuesta, valores, editando, interpretando, guardando, error, historial, iaActiva,
    enviar, cambiarCampo,
    alternarEdicion: () => setEditando((v) => !v),
    confirmar, descartar,
    limpiar: () => { setMensajes([]); setPropuesta(null); setValores({}); setError(null); },
    borrarHistorial: () => { setHistorial([]); escribirHistorial([]); }
  }), [mensajes, propuesta, valores, editando, interpretando, guardando, error, historial, iaActiva, enviar, cambiarCampo, confirmar, descartar]);
}
