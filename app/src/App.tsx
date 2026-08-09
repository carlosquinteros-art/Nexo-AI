/**
 * Cáscara de la aplicación.
 *
 * Es deliberadamente mínima: su trabajo es demostrar que la capa de datos
 * (servicios y hooks) funciona de punta a punta con sesión real, estados de
 * carga, error y vacío. La interfaz completa vive todavía en `nexo.html`,
 * que es el prototipo en uso.
 */
import { useState, type FormEvent } from 'react';
import { useAuth } from './hooks/useAuth';
import { usePanelInicio, useTareas } from './hooks';
import AssistantChat from './components/AssistantChat';
import type { SpaceType } from './types/database.types';

const ESPACIOS: Array<{ k: SpaceType | 'all'; l: string }> = [
  { k: 'all', l: 'Todo' },
  { k: 'work', l: 'Trabajo' },
  { k: 'university', l: 'Universidad' },
  { k: 'personal', l: 'Personal' }
];

const BTN =
  'inline-flex items-center justify-center gap-1.5 rounded-lg bg-[var(--acc)] text-white ' +
  'text-[13px] font-medium px-3.5 py-2.5 disabled:opacity-50';
const INPUT =
  'w-full rounded-lg border border-ink-300 dark:border-ink-700 bg-white dark:bg-ink-850 ' +
  'px-3 py-2.5 text-[14px]';

/* ----------------------------------------------------------- Autenticación */
function PantallaAuth() {
  const { iniciarSesion, registrar, solicitarRecuperacion, error, cargando } = useAuth();
  const [modo, setModo] = useState<'entrar' | 'registro' | 'recuperar'>('entrar');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [nombre, setNombre] = useState('');
  const [aviso, setAviso] = useState('');
  const [enviando, setEnviando] = useState(false);

  const enviar = async (e: FormEvent) => {
    e.preventDefault();
    setAviso('');
    setEnviando(true);
    try {
      if (modo === 'entrar') await iniciarSesion(email, password);
      else if (modo === 'registro') {
        const r = await registrar({ email, password, fullName: nombre });
        if (r.requiereConfirmacion) setAviso('Te enviamos un correo para confirmar la cuenta.');
      } else {
        await solicitarRecuperacion(email);
        setAviso('Te enviamos el enlace para crear una contraseña nueva.');
      }
    } catch {
      /* el mensaje ya viene traducido en `error` */
    } finally {
      setEnviando(false);
    }
  };

  return (
    <main className="min-h-[100dvh] grid place-items-center p-4">
      <form onSubmit={enviar} className="surface shadow-pop w-full max-w-sm p-6">
        <div className="w-11 h-11 rounded-xl2 bg-[var(--acc)] text-white grid place-items-center font-bold mb-4">
          N
        </div>
        <h1 className="text-[20px] font-semibold">Nexo</h1>
        <p className="text-[13px] text-ink-500 dark:text-ink-400 mb-4">
          Trabajo, universidad y vida personal en un solo lugar.
        </p>

        <div className="flex gap-1 p-1 rounded-xl2 bg-ink-100 dark:bg-ink-850 mb-4" role="tablist">
          {(['entrar', 'registro', 'recuperar'] as const).map((m) => (
            <button
              key={m}
              type="button"
              role="tab"
              aria-selected={modo === m}
              onClick={() => setModo(m)}
              className={`flex-1 text-[12.5px] font-semibold px-2 py-2 rounded-lg ${
                modo === m ? 'bg-white dark:bg-ink-700 shadow-card' : 'text-ink-500'
              }`}
            >
              {m === 'entrar' ? 'Entrar' : m === 'registro' ? 'Crear cuenta' : 'Recuperar'}
            </button>
          ))}
        </div>

        {modo === 'registro' && (
          <label className="block mb-3">
            <span className="block text-[12px] font-medium text-ink-600 dark:text-ink-400 mb-1.5">Tu nombre</span>
            <input className={INPUT} value={nombre} onChange={(e) => setNombre(e.target.value)} autoComplete="name" />
          </label>
        )}

        <label className="block mb-3">
          <span className="block text-[12px] font-medium text-ink-600 dark:text-ink-400 mb-1.5">Correo</span>
          <input
            className={INPUT}
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoComplete="username"
            required
          />
        </label>

        {modo !== 'recuperar' && (
          <label className="block mb-4">
            <span className="block text-[12px] font-medium text-ink-600 dark:text-ink-400 mb-1.5">Contraseña</span>
            <input
              className={INPUT}
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete={modo === 'registro' ? 'new-password' : 'current-password'}
              required
              minLength={8}
            />
          </label>
        )}

        {error && (
          <p role="alert" className="text-[12.5px] text-critc-700 dark:text-critc-200 bg-critc-50 dark:bg-critc-500/15 rounded-xl px-3 py-2.5 mb-3">
            {error.message}
          </p>
        )}
        {aviso && (
          <p role="status" className="text-[12.5px] text-okc-700 dark:text-okc-200 bg-okc-50 dark:bg-okc-500/15 rounded-xl px-3 py-2.5 mb-3">
            {aviso}
          </p>
        )}

        <button type="submit" className={`${BTN} w-full`} disabled={enviando || cargando}>
          {enviando ? 'Procesando…' : modo === 'entrar' ? 'Entrar' : modo === 'registro' ? 'Crear cuenta' : 'Enviar enlace'}
        </button>
      </form>
    </main>
  );
}

/* ------------------------------------------------------------------ Panel */
function Panel({ espacio }: { espacio: SpaceType | 'all' }) {
  const { datos, cargando, error, recargar } = usePanelInicio(espacio);

  if (cargando) {
    return (
      <div className="space-y-3" aria-busy="true">
        <span className="sr-only">Cargando…</span>
        {[0, 1, 2].map((i) => (
          <div key={i} className="surface h-24 animate-pulse" />
        ))}
      </div>
    );
  }
  if (error) {
    return (
      <div className="surface p-5 text-center">
        <p className="font-semibold text-critc-600 dark:text-critc-200">{error.message}</p>
        <button type="button" className={`${BTN} mt-3`} onClick={() => void recargar()}>
          Reintentar
        </button>
      </div>
    );
  }
  if (!datos) return null;

  const { resumen, prioridades, vencidas, evaluaciones } = datos;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-3 gap-2.5">
        {[
          { l: 'Para hoy', v: resumen.hoy },
          { l: 'Vencidas', v: resumen.vencidas },
          { l: 'Abiertas', v: resumen.abiertas }
        ].map((m) => (
          <div key={m.l} className="surface px-3.5 py-3">
            <p className="text-[10.5px] uppercase tracking-wider text-ink-500">{m.l}</p>
            <p className="text-[22px] font-semibold tabular-nums">{m.v}</p>
          </div>
        ))}
      </div>

      <section className="surface p-4">
        <h2 className="text-[13px] font-semibold text-ink-500 mb-2">Tus 3 prioridades</h2>
        {prioridades.length === 0 ? (
          <p className="text-[13px] text-ink-500">Nada urgente por ahora.</p>
        ) : (
          <ul className="space-y-1.5">
            {prioridades.map((t) => (
              <li key={t.id} className="text-[13.5px]">
                {t.title}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="surface p-4">
        <h2 className="text-[13px] font-semibold text-ink-500 mb-2">Vencidas</h2>
        {vencidas.length === 0 ? (
          <p className="text-[13px] text-ink-500">Todo al día.</p>
        ) : (
          <ul className="space-y-1.5">
            {vencidas.map((t) => (
              <li key={t.id} className="text-[13.5px] text-critc-600 dark:text-critc-300">
                {t.title}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="surface p-4">
        <h2 className="text-[13px] font-semibold text-ink-500 mb-2">Próximas evaluaciones</h2>
        {evaluaciones.length === 0 ? (
          <p className="text-[13px] text-ink-500">Sin evaluaciones registradas.</p>
        ) : (
          <ul className="space-y-1.5">
            {evaluaciones.map((e) => (
              <li key={e.id} className="text-[13.5px]">
                {e.title} · {e.due_date ?? 'sin fecha'}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

/* ------------------------------------------------------------------ Tareas */
function Tareas({ espacio }: { espacio: SpaceType | 'all' }) {
  const { tareas, cargando, error, alternar } = useTareas({ space: espacio });

  if (cargando) return <div className="surface h-40 animate-pulse" aria-busy="true" />;
  if (error) return <p role="alert" className="surface p-4 text-critc-600">{error.message}</p>;
  if (!tareas.length) return <p className="surface p-6 text-center text-[13px] text-ink-500">Sin tareas en este espacio.</p>;

  return (
    <ul className="surface divide-y divide-ink-200 dark:divide-ink-800">
      {tareas.map((t) => (
        <li key={t.id} className="flex items-center gap-3 px-4 py-3">
          <input
            type="checkbox"
            className="w-4 h-4 rounded"
            checked={t.status === 'done'}
            onChange={() => void alternar.ejecutar(t)}
            aria-label={`Completar ${t.title}`}
          />
          <span className={`text-[13.5px] ${t.status === 'done' ? 'line-through text-ink-400' : ''}`}>{t.title}</span>
        </li>
      ))}
    </ul>
  );
}

/* --------------------------------------------------------------------- App */
export default function App() {
  const { autenticado, cargando, perfil, cerrarSesion } = useAuth();
  const [espacio, setEspacio] = useState<SpaceType | 'all'>('all');
  const [vista, setVista] = useState<'panel' | 'tareas' | 'asistente'>('panel');

  if (cargando) {
    return (
      <main className="min-h-[100dvh] grid place-items-center">
        <p className="text-[13px] text-ink-500">Cargando…</p>
      </main>
    );
  }
  if (!autenticado) return <PantallaAuth />;

  return (
    <div className="min-h-[100dvh] max-w-3xl mx-auto p-4">
      <header className="flex items-center justify-between gap-3 mb-4">
        <div>
          <h1 className="text-[18px] font-semibold">Hola, {perfil?.full_name ?? 'Carlos'}</h1>
          <p className="text-[12px] text-ink-500">
            {new Date().toLocaleDateString('es-CL', { timeZone: 'America/Santiago', dateStyle: 'full' })}
          </p>
        </div>
        <button type="button" className="text-[12.5px] text-ink-500" onClick={() => void cerrarSesion()}>
          Salir
        </button>
      </header>

      <nav className="flex gap-1 p-1 rounded-xl2 bg-ink-100 dark:bg-ink-850 mb-3" role="tablist" aria-label="Espacio">
        {ESPACIOS.map((e) => (
          <button
            key={e.k}
            type="button"
            role="tab"
            aria-selected={espacio === e.k}
            onClick={() => {
              setEspacio(e.k);
              document.documentElement.dataset.space = e.k === 'all' ? 'todo' : e.k;
            }}
            className={`flex-1 text-[12.5px] font-semibold px-2 py-2 rounded-lg ${
              espacio === e.k ? 'bg-white dark:bg-ink-700 shadow-card' : 'text-ink-500'
            }`}
          >
            {e.l}
          </button>
        ))}
      </nav>

      <nav className="flex gap-1 mb-4" role="tablist" aria-label="Sección">
        {(['panel', 'tareas', 'asistente'] as const).map((v) => (
          <button
            key={v}
            type="button"
            role="tab"
            aria-selected={vista === v}
            onClick={() => setVista(v)}
            className={`text-[12.5px] font-semibold px-3 py-2 rounded-lg ${
              vista === v ? 'bg-[var(--acc)] text-white' : 'bg-ink-100 dark:bg-ink-850 text-ink-600'
            }`}
          >
            {v === 'panel' ? 'Panel' : v === 'tareas' ? 'Tareas' : 'Asistente'}
          </button>
        ))}
      </nav>

      {vista === 'panel' && <Panel espacio={espacio} />}
      {vista === 'tareas' && <Tareas espacio={espacio} />}
      {vista === 'asistente' && <AssistantChat espacio={espacio === 'all' ? 'all' : espacio} />}
    </div>
  );
}
