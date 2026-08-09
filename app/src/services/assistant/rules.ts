/**
 * Motor de reglas: de una frase a una `Propuesta`.
 *
 * El orden de evaluación importa: se prueba lo más específico primero.
 * Cada regla devuelve `null` si no le corresponde, y la siguiente lo intenta.
 *
 * Este módulo es puro: no toca la red ni la base. Recibe el contexto con los
 * nombres del usuario y devuelve el objeto que la interfaz muestra en la
 * tarjeta de confirmación.
 */
import type { ContextoAsistente, Propuesta, Intencion, CampoPropuesta, Aviso } from './types';
import { ETIQUETA_INTENCION, ENTIDADES_VACIAS } from './types';
import { normalizar, numeroDe, PATRON_NUMERO, hoyISO, sumarDias, fmtFecha } from './datetime';
import {
  extraerEntidades, limpiarTitulo, detectarMonto, detectarNota,
  detectarCantidadPedida, detectarUnidades
} from './entities';

const TIPO_EVAL_ES: Record<string, string> = {
  test: 'Prueba', exam: 'Examen', quiz: 'Control', paper: 'Trabajo',
  presentation: 'Presentación', workshop: 'Taller'
};

function base(intencion: Intencion, texto: string, extra: Partial<Propuesta>): Propuesta {
  return {
    version: 1, origen: 'reglas', textoOriginal: texto, intencion,
    espacio: 'work', confianza: 0.85, titulo: ETIQUETA_INTENCION[intencion],
    entidades: {}, campos: [], faltantes: [], pregunta: null, respuesta: null,
    avisos: [], requiereConfirmacion: true, accion: null,
    ...extra
  };
}

function consulta(intencion: Intencion, texto: string, extra: Partial<Propuesta>): Propuesta {
  return base(intencion, texto, { requiereConfirmacion: false, ...extra });
}

/**
 * Interpreta una frase. `datos` permite resolver consultas y cálculos que
 * dependen de los registros del usuario; si no se entrega, esas intenciones
 * devuelven la intención sin la respuesta calculada.
 */
export function interpretarPorReglas(texto: string, ctx: ContextoAsistente): Propuesta {
  const t = texto.trim();
  const n = normalizar(t);
  const e = extraerEntidades(t, ctx);

  const opcionesAsignaturas = ctx.asignaturas.map((s) => ({ v: s.id, l: s.nombre }));
  const opcionesMarcas = [{ v: '', l: '— Sin marca —' }].concat(ctx.marcas.map((b) => ({ v: b.id, l: b.nombre })));

  /* ------------------------------------------------------------- CÁLCULOS */
  const mHoras = n.match(new RegExp(`${PATRON_NUMERO}\\s*horas?\\s*(?:menos|descontando|sin)\\s*${PATRON_NUMERO}?\\s*(?:hora|horas|min|minutos)?\\s*(?:de\\s*)?colacion`));
  if (mHoras) {
    const brutas = numeroDe(mHoras[1]) ?? 0;
    const col = numeroDe(mHoras[2]) ?? 1;
    const colMin = /min/.test(n) && !/hora/.test((mHoras[0].split('menos')[1] ?? '')) ? col : col * 60;
    const netas = brutas * 60 - colMin;
    return consulta('calcular', t, {
      espacio: 'work', titulo: 'Horas efectivas',
      respuesta: {
        texto: `${Math.floor(netas / 60)} h ${netas % 60} min`, subtitulo: 'Horas efectivas',
        detalle: [`Brutas: ${brutas} h`, `Colación: ${colMin} min`, `Decimal: ${(netas / 60).toFixed(2)} h`]
      }
    });
  }

  if (/\bneto|sin iva|con iva|iva\b/.test(n)) {
    const monto = detectarMonto(t);
    if (monto == null) {
      return consulta('calcular', t, {
        espacio: 'work', faltantes: ['monto'],
        pregunta: { texto: '¿Sobre qué monto lo calculo?' },
        respuesta: { texto: '¿Sobre qué monto lo calculo?' }
      });
    }
    const pideNeto = /neto|sin iva/.test(n);
    const neto = pideNeto ? monto / 1.19 : monto;
    const iva = pideNeto ? monto - neto : monto * 0.19;
    const clp = (x: number) => `$${Math.round(x).toLocaleString('es-CL')}`;
    return consulta('calcular', t, {
      espacio: 'work', titulo: pideNeto ? 'Monto neto' : 'Monto con IVA',
      respuesta: {
        texto: clp(pideNeto ? neto : neto + iva), subtitulo: pideNeto ? 'Monto neto' : 'Monto con IVA',
        detalle: [`Neto: ${clp(neto)}`, `IVA 19%: ${clp(iva)}`, `Total: ${clp(neto + iva)}`,
          pideNeto ? `Se dividió por 1,19 sobre ${clp(monto)}` : `Se agregó 19% sobre ${clp(monto)}`]
      }
    });
  }

  if (/que nota necesito|nota necesaria|cuanto necesito para aprobar|para aprobar/.test(n)) {
    if (!e.asignaturaId && ctx.asignaturas.length > 1) {
      return consulta('calcular', t, {
        espacio: 'university', faltantes: ['asignatura'],
        pregunta: {
          texto: '¿De qué asignatura necesitas la nota?',
          opciones: ctx.asignaturas.slice(0, 6).map((s) => ({ etiqueta: s.nombre, texto: `Qué nota necesito para aprobar ${s.nombre}` }))
        },
        respuesta: { texto: '¿De qué asignatura necesitas la nota?' }
      });
    }
    return consulta('calcular', t, {
      espacio: 'university', titulo: 'Nota necesaria',
      entidades: { asignaturaId: e.asignaturaId, asignaturaNombre: e.asignaturaNombre },
      accion: { tipo: 'crear', datos: { calculo: 'nota_necesaria', courseId: e.asignaturaId, notaAprobacion: ctx.notaAprobacion } }
    });
  }

  if (/cuanto me falta|cuantas paginas me faltan|falta para terminar la lectura|me falta para terminar/.test(n)) {
    return consulta('calcular', t, {
      espacio: 'university', titulo: 'Páginas pendientes',
      entidades: { asignaturaId: e.asignaturaId },
      accion: { tipo: 'crear', datos: { calculo: 'paginas_pendientes', courseId: e.asignaturaId } }
    });
  }

  /* ------------------------------------------------------------ CONSULTAS */
  const esPregunta = /^(que|cuales|cual|cuanto|cuantas|cuantos|cuando|muestrame|dame|listame|enumera|revisa mis)\b/.test(n) || /\?/.test(t);
  if (esPregunta) {
    if (/\bevaluacion|evaluaciones|pruebas?|examenes?|controles?\b/.test(n)) {
      const m = n.match(new RegExp(`proximos?\\s+${PATRON_NUMERO}\\s*dias`));
      const dias = m ? Math.round(numeroDe(m[1]) ?? 30) : (/este mes|del mes/.test(n) ? 31 : 30);
      return consulta('consultar_evaluaciones', t, {
        espacio: 'university', titulo: `Evaluaciones de los próximos ${dias} días`,
        entidades: { asignaturaId: e.asignaturaId },
        accion: { tipo: 'crear', datos: { consulta: 'evaluaciones', dias, courseId: e.asignaturaId } }
      });
    }
    if (/\bagenda|reunion|reuniones|clases|agendado\b/.test(n) && !/pendiente/.test(n)) {
      const dias = /semana/.test(n) ? 7 : 1;
      return consulta('consultar_agenda', t, {
        espacio: e.espacio, titulo: dias === 1 ? 'Tu agenda de hoy' : 'Tu agenda de la semana',
        accion: { tipo: 'crear', datos: { consulta: 'agenda', dias, brandId: e.marcaId } }
      });
    }
    return consulta('consultar_pendientes', t, {
      espacio: e.marcaId ? 'work' : e.asignaturaId ? 'university' : e.espacio,
      titulo: e.marcaNombre ? `Pendientes con ${e.marcaNombre}` : e.asignaturaNombre ? `Pendientes de ${e.asignaturaNombre}` : 'Tus pendientes',
      entidades: { marcaId: e.marcaId, asignaturaId: e.asignaturaId },
      accion: { tipo: 'crear', datos: { consulta: 'pendientes', brandId: e.marcaId, courseId: e.asignaturaId, dias: /esta semana|de la semana/.test(n) ? 7 : null } }
    });
  }

  /* ------------------------------------------------------------- MENSAJES */
  if (/^(redacta|redactame|escribe|escribeme|hazme un mensaje|arma un mensaje)/.test(n) || /redacta.*mensaje|mensaje para/.test(n)) {
    const tono = /firme/.test(n) ? 'firme' : /ejecutiv/.test(n) ? 'ejecutivo' : /motivacion/.test(n) ? 'motivacional'
      : /breve|corto/.test(n) ? 'breve' : 'cercano';
    const destinatario = /rrhh|recursos humanos/.test(n) ? 'rrhh' : /cliente/.test(n) ? 'cliente' : 'equipo';
    const asunto = t.replace(/^.*?\b(para|sobre|de)\b\s+/i, '')
      .replace(/\b(firme|ejecutivo|cercano|motivacional|breve)\b/gi, '').trim() || 'el reporte diario';
    return consulta('generar_mensaje', t, {
      espacio: 'work', titulo: `Mensaje sugerido · tono ${tono}`,
      accion: { tipo: 'crear', datos: { mensaje: { tono, destinatario, asunto, marca: e.marcaNombre } } }
    });
  }

  /* ------------------------------------------------- PREGUNTAS DE ESTUDIO */
  if (/preguntas de repaso|preguntas sobre|crear fichas|fichas de repaso|preguntas para repasar/.test(n)) {
    const cantidad = detectarCantidadPedida(t) ?? 10;
    const tema = (/\bsobre\b/i.test(t) ? t.replace(/^.*?\bsobre\s+/i, '') : t.replace(/^.*?\bde\s+/i, ''))
      .replace(/\besta materia\b/i, '').trim();
    return base('generar_preguntas', t, {
      espacio: 'university',
      resumen: 'Las preguntas se arman con tu propio glosario y tus apuntes. Nexo no genera contenido jurídico nuevo.',
      entidades: { asignaturaId: e.asignaturaId, tema },
      campos: [
        { k: 'tema', etiqueta: 'Tema', valor: tema, tipo: 'texto' },
        { k: 'cantidad', etiqueta: 'Cantidad', valor: String(cantidad), tipo: 'numero' }
      ],
      avisos: ['material_propio'],
      accion: { tipo: 'crear_fichas', datos: { tema, cantidad, courseId: e.asignaturaId } }
    });
  }

  /* --------------------------------------------------------- PLAN ESTUDIO */
  if (/plan de estudio|planifica|planificar el estudio|organiza(r)? el estudio|estudiar\s+\w+\s*unidades/.test(n)) {
    return base('crear_plan_estudio', t, {
      espacio: 'university',
      resumen: 'Se reparte la materia en tu disponibilidad declarada, con repasos a 3 y 7 días y un simulacro la víspera.',
      entidades: { asignaturaId: e.asignaturaId, fecha: e.fecha },
      campos: [
        { k: 'inicio', etiqueta: 'Empezar el', valor: e.fecha ?? ctx.hoy, tipo: 'fecha' },
        { k: 'unidades', etiqueta: 'Unidades a cubrir', valor: String(detectarUnidades(t) ?? ''), tipo: 'numero' },
        { k: 'horas_semana', etiqueta: 'Horas por semana', valor: '6', tipo: 'numero' }
      ],
      faltantes: ['evaluacion'],
      accion: { tipo: 'plan_estudio', datos: { courseId: e.asignaturaId, inicio: e.fecha ?? ctx.hoy, unidades: detectarUnidades(t) } }
    });
  }

  /* ---------------------------------------------------------- FICHA CASO -- */
  if (/ficha de caso|analisis de caso|caso practico|caso con los hechos/.test(n)) {
    let titulo = t.replace(/^.*?(ficha de caso|caso pr[aá]ctico|an[aá]lisis de caso)\s*/i, '')
      .replace(/^(de|sobre|con|para)\s+/i, '').trim();
    if (/^(los\s+)?hechos\b|problema jur[ií]dico|estructura/i.test(titulo)) titulo = '';
    return base('crear_ficha_caso', t, {
      espacio: 'university',
      resumen: 'Se crea con la estructura hechos → problema jurídico → normas → argumentos → conclusión. Los completas tú: Nexo no redacta hechos ni decisiones judiciales.',
      entidades: { asignaturaId: e.asignaturaId },
      campos: [
        { k: 'titulo', etiqueta: 'Título del caso', valor: titulo, tipo: 'texto', requerido: true },
        { k: 'course_id', etiqueta: 'Asignatura', valor: e.asignaturaId ?? '', tipo: 'select', opciones: opcionesAsignaturas },
        { k: 'facts', etiqueta: 'Hechos', valor: '', tipo: 'textarea' },
        { k: 'legal_issue', etiqueta: 'Problema jurídico', valor: '', tipo: 'textarea' },
        { k: 'rules', etiqueta: 'Normas aplicables (verifícalas en BCN)', valor: '', tipo: 'textarea' },
        { k: 'conclusion', etiqueta: 'Decisión o conclusión', valor: '', tipo: 'textarea' }
      ],
      faltantes: titulo ? [] : ['titulo'],
      pregunta: titulo ? null : { texto: '¿Cómo se llama el caso? Los hechos y la decisión los escribes tú.' },
      avisos: ['verificacion_juridica'],
      accion: { tipo: 'crear', tabla: 'case_briefs' }
    });
  }

  /* ---------------------------------------------------- FUENTE JURÍDICA -- */
  if (/registra(r)? (este|esta|el|la)? ?(fallo|sentencia|ley|norma|decreto|fuente)|guarda (este|esta) (fallo|sentencia|ley)|registrar fuente/.test(n)) {
    const tipo = /fallo|sentencia/.test(n) ? 'ruling' : /decreto/.test(n) ? 'decree' : /codigo/.test(n) ? 'code' : 'law';
    const resto = t.replace(/^.*?(fallo|sentencia|ley|norma|decreto|fuente)\s*/i, '')
      .replace(/\bpara\s+(revisarl[oa]s?|verl[oa]|leerl[oa])\s*(despu[eé]s|luego|m[aá]s\s+tarde)?\b/i, '')
      .replace(/^(para|de|del|el|la)\s+/i, '').trim();
    return base('registrar_fuente_juridica', t, {
      espacio: 'university',
      resumen: 'Se guardará como NO verificada. Nexo no completa rol, tribunal ni fecha: cópialos desde la fuente oficial.',
      entidades: { asignaturaId: e.asignaturaId },
      campos: [
        { k: 'identifier', etiqueta: 'Identificador', valor: resto, tipo: 'texto', requerido: true,
          ayuda: 'Ej: «Rol 12.345-2024» o «Ley 21.120». Cópialo tal cual.' },
        { k: 'type', etiqueta: 'Tipo', valor: tipo, tipo: 'select',
          opciones: [['law', 'Ley'], ['code', 'Código'], ['decree', 'Decreto'], ['ruling', 'Sentencia'], ['doctrine', 'Doctrina'], ['other', 'Otro']].map(([v, l]) => ({ v, l })) },
        { k: 'court', etiqueta: 'Tribunal', valor: '', tipo: 'texto' },
        { k: 'docket', etiqueta: 'Rol o causa', valor: '', tipo: 'texto' },
        { k: 'issued_on', etiqueta: 'Fecha del documento', valor: e.fecha ?? '', tipo: 'fecha' },
        { k: 'official_url', etiqueta: 'Enlace oficial', valor: '', tipo: 'texto', ayuda: 'BCN, Poder Judicial o Diario Oficial.' },
        { k: 'course_id', etiqueta: 'Asignatura', valor: e.asignaturaId ?? '', tipo: 'select', opciones: opcionesAsignaturas },
        { k: 'summary', etiqueta: 'Tu resumen', valor: '', tipo: 'textarea', ayuda: 'Escríbelo tú. Nexo no resume sentencias que no ha leído.' }
      ],
      faltantes: resto ? [] : ['identificador'],
      pregunta: resto ? null : { texto: '¿Cuál es el rol o identificador? Cópialo del buscador de causas del Poder Judicial; no lo invento.' },
      avisos: ['verificacion_juridica', 'sin_verificar'],
      accion: { tipo: 'crear', tabla: 'legal_sources' }
    });
  }

  /* --------------------------------------------------- APUNTE JURÍDICO --- */
  if (/apunte de|como apunte|guarda(r)? (este )?(concepto|apunte)|anota (este )?concepto|agrega este texto/.test(n)) {
    let contenido = t.replace(/^.*?(como apunte de|apunte de|apunte|concepto jur[ií]dico|concepto)\s*:?\s*/i, '').trim();
    let tema = '';
    const mTema = t.match(/apunte de\s+([^.,;]+)/i);
    if (mTema) { tema = mTema[1].trim(); contenido = t.replace(/^.*?apunte de\s+[^.,;]+[.,;]?\s*/i, '').trim(); }
    const esConcepto = /concepto/.test(n);
    return base('registrar_apunte_juridico', t, {
      espacio: 'university',
      resumen: esConcepto
        ? 'Se guarda en el glosario como NO verificado. Confirma la definición antes de citarla.'
        : 'Se guarda como apunte tuyo. Tu texto se conserva tal cual, sin reescribirlo.',
      entidades: { asignaturaId: e.asignaturaId, tema },
      campos: esConcepto
        ? [
            { k: 'term', etiqueta: 'Concepto', valor: (contenido.split(':')[0] ?? '').trim(), tipo: 'texto', requerido: true },
            { k: 'definition', etiqueta: 'Definición (tu texto, sin cambios)', valor: contenido.includes(':') ? contenido.split(':').slice(1).join(':').trim() : contenido, tipo: 'textarea', requerido: true },
            { k: 'course_id', etiqueta: 'Asignatura', valor: e.asignaturaId ?? '', tipo: 'select', opciones: opcionesAsignaturas },
            { k: 'origin', etiqueta: 'Origen', valor: 'Apunte propio', tipo: 'texto' }
          ]
        : [
            { k: 'title', etiqueta: 'Título', valor: tema ? `Apunte: ${tema}` : contenido.slice(0, 60), tipo: 'texto', requerido: true },
            { k: 'body', etiqueta: 'Contenido (tu texto, sin cambios)', valor: contenido, tipo: 'textarea', requerido: true },
            { k: 'course_id', etiqueta: 'Asignatura', valor: e.asignaturaId ?? '', tipo: 'select', opciones: opcionesAsignaturas },
            { k: 'topic', etiqueta: 'Tema', valor: tema, tipo: 'texto' }
          ],
      faltantes: contenido ? [] : ['contenido'],
      pregunta: contenido ? null : { texto: 'Pega el texto del apunte y lo guardo tal cual, sin modificarlo.' },
      avisos: ['verificacion_juridica'],
      accion: { tipo: 'crear', tabla: esConcepto ? 'legal_concepts' : 'legal_notes' }
    });
  }

  /* ---------------------------------------------------------- CALIFICACIÓN */
  if (/me saque|obtuve|saque un|nota de|me pusieron|calificacion/.test(n)) {
    const nota = detectarNota(t);
    return base('registrar_calificacion', t, {
      espacio: 'university',
      resumen: 'Se guarda la nota y se recalculan el promedio y la nota que necesitas.',
      entidades: { asignaturaId: e.asignaturaId },
      campos: [
        { k: 'assessment_id', etiqueta: 'Evaluación', valor: '', tipo: 'select', opciones: [], requerido: true },
        { k: 'score', etiqueta: 'Nota (1,0 a 7,0)', valor: nota != null ? String(nota) : '', tipo: 'numero', requerido: true }
      ],
      faltantes: nota == null ? ['nota'] : [],
      pregunta: nota == null ? { texto: '¿Qué nota obtuviste?' } : null,
      accion: { tipo: 'calificacion', datos: { courseId: e.asignaturaId } }
    });
  }

  /* --------------------------------------------------------------- LECTURA */
  if (e.paginas && /leer|lectura/.test(n)) {
    const esRecordatorio = /recuerdame|recordarme|avisame/.test(n);
    return base('registrar_lectura', t, {
      espacio: 'university',
      resumen: `Se agrega al registro de lecturas con control de páginas.${esRecordatorio ? ' Además se crea el recordatorio.' : ''}`,
      entidades: { asignaturaId: e.asignaturaId, paginas: e.paginas, fecha: e.fecha },
      campos: [
        { k: 'title', etiqueta: 'Título de la lectura', valor: e.asignaturaNombre ? `Lectura de ${e.asignaturaNombre}` : '', tipo: 'texto', requerido: true },
        { k: 'course_id', etiqueta: 'Asignatura', valor: e.asignaturaId ?? '', tipo: 'select', opciones: opcionesAsignaturas },
        { k: 'total_pages', etiqueta: 'Páginas', valor: String(e.paginas), tipo: 'numero' },
        { k: 'due_date', etiqueta: 'Para el', valor: e.fecha ?? '', tipo: 'fecha' },
        { k: 'priority', etiqueta: 'Prioridad', valor: e.prioridad ?? 'high', tipo: 'select',
          opciones: [['low', 'Baja'], ['medium', 'Media'], ['high', 'Alta'], ['urgent', 'Urgente']].map(([v, l]) => ({ v, l })) },
        { k: 'crear_tarea', etiqueta: 'Crear también un recordatorio', valor: esRecordatorio ? '1' : '', tipo: 'check' }
      ],
      faltantes: e.asignaturaId ? [] : ['asignatura'],
      pregunta: e.asignaturaId ? null : {
        texto: '¿De qué asignatura es la lectura?',
        opciones: ctx.asignaturas.slice(0, 6).map((s) => ({ etiqueta: s.nombre, texto: `${t} de ${s.nombre}` }))
      },
      accion: { tipo: 'crear', tabla: 'readings' }
    });
  }

  /* ------------------------------------------------------------ EVALUACIÓN */
  if (e.tipoEvaluacion && /tengo|hay|agenda|registra|crea|anota|es el|sera el/.test(n)) {
    if (!e.asignaturaId) {
      return consulta('crear_evaluacion', t, {
        espacio: 'university', faltantes: ['asignatura'],
        pregunta: {
          texto: `¿De qué asignatura es la ${TIPO_EVAL_ES[e.tipoEvaluacion].toLowerCase()}?`,
          opciones: ctx.asignaturas.slice(0, 6).map((s) => ({ etiqueta: s.nombre, texto: `${t} de ${s.nombre}` }))
        },
        respuesta: { texto: '¿De qué asignatura?', nota: 'No creo evaluaciones de asignaturas que no existen.' }
      });
    }
    return base('crear_evaluacion', t, {
      espacio: 'university',
      resumen: `Se agrega a ${e.asignaturaNombre} y aparece en el calendario académico.`,
      entidades: { asignaturaId: e.asignaturaId, tipoEvaluacion: e.tipoEvaluacion, fecha: e.fecha, hora: e.hora },
      campos: [
        { k: 'title', etiqueta: 'Título', valor: `${TIPO_EVAL_ES[e.tipoEvaluacion]} de ${e.asignaturaNombre}`, tipo: 'texto', requerido: true },
        { k: 'course_id', etiqueta: 'Asignatura', valor: e.asignaturaId, tipo: 'select', opciones: opcionesAsignaturas },
        { k: 'type', etiqueta: 'Tipo', valor: e.tipoEvaluacion, tipo: 'select',
          opciones: Object.entries(TIPO_EVAL_ES).map(([v, l]) => ({ v, l })) },
        { k: 'due_date', etiqueta: 'Fecha', valor: e.fecha ?? '', tipo: 'fecha', requerido: true },
        { k: 'due_time', etiqueta: 'Hora', valor: e.hora ?? '18:30', tipo: 'hora' },
        { k: 'weight', etiqueta: 'Ponderación (%)', valor: String(e.ponderacion ?? 25), tipo: 'numero' },
        { k: 'syllabus', etiqueta: 'Temario', valor: '', tipo: 'textarea' }
      ],
      faltantes: e.fecha ? [] : ['fecha'],
      pregunta: e.fecha ? null : { texto: `¿Qué día es la ${TIPO_EVAL_ES[e.tipoEvaluacion].toLowerCase()}?` },
      accion: { tipo: 'crear', tabla: 'assessments' }
    });
  }

  /* ------------------------------------------------------ SESIÓN DE ESTUDIO */
  if (/sesion de estudio|bloque de estudio|estudiar/.test(n)) {
    return base('crear_sesion_estudio', t, {
      espacio: 'university',
      resumen: 'Se agenda en el planificador y aparece en la agenda del día.',
      entidades: { asignaturaId: e.asignaturaId, fecha: e.fecha, hora: e.hora, duracionMin: e.duracionMin },
      campos: [
        { k: 'title', etiqueta: 'Título', valor: `Sesión de estudio${e.asignaturaNombre ? `: ${e.asignaturaNombre}` : ''}`, tipo: 'texto', requerido: true },
        { k: 'course_id', etiqueta: 'Asignatura', valor: e.asignaturaId ?? '', tipo: 'select', opciones: opcionesAsignaturas },
        { k: 'scheduled_date', etiqueta: 'Fecha', valor: e.fecha ?? ctx.hoy, tipo: 'fecha', requerido: true },
        { k: 'scheduled_time', etiqueta: 'Hora', valor: e.hora ?? '20:30', tipo: 'hora' },
        { k: 'duration_min', etiqueta: 'Duración (min)', valor: String(e.duracionMin ?? 60), tipo: 'numero' },
        { k: 'type', etiqueta: 'Tipo', valor: 'study', tipo: 'select',
          opciones: [['study', 'Estudio'], ['review', 'Repaso'], ['practice', 'Ejercicios'], ['summary', 'Síntesis']].map(([v, l]) => ({ v, l })) }
      ],
      accion: { tipo: 'crear', tabla: 'study_sessions' }
    });
  }

  /* ------------------------------------------------- NOVEDAD DE PERSONA --- */
  if (/licencia|vacacion|reemplaz|renunci|se va|capacitacion|amonestacion/.test(n)) {
    const infinitivo = /^(crea|crear|nueva tarea|recuerdame|recordarme|agenda|agendar|necesito)/.test(n) || /\b(reemplazar|cubrir|contratar|buscar)\b/.test(n);
    if (e.personaId || !infinitivo) {
      if (!e.personaId) {
        const nombre = (t.match(/\b(?:que|a)\s+([A-ZÁÉÍÓÚÑ][a-záéíóúñ]{2,})\b/) ?? [])[1];
        return consulta('registrar_novedad_persona', t, {
          espacio: 'work', faltantes: ['persona'],
          pregunta: {
            texto: nombre ? `No tengo a nadie llamado «${nombre}» en tu equipo. ¿A quién te refieres?` : '¿De qué persona es la novedad?',
            opciones: ctx.personas.slice(0, 6).map((p) => ({ etiqueta: p.nombre, texto: t.replace(nombre ?? '@@', p.nombre.split(' ')[0]) }))
          },
          respuesta: { texto: 'Necesito saber de quién se trata.', nota: 'No registro novedades de personas que no existen en tu equipo.' }
        });
      }
      const tipo = /licencia/.test(n) ? 'sick_leave' : /vacacion/.test(n) ? 'vacation' : /reemplaz/.test(n) ? 'replacement'
        : /renunci|se va/.test(n) ? 'resignation' : /capacitacion/.test(n) ? 'training' : 'warning';
      return base('registrar_novedad_persona', t, {
        espacio: 'work',
        resumen: `Se registra la novedad y se actualiza el estado de ${e.personaNombre}. Solo tipo y fechas: nunca diagnósticos.`,
        entidades: { personaId: e.personaId, personaNombre: e.personaNombre },
        campos: [
          { k: 'person_id', etiqueta: 'Persona', valor: e.personaId, tipo: 'select',
            opciones: ctx.personas.map((p) => ({ v: p.id, l: p.nombre })) },
          { k: 'type', etiqueta: 'Tipo de novedad', valor: tipo, tipo: 'select',
            opciones: [['sick_leave', 'Licencia'], ['vacation', 'Vacaciones'], ['replacement', 'Reemplazo'],
              ['onboarding', 'Ingreso'], ['resignation', 'Renuncia'], ['training', 'Capacitación'], ['warning', 'Amonestación']].map(([v, l]) => ({ v, l })) },
          { k: 'starts_on', etiqueta: 'Desde', valor: e.fechaFin ? ctx.hoy : (e.fecha ?? ctx.hoy), tipo: 'fecha', requerido: true },
          { k: 'ends_on', etiqueta: 'Hasta', valor: e.fechaFin ?? '', tipo: 'fecha' },
          { k: 'note', etiqueta: 'Observación operativa', valor: '', tipo: 'texto', ayuda: 'Sin información médica.' }
        ],
        avisos: ['datos_minimos'],
        accion: { tipo: 'novedad' }
      });
    }
  }

  /* -------------------------------------------------------------- REUNIÓN */
  if (/\b(reunion|reunirme|junta|videollamada|meet|zoom|cita con)\b/.test(n)) {
    const fecha = e.fecha ?? sumarDias(ctx.hoy, 1);
    return base('crear_reunion', t, {
      espacio: e.espacio === 'university' ? 'university' : 'work',
      resumen: `Se crea el evento y aparece en Inicio y en la Agenda.${e.marcaNombre ? ` Queda asociado a ${e.marcaNombre}.` : ''}`,
      entidades: { marcaId: e.marcaId, fecha, hora: e.hora },
      campos: [
        { k: 'title', etiqueta: 'Título', valor: `Reunión${e.marcaNombre ? ` con ${e.marcaNombre}` : ''}`, tipo: 'texto', requerido: true },
        { k: 'brand_id', etiqueta: 'Marca', valor: e.marcaId ?? '', tipo: 'select', opciones: opcionesMarcas },
        { k: 'fecha', etiqueta: 'Fecha', valor: fecha, tipo: 'fecha', requerido: true },
        { k: 'hora', etiqueta: 'Hora', valor: e.hora ?? '10:00', tipo: 'hora', requerido: true },
        { k: 'duracion_min', etiqueta: 'Duración (min)', valor: String(e.duracionMin ?? 60), tipo: 'numero' },
        { k: 'location', etiqueta: 'Lugar o enlace', valor: '', tipo: 'texto' },
        { k: 'objective', etiqueta: 'Objetivo', valor: '', tipo: 'texto' },
        { k: 'participantes', etiqueta: 'Participantes', valor: '', tipo: 'texto', ayuda: 'Separados por coma.' }
      ],
      faltantes: e.hora ? [] : ['hora'],
      accion: { tipo: 'crear', tabla: 'meetings' }
    });
  }

  /* ------------------------------------------------- NOTA / RECORDATORIO -- */
  const esNota = /^(anota|apunta|toma nota)\b/.test(n) && !/tarea/.test(n);
  const esperando = /esta esperando|quedo esperando|esperando respuesta|a la espera/.test(n);

  if (esNota && !esperando) {
    const contenido = t.replace(/^(anota|ap[uú]nta|apunta|toma nota)\s*(que|:)?\s*/i, '').trim();
    return base('registrar_nota', t, {
      espacio: e.espacio,
      resumen: 'Se guarda en Notas. Después puedes convertirla sin perder el texto original.',
      entidades: { marcaId: e.marcaId, asignaturaId: e.asignaturaId },
      campos: [
        { k: 'title', etiqueta: 'Título', valor: contenido.slice(0, 70), tipo: 'texto', requerido: true },
        { k: 'content', etiqueta: 'Contenido', valor: contenido, tipo: 'textarea' },
        { k: 'space', etiqueta: 'Espacio', valor: e.espacio, tipo: 'select',
          opciones: [['work', 'Trabajo'], ['university', 'Universidad'], ['personal', 'Personal']].map(([v, l]) => ({ v, l })) },
        { k: 'brand_id', etiqueta: 'Marca', valor: e.marcaId ?? '', tipo: 'select', opciones: opcionesMarcas },
        { k: 'course_id', etiqueta: 'Asignatura', valor: e.asignaturaId ?? '', tipo: 'select', opciones: [{ v: '', l: '— Sin asignatura —' }].concat(opcionesAsignaturas) }
      ],
      accion: { tipo: 'crear', tabla: 'notes' }
    });
  }

  const esRecordatorio = /^(recuerdame|recordarme|avisame|no me dejes olvidar)/.test(n);
  let titulo = t.replace(/^(recu[eé]rdame|recordarme|recordar|av[ií]same|tengo que|debo|necesito|hay que|crea(r)?\s+(una\s+)?tarea(\s+urgente|\s+importante)?(\s+para)?|nueva tarea)\s*/i, '').trim();
  titulo = limpiarTitulo(titulo);
  titulo = titulo.charAt(0).toUpperCase() + titulo.slice(1);

  const prioridad = e.prioridad ?? 'medium';
  const avisos: Aviso[] = [];
  const campos: CampoPropuesta[] = [
    { k: 'title', etiqueta: 'Título', valor: titulo, tipo: 'texto', requerido: true },
    { k: 'space', etiqueta: 'Espacio', valor: e.espacio, tipo: 'select',
      opciones: [['work', 'Trabajo'], ['university', 'Universidad'], ['personal', 'Personal']].map(([v, l]) => ({ v, l })) },
    { k: 'priority', etiqueta: 'Prioridad', valor: prioridad, tipo: 'select',
      opciones: [['low', 'Baja'], ['medium', 'Media'], ['high', 'Alta'], ['urgent', 'Urgente']].map(([v, l]) => ({ v, l })) },
    { k: 'status', etiqueta: 'Estado', valor: esperando ? 'waiting' : 'pending', tipo: 'select',
      opciones: [['pending', 'Pendiente'], ['in_progress', 'En curso'], ['waiting', 'Esperando respuesta']].map(([v, l]) => ({ v, l })) },
    { k: 'fecha', etiqueta: 'Vence el', valor: e.fecha ?? '', tipo: 'fecha' },
    { k: 'hora', etiqueta: 'Hora', valor: e.hora ?? (e.fecha ? '18:00' : ''), tipo: 'hora' },
    { k: 'brand_id', etiqueta: 'Marca', valor: e.marcaId ?? '', tipo: 'select', opciones: opcionesMarcas },
    { k: 'course_id', etiqueta: 'Asignatura', valor: e.asignaturaId ?? '', tipo: 'select', opciones: [{ v: '', l: '— Sin asignatura —' }].concat(opcionesAsignaturas) },
    { k: 'assignee', etiqueta: 'Responsable', valor: e.responsable ?? '', tipo: 'texto' },
    { k: 'description', etiqueta: 'Descripción', valor: '', tipo: 'textarea' }
  ];

  const propuesta = base(esRecordatorio ? 'crear_recordatorio' : 'crear_tarea', t, {
    espacio: e.espacio,
    resumen: `${esRecordatorio ? 'Se crea el recordatorio' : 'Se crea la tarea'} en tu espacio de ${e.espacio === 'work' ? 'trabajo' : e.espacio === 'university' ? 'universidad' : 'vida personal'}.${esperando ? ' Queda en «esperando respuesta».' : ''}`,
    entidades: e,
    campos,
    avisos,
    accion: { tipo: 'crear', tabla: 'tasks' }
  });

  /* Menciona un lugar que no está registrado: se pregunta, no se inventa. */
  if (e.lugarDesconocido && !e.tiendaId) {
    propuesta.avisos = ['lugar_desconocido'];
    propuesta.pregunta = {
      texto: `No tengo ninguna tienda registrada en ${e.lugarDesconocido}. ¿A cuál corresponde?`,
      opciones: ctx.tiendas.slice(0, 5)
        .map((s) => ({ etiqueta: `${s.nombre}${s.ciudad ? ` · ${s.ciudad}` : ''}`, texto: t.replace(new RegExp(e.lugarDesconocido!, 'i'), s.nombre) }))
        .concat([{ etiqueta: 'Dejar sin tienda', texto: t.replace(new RegExp(`\\s*(de|en)\\s+${e.lugarDesconocido}`, 'i'), '') }])
    };
  }
  return propuesta;
}

export { ENTIDADES_VACIAS, hoyISO, fmtFecha };
