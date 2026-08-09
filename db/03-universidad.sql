-- ============================================================================
-- NEXO — Migración: profundización del módulo Universidad
--
-- Se ejecuta DESPUÉS de `01-schema.sql`. Es idempotente: puedes correrla más
-- de una vez sin romper nada.
--
-- QUÉ AGREGA
--   · Escala de notas configurable (mínima, máxima y de aprobación).
--   · Evaluaciones con nota objetivo, nivel de preparación, materia incluida
--     y documentos asociados.
--   · Lecturas con tiempo estimado, página actual y citas personales.
--   · Apuntes jurídicos con el texto original SIEMPRE separado del contenido
--     derivado (resumen, conceptos, normas y jurisprudencia mencionadas).
--   · Fichas de legislación y de jurisprudencia como registros propios, con
--     fuente oficial, fecha de consulta y estado de verificación.
--   · Análisis de casos con la plantilla completa.
--   · Sesiones de estudio con objetivo, material, pausas, concentración,
--     resultado y próximo paso.
--   · Marca `is_demo` para que ningún dato de ejemplo pueda confundirse con
--     una fuente jurídica real.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. TIPOS NUEVOS
-- ----------------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_type where typname = 'preparation_level') then
    create type preparation_level as enum ('not_started', 'reading', 'practicing', 'ready');
  end if;
  if not exists (select 1 from pg_type where typname = 'validity_status') then
    create type validity_status as enum ('to_verify', 'in_force', 'amended', 'repealed');
  end if;
  if not exists (select 1 from pg_type where typname = 'focus_level') then
    create type focus_level as enum ('low', 'medium', 'high');
  end if;
  if not exists (select 1 from pg_type where typname = 'session_outcome') then
    create type session_outcome as enum ('pending', 'completed', 'partial', 'interrupted');
  end if;
  if not exists (select 1 from pg_type where typname = 'review_result') then
    create type review_result as enum ('correct', 'incorrect', 'partial', 'skipped');
  end if;
end
$$;

-- El examen oral no existía como tipo de evaluación.
-- Va fuera de un bloque DO: PostgreSQL no permite ADD VALUE dentro de una
-- transacción explícita. `if not exists` lo hace idempotente.
alter type assessment_type add value if not exists 'oral_exam';

-- ----------------------------------------------------------------------------
-- 2. ESCALA DE NOTAS CONFIGURABLE
-- Parte en la escala chilena 1,0–7,0 con aprobación en 4,0, pero es editable.
-- ----------------------------------------------------------------------------
alter table public.user_settings
  add column if not exists min_grade      numeric(4,2) not null default 1.0,
  add column if not exists grade_decimals smallint     not null default 1,
  add column if not exists grade_scale_name text       not null default 'Escala chilena 1,0 – 7,0';

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'user_settings_scale_chk') then
    alter table public.user_settings
      add constraint user_settings_scale_chk
      check (min_grade < max_grade and pass_grade >= min_grade and pass_grade <= max_grade);
  end if;
end
$$;

-- Las notas dejan de estar amarradas al 1–7 fijo: la escala manda.
alter table public.grades drop constraint if exists grades_score_check;
alter table public.grades
  add column if not exists target_score numeric(4,2);
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'grades_score_range_chk') then
    alter table public.grades add constraint grades_score_range_chk check (score >= 0 and score <= 100);
  end if;
end
$$;

-- ----------------------------------------------------------------------------
-- 3. EVALUACIONES
-- ----------------------------------------------------------------------------
alter table public.assessments
  add column if not exists target_grade      numeric(4,2),
  add column if not exists preparation       preparation_level not null default 'not_started',
  add column if not exists included_topics   text,
  add column if not exists documents         jsonb not null default '[]'::jsonb,
  add column if not exists location          text,
  add column if not exists duration_min      integer check (duration_min is null or duration_min between 5 and 600);

comment on column public.assessments.target_grade is 'Nota a la que apuntas, distinta de la mínima de aprobación.';
comment on column public.assessments.preparation is 'Autoevaluación de cuán preparado te sientes.';
comment on column public.assessments.documents is 'Lista [{title,url}] de material asociado.';

-- ----------------------------------------------------------------------------
-- 4. LECTURAS
-- ----------------------------------------------------------------------------
alter table public.readings
  add column if not exists estimated_min_per_page numeric(4,1) not null default 2.5,
  add column if not exists edition            text,
  add column if not exists is_required        boolean not null default true,
  add column if not exists notes              text;

comment on column public.readings.estimated_min_per_page is
  'Minutos por página. Con el total de páginas da el tiempo estimado de lectura.';
comment on column public.readings.is_required is 'Bibliografía obligatoria (true) o complementaria (false).';

-- Citas y comentarios propios de una lectura.
create table if not exists public.reading_notes (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  reading_id  uuid not null,
  page        integer check (page is null or page >= 0),
  quote       text,
  comment     text,
  is_verbatim boolean not null default false,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint reading_notes_id_user_uk unique (id, user_id),
  constraint reading_notes_reading_fk foreign key (reading_id, user_id)
    references public.readings(id, user_id) on delete cascade,
  constraint reading_notes_content_chk check (coalesce(quote, '') <> '' or coalesce(comment, '') <> '')
);
comment on column public.reading_notes.is_verbatim is
  'true cuando es una cita textual del autor; false cuando es un comentario propio.';

-- ----------------------------------------------------------------------------
-- 5. APUNTES JURÍDICOS
-- El texto original (`body`) nunca se sobrescribe. Todo lo derivado vive en
-- columnas aparte para que la interfaz pueda mostrarlo separado.
-- ----------------------------------------------------------------------------
alter table public.legal_notes
  add column if not exists topic             text,
  add column if not exists summary           text,
  add column if not exists key_concepts      jsonb not null default '[]'::jsonb,
  add column if not exists norms_mentioned   jsonb not null default '[]'::jsonb,
  add column if not exists case_law_mentioned jsonb not null default '[]'::jsonb,
  add column if not exists tags              text[] not null default '{}',
  add column if not exists derived_at        timestamptz,
  add column if not exists derived_by        text;

comment on column public.legal_notes.body is 'TEXTO ORIGINAL DEL USUARIO. No se modifica nunca.';
comment on column public.legal_notes.summary is 'Resumen derivado. Se muestra en una sección separada del original.';
comment on column public.legal_notes.derived_by is 'Quién generó el contenido derivado: "usuario", "reglas" o "ia".';

-- ----------------------------------------------------------------------------
-- 6. LEGISLACIÓN Y JURISPRUDENCIA
-- Se separan en dos fichas con los campos que cada una necesita.
-- `legal_sources` sigue siendo el índice común.
-- ----------------------------------------------------------------------------
alter table public.legal_sources
  add column if not exists number         text,
  add column if not exists article        text,
  add column if not exists consulted_on   date,
  add column if not exists validity       validity_status not null default 'to_verify',
  add column if not exists recorded_text  text,
  add column if not exists parties        text,
  add column if not exists facts          text,
  add column if not exists decision       text,
  add column if not exists reasoning      text,
  add column if not exists is_demo        boolean not null default false;

comment on column public.legal_sources.recorded_text is
  'Texto que TÚ copiaste desde la fuente oficial. Nexo nunca lo genera.';
comment on column public.legal_sources.validity is
  'Vigencia declarada por el usuario. Parte siempre en "por verificar".';
comment on column public.legal_sources.is_demo is
  'true en los datos de ejemplo, para que jamás se confundan con una fuente real.';

-- Si dices que la consultaste, queda la fecha; si la marcas verificada, exige enlace.
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'legal_sources_verified_url_chk') then
    alter table public.legal_sources
      add constraint legal_sources_verified_url_chk
      check (verification <> 'verified' or official_url is not null);
  end if;
end
$$;

-- ----------------------------------------------------------------------------
-- 7. ANÁLISIS DE CASOS — plantilla completa
-- ----------------------------------------------------------------------------
alter table public.case_briefs
  add column if not exists parties           text,
  add column if not exists arguments_claimant text,
  add column if not exists arguments_defendant text,
  add column if not exists decision          text,
  add column if not exists reasoning         text,
  add column if not exists personal_opinion  text,
  add column if not exists source_reference  text,
  add column if not exists verification      verification_status not null default 'unverified',
  add column if not exists is_demo           boolean not null default false;

comment on column public.case_briefs.arguments is 'Campo antiguo. Se conserva; usa arguments_claimant y arguments_defendant.';
comment on column public.case_briefs.personal_opinion is 'Tu análisis. Se guarda aparte de los hechos y de la decisión del tribunal.';

-- ----------------------------------------------------------------------------
-- 8. SESIONES DE ESTUDIO — modo de estudio
-- ----------------------------------------------------------------------------
alter table public.study_sessions
  add column if not exists objective    text,
  add column if not exists material     jsonb not null default '[]'::jsonb,
  add column if not exists breaks_count integer not null default 0 check (breaks_count >= 0),
  add column if not exists focus        focus_level,
  add column if not exists outcome      session_outcome not null default 'pending',
  add column if not exists next_step    text,
  add column if not exists started_at   timestamptz,
  add column if not exists ended_at     timestamptz,
  add column if not exists reading_page integer check (reading_page is null or reading_page >= 0);

comment on column public.study_sessions.material is 'Lista [{tipo,id,titulo}] de lo que vas a estudiar.';
comment on column public.study_sessions.focus is 'Cómo sentiste tu concentración, para detectar patrones.';

-- Registro de bloques de Pomodoro dentro de una sesión.
create table if not exists public.study_intervals (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  session_id  uuid not null,
  phase       text not null check (phase in ('focus', 'break')),
  started_at  timestamptz not null default now(),
  ended_at    timestamptz,
  minutes     integer not null default 0 check (minutes >= 0),
  created_at  timestamptz not null default now(),
  constraint study_intervals_id_user_uk unique (id, user_id),
  constraint study_intervals_session_fk foreign key (session_id, user_id)
    references public.study_sessions(id, user_id) on delete cascade
);

-- ----------------------------------------------------------------------------
-- 9. REPASO — registro de respuestas
-- ----------------------------------------------------------------------------
alter table public.practice_questions
  add column if not exists explanation  text,
  add column if not exists hits         integer not null default 0 check (hits >= 0),
  add column if not exists misses       integer not null default 0 check (misses >= 0),
  add column if not exists interval_days integer not null default 1 check (interval_days between 0 and 365),
  add column if not exists next_review  date,
  add column if not exists source_note_id uuid;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'pq_source_note_fk') then
    alter table public.practice_questions
      add constraint pq_source_note_fk foreign key (source_note_id, user_id)
      references public.legal_notes(id, user_id) on delete set null (source_note_id);
  end if;
end
$$;

/* Cada intento de repaso, sea de ficha, pregunta o caso. */
create table if not exists public.review_attempts (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users(id) on delete cascade,
  item_type    text not null check (item_type in ('flashcard', 'practice_question', 'case_brief')),
  item_id      uuid not null,
  course_id    uuid,
  unit_id      uuid,
  result       review_result not null,
  seconds      integer not null default 0 check (seconds >= 0),
  answered_at  timestamptz not null default now(),
  created_at   timestamptz not null default now(),
  constraint review_attempts_course_fk foreign key (course_id, user_id)
    references public.courses(id, user_id) on delete set null (course_id),
  constraint review_attempts_unit_fk foreign key (unit_id, user_id)
    references public.course_units(id, user_id) on delete set null (unit_id)
);

-- ----------------------------------------------------------------------------
-- 10. DISPONIBILIDAD DE ESTUDIO POR DÍA
-- El planificador necesita saber cuándo puedes estudiar de verdad, cruzando
-- horario laboral y horario de clases.
-- ----------------------------------------------------------------------------
create table if not exists public.study_availability (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  weekday     smallint not null check (weekday between 0 and 6),
  start_time  time not null,
  end_time    time not null,
  is_active   boolean not null default true,
  label       text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint study_availability_id_user_uk unique (id, user_id),
  constraint study_availability_range_chk check (end_time > start_time)
);
comment on table public.study_availability is
  'Reemplaza al jsonb de user_settings cuando quieras editar bloque por bloque.';

-- ----------------------------------------------------------------------------
-- 11. ÍNDICES
-- ----------------------------------------------------------------------------
create index if not exists idx_reading_notes_reading   on public.reading_notes (user_id, reading_id, page);
create index if not exists idx_study_intervals_session on public.study_intervals (user_id, session_id);
create index if not exists idx_review_attempts_item    on public.review_attempts (user_id, item_type, item_id, answered_at desc);
create index if not exists idx_review_attempts_unit    on public.review_attempts (user_id, unit_id, answered_at desc);
create index if not exists idx_availability_user       on public.study_availability (user_id, weekday) where is_active;
create index if not exists idx_assessments_prep        on public.assessments (user_id, preparation) where deleted_at is null;
create index if not exists idx_legal_sources_validity  on public.legal_sources (user_id, validity) where deleted_at is null;
create index if not exists idx_practice_q_review       on public.practice_questions (user_id, next_review) where deleted_at is null;

-- ----------------------------------------------------------------------------
-- 12. TRIGGERS
-- ----------------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['reading_notes', 'study_availability'] loop
    execute format('drop trigger if exists trg_%1$s_updated on public.%1$I;', t);
    execute format('create trigger trg_%1$s_updated before update on public.%1$I for each row execute function public.set_updated_at();', t);
    execute format('drop trigger if exists trg_%1$s_owner on public.%1$I;', t);
    execute format('create trigger trg_%1$s_owner before update on public.%1$I for each row execute function public.lock_user_id();', t);
  end loop;
end
$$;

-- La página actual de una lectura no puede superar el total.
create or replace function public.readings_clamp_pages()
returns trigger language plpgsql as $$
begin
  if new.pages_read > new.total_pages then new.pages_read := new.total_pages; end if;
  if new.pages_read < 0 then new.pages_read := 0; end if;
  return new;
end;
$$;
drop trigger if exists trg_readings_clamp on public.readings;
create trigger trg_readings_clamp before insert or update on public.readings
  for each row execute function public.readings_clamp_pages();

-- Marca la fecha de consulta cuando registras el texto de una fuente.
create or replace function public.legal_sources_stamp_consult()
returns trigger language plpgsql as $$
begin
  if coalesce(new.recorded_text, '') <> '' and new.consulted_on is null then
    new.consulted_on := current_date;
  end if;
  return new;
end;
$$;
drop trigger if exists trg_legal_sources_consult on public.legal_sources;
create trigger trg_legal_sources_consult before insert or update on public.legal_sources
  for each row execute function public.legal_sources_stamp_consult();

-- Al cerrar una sesión de estudio se calculan los minutos efectivos reales.
create or replace function public.study_sessions_close()
returns trigger language plpgsql as $$
begin
  if new.status = 'done' and new.ended_at is null then new.ended_at := now(); end if;
  if new.status <> 'done' then new.ended_at := null; end if;
  return new;
end;
$$;
drop trigger if exists trg_study_sessions_close on public.study_sessions;
create trigger trg_study_sessions_close before insert or update on public.study_sessions
  for each row execute function public.study_sessions_close();

-- ----------------------------------------------------------------------------
-- 13. VISTAS ACADÉMICAS
-- ----------------------------------------------------------------------------

-- Progreso por unidad, cruzando dominio declarado con resultados de repaso.
create or replace view public.v_unit_progress
with (security_invoker = true) as
select u.user_id,
       u.id   as unit_id,
       u.course_id,
       u.name,
       u.difficulty,
       u.mastery,
       case u.mastery when 'not_started' then 0 when 'initial' then 33
                      when 'in_progress' then 66 else 100 end as mastery_pct,
       coalesce(r.intentos, 0)  as review_attempts,
       coalesce(r.aciertos, 0)  as review_hits,
       case when coalesce(r.intentos, 0) = 0 then null
            else round(r.aciertos::numeric * 100 / r.intentos, 0) end as accuracy_pct,
       coalesce(s.minutos, 0)   as studied_minutes
  from public.course_units u
  left join lateral (
      select count(*) as intentos, count(*) filter (where result = 'correct') as aciertos
        from public.review_attempts ra where ra.unit_id = u.id
    ) r on true
  left join lateral (
      select sum(effective_min) as minutos
        from public.study_sessions ss where ss.unit_id = u.id and ss.deleted_at is null
    ) s on true
 where u.deleted_at is null;

-- Temas que necesitan refuerzo: poco dominio, mucha dificultad o baja precisión.
create or replace view public.v_weak_topics
with (security_invoker = true) as
select p.*,
       (100 - p.mastery_pct) * 0.5
     + (p.difficulty * 8)
     + coalesce(100 - p.accuracy_pct, 40) * 0.4
     + case when p.studied_minutes = 0 then 15 else 0 end as reinforcement_score
  from public.v_unit_progress p
 where p.mastery_pct < 100;

-- Tiempo de estudio por semana.
create or replace view public.v_study_week
with (security_invoker = true) as
select user_id,
       date_trunc('week', scheduled_date)::date as week_start,
       count(*)                                  as sessions_total,
       count(*) filter (where status = 'done')   as sessions_done,
       coalesce(sum(effective_min), 0)           as effective_minutes,
       coalesce(sum(breaks_count), 0)            as breaks_total
  from public.study_sessions
 where deleted_at is null
 group by user_id, date_trunc('week', scheduled_date);

-- Panel de la evaluación: días restantes, preparación y plan asociado.
create or replace view public.v_assessment_panel
with (security_invoker = true) as
select a.user_id,
       a.id as assessment_id,
       a.course_id,
       c.name as course_name,
       a.title,
       a.type,
       a.due_date,
       a.weight,
       a.preparation,
       a.target_grade,
       (a.due_date - current_date)                    as days_left,
       g.score                                        as grade,
       sp.id                                          as plan_id,
       coalesce(ses.total, 0)                         as plan_sessions,
       coalesce(ses.hechas, 0)                        as plan_sessions_done
  from public.assessments a
  join public.courses c on c.id = a.course_id
  left join lateral (
      select score from public.grades gg where gg.assessment_id = a.id order by attempt desc limit 1
    ) g on true
  left join public.study_plans sp on sp.assessment_id = a.id and sp.status = 'active'
  left join lateral (
      select count(*) as total, count(*) filter (where status = 'done') as hechas
        from public.study_sessions ss where ss.plan_id = sp.id and ss.deleted_at is null
    ) ses on true
 where a.deleted_at is null;

-- ----------------------------------------------------------------------------
-- 14. RLS EN LAS TABLAS NUEVAS
-- ----------------------------------------------------------------------------
do $$
declare
  t text;
  tablas text[] := array['reading_notes', 'study_intervals', 'review_attempts', 'study_availability'];
begin
  foreach t in array tablas loop
    execute format('alter table public.%I enable row level security;', t);
    execute format('alter table public.%I force row level security;', t);

    execute format('drop policy if exists "%1$s_select_own" on public.%1$I;', t);
    execute format('create policy "%1$s_select_own" on public.%1$I for select to authenticated using (auth.uid() = user_id);', t);
    execute format('drop policy if exists "%1$s_insert_own" on public.%1$I;', t);
    execute format('create policy "%1$s_insert_own" on public.%1$I for insert to authenticated with check (auth.uid() = user_id);', t);
    execute format('drop policy if exists "%1$s_update_own" on public.%1$I;', t);
    execute format('create policy "%1$s_update_own" on public.%1$I for update to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);', t);
    execute format('drop policy if exists "%1$s_delete_own" on public.%1$I;', t);
    execute format('create policy "%1$s_delete_own" on public.%1$I for delete to authenticated using (auth.uid() = user_id);', t);
  end loop;
end
$$;

grant select, insert, update, delete on all tables in schema public to authenticated;
grant select on public.v_unit_progress, public.v_weak_topics, public.v_study_week, public.v_assessment_panel to authenticated;

-- ----------------------------------------------------------------------------
-- 15. LOS DATOS DE EJEMPLO QUEDAN MARCADOS
-- Ninguna fuente jurídica de muestra puede parecer real.
-- ----------------------------------------------------------------------------
update public.legal_sources
   set is_demo = true,
       validity = 'to_verify'
 where identifier ilike '%por identificar%'
    or summary ilike '%PENDIENTE%';

-- ============================================================================
-- FIN DE LA MIGRACIÓN
-- ============================================================================
