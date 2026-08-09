/**
 * Interfaz del Asistente: chat, tarjeta de confirmación editable, preguntas de
 * desambiguación, historial reciente y ejemplos clicables.
 *
 * Estilos con clases de Tailwind equivalentes a las del prototipo.
 */
import { useEffect, useRef, useState } from 'react';
import { useAssistant } from '../hooks/useAssistant';
import { EJEMPLOS_ASISTENTE } from '../services/assistant';
import { TEXTO_AVISO } from '../services/assistant/types';
import type { CampoPropuesta, Propuesta, SpaceType } from '../services/assistant/types';

const ETIQUETA_ESPACIO: Record<SpaceType, string> = {
  work: 'Trabajo', university: 'Universidad', personal: 'Personal'
};
const PUNTO_ESPACIO: Record<SpaceType, string> = {
  work: 'bg-petrol-500', university: 'bg-uni-500', personal: 'bg-per-500'
};

const INPUT =
  'w-full rounded-lg border border-ink-300 dark:border-ink-700 bg-white dark:bg-ink-850 px-3 py-2.5 ' +
  'text-[14px] placeholder:text-ink-400 focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--acc)]';
const BTN_PRIMARIO =
  'inline-flex items-center justify-center gap-1.5 rounded-lg bg-[var(--acc)] hover:opacity-90 text-white ' +
  'text-[13px] font-medium px-3.5 py-2.5 transition disabled:opacity-50';
const BTN_SECUNDARIO =
  'inline-flex items-center justify-center gap-1.5 rounded-lg bg-ink-100 dark:bg-ink-800 hover:bg-ink-200 ' +
  'dark:hover:bg-ink-700 text-ink-700 dark:text-ink-200 text-[13px] font-medium px-3.5 py-2.5 transition';

/* ------------------------------------------------- Campo editable --------- */
function Campo({ campo, valor, onChange }: { campo: CampoPropuesta; valor: string; onChange: (v: string) => void }) {
  const id = `pc_${campo.k}`;
  const comun = { id, disabled: campo.bloqueado, className: INPUT };
  return (
    <div className={campo.tipo === 'textarea' || campo.tipo === 'texto' ? 'sm:col-span-2' : ''}>
      <label htmlFor={id} className="block text-[12px] font-medium text-ink-600 dark:text-ink-400 mb-1.5">
        {campo.etiqueta}{campo.requerido && <span className="text-critc-500"> *</span>}
      </label>

      {campo.tipo === 'textarea' && (
        <textarea {...comun} rows={3} value={valor} onChange={(e) => onChange(e.target.value)} />
      )}
      {campo.tipo === 'select' && (
        <select {...comun} value={valor} onChange={(e) => onChange(e.target.value)}>
          {(campo.opciones ?? []).map((o) => <option key={o.v} value={o.v}>{o.l}</option>)}
        </select>
      )}
      {campo.tipo === 'check' && (
        <label className="flex items-center gap-2 text-[13px]">
          <input type="checkbox" id={id} checked={!!valor} className="w-4 h-4 rounded"
            onChange={(e) => onChange(e.target.checked ? '1' : '')} /> Sí
        </label>
      )}
      {['texto', 'fecha', 'hora', 'numero'].includes(campo.tipo) && (
        <input {...comun}
          type={{ fecha: 'date', hora: 'time', numero: 'number', texto: 'text' }[campo.tipo] ?? 'text'}
          value={valor} onChange={(e) => onChange(e.target.value)} />
      )}

      {campo.ayuda && <p className="text-[11px] text-ink-500 dark:text-ink-400 mt-1.5">{campo.ayuda}</p>}
    </div>
  );
}

/* --------------------------------------------- Tarjeta de confirmación ---- */
function TarjetaConfirmacion({
  propuesta, valores, editando, guardando, onCampo, onEditar, onConfirmar, onDescartar
}: {
  propuesta: Propuesta; valores: Record<string, string>; editando: boolean; guardando: boolean;
  onCampo: (k: string, v: string) => void; onEditar: () => void;
  onConfirmar: () => void; onDescartar: () => void;
}) {
  const resumen = propuesta.campos.filter((c) => (valores[c.k] ?? '').trim());

  return (
    <section aria-label="Propuesta del asistente"
      className="surface shadow-pop p-4 sm:p-5 rounded-xl2 border border-[var(--acc)]/30">
      <header className="flex items-start justify-between gap-3 mb-2.5">
        <div className="min-w-0">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-[var(--acc)] mb-1">
            Propuesta · {propuesta.origen === 'ia' ? 'IA' : 'reglas locales'}
          </p>
          <h3 className="font-semibold text-[16px] leading-snug">{propuesta.titulo}</h3>
        </div>
        <span className="inline-flex items-center gap-1.5 text-[11px] font-medium px-2 py-1 rounded-md bg-ink-100 dark:bg-ink-800">
          <span className={`w-1.5 h-1.5 rounded-full ${PUNTO_ESPACIO[propuesta.espacio]}`} />
          {ETIQUETA_ESPACIO[propuesta.espacio]}
        </span>
      </header>

      {propuesta.resumen && (
        <p className="text-[13px] text-ink-600 dark:text-ink-300 leading-relaxed mb-3.5">{propuesta.resumen}</p>
      )}

      {editando ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-3 mb-3.5">
          {propuesta.campos.map((c) => (
            <Campo key={c.k} campo={c} valor={valores[c.k] ?? ''} onChange={(v) => onCampo(c.k, v)} />
          ))}
        </div>
      ) : (
        <dl className="rounded-xl2 border border-ink-200 dark:border-ink-800 divide-y divide-ink-200/70 dark:divide-ink-800 mb-3.5 overflow-hidden">
          {resumen.map((c) => {
            const opcion = c.opciones?.find((o) => o.v === valores[c.k]);
            return (
              <div key={c.k} className="flex gap-3 px-3 py-2 text-[13px]">
                <dt className="text-ink-500 dark:text-ink-400 shrink-0 w-32 sm:w-40">{c.etiqueta}</dt>
                <dd className="font-medium min-w-0 flex-1 break-words">{opcion ? opcion.l : valores[c.k]}</dd>
              </div>
            );
          })}
        </dl>
      )}

      {propuesta.faltantes.length > 0 && (
        <p className="text-[12px] text-warnc-700 dark:text-warnc-200 bg-warnc-50 dark:bg-warnc-500/15 rounded-xl px-3 py-2.5 mb-3.5">
          Falta <strong>{propuesta.faltantes.join(', ')}</strong>. Usa «Editar» para completarlo antes de guardar.
        </p>
      )}

      {propuesta.avisos.map((a) => (
        <p key={a} className="text-[11.5px] leading-relaxed text-ink-600 dark:text-ink-300 bg-ink-100/70 dark:bg-ink-850 border border-ink-200 dark:border-ink-800 rounded-xl px-3 py-2.5 mb-2">
          {TEXTO_AVISO[a]}
        </p>
      ))}

      <div className="grid grid-cols-1 sm:flex sm:flex-wrap gap-2 mt-3.5">
        <button type="button" className={BTN_PRIMARIO} onClick={onConfirmar} disabled={guardando}>
          {guardando ? 'Guardando…' : 'Confirmar y guardar'}
        </button>
        <button type="button" className={BTN_SECUNDARIO} onClick={onEditar}>
          {editando ? 'Ver resumen' : 'Editar'}
        </button>
        <button type="button" className="text-[13px] text-ink-500 px-3 py-2.5" onClick={onDescartar}>Cancelar</button>
      </div>

      <p className="text-[11.5px] text-ink-400 mt-3">
        Nada se guarda hasta que confirmes. Nexo no envía correos ni mensajes por ti.
      </p>
    </section>
  );
}

/* ------------------------------------------------------ Chat completo ----- */
export default function AssistantChat({ espacio = 'work' }: { espacio?: SpaceType | 'all' }) {
  const a = useAssistant();
  const [texto, setTexto] = useState('');
  const finRef = useRef<HTMLDivElement>(null);

  useEffect(() => { finRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [a.mensajes.length, a.propuesta]);

  const enviar = () => { const t = texto; setTexto(''); void a.enviar(t); };
  const grupos: Array<[SpaceType, string]> = espacio === 'all'
    ? [['work', 'Trabajo'], ['university', 'Universidad']]
    : [[espacio, ETIQUETA_ESPACIO[espacio]]];

  return (
    <div className="flex flex-col gap-4 max-w-3xl mx-auto w-full">
      <header className="surface rounded-xl2 shadow-card px-4 py-3.5">
        <p className="font-semibold text-[14px]">Dime qué necesitas, en tus palabras</p>
        <p className="text-[12.5px] text-ink-600 dark:text-ink-300 mt-0.5 leading-relaxed">
          Reconozco 19 tipos de instrucción entre trabajo, universidad y vida personal. Siempre te muestro
          la interpretación antes de guardar, y si falta un dato te pregunto en vez de inventarlo.
        </p>
        <div className="flex flex-wrap gap-1.5 mt-2 text-[11px]">
          <span className="px-2 py-1 rounded-md bg-ink-100 dark:bg-ink-800">
            {a.iaActiva ? 'IA conectada' : 'Reglas locales'}
          </span>
          <span className="px-2 py-1 rounded-md bg-ink-100 dark:bg-ink-800">Zona horaria de Chile</span>
          <span className="px-2 py-1 rounded-md bg-ink-100 dark:bg-ink-800">Sin envíos automáticos</span>
        </div>
      </header>

      {a.error && (
        <p role="alert" className="text-[13px] text-critc-700 dark:text-critc-200 bg-critc-50 dark:bg-critc-500/15 border border-critc-200 dark:border-critc-500/30 rounded-xl px-3 py-2.5">
          {a.error.message}
        </p>
      )}

      {a.mensajes.length > 0 && (
        <div className="flex flex-col gap-3">
          {a.mensajes.map((m, i) => {
            if (m.rol === 'usuario') {
              return (
                <div key={i} className="flex justify-end">
                  <p className="max-w-[85%] bg-[var(--acc)] text-white text-[13.5px] leading-relaxed px-4 py-2.5 rounded-2xl2 rounded-br-md">{m.texto}</p>
                </div>
              );
            }
            if (m.tipo === 'resultado') {
              return (
                <div key={i} className="flex justify-start pl-9">
                  <p className={`inline-flex items-center gap-1.5 text-[12.5px] font-medium px-3 py-1.5 rounded-lg ${
                    m.ok ? 'bg-okc-100 text-okc-700 dark:bg-okc-500/20 dark:text-okc-200' : 'bg-ink-100 dark:bg-ink-850 text-ink-500'}`}>
                    {m.ok ? '✓' : '✕'} {m.texto}
                    {m.ruta && <a href={m.ruta} className="underline underline-offset-2 ml-1">Ver</a>}
                  </p>
                </div>
              );
            }
            if (m.tipo === 'pregunta') {
              const q = m.propuesta.pregunta!;
              return (
                <div key={i} className="flex justify-start">
                  <div className="max-w-[88%] surface rounded-2xl2 rounded-bl-md px-4 py-3 shadow-card border border-warnc-200 dark:border-warnc-500/30">
                    <p className="text-[13.5px] font-medium leading-relaxed">{q.texto}</p>
                    {m.propuesta.respuesta?.nota && (
                      <p className="text-[11.5px] text-ink-500 dark:text-ink-400 mt-1.5">{m.propuesta.respuesta.nota}</p>
                    )}
                    {!!q.opciones?.length && (
                      <div className="flex flex-wrap gap-1.5 mt-2.5">
                        {q.opciones.map((o) => (
                          <button key={o.etiqueta} type="button" onClick={() => void a.enviar(o.texto)}
                            className="text-[12px] px-2.5 py-1.5 rounded-lg bg-ink-100 dark:bg-ink-850 hover:bg-ink-200 dark:hover:bg-ink-800 text-ink-600 dark:text-ink-300">
                            {o.etiqueta}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              );
            }
            return (
              <div key={i} className="flex justify-start">
                <div className="max-w-[88%] surface rounded-2xl2 rounded-bl-md px-4 py-3 shadow-card">
                  <p className="text-[11px] font-semibold text-ink-400 uppercase tracking-wider mb-1.5">{m.titulo}</p>
                  <p className="text-[14px] font-semibold leading-snug whitespace-pre-wrap">{m.respuesta.texto}</p>
                  {!!m.respuesta.detalle?.length && (
                    <ul className="mt-2 space-y-1 text-[12.5px] text-ink-600 dark:text-ink-300">
                      {m.respuesta.detalle.map((d, j) => <li key={j}>{d}</li>)}
                    </ul>
                  )}
                  {m.respuesta.nota && (
                    <p className="text-[11.5px] text-ink-400 mt-2 pt-2 border-t border-ink-200 dark:border-ink-800">{m.respuesta.nota}</p>
                  )}
                  <div className="flex flex-wrap gap-1.5 mt-2.5">
                    {m.respuesta.copiable && (
                      <button type="button" className={BTN_SECUNDARIO}
                        onClick={() => navigator.clipboard.writeText(m.respuesta.texto)}>Copiar</button>
                    )}
                    {m.respuesta.enlace && <a href={m.respuesta.enlace} className={BTN_SECUNDARIO}>Abrir sección</a>}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {a.interpretando && (
        <p className="text-[12.5px] text-ink-500 dark:text-ink-400 pl-9" aria-live="polite">Interpretando…</p>
      )}

      {a.propuesta && (
        <TarjetaConfirmacion
          propuesta={a.propuesta} valores={a.valores} editando={a.editando} guardando={a.guardando}
          onCampo={a.cambiarCampo} onEditar={a.alternarEdicion}
          onConfirmar={() => void a.confirmar()} onDescartar={a.descartar}
        />
      )}

      {a.mensajes.length === 0 && (
        <section className="surface rounded-xl2 shadow-card p-4">
          <h2 className="text-[13px] font-semibold text-ink-500 dark:text-ink-400 mb-3">Prueba con esto</h2>
          <div className="flex flex-col gap-3">
            {grupos.map(([k, l]) => (
              <div key={k}>
                <p className="text-[11px] font-semibold uppercase tracking-wider text-ink-400 mb-1.5">{l}</p>
                <div className="flex flex-wrap gap-1.5">
                  {EJEMPLOS_ASISTENTE[k].map((e) => (
                    <button key={e} type="button" onClick={() => void a.enviar(e)}
                      className="text-[12px] text-left px-3 py-1.5 rounded-lg bg-ink-100 dark:bg-ink-850 hover:bg-ink-200 dark:hover:bg-ink-800 text-ink-600 dark:text-ink-300 max-w-full truncate">
                      {e}
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {a.historial.length > 0 && (
        <section className="surface rounded-xl2 shadow-card p-4">
          <div className="flex items-center justify-between mb-2">
            <h2 className="text-[13px] font-semibold text-ink-500 dark:text-ink-400">Historial reciente</h2>
            <button type="button" className="text-[12px] text-[var(--acc)] font-semibold" onClick={a.borrarHistorial}>Borrar</button>
          </div>
          <div className="flex flex-col gap-1">
            {a.historial.map((h) => (
              <button key={h.texto + h.cuando} type="button" onClick={() => void a.enviar(h.texto)}
                className="w-full text-left p-2 rounded-lg hover:bg-ink-100 dark:hover:bg-ink-850">
                <span className="block text-[12.5px] truncate">{h.texto}</span>
                <span className="block text-[11px] text-ink-400 truncate">
                  {h.resultado} · {new Date(h.cuando).toLocaleDateString('es-CL')}
                </span>
              </button>
            ))}
          </div>
        </section>
      )}

      <div ref={finRef} />

      <div className="sticky bottom-4 z-30">
        <div className="flex gap-2 items-end surface rounded-2xl2 shadow-pop p-2">
          <textarea
            rows={1} value={texto} aria-label="Mensaje para el asistente"
            placeholder="Ej: recuérdame pedir las ventas de Gnomo mañana a las 10"
            onChange={(e) => setTexto(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); enviar(); } }}
            className="flex-1 resize-none bg-transparent px-2.5 py-2.5 text-[14px] focus:outline-none max-h-32"
          />
          <button type="button" onClick={enviar} disabled={a.interpretando} aria-label="Enviar mensaje"
            className="w-10 h-10 rounded-xl bg-[var(--acc)] text-white grid place-items-center shrink-0 disabled:opacity-50">→</button>
        </div>
        {a.mensajes.length > 0 && (
          <div className="text-center mt-2">
            <button type="button" className="text-[12px] text-ink-500" onClick={a.limpiar}>Limpiar conversación</button>
          </div>
        )}
      </div>
    </div>
  );
}
