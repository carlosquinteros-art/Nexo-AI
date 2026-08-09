-- ============================================================================
-- NEXO — Datos iniciales OPCIONALES
--
-- Crea una función que siembra datos de ejemplo para el usuario que la ejecuta.
-- No usa IDs fijos ni el rol service_role: todo cuelga de auth.uid().
--
-- CÓMO USARLO
--   1. Ejecutar este archivo una vez en el SQL Editor (crea las funciones).
--   2. Iniciar sesión en la app con tu cuenta.
--   3. Desde la app: Configuración → Datos → "Cargar datos de ejemplo".
--      O bien, desde el SQL Editor autenticado: select public.seed_demo_data();
--
--   Para dejar la cuenta en blanco: select public.wipe_my_data();
--
-- IMPORTANTE
--   Todo lo académico y jurídico que siembra este archivo queda marcado con
--   `is_demo = true`. Los profesores son ficticios y ninguna fuente jurídica
--   está verificada: son plantillas para que las reemplaces con tus datos.
--
-- Las fechas son relativas a hoy, así que el ejemplo siempre luce vigente.
-- ============================================================================

create or replace function public.seed_demo_data()
returns text
language plpgsql
security invoker
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  v_period uuid;
  b_gnomo uuid; b_luau uuid; b_trauko uuid; b_dolce uuid; b_hypnos uuid; b_inzt uuid; b_arde uuid;
  s_costanera uuid; s_arauco uuid; s_marina uuid; s_altolas uuid; s_vespucio uuid;
  s_oeste uuid; s_trebol uuid; s_serena uuid; s_egana uuid; s_montt uuid;
  p_javiera uuid; p_camila uuid; p_diego uuid; p_valentina uuid; p_nicolas uuid;
  p_constanza uuid; p_martina uuid; p_ignacio uuid; p_sofia uuid; p_renata uuid;
  c_civil uuid; c_const uuid; c_proc uuid; c_penal uuid; c_intro uuid;
  u_fuentes_ob uuid; u_efectos uuid; u_modos uuid; u_ddff uuid; u_recursos uuid;
  u_juris uuid; u_compet uuid; u_delito uuid; u_fuentes_d uuid;
  a_civil2 uuid; a_const2 uuid; a_proc1 uuid; a_intro2 uuid; a_penal1 uuid;
  m_trauko uuid;
  t_plan uuid;
  ls_cc uuid; ls_cpr uuid;
  n integer;
begin
  if uid is null then
    raise exception 'Debes ejecutar esto con una sesión iniciada (auth.uid() es null).';
  end if;

  select count(*) into n from public.brands where user_id = uid and deleted_at is null;
  if n > 0 then
    return 'Ya tienes datos cargados. Si quieres partir de cero: select public.wipe_my_data();';
  end if;

  -- ---------------------------------------------------------------- TRABAJO
  insert into public.brands (user_id, name, client_name, category, status, notes) values
    (uid, 'Gnomo Wear',   'Gnomo SpA',            'Vestuario', 'needs_attention', 'Campaña primavera parte en 3 semanas. Falta confirmar dotación de fin de semana.'),
    (uid, 'Luau Shoes',   'Comercial Luau Ltda.', 'Calzado',   'on_track',        'Cliente ordenado, reporta ventas todos los lunes.'),
    (uid, 'Trauko',       'Trauko Retail',        'Vestuario', 'critical',        'Dos tiendas sin cobertura hace más de una semana.'),
    (uid, 'Dolce Gusto',  'Nestlé Chile',         'Café',      'on_track',        'Activación de degustación los fines de semana.'),
    (uid, 'Hypnos',       'Hypnos Chile',         'Descanso',  'needs_attention', 'Sell out bajo en regiones. Revisar exhibición y capacitación.'),
    (uid, 'Inztinto',     'Inztinto SpA',         'Vestuario', 'on_track',        null),
    (uid, 'Arde x Athar', 'Athar Beauty',         'Belleza',   'needs_attention', 'Lanzamiento en 2 tiendas nuevas. Falta material POP.');

  select id into b_gnomo  from public.brands where user_id = uid and name = 'Gnomo Wear';
  select id into b_luau   from public.brands where user_id = uid and name = 'Luau Shoes';
  select id into b_trauko from public.brands where user_id = uid and name = 'Trauko';
  select id into b_dolce  from public.brands where user_id = uid and name = 'Dolce Gusto';
  select id into b_hypnos from public.brands where user_id = uid and name = 'Hypnos';
  select id into b_inzt   from public.brands where user_id = uid and name = 'Inztinto';
  select id into b_arde   from public.brands where user_id = uid and name = 'Arde x Athar';

  insert into public.contacts (user_id, brand_id, full_name, role_title, email, phone) values
    (uid, b_gnomo,  'Paula Ríos',         'Jefa de Retail',    'paula.rios@gnomo.cl',      '+56 9 5555 1010'),
    (uid, b_luau,   'Matías Fuentes',     'Trade Manager',     'mfuentes@luau.cl',         '+56 9 5555 2020'),
    (uid, b_trauko, 'Carolina Sepúlveda', 'Jefa Comercial',    'csepulveda@trauko.cl',     '+56 9 5555 3030'),
    (uid, b_dolce,  'Rodrigo Vera',       'Key Account',       'rodrigo.vera@nestle.cl',   '+56 9 5555 4040'),
    (uid, b_hypnos, 'Ignacio Bravo',      'Gerente de Ventas', 'ibravo@hypnos.cl',         '+56 9 5555 5050'),
    (uid, b_arde,   'Josefa Muñoz',       'Brand Manager',     'jmunoz@athar.cl',          '+56 9 5555 7070');

  insert into public.stores (user_id, brand_id, name, chain, city, region, format, status) values
    (uid, b_gnomo,  'Paris Costanera Center',     'Paris',     'Santiago',     'Metropolitana', 'Perchero', 'active'),
    (uid, b_gnomo,  'Falabella Parque Arauco',    'Falabella', 'Santiago',     'Metropolitana', 'Perchero', 'active'),
    (uid, b_gnomo,  'Paris Marina Arauco',        'Paris',     'Viña del Mar', 'Valparaíso',    'Perchero', 'active'),
    (uid, b_luau,   'Falabella Alto Las Condes',  'Falabella', 'Santiago',     'Metropolitana', 'Corner',   'active'),
    (uid, b_luau,   'Paris Plaza Vespucio',       'Paris',     'Santiago',     'Metropolitana', 'Corner',   'active'),
    (uid, b_trauko, 'Paris Plaza Oeste',          'Paris',     'Santiago',     'Metropolitana', 'Perchero', 'uncovered'),
    (uid, b_trauko, 'Falabella Mall Plaza Trébol','Falabella', 'Concepción',   'Biobío',        'Perchero', 'uncovered'),
    (uid, b_trauko, 'Paris La Serena',            'Paris',     'La Serena',    'Coquimbo',      'Perchero', 'active'),
    (uid, b_dolce,  'Falabella Costanera Center', 'Falabella', 'Santiago',     'Metropolitana', 'Isla',     'active'),
    (uid, b_dolce,  'Paris Alto Las Condes',      'Paris',     'Santiago',     'Metropolitana', 'Isla',     'active'),
    (uid, b_hypnos, 'Falabella Mall Plaza Egaña', 'Falabella', 'Santiago',     'Metropolitana', 'Góndola',  'active'),
    (uid, b_hypnos, 'Paris Puerto Montt',         'Paris',     'Puerto Montt', 'Los Lagos',     'Góndola',  'active'),
    (uid, b_inzt,   'Paris Mall Plaza Norte',     'Paris',     'Santiago',     'Metropolitana', 'Perchero', 'active'),
    (uid, b_arde,   'Falabella Parque Arauco',    'Falabella', 'Santiago',     'Metropolitana', 'Isla',     'active');

  select id into s_costanera from public.stores where user_id = uid and name = 'Paris Costanera Center';
  select id into s_arauco    from public.stores where user_id = uid and name = 'Falabella Parque Arauco' and brand_id = b_gnomo;
  select id into s_marina    from public.stores where user_id = uid and name = 'Paris Marina Arauco';
  select id into s_altolas   from public.stores where user_id = uid and name = 'Falabella Alto Las Condes';
  select id into s_vespucio  from public.stores where user_id = uid and name = 'Paris Plaza Vespucio';
  select id into s_oeste     from public.stores where user_id = uid and name = 'Paris Plaza Oeste';
  select id into s_trebol    from public.stores where user_id = uid and name = 'Falabella Mall Plaza Trébol';
  select id into s_serena    from public.stores where user_id = uid and name = 'Paris La Serena';
  select id into s_egana     from public.stores where user_id = uid and name = 'Falabella Mall Plaza Egaña';
  select id into s_montt     from public.stores where user_id = uid and name = 'Paris Puerto Montt';

  -- Solo datos operativos: sin RUT, sin dirección, sin información de salud.
  insert into public.people (user_id, brand_id, store_id, full_name, role_title, shift, status, started_on) values
    (uid, b_gnomo,  s_costanera, 'Javiera Soto',     'Promotora', 'Full time',     'sick_leave',  current_date - 200),
    (uid, b_gnomo,  s_arauco,    'Camila Herrera',   'Promotora', 'Full time',     'active',      current_date - 90),
    (uid, b_gnomo,  s_marina,    'Fernanda Aguilar', 'Promotora', 'Part time',     'active',      current_date - 45),
    (uid, b_luau,   s_altolas,   'Diego Contreras',  'Promotor',  'Full time',     'active',      current_date - 300),
    (uid, b_luau,   s_vespucio,  'Antonia Lagos',    'Promotora', 'Fin de semana', 'active',      current_date - 60),
    (uid, b_trauko, s_serena,    'Valentina Muñoz',  'Promotora', 'Full time',     'active',      current_date - 150),
    (uid, b_trauko, s_oeste,     'Nicolás Pérez',    'Promotor',  'Full time',     'resigned',    current_date - 260),
    (uid, b_dolce,  null,        'Constanza Rojas',  'Captadora', 'Fin de semana', 'active',      current_date - 30),
    (uid, b_dolce,  null,        'Martina Silva',    'Captadora', 'Fin de semana', 'vacation',    current_date - 180),
    (uid, b_hypnos, s_egana,     'Ignacio Torres',   'Promotor',  'Full time',     'active',      current_date - 75),
    (uid, b_arde,   null,        'Sofía Cárdenas',   'Promotora', 'Full time',     'active',      current_date - 15),
    (uid, b_arde,   s_costanera, 'Renata Espinoza',  'Promotora', 'Part time',     'replacement', current_date - 5);

  select id into p_javiera   from public.people where user_id = uid and full_name = 'Javiera Soto';
  select id into p_camila    from public.people where user_id = uid and full_name = 'Camila Herrera';
  select id into p_diego     from public.people where user_id = uid and full_name = 'Diego Contreras';
  select id into p_valentina from public.people where user_id = uid and full_name = 'Valentina Muñoz';
  select id into p_nicolas   from public.people where user_id = uid and full_name = 'Nicolás Pérez';
  select id into p_constanza from public.people where user_id = uid and full_name = 'Constanza Rojas';
  select id into p_martina   from public.people where user_id = uid and full_name = 'Martina Silva';
  select id into p_ignacio   from public.people where user_id = uid and full_name = 'Ignacio Torres';
  select id into p_sofia     from public.people where user_id = uid and full_name = 'Sofía Cárdenas';
  select id into p_renata    from public.people where user_id = uid and full_name = 'Renata Espinoza';

  insert into public.people_events (user_id, person_id, type, starts_on, ends_on, replaces_id, note) values
    (uid, p_javiera, 'sick_leave',  current_date - 2, current_date + 4, null,      'Licencia presentada. Solo se registran fechas.'),
    (uid, p_martina, 'vacation',    current_date - 3, current_date + 11, null,     'Vacaciones legales aprobadas.'),
    (uid, p_renata,  'replacement', current_date - 5, current_date + 9, p_javiera, 'Reemplazo por licencia.'),
    (uid, p_nicolas, 'resignation', current_date - 8, null, null,                  'Renuncia voluntaria. Tienda sin cobertura.'),
    (uid, p_sofia,   'onboarding',  current_date - 15, null, null,                 'Ingreso con capacitación de marca realizada.');

  insert into public.requests (user_id, brand_id, title, requested_to, channel, requested_on, committed_on, status, detail) values
    (uid, b_gnomo,  'Ventas semana 31 por tienda',           'Cliente',      current_date - 4, current_date - 1, 'no_reply',    'Sin respuesta al correo del lunes.'),
    (uid, b_trauko, 'Autorización de dotación de reemplazo', 'Cliente',      current_date - 6, current_date - 2, 'no_reply',    'Necesario para recuperar cobertura.'),
    (uid, b_trauko, 'Plan de recuperación de cobertura',     'Operaciones',  current_date - 2, current_date + 1, 'in_progress', 'Propuesta con fechas y personas asignadas.'),
    (uid, b_arde,   'Envío de material POP a 2 tiendas',     'Cliente',      current_date - 3, current_date + 2, 'open',        'Faltan tótem y bandeja de muestras.'),
    (uid, b_hypnos, 'Capacitación de vendedores regiones',   'Cliente',      current_date - 7, current_date + 3, 'in_progress', 'Coordinar fecha con jefaturas.'),
    (uid, b_luau,   'Confirmación de metas de agosto',       'Cliente',      current_date - 9, current_date - 6, 'answered',    'Metas confirmadas y cargadas.'),
    (uid, b_gnomo,  'Liquidaciones pendientes de firma',     'RRHH',         current_date - 5, current_date,     'in_progress', 'Tres firmas pendientes.');

  insert into public.incidents (user_id, brand_id, store_id, person_id, title, description, severity, status, detected_at) values
    (uid, b_trauko, s_oeste,  p_nicolas, 'Plaza Oeste sin cobertura hace 8 días', 'Renuncia sin aviso. Se requiere autorización del cliente.', 'critical', 'in_progress', now() - interval '8 days'),
    (uid, b_trauko, s_trebol, null,      'Trébol sin cobertura',                  'Sin persona asignada desde la baja.',                       'high',     'open',        now() - interval '6 days'),
    (uid, b_hypnos, s_montt,  null,      'Exhibición desordenada en Puerto Montt','Producto mezclado con competencia, sin precio visible.',    'medium',   'open',        now() - interval '4 days'),
    (uid, b_arde,   null,     null,      'Lanzamiento sin material POP',          'Impacta la visibilidad de la marca en el debut.',           'high',     'in_progress', now() - interval '3 days');

  insert into public.meetings (user_id, space, brand_id, title, starts_at, ends_at, location, objective, status) values
    (uid, 'work', b_trauko, 'Reunión de seguimiento — Trauko', (current_date + 0)::timestamptz + interval '11 hours', (current_date + 0)::timestamptz + interval '12 hours', 'Oficina cliente', 'Presentar plan de recuperación de cobertura', 'scheduled'),
    (uid, 'work', null,     'Comité semanal Touch',            (current_date + 1)::timestamptz + interval '9.5 hours', (current_date + 1)::timestamptz + interval '10.5 hours', 'Sala de reuniones', 'Revisión de cobertura y pendientes', 'scheduled'),
    (uid, 'work', b_luau,   'Reunión con Luau',                (current_date + 2)::timestamptz + interval '15 hours', (current_date + 2)::timestamptz + interval '16 hours', 'Google Meet', 'Revisar cumplimiento de metas de agosto', 'scheduled'),
    (uid, 'work', b_arde,   'Kick off Arde x Athar',           (current_date + 4)::timestamptz + interval '10 hours', (current_date + 4)::timestamptz + interval '11 hours', 'Oficina', 'Definir apertura y material POP', 'scheduled');

  select id into m_trauko from public.meetings where user_id = uid and title = 'Reunión de seguimiento — Trauko';

  insert into public.meeting_participants (user_id, meeting_id, display_name, role_title) values
    (uid, m_trauko, 'Carolina Sepúlveda', 'Cliente'),
    (uid, m_trauko, 'Carlos Quinteros',   'Coordinador');

  insert into public.agreements (user_id, meeting_id, brand_id, type, title, detail, owner_name, agreed_on, due_date, status, impact) values
    (uid, m_trauko, b_trauko, 'agreement',   'Enviar plan de recuperación el lunes', 'Acordado con Carolina Sepúlveda.',           'Carlos',         current_date - 2, current_date + 1, 'in_progress', 'high'),
    (uid, null,     b_hypnos, 'finding',     'Exhibición desordenada en Puerto Montt','Producto sin precio visible.',              'Ignacio Torres', current_date - 4, null,             'open',        'medium'),
    (uid, null,     b_hypnos, 'opportunity', 'Espacio libre junto a caja en Egaña',   'Buena ubicación para exhibición adicional.','Carlos',         current_date - 4, null,             'open',        'medium'),
    (uid, null,     b_gnomo,  'opportunity', 'Replicar discurso de venta de Parque Arauco', 'Camila tiene la mejor conversión.',   'Carlos',         current_date - 6, null,             'open',        'medium');

  insert into public.message_templates (user_id, title, audience, tone, body) values
    (uid, 'Solicitud de reporte diario', 'team', 'firm',
     E'Equipo:\n\nNecesito el reporte diario de ventas con carácter prioritario. Este punto ya fue solicitado y su demora afecta el compromiso con el cliente.\n\nAgradeceré su respuesta hoy antes del cierre de jornada.\n\nSaludos,\nCarlos Quinteros'),
    (uid, 'Recordatorio de firmas pendientes', 'hr', 'executive',
     E'Estimados:\n\nSolicito su gestión respecto de las firmas pendientes del equipo. Esta información es necesaria para cerrar el proceso del mes.\n\nQuedo atento a su confirmación.\n\nSaludos cordiales,\nCarlos Quinteros');

  -- ------------------------------------------------------------ UNIVERSIDAD
  insert into public.academic_periods (user_id, name, starts_on, ends_on, is_current)
  values (uid, '2º semestre ' || extract(year from current_date)::text, date_trunc('year', current_date)::date + 180, date_trunc('year', current_date)::date + 330, true)
  returning id into v_period;

  /* Asignaturas DEMOSTRATIVAS. Los nombres de profesor son ficticios y las
     fichas quedan marcadas con is_demo para que la interfaz las etiquete. */
  insert into public.courses (user_id, period_id, name, code, professor, room_modality, credits, schedule, bibliography, links) values
    (uid, v_period, 'Derecho Civil II',        'DER-210', 'Prof. Alejandro Ibáñez',  'Sala 402 · Presencial', 6,
     '[{"day":1,"start":"18:30","end":"20:00"},{"day":3,"start":"18:30","end":"20:00"}]',
     '[{"title":"Las obligaciones","author":"René Abeliuk","required":true}]',
     '[{"title":"Código Civil en BCN","url":"https://www.bcn.cl/leychile"}]'),
    (uid, v_period, 'Derecho Constitucional',  'DER-150', 'Prof. María Elena Cortés','Sala 305 · Presencial', 6,
     '[{"day":2,"start":"18:30","end":"20:00"},{"day":4,"start":"18:30","end":"20:00"}]',
     '[{"title":"Derecho Constitucional chileno","author":"José Luis Cea","required":true}]',
     '[{"title":"Constitución en BCN","url":"https://www.bcn.cl/leychile"}]'),
    (uid, v_period, 'Derecho Procesal I',      'DER-230', 'Prof. Rodrigo Vidal',     'Online · Zoom', 5,
     '[{"day":5,"start":"19:00","end":"21:30"}]',
     '[{"title":"Derecho Procesal Orgánico","author":"Cristián Maturana","required":true}]', '[]'),
    (uid, v_period, 'Derecho Penal I',         'DER-220', 'Prof. Carmen Gloria Ruiz','Sala 210 · Presencial', 5,
     '[{"day":4,"start":"20:15","end":"21:45"}]',
     '[{"title":"Lecciones de Derecho Penal chileno","author":"Politoff, Matus y Ramírez","required":true}]', '[]'),
    (uid, v_period, 'Introducción al Derecho', 'DER-110', 'Prof. Sebastián Núñez',   'Sala 108 · Presencial', 4,
     '[{"day":2,"start":"20:15","end":"21:45"}]',
     '[{"title":"Introducción al Derecho","author":"Agustín Squella","required":true}]', '[]');

  select id into c_civil from public.courses where user_id = uid and name = 'Derecho Civil II';
  select id into c_const from public.courses where user_id = uid and name = 'Derecho Constitucional';
  select id into c_proc  from public.courses where user_id = uid and name = 'Derecho Procesal I';
  select id into c_penal from public.courses where user_id = uid and name = 'Derecho Penal I';
  select id into c_intro from public.courses where user_id = uid and name = 'Introducción al Derecho';

  /* Sello de ejemplo en todo el bloque académico. */
  update public.courses set is_demo = true where user_id = uid;

  insert into public.course_units (user_id, course_id, name, position, difficulty, mastery, pages) values
    (uid, c_civil, 'Teoría general de las obligaciones', 1, 3, 'mastered',    45),
    (uid, c_civil, 'Fuentes de las obligaciones',        2, 4, 'in_progress', 60),
    (uid, c_civil, 'Efectos de las obligaciones',        3, 4, 'initial',     55),
    (uid, c_civil, 'Modos de extinguir las obligaciones',4, 5, 'not_started', 70),
    (uid, c_const, 'Bases de la institucionalidad',      1, 2, 'mastered',    30),
    (uid, c_const, 'Derechos fundamentales',             2, 4, 'in_progress', 80),
    (uid, c_const, 'Recursos de protección y amparo',    3, 4, 'initial',     50),
    (uid, c_const, 'Órganos del Estado',                 4, 3, 'not_started', 65),
    (uid, c_proc,  'Jurisdicción',                       1, 3, 'in_progress', 40),
    (uid, c_proc,  'Competencia',                        2, 4, 'initial',     55),
    (uid, c_proc,  'Tribunales ordinarios y especiales', 3, 3, 'not_started', 45),
    (uid, c_penal, 'Teoría de la ley penal',             1, 3, 'in_progress', 40),
    (uid, c_penal, 'Teoría del delito',                  2, 5, 'initial',     90),
    (uid, c_penal, 'Tipicidad y antijuridicidad',        3, 5, 'not_started', 70),
    (uid, c_intro, 'Concepto y funciones del Derecho',   1, 2, 'mastered',    25),
    (uid, c_intro, 'Fuentes del Derecho',                2, 3, 'in_progress', 45),
    (uid, c_intro, 'Interpretación jurídica',            3, 3, 'initial',     35);

  select id into u_fuentes_ob from public.course_units where user_id = uid and name = 'Fuentes de las obligaciones';
  select id into u_efectos    from public.course_units where user_id = uid and name = 'Efectos de las obligaciones';
  select id into u_modos      from public.course_units where user_id = uid and name = 'Modos de extinguir las obligaciones';
  select id into u_ddff       from public.course_units where user_id = uid and name = 'Derechos fundamentales';
  select id into u_recursos   from public.course_units where user_id = uid and name = 'Recursos de protección y amparo';
  select id into u_juris      from public.course_units where user_id = uid and name = 'Jurisdicción';
  select id into u_compet     from public.course_units where user_id = uid and name = 'Competencia';
  select id into u_delito     from public.course_units where user_id = uid and name = 'Teoría del delito';
  select id into u_fuentes_d  from public.course_units where user_id = uid and name = 'Fuentes del Derecho';

  insert into public.assessments (user_id, course_id, title, type, due_date, due_time, weight, syllabus) values
    (uid, c_civil, 'Prueba 1 — Teoría general',            'test',        current_date - 24, '18:30', 25, 'Unidad 1'),
    (uid, c_civil, 'Prueba 2 — Fuentes y efectos',         'test',        current_date + 20, '18:30', 30, 'Unidades 2 y 3. Incluye casos.'),
    (uid, c_civil, 'Examen final',                         'exam',        current_date + 62, '18:30', 45, 'Todo el programa'),
    (uid, c_const, 'Control 1',                            'quiz',        current_date - 18, '18:30', 15, 'Bases de la institucionalidad'),
    (uid, c_const, 'Prueba 2 — Derechos fundamentales',    'test',        current_date + 9,  '18:30', 30, 'Unidad 2 completa.'),
    (uid, c_const, 'Trabajo grupal — Recurso de protección','paper',      current_date + 16, null,    20, 'Análisis de un caso real con sentencia verificada.'),
    (uid, c_const, 'Examen final',                         'exam',        current_date + 58, '18:30', 35, 'Todo el programa'),
    (uid, c_proc,  'Control 1 — Jurisdicción',             'quiz',        current_date + 4,  '19:00', 20, 'Unidad 1'),
    (uid, c_proc,  'Prueba 1',                             'test',        current_date + 27, '19:00', 35, 'Unidades 1 y 2'),
    (uid, c_penal, 'Prueba 1 — Ley penal',                 'test',        current_date + 12, '20:15', 30, 'Unidad 1 y principios'),
    (uid, c_penal, 'Presentación de caso',                 'presentation',current_date + 34, '20:15', 20, 'Análisis de tipicidad'),
    (uid, c_intro, 'Prueba 1',                             'test',        current_date - 30, '20:15', 25, 'Unidad 1'),
    (uid, c_intro, 'Control 2 — Fuentes del Derecho',      'quiz',        current_date + 6,  '20:15', 20, 'Unidad 2');

  select id into a_civil2 from public.assessments where user_id = uid and title = 'Prueba 2 — Fuentes y efectos';
  select id into a_const2 from public.assessments where user_id = uid and title = 'Prueba 2 — Derechos fundamentales';
  select id into a_proc1  from public.assessments where user_id = uid and title = 'Control 1 — Jurisdicción';
  select id into a_intro2 from public.assessments where user_id = uid and title = 'Control 2 — Fuentes del Derecho';
  select id into a_penal1 from public.assessments where user_id = uid and title = 'Prueba 1 — Ley penal';

  -- Notas ya rendidas
  insert into public.grades (user_id, assessment_id, score, graded_on)
  select uid, a.id, v.score, current_date - 10
    from (values ('Prueba 1 — Teoría general', 5.4), ('Control 1', 6.1)) as v(t, score)
    join public.assessments a on a.user_id = uid and a.title = v.t;
  insert into public.grades (user_id, assessment_id, score, graded_on)
  select uid, id, 6.5, current_date - 20 from public.assessments
   where user_id = uid and course_id = c_intro and title = 'Prueba 1';

  insert into public.assessment_topics (user_id, assessment_id, unit_id, title, position) values
    (uid, a_const2, u_ddff,     'Catálogo de garantías del artículo 19', 1),
    (uid, a_const2, u_ddff,     'Privación, perturbación y amenaza',     2),
    (uid, a_civil2, u_fuentes_ob,'Fuentes de las obligaciones',          1),
    (uid, a_civil2, u_efectos,  'Efectos de las obligaciones',           2);

  insert into public.readings (user_id, course_id, title, author, total_pages, pages_read, due_date, priority) values
    (uid, c_const, 'Derechos fundamentales — capítulo IV', 'José Luis Cea',                  60, 18, current_date + 5,  'high'),
    (uid, c_civil, 'Fuentes de las obligaciones — cap. 3 y 4','René Abeliuk',                85, 55, current_date + 12, 'high'),
    (uid, c_civil, 'Modos de extinguir — cap. 7',         'René Abeliuk',                    70, 0,  current_date + 18, 'medium'),
    (uid, c_proc,  'Jurisdicción y competencia',          'Cristián Maturana',               55, 40, current_date + 2,  'urgent'),
    (uid, c_penal, 'Teoría del delito — introducción',    'Politoff, Matus y Ramírez',       90, 12, current_date + 10, 'high'),
    (uid, c_intro, 'Fuentes del Derecho',                 'Agustín Squella',                 45, 45, current_date - 2,  'medium');

  insert into public.study_plans (user_id, course_id, assessment_id, name, target_date, hours_per_week)
  values (uid, c_const, a_const2, 'Plan: Prueba 2 — Derechos fundamentales', current_date + 9, 8)
  returning id into t_plan;

  insert into public.study_sessions (user_id, plan_id, course_id, unit_id, assessment_id, title, scheduled_date, scheduled_time, duration_min, type, status, effective_min) values
    (uid, t_plan, c_const, u_ddff,     a_const2, 'Lectura: igualdad ante la ley',            current_date - 3, '20:30', 60, 'study',   'done',    55),
    (uid, t_plan, c_const, u_ddff,     a_const2, 'Esquema de garantías del art. 19',         current_date - 2, '20:30', 60, 'study',   'done',    60),
    (uid, t_plan, c_const, u_ddff,     a_const2, 'Repaso: garantías individuales',           current_date - 1, '20:30', 45, 'review',  'pending', 0),
    (uid, t_plan, c_const, u_ddff,     a_const2, 'Casos: privación, perturbación y amenaza', current_date,     '20:30', 60, 'practice','pending', 0),
    (uid, t_plan, c_const, u_recursos, a_const2, 'Lectura: recurso de protección',           current_date + 1, '20:30', 60, 'study',   'pending', 0),
    (uid, t_plan, c_const, u_recursos, a_const2, 'Síntesis y fichas',                        current_date + 3, '10:00', 90, 'summary', 'pending', 0),
    (uid, t_plan, c_const, null,       a_const2, 'Simulacro de prueba',                      current_date + 7, '10:00', 90, 'practice','pending', 0);

  insert into public.study_sessions (user_id, course_id, unit_id, assessment_id, reading_id, title, scheduled_date, scheduled_time, duration_min, type, status)
  select uid, c_proc, u_juris, a_proc1, r.id, 'Terminar lectura de Jurisdicción', current_date + 1, '20:30', 60, 'study', 'pending'
    from public.readings r where r.user_id = uid and r.title = 'Jurisdicción y competencia';

  insert into public.legal_sources (user_id, course_id, type, identifier, title, subject_matter, official_url, summary, verification) values
    (uid, c_civil, 'code',   'Código Civil',                          'Código Civil de la República de Chile', 'Obligaciones y contratos', 'https://www.bcn.cl/leychile', 'Texto base del curso. Consultar la versión vigente en BCN.', 'verified'),
    (uid, c_const, 'code',   'Constitución Política de la República', 'Texto refundido vigente',               'Derechos fundamentales',   'https://www.bcn.cl/leychile', 'Revisar el texto actualizado antes de citar cualquier artículo.', 'verified'),
    (uid, c_const, 'ruling', 'Sentencia por identificar',             'Caso para el trabajo grupal',           'Recurso de protección',    'https://www.pjud.cl', 'PENDIENTE: buscar la causa en el portal del Poder Judicial y registrar rol, fecha y tribunal exactos. No citar de memoria.', 'unverified'),
    (uid, c_proc,  'code',   'Código Orgánico de Tribunales',         'Organización y atribuciones',           'Jurisdicción y competencia','https://www.bcn.cl/leychile', 'Consultar el texto vigente en BCN.', 'verified'),
    (uid, c_penal, 'code',   'Código Penal',                          'Código Penal chileno',                  'Teoría del delito',        'https://www.bcn.cl/leychile', 'Base para el análisis de tipicidad.', 'verified');

  select id into ls_cc  from public.legal_sources where user_id = uid and identifier = 'Código Civil';
  select id into ls_cpr from public.legal_sources where user_id = uid and identifier = 'Constitución Política de la República';

  insert into public.legal_concepts (user_id, course_id, source_id, term, definition, origin, verification) values
    (uid, c_civil, ls_cc,  'Obligación', 'Vínculo jurídico entre dos personas determinadas, en virtud del cual una de ellas se encuentra en la necesidad de dar, hacer o no hacer algo a favor de la otra.', 'Apunte de clase + manual', 'verified'),
    (uid, c_civil, null,   'Novación',   'Modo de extinguir obligaciones que consiste en la sustitución de una obligación anterior por una nueva, que queda extinguida.', 'Apunte de clase', 'unverified'),
    (uid, c_civil, null,   'Caso fortuito','Imprevisto imposible de resistir. Verificar la definición legal exacta en el Código Civil antes de citarla.', 'Pendiente de verificación', 'unverified'),
    (uid, c_const, ls_cpr, 'Supremacía constitucional', 'Principio según el cual la Constitución se ubica en la cúspide del ordenamiento y toda norma inferior debe conformarse a ella.', 'Apunte de clase', 'verified'),
    (uid, c_const, null,   'Recurso de protección', 'Acción cautelar destinada a restablecer el imperio del Derecho frente a actos u omisiones arbitrarios o ilegales. Verificar el listado de derechos amparados en el texto vigente.', 'Apunte de clase', 'unverified'),
    (uid, c_proc,  null,   'Jurisdicción', 'Poder-deber del Estado de resolver conflictos de relevancia jurídica con efecto de cosa juzgada.', 'Apunte de clase', 'verified'),
    (uid, c_proc,  null,   'Competencia',  'Medida en que la jurisdicción se distribuye entre los distintos tribunales.', 'Manual de Maturana', 'verified'),
    (uid, c_penal, null,   'Tipicidad',    'Adecuación de una conducta concreta a la descripción abstracta contenida en un tipo penal.', 'Apunte de clase', 'verified'),
    (uid, c_penal, null,   'Antijuridicidad','Contrariedad de la conducta típica con el ordenamiento jurídico, en ausencia de causales de justificación.', 'Apunte de clase', 'verified'),
    (uid, c_intro, null,   'Fuente formal del Derecho', 'Modos o formas a través de las cuales se manifiestan y producen las normas jurídicas.', 'Squella', 'verified'),
    (uid, c_intro, null,   'Analogía',     'Método de integración que aplica a un caso no regulado la solución prevista para otro semejante, cuando concurre la misma razón.', 'Apunte de clase', 'verified');

  insert into public.legal_notes (user_id, source_id, course_id, unit_id, title, body, verification) values
    (uid, ls_cpr, c_const, u_ddff, 'Garantías del artículo 19',
     E'El artículo 19 contiene el catálogo de derechos.\nPara la prueba: distinguir privación, perturbación y amenaza.\nRevisar en BCN qué numerales ampara el recurso de protección; no confiar en el apunte.', 'unverified');

  insert into public.flashcards (user_id, course_id, unit_id, front, back, mastery, next_review) values
    (uid, c_intro, u_fuentes_d, '¿Qué son las fuentes formales del Derecho?', 'Los modos o formas a través de los cuales se producen y manifiestan las normas jurídicas.', 'in_progress', current_date),
    (uid, c_intro, u_fuentes_d, 'Diferencia entre fuente formal y fuente material', 'La formal es el modo de producción de la norma; la material son los factores sociales, económicos y políticos que influyen en su contenido.', 'initial', current_date),
    (uid, c_civil, u_fuentes_ob,'Fuentes de las obligaciones (doctrina clásica)', 'Contrato, cuasicontrato, delito, cuasidelito y la ley.', 'in_progress', current_date),
    (uid, c_civil, u_modos,     '¿Qué es la novación?', 'Sustitución de una obligación anterior por una nueva, quedando extinguida la primera.', 'not_started', current_date),
    (uid, c_const, u_ddff,      '¿Qué es la supremacía constitucional?', 'Principio según el cual la Constitución está en la cúspide del ordenamiento.', 'in_progress', current_date),
    (uid, c_proc,  u_juris,     'Defina jurisdicción', 'Poder-deber del Estado de resolver conflictos con efecto de cosa juzgada.', 'in_progress', current_date),
    (uid, c_proc,  u_compet,    'Relación entre jurisdicción y competencia', 'La competencia es la medida en que se distribuye la jurisdicción entre los tribunales.', 'initial', current_date + 2),
    (uid, c_penal, u_delito,    'Elementos del delito', 'Conducta típica, antijurídica y culpable.', 'initial', current_date);

  insert into public.practice_questions (user_id, course_id, unit_id, type, prompt, answer, options, difficulty) values
    (uid, c_intro, u_fuentes_d, 'multiple_choice', 'La costumbre en materia civil chilena rige:', 'Solo cuando la ley se remite a ella.',
     '[{"text":"Siempre","correct":false},{"text":"Solo cuando la ley se remite a ella","correct":true},{"text":"Nunca","correct":false},{"text":"Solo en materia penal","correct":false}]', 3),
    (uid, c_penal, u_delito, 'multiple_choice', 'La tipicidad consiste en:', 'La adecuación de la conducta al tipo penal.',
     '[{"text":"La contrariedad con el ordenamiento","correct":false},{"text":"La adecuación de la conducta al tipo penal","correct":true},{"text":"El reproche personal al autor","correct":false}]', 4),
    (uid, c_const, u_ddff, 'open', 'Explique la diferencia entre privación, perturbación y amenaza de un derecho.', null, '[]', 4);

  insert into public.case_briefs (user_id, course_id, title, facts, legal_issue, rules, arguments, status) values
    (uid, c_civil, 'Incumplimiento de contrato de compraventa',
     'Comprador paga el precio y el vendedor no entrega la cosa en el plazo pactado. Han pasado 45 días.',
     '¿Qué acciones tiene el comprador y cuáles son sus requisitos de procedencia?',
     'Normas del Código Civil sobre efectos de las obligaciones y condición resolutoria tácita. Verificar los artículos exactos en BCN.',
     'Se discute si procede el cumplimiento forzado o la resolución con indemnización, y si es necesaria la constitución en mora.', 'in_review'),
    (uid, c_const, 'Traslado de funcionario sin fundamento',
     'Un funcionario es trasladado de ciudad mediante un acto administrativo sin expresión de fundamentos.',
     '¿Constituye un acto arbitrario que habilite el recurso de protección?',
     'Garantías del artículo 19. Verificar numerales aplicables en el texto vigente.', null, 'draft');

  -- --------------------------------------------------------------- TAREAS
  insert into public.tasks (user_id, space, title, description, category, priority, status, due_at, brand_id, course_id, assessment_id, recurrence) values
    (uid, 'work', 'Solicitar ventas semana 31 a Gnomo', 'Cliente no ha respondido. Reiterar por WhatsApp.', 'Reportes', 'urgent', 'waiting', (current_date - 1)::timestamptz + interval '12 hours', b_gnomo, null, null, 'none'),
    (uid, 'work', 'Enviar plan de recuperación de cobertura a Trauko', 'Dos tiendas sin cobertura. Incluir fechas, personas y costo.', 'Cobertura', 'urgent', 'in_progress', (current_date)::timestamptz + interval '17 hours', b_trauko, null, null, 'none'),
    (uid, 'work', 'Revisar marcaciones de la semana', null, 'Asistencia', 'high', 'pending', (current_date)::timestamptz + interval '18 hours', null, null, null, 'weekly'),
    (uid, 'work', 'Confirmar material POP para Arde x Athar', null, 'Materiales', 'high', 'pending', (current_date + 1)::timestamptz + interval '12 hours', b_arde, null, null, 'none'),
    (uid, 'work', 'Cerrar firmas pendientes (3 personas)', null, 'RRHH', 'high', 'in_progress', (current_date + 1)::timestamptz + interval '16 hours', b_gnomo, null, null, 'none'),
    (uid, 'work', 'Reporte de jornada del fin de semana Dolce Gusto', null, 'Reportes', 'medium', 'pending', (current_date + 2)::timestamptz + interval '11 hours', b_dolce, null, null, 'weekly'),
    (uid, 'work', 'Coordinar capacitación Hypnos en regiones', null, 'Capacitación', 'medium', 'waiting', (current_date + 3)::timestamptz + interval '15 hours', b_hypnos, null, null, 'none'),
    (uid, 'work', 'Validar horas del mes para remuneraciones', null, 'Remuneraciones', 'high', 'pending', (current_date + 5)::timestamptz + interval '18 hours', null, null, null, 'monthly'),
    (uid, 'work', 'Enviar reporte diario a clientes', null, 'Reportes', 'medium', 'pending', (current_date)::timestamptz + interval '19 hours', null, null, null, 'weekdays'),
    (uid, 'university', 'Leer 60 páginas de Derecho Constitucional', null, 'Lectura', 'high', 'in_progress', (current_date + 5)::timestamptz + interval '22 hours', null, c_const, a_const2, 'none'),
    (uid, 'university', 'Preparar Control 1 de Procesal', null, 'Evaluación', 'urgent', 'pending', (current_date + 3)::timestamptz + interval '21 hours', null, c_proc, a_proc1, 'none'),
    (uid, 'university', 'Buscar sentencia real para el trabajo de Constitucional', 'Buscar en el portal del Poder Judicial. Registrar rol, tribunal y fecha exactos. No citar de memoria.', 'Investigación', 'high', 'pending', (current_date + 8)::timestamptz + interval '22 hours', null, c_const, null, 'none'),
    (uid, 'university', 'Hacer fichas de Teoría del delito', null, 'Fichas', 'medium', 'pending', (current_date + 6)::timestamptz + interval '22 hours', null, c_penal, a_penal1, 'none'),
    (uid, 'university', 'Repasar Fuentes del Derecho para el control', null, 'Evaluación', 'high', 'pending', (current_date + 5)::timestamptz + interval '22 hours', null, c_intro, a_intro2, 'none'),
    (uid, 'personal', 'Renovar licencia de conducir', null, 'Trámites', 'medium', 'pending', (current_date + 14)::timestamptz + interval '12 hours', null, null, null, 'none'),
    (uid, 'personal', 'Comprar regalo de cumpleaños', null, 'Familia', 'medium', 'pending', (current_date + 3)::timestamptz + interval '20 hours', null, null, null, 'none'),
    (uid, 'personal', 'Pagar cuentas del mes', null, 'Finanzas', 'high', 'pending', (current_date + 2)::timestamptz + interval '21 hours', null, null, null, 'monthly');

  insert into public.subtasks (user_id, task_id, title, is_done, position)
  select uid, t.id, v.title, v.done, v.pos
    from public.tasks t
    join (values ('Levantar dotación disponible', true, 1),
                 ('Cotizar reemplazos', true, 2),
                 ('Redactar propuesta', false, 3),
                 ('Enviar a Carolina', false, 4)) as v(title, done, pos) on true
   where t.user_id = uid and t.title = 'Enviar plan de recuperación de cobertura a Trauko';

  insert into public.task_comments (user_id, task_id, body)
  select uid, id, 'El cliente pidió el detalle por tienda y no solo el consolidado.'
    from public.tasks where user_id = uid and title = 'Enviar plan de recuperación de cobertura a Trauko';

  -- --------------------------------------------------------------- NOTAS
  insert into public.notes (user_id, space, type, title, content, brand_id, course_id, unit_id, topic, is_pinned) values
    (uid, 'work', 'minutes', 'Minuta reunión Trauko',
     E'Cliente pide plan escrito con fechas y responsables.\nAcepta reemplazos externos si se acredita capacitación previa.\nQuiere reporte fotográfico diario mientras dure la contingencia.',
     b_trauko, null, null, null, true),
    (uid, 'work', 'note', 'Hallazgos visita Hypnos Egaña',
     E'Buena rotación en modelo intermedio.\nEspacio libre junto a caja: oportunidad de exhibición adicional.\nVendedores no manejan el argumento de garantía.',
     b_hypnos, null, null, null, false),
    (uid, 'work', 'idea', 'Incentivo por conversión',
     'Probar un incentivo simple por conversión semanal en las 3 tiendas con peor desempeño de Gnomo. Medir 2 semanas antes de escalar.',
     b_gnomo, null, null, null, false),
    (uid, 'university', 'class_note', 'Fuentes del Derecho — clase 4',
     E'Fuentes formales: ley, costumbre, jurisprudencia, doctrina, principios generales y actos jurídicos.\nEn Chile la costumbre en materia civil rige solo cuando la ley se remite a ella.\nVerificar el artículo exacto en BCN antes de citarlo.',
     null, c_intro, u_fuentes_d, 'Fuentes formales', false),
    (uid, 'university', 'class_note', 'Diferencia jurisdicción / competencia',
     E'Jurisdicción: poder-deber del Estado de resolver conflictos con efecto de cosa juzgada.\nCompetencia: medida en que esa jurisdicción se reparte entre tribunales.',
     null, c_proc, u_juris, 'Conceptos base', false),
    (uid, 'personal', 'note', 'Ideas de regalo', E'Libro de fotografía\nSet de café\nEntradas a concierto', null, null, null, null, false);

  -- --------------------------------------------- EVENTOS PERSONALES Y BLOQUES
  insert into public.personal_events (user_id, title, starts_at, ends_at, location) values
    (uid, 'Cumpleaños de mamá', (current_date + 3)::timestamptz + interval '20 hours', (current_date + 3)::timestamptz + interval '23 hours', 'Casa'),
    (uid, 'Partido de fútbol',  (current_date + 2)::timestamptz + interval '21 hours', (current_date + 2)::timestamptz + interval '22.5 hours', 'Cancha La Reina');

  insert into public.time_blocks (user_id, space, title, block_date, start_time, end_time, brand_id, course_id, is_done) values
    (uid, 'work',       'Bloque foco: reportes y correos', current_date, '09:00', '10:30', null,     null,    true),
    (uid, 'work',       'Bloque: plan Trauko',             current_date, '15:00', '16:30', b_trauko, null,    false),
    (uid, 'university', 'Estudio: Constitucional',         current_date, '20:30', '22:00', null,     c_const, false);

  -- --------------------------------------------------------------- ETIQUETAS
  insert into public.tags (user_id, name, color, space) values
    (uid, 'cobertura',   '#DC2626', 'work'),
    (uid, 'reportes',    '#0D5C63', 'work'),
    (uid, 'oportunidad', '#16A34A', 'work'),
    (uid, 'garantías',   '#4F46E5', 'university'),
    (uid, 'fuentes',     '#4F46E5', 'university')
  on conflict do nothing;

  insert into public.entity_tags (user_id, tag_id, entity_type, entity_id)
  select uid, tg.id, 'note', n.id
    from public.tags tg, public.notes n
   where tg.user_id = uid and tg.name = 'cobertura'
     and n.user_id = uid and n.title = 'Minuta reunión Trauko'
  on conflict do nothing;

  update public.user_settings
     set study_availability = '[{"day":1,"start":"20:30","end":"22:30"},{"day":2,"start":"20:30","end":"22:30"},{"day":3,"start":"20:30","end":"22:30"},{"day":4,"start":"20:30","end":"22:30"},{"day":6,"start":"10:00","end":"13:00"},{"day":0,"start":"16:00","end":"19:00"}]'::jsonb
   where user_id = uid;

  /* Todo lo académico sembrado queda marcado como ejemplo. */
  update public.course_units  set is_demo = true where user_id = uid;
  update public.assessments   set is_demo = true where user_id = uid;
  update public.readings      set is_demo = true where user_id = uid;
  update public.legal_concepts set is_demo = true where user_id = uid;
  update public.legal_notes   set is_demo = true where user_id = uid;
  update public.flashcards    set is_demo = true where user_id = uid;
  update public.practice_questions set is_demo = true where user_id = uid;

  return 'Datos de ejemplo cargados. Las asignaturas, fuentes y casos quedaron marcados como demostrativos.';
end;
$$;

-- ----------------------------------------------------------------------------
-- Vaciar la cuenta del usuario actual (no toca la cuenta ni las preferencias).
-- ----------------------------------------------------------------------------
create or replace function public.wipe_my_data()
returns text
language plpgsql
security invoker
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  t text;
  tablas text[] := array[
    'activity_log','reminders','attachments','entity_tags','tags','time_blocks','personal_events',
    'task_comments','subtasks','agreements','tasks','notes','case_briefs','practice_questions',
    'flashcards','legal_notes','legal_concepts','legal_sources','study_sessions','study_plans',
    'readings','grades','assessment_topics','assessments','class_sessions','course_units','courses',
    'academic_periods','message_templates','meeting_participants','meetings','incidents','requests',
    'people_events','people','stores','contacts','brands'
  ];
begin
  if uid is null then
    raise exception 'Debes ejecutar esto con una sesión iniciada.';
  end if;
  foreach t in array tablas loop
    execute format('delete from public.%I where user_id = $1;', t) using uid;
  end loop;
  return 'Cuenta vaciada.';
end;
$$;

grant execute on function public.seed_demo_data() to authenticated;
grant execute on function public.wipe_my_data() to authenticated;
