/** Asistente de Nexo: motor de reglas, contrato JSON y ejecución confirmada. */
export * from './types';
export * from './datetime';
export * from './entities';
export { interpretarPorReglas } from './rules';
export { assistantService, iaService, obtenerContexto, invalidarContexto, generarMensaje } from './assistant.service';

/** Ejemplos clicables que se muestran en el chat, agrupados por espacio. */
export const EJEMPLOS_ASISTENTE: Record<'work' | 'university' | 'personal', string[]> = {
  work: [
    'Recuérdame pedir las ventas de Gnomo mañana a las 10',
    'Tengo reunión con Luau el miércoles a las 15:00',
    'Trauko está esperando respuesta de Recursos Humanos',
    'Crea una tarea urgente para reemplazar a la persona de Osorno',
    '¿Qué tengo pendiente esta semana con Dolce Gusto?',
    'Anota que Camila estará con licencia hasta el viernes',
    'Calcula nueve horas menos una hora de colación',
    'Dame el monto neto de $678.838',
    'Redacta un mensaje firme para recordar el envío del reporte'
  ],
  university: [
    'Tengo prueba de Derecho Constitucional el 2 de septiembre',
    'Necesito estudiar cinco unidades antes de la prueba',
    'Crea un plan de estudio desde mañana',
    'Recuérdame leer 30 páginas de Derecho Civil el sábado',
    'Crea una sesión de estudio de dos horas mañana a las 20:00',
    'Agrega este texto como apunte de fuentes del Derecho',
    'Crea diez preguntas de repaso sobre esta materia',
    '¿Cuánto me falta para terminar la lectura?',
    '¿Qué nota necesito en el examen para aprobar?',
    'Muéstrame mis evaluaciones de los próximos 30 días',
    'Registra este fallo para revisarlo después',
    'Crea una ficha de caso con los hechos, problema jurídico y decisión'
  ],
  personal: [
    'Recuérdame pagar las cuentas el viernes',
    'Anota que tengo que renovar la licencia de conducir',
    '¿Qué tengo agendado hoy?'
  ]
};
