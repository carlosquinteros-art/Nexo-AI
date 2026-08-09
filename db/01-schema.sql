-- ============================================================================
-- NEXO — Esquema de base de datos v2 (PostgreSQL / Supabase)
-- Autor: capa de datos para Carlos Quinteros
-- Reemplaza al esquema v1 (`02-supabase-schema.sql`, ahora en desuso).
--
-- REQUISITO: PostgreSQL 15 o superior.
--   Se usa `ON DELETE SET NULL (columna)`, disponible desde PG 15.
--   Todos los proyectos nuevos de Supabase cumplen este requisito.
--
-- CÓMO EJECUTAR
--   1. Supabase → SQL Editor → New query
--   2. Pegar este archivo completo → Run
--   3. (Opcional) Ejecutar luego `02-seed.sql` para datos de ejemplo
--
-- DECISIONES DE DISEÑO QUE CONVIENE CONOCER
--   · Aislamiento fuerte: además de RLS, cada relación entre tablas viaja por
--     una clave foránea COMPUESTA (id, user_id). Es imposible apuntar a una
--     fila de otro usuario aunque una política tuviera un error.
--   · Borrado seguro: `deleted_at` (soft delete) en las entidades con historia.
--     Los hijos usan ON DELETE CASCADE, así no quedan registros huérfanos.
--   · Enums para todo estado cerrado; CHECK para rangos numéricos.
--   · `space` ('work' | 'university' | 'personal') está en toda entidad que el
--     usuario ve en una lista mixta.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 0. EXTENSIONES
-- ----------------------------------------------------------------------------
create extension if not exists "pgcrypto";
create extension if not exists "unaccent";

-- ----------------------------------------------------------------------------
-- 1. TIPOS ENUMERADOS
-- ----------------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_type where typname = 'space_type') then
    create type space_type as enum ('work', 'university', 'personal');
  end if;
  if not exists (select 1 from pg_type where typname = 'priority_level') then
    create type priority_level as enum ('low', 'medium', 'high', 'urgent');
  end if;
  if not exists (select 1 from pg_type where typname = 'task_status') then
    create type task_status as enum ('pending', 'in_progress', 'waiting', 'done', 'cancelled');
  end if;
  if not exists (select 1 from pg_type where typname = 'recurrence_type') then
    create type recurrence_type as enum ('none', 'daily', 'weekdays', 'weekly', 'biweekly', 'monthly');
  end if;
  if not exists (select 1 from pg_type where typname = 'brand_status') then
    create type brand_status as enum ('on_track', 'needs_attention', 'critical');
  end if;
  if not exists (select 1 from pg_type where typname = 'store_status') then
    create type store_status as enum ('active', 'uncovered', 'closed');
  end if;
  if not exists (select 1 from pg_type where typname = 'person_status') then
    create type person_status as enum ('active', 'sick_leave', 'vacation', 'replacement', 'resigned', 'inactive');
  end if;
  if not exists (select 1 from pg_type where typname = 'person_event_type') then
    create type person_event_type as enum ('onboarding', 'sick_leave', 'vacation', 'replacement', 'resignation', 'training', 'warning');
  end if;
  if not exists (select 1 from pg_type where typname = 'request_status') then
    create type request_status as enum ('open', 'in_progress', 'answered', 'closed', 'no_reply');
  end if;
  if not exists (select 1 from pg_type where typname = 'incident_severity') then
    create type incident_severity as enum ('low', 'medium', 'high', 'critical');
  end if;
  if not exists (select 1 from pg_type where typname = 'incident_status') then
    create type incident_status as enum ('open', 'in_progress', 'resolved');
  end if;
  if not exists (select 1 from pg_type where typname = 'meeting_status') then
    create type meeting_status as enum ('scheduled', 'done', 'cancelled');
  end if;
  if not exists (select 1 from pg_type where typname = 'agreement_type') then
    create type agreement_type as enum ('agreement', 'incident', 'finding', 'opportunity');
  end if;
  if not exists (select 1 from pg_type where typname = 'agreement_status') then
    create type agreement_status as enum ('open', 'in_progress', 'closed');
  end if;
  if not exists (select 1 from pg_type where typname = 'impact_level') then
    create type impact_level as enum ('low', 'medium', 'high');
  end if;
  if not exists (select 1 from pg_type where typname = 'message_audience') then
    create type message_audience as enum ('team', 'client', 'hr', 'supplier', 'other');
  end if;
  if not exists (select 1 from pg_type where typname = 'message_tone') then
    create type message_tone as enum ('warm', 'executive', 'firm', 'motivational', 'brief');
  end if;
  if not exists (select 1 from pg_type where typname = 'assessment_type') then
    create type assessment_type as enum ('quiz', 'test', 'exam', 'paper', 'presentation', 'workshop');
  end if;
  if not exists (select 1 from pg_type where typname = 'assessment_status') then
    create type assessment_status as enum ('pending', 'taken', 'graded', 'cancelled');
  end if;
  if not exists (select 1 from pg_type where typname = 'mastery_level') then
    create type mastery_level as enum ('not_started', 'initial', 'in_progress', 'mastered');
  end if;
  if not exists (select 1 from pg_type where typname = 'study_plan_status') then
    create type study_plan_status as enum ('active', 'completed', 'cancelled');
  end if;
  if not exists (select 1 from pg_type where typname = 'study_session_type') then
    create type study_session_type as enum ('study', 'review', 'practice', 'summary');
  end if;
  if not exists (select 1 from pg_type where typname = 'study_session_status') then
    create type study_session_status as enum ('pending', 'done', 'rescheduled', 'skipped');
  end if;
  if not exists (select 1 from pg_type where typname = 'note_type') then
    create type note_type as enum ('note', 'class_note', 'idea', 'minutes');
  end if;
  if not exists (select 1 from pg_type where typname = 'legal_source_type') then
    create type legal_source_type as enum ('law', 'code', 'decree', 'ruling', 'doctrine', 'other');
  end if;
  if not exists (select 1 from pg_type where typname = 'verification_status') then
    create type verification_status as enum ('unverified', 'verified', 'disputed');
  end if;
  if not exists (select 1 from pg_type where typname = 'question_type') then
    create type question_type as enum ('flashcard', 'multiple_choice', 'open');
  end if;
  if not exists (select 1 from pg_type where typname = 'reminder_channel') then
    create type reminder_channel as enum ('in_app', 'email', 'push');
  end if;
  if not exists (select 1 from pg_type where typname = 'theme_pref') then
    create type theme_pref as enum ('light', 'dark', 'system');
  end if;
  if not exists (select 1 from pg_type where typname = 'activity_action') then
    create type activity_action as enum ('create', 'update', 'delete', 'restore');
  end if;
  if not exists (select 1 from pg_type where typname = 'entity_kind') then
    create type entity_kind as enum (
      'task','note','brand','store','person','contact','incident','meeting','agreement','request',
      'course','course_unit','assessment','reading','study_plan','study_session','legal_source',
      'legal_note','legal_concept','flashcard','practice_question','case_brief','personal_event','time_block'
    );
  end if;
end
$$;

-- ----------------------------------------------------------------------------
-- 2. FUNCIONES COMUNES
-- ----------------------------------------------------------------------------
create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- Evita que el cliente cambie el dueño de una fila existente.
create or replace function public.lock_user_id()
returns trigger language plpgsql as $$
begin
  if new.user_id is distinct from old.user_id then
    raise exception 'No se permite cambiar el propietario del registro';
  end if;
  return new;
end;
$$;

-- ============================================================================
-- 3. PERFIL Y PREFERENCIAS
-- ============================================================================
create table if not exists public.profiles (
  id           uuid primary key references auth.users(id) on delete cascade,
  full_name    text not null default 'Usuario' check (char_length(full_name) between 1 and 120),
  email        text,
  avatar_url   text,
  headline     text check (headline is null or char_length(headline) <= 160),
  timezone     text not null default 'America/Santiago',
  onboarded    boolean not null default false,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create table if not exists public.user_settings (
  user_id              uuid primary key references auth.users(id) on delete cascade,
  theme                theme_pref not null default 'light',
  locale               text not null default 'es-CL',
  timezone             text not null default 'America/Santiago',
  pass_grade           numeric(3,1) not null default 4.0 check (pass_grade between 1.0 and 7.0),
  max_grade            numeric(3,1) not null default 7.0 check (max_grade between 1.0 and 7.0),
  weekly_study_goal_min integer not null default 480 check (weekly_study_goal_min >= 0),
  work_schedule        jsonb not null default '{"start":"09:00","end":"18:30","days":[1,2,3,4,5]}'::jsonb,
  study_availability   jsonb not null default '[]'::jsonb,
  notifications        jsonb not null default '{"tasks":true,"events":true,"assessments":true,"sessions":true,"lead_minutes":30}'::jsonb,
  privacy              jsonb not null default '{"store_minimal_people_data":true}'::jsonb,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);

-- Alta automática de perfil y preferencias al registrarse
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, email, full_name)
  values (new.id, new.email, coalesce(nullif(new.raw_user_meta_data->>'full_name', ''), split_part(coalesce(new.email,'usuario'), '@', 1)))
  on conflict (id) do nothing;

  insert into public.user_settings (user_id) values (new.id)
  on conflict (user_id) do nothing;

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ============================================================================
-- 4. ESPACIO TRABAJO
-- ============================================================================

create table if not exists public.brands (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  name        text not null check (char_length(trim(name)) between 1 and 120),
  client_name text check (client_name is null or char_length(client_name) <= 160),
  category    text check (category is null or char_length(category) <= 80),
  status      brand_status not null default 'on_track',
  color       text not null default '#0D5C63' check (color ~* '^#[0-9a-f]{6}$'),
  notes       text,
  documents   jsonb not null default '[]'::jsonb,
  is_active   boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  deleted_at  timestamptz,
  constraint brands_id_user_uk unique (id, user_id)
);

create table if not exists public.contacts (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users(id) on delete cascade,
  brand_id   uuid,
  full_name  text not null check (char_length(trim(full_name)) between 1 and 120),
  role_title text,
  email      text check (email is null or email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  phone      text,
  notes      text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  constraint contacts_id_user_uk unique (id, user_id),
  constraint contacts_brand_fk foreign key (brand_id, user_id)
    references public.brands(id, user_id) on delete set null (brand_id)
);

create table if not exists public.stores (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users(id) on delete cascade,
  brand_id   uuid,
  name       text not null check (char_length(trim(name)) between 1 and 140),
  chain      text,
  city       text,
  region     text,
  format     text,
  status     store_status not null default 'active',
  notes      text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  constraint stores_id_user_uk unique (id, user_id),
  constraint stores_brand_fk foreign key (brand_id, user_id)
    references public.brands(id, user_id) on delete set null (brand_id)
);

-- Datos mínimos del equipo. Por diseño NO existen columnas para RUT,
-- dirección ni información de salud.
create table if not exists public.people (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  brand_id    uuid,
  store_id    uuid,
  full_name   text not null check (char_length(trim(full_name)) between 1 and 120),
  role_title  text,
  shift       text,
  phone       text,
  email       text check (email is null or email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  status      person_status not null default 'active',
  started_on  date,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  deleted_at  timestamptz,
  constraint people_id_user_uk unique (id, user_id),
  constraint people_brand_fk foreign key (brand_id, user_id)
    references public.brands(id, user_id) on delete set null (brand_id),
  constraint people_store_fk foreign key (store_id, user_id)
    references public.stores(id, user_id) on delete set null (store_id)
);

-- Novedades de personal. No está en el listado original, pero licencias,
-- reemplazos y renuncias son una función existente y mezclarlas con
-- `incidents` (que son incidencias de ejecución en tienda) haría el modelo
-- confuso y difícil de reportar.
create table if not exists public.people_events (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users(id) on delete cascade,
  person_id     uuid not null,
  type          person_event_type not null,
  starts_on     date not null,
  ends_on       date,
  replaces_id   uuid,
  note          text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  constraint people_events_id_user_uk unique (id, user_id),
  constraint people_events_person_fk foreign key (person_id, user_id)
    references public.people(id, user_id) on delete cascade,
  constraint people_events_replaces_fk foreign key (replaces_id, user_id)
    references public.people(id, user_id) on delete set null (replaces_id),
  constraint people_events_range_chk check (ends_on is null or ends_on >= starts_on)
);

-- Seguimiento de solicitudes al cliente o a áreas internas. Tampoco estaba en
-- el listado, pero es una función existente y `agreements` no tiene el par
-- fecha de solicitud / fecha comprometida que hace útil el seguimiento.
create table if not exists public.requests (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users(id) on delete cascade,
  brand_id      uuid,
  title         text not null check (char_length(trim(title)) between 1 and 200),
  detail        text,
  requested_to  text,
  channel       text,
  requested_on  date not null default current_date,
  committed_on  date,
  status        request_status not null default 'open',
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  deleted_at    timestamptz,
  constraint requests_id_user_uk unique (id, user_id),
  constraint requests_brand_fk foreign key (brand_id, user_id)
    references public.brands(id, user_id) on delete set null (brand_id),
  constraint requests_dates_chk check (committed_on is null or committed_on >= requested_on)
);

create table if not exists public.incidents (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  brand_id    uuid,
  store_id    uuid,
  person_id   uuid,
  title       text not null check (char_length(trim(title)) between 1 and 200),
  description text,
  severity    incident_severity not null default 'medium',
  status      incident_status not null default 'open',
  detected_at timestamptz not null default now(),
  resolved_at timestamptz,
  resolution  text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  deleted_at  timestamptz,
  constraint incidents_id_user_uk unique (id, user_id),
  constraint incidents_brand_fk foreign key (brand_id, user_id)
    references public.brands(id, user_id) on delete set null (brand_id),
  constraint incidents_store_fk foreign key (store_id, user_id)
    references public.stores(id, user_id) on delete set null (store_id),
  constraint incidents_person_fk foreign key (person_id, user_id)
    references public.people(id, user_id) on delete set null (person_id),
  constraint incidents_resolved_chk check (status <> 'resolved' or resolved_at is not null)
);

create table if not exists public.meetings (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users(id) on delete cascade,
  space      space_type not null default 'work',
  brand_id   uuid,
  title      text not null check (char_length(trim(title)) between 1 and 200),
  starts_at  timestamptz not null,
  ends_at    timestamptz,
  location   text,
  link       text,
  objective  text,
  notes      text,
  status     meeting_status not null default 'scheduled',
  reminder_minutes integer not null default 30 check (reminder_minutes between 0 and 10080),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  constraint meetings_id_user_uk unique (id, user_id),
  constraint meetings_brand_fk foreign key (brand_id, user_id)
    references public.brands(id, user_id) on delete set null (brand_id),
  constraint meetings_range_chk check (ends_at is null or ends_at >= starts_at)
);

create table if not exists public.meeting_participants (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  meeting_id  uuid not null,
  person_id   uuid,
  contact_id  uuid,
  display_name text not null check (char_length(trim(display_name)) between 1 and 120),
  role_title  text,
  attended    boolean,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint meeting_participants_id_user_uk unique (id, user_id),
  constraint mp_meeting_fk foreign key (meeting_id, user_id)
    references public.meetings(id, user_id) on delete cascade,
  constraint mp_person_fk foreign key (person_id, user_id)
    references public.people(id, user_id) on delete set null (person_id),
  constraint mp_contact_fk foreign key (contact_id, user_id)
    references public.contacts(id, user_id) on delete set null (contact_id)
);

create table if not exists public.message_templates (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users(id) on delete cascade,
  space      space_type not null default 'work',
  title      text not null check (char_length(trim(title)) between 1 and 140),
  audience   message_audience not null default 'team',
  tone       message_tone not null default 'warm',
  body       text not null,
  is_favorite boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  constraint message_templates_id_user_uk unique (id, user_id)
);

-- ============================================================================
-- 5. ESPACIO UNIVERSIDAD
-- ============================================================================

create table if not exists public.academic_periods (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users(id) on delete cascade,
  name       text not null check (char_length(trim(name)) between 1 and 80),
  starts_on  date,
  ends_on    date,
  is_current boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint academic_periods_id_user_uk unique (id, user_id),
  constraint academic_periods_name_uk unique (user_id, name),
  constraint academic_periods_range_chk check (ends_on is null or starts_on is null or ends_on >= starts_on)
);

create table if not exists public.courses (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users(id) on delete cascade,
  period_id     uuid,
  name          text not null check (char_length(trim(name)) between 1 and 140),
  code          text,
  professor     text,
  room_modality text,
  schedule      jsonb not null default '[]'::jsonb,
  bibliography  jsonb not null default '[]'::jsonb,
  links         jsonb not null default '[]'::jsonb,
  credits       integer check (credits is null or credits between 0 and 60),
  color         text not null default '#4F46E5' check (color ~* '^#[0-9a-f]{6}$'),
  is_active     boolean not null default true,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  deleted_at    timestamptz,
  constraint courses_id_user_uk unique (id, user_id),
  constraint courses_period_fk foreign key (period_id, user_id)
    references public.academic_periods(id, user_id) on delete set null (period_id)
);

create table if not exists public.course_units (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users(id) on delete cascade,
  course_id  uuid not null,
  name       text not null check (char_length(trim(name)) between 1 and 160),
  position   integer not null default 1 check (position >= 0),
  difficulty smallint not null default 3 check (difficulty between 1 and 5),
  mastery    mastery_level not null default 'not_started',
  pages      integer check (pages is null or pages >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  constraint course_units_id_user_uk unique (id, user_id),
  constraint course_units_course_fk foreign key (course_id, user_id)
    references public.courses(id, user_id) on delete cascade
);

create table if not exists public.class_sessions (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users(id) on delete cascade,
  course_id  uuid not null,
  unit_id    uuid,
  title      text,
  starts_at  timestamptz not null,
  ends_at    timestamptz,
  room       text,
  modality   text,
  topic      text,
  notes      text,
  attended   boolean,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  constraint class_sessions_id_user_uk unique (id, user_id),
  constraint class_sessions_course_fk foreign key (course_id, user_id)
    references public.courses(id, user_id) on delete cascade,
  constraint class_sessions_unit_fk foreign key (unit_id, user_id)
    references public.course_units(id, user_id) on delete set null (unit_id),
  constraint class_sessions_range_chk check (ends_at is null or ends_at >= starts_at)
);

create table if not exists public.assessments (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  course_id   uuid not null,
  title       text not null check (char_length(trim(title)) between 1 and 200),
  type        assessment_type not null default 'test',
  due_date    date,
  due_time    time,
  weight      numeric(5,2) not null default 0 check (weight >= 0 and weight <= 100),
  status      assessment_status not null default 'pending',
  syllabus    text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  deleted_at  timestamptz,
  constraint assessments_id_user_uk unique (id, user_id),
  constraint assessments_course_fk foreign key (course_id, user_id)
    references public.courses(id, user_id) on delete cascade
);

create table if not exists public.assessment_topics (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users(id) on delete cascade,
  assessment_id uuid not null,
  unit_id       uuid,
  title         text not null check (char_length(trim(title)) between 1 and 200),
  description   text,
  position      integer not null default 1 check (position >= 0),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  constraint assessment_topics_id_user_uk unique (id, user_id),
  constraint at_assessment_fk foreign key (assessment_id, user_id)
    references public.assessments(id, user_id) on delete cascade,
  constraint at_unit_fk foreign key (unit_id, user_id)
    references public.course_units(id, user_id) on delete set null (unit_id)
);

-- Nota obtenida. Se separa de `assessments` para permitir recuperativos y
-- correcciones sin perder el histórico.
create table if not exists public.grades (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users(id) on delete cascade,
  assessment_id uuid not null,
  score         numeric(4,2) not null check (score >= 1.0 and score <= 7.0),
  max_score     numeric(4,2) not null default 7.0 check (max_score > 0),
  attempt       smallint not null default 1 check (attempt >= 1),
  graded_on     date not null default current_date,
  comment       text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  constraint grades_id_user_uk unique (id, user_id),
  constraint grades_assessment_attempt_uk unique (assessment_id, attempt),
  constraint grades_assessment_fk foreign key (assessment_id, user_id)
    references public.assessments(id, user_id) on delete cascade
);

create table if not exists public.readings (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  course_id   uuid,
  unit_id     uuid,
  title       text not null check (char_length(trim(title)) between 1 and 200),
  author      text,
  source_url  text,
  total_pages integer not null default 0 check (total_pages >= 0),
  pages_read  integer not null default 0 check (pages_read >= 0),
  due_date    date,
  priority    priority_level not null default 'medium',
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  deleted_at  timestamptz,
  constraint readings_id_user_uk unique (id, user_id),
  constraint readings_pages_chk check (pages_read <= total_pages),
  constraint readings_course_fk foreign key (course_id, user_id)
    references public.courses(id, user_id) on delete set null (course_id),
  constraint readings_unit_fk foreign key (unit_id, user_id)
    references public.course_units(id, user_id) on delete set null (unit_id)
);

create table if not exists public.study_plans (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users(id) on delete cascade,
  course_id     uuid,
  assessment_id uuid,
  name          text not null check (char_length(trim(name)) between 1 and 200),
  target_date   date not null,
  hours_per_week numeric(4,1) not null default 6 check (hours_per_week >= 0 and hours_per_week <= 80),
  status        study_plan_status not null default 'active',
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  deleted_at    timestamptz,
  constraint study_plans_id_user_uk unique (id, user_id),
  constraint sp_course_fk foreign key (course_id, user_id)
    references public.courses(id, user_id) on delete set null (course_id),
  constraint sp_assessment_fk foreign key (assessment_id, user_id)
    references public.assessments(id, user_id) on delete set null (assessment_id)
);

-- Una sesión puede colgar de un plan, de una evaluación y/o de una lectura.
create table if not exists public.study_sessions (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null references auth.users(id) on delete cascade,
  plan_id        uuid,
  course_id      uuid,
  unit_id        uuid,
  assessment_id  uuid,
  reading_id     uuid,
  title          text not null check (char_length(trim(title)) between 1 and 200),
  scheduled_date date not null,
  scheduled_time time,
  duration_min   integer not null default 60 check (duration_min between 5 and 600),
  type           study_session_type not null default 'study',
  status         study_session_status not null default 'pending',
  effective_min  integer not null default 0 check (effective_min >= 0),
  notes          text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  deleted_at     timestamptz,
  constraint study_sessions_id_user_uk unique (id, user_id),
  constraint ss_plan_fk foreign key (plan_id, user_id)
    references public.study_plans(id, user_id) on delete cascade,
  constraint ss_course_fk foreign key (course_id, user_id)
    references public.courses(id, user_id) on delete set null (course_id),
  constraint ss_unit_fk foreign key (unit_id, user_id)
    references public.course_units(id, user_id) on delete set null (unit_id),
  constraint ss_assessment_fk foreign key (assessment_id, user_id)
    references public.assessments(id, user_id) on delete set null (assessment_id),
  constraint ss_reading_fk foreign key (reading_id, user_id)
    references public.readings(id, user_id) on delete set null (reading_id)
);

-- Fuentes jurídicas. `verification` parte SIEMPRE en 'unverified': la app no
-- asume que el contenido es correcto ni completa datos automáticamente.
create table if not exists public.legal_sources (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users(id) on delete cascade,
  course_id     uuid,
  type          legal_source_type not null default 'law',
  identifier    text not null check (char_length(trim(identifier)) between 1 and 200),
  title         text,
  court         text,
  docket        text,
  issued_on     date,
  subject_matter text,
  official_url  text,
  summary       text,
  verification  verification_status not null default 'unverified',
  verified_at   timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  deleted_at    timestamptz,
  constraint legal_sources_id_user_uk unique (id, user_id),
  constraint ls_course_fk foreign key (course_id, user_id)
    references public.courses(id, user_id) on delete set null (course_id),
  constraint ls_verified_chk check (verification <> 'verified' or verified_at is not null)
);

create table if not exists public.legal_concepts (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users(id) on delete cascade,
  course_id    uuid,
  source_id    uuid,
  term         text not null check (char_length(trim(term)) between 1 and 160),
  definition   text not null check (char_length(trim(definition)) >= 3),
  origin       text,
  verification verification_status not null default 'unverified',
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  deleted_at   timestamptz,
  constraint legal_concepts_id_user_uk unique (id, user_id),
  constraint lc_course_fk foreign key (course_id, user_id)
    references public.courses(id, user_id) on delete set null (course_id),
  constraint lc_source_fk foreign key (source_id, user_id)
    references public.legal_sources(id, user_id) on delete set null (source_id)
);

-- Comentario o análisis propio sobre una fuente concreta.
create table if not exists public.legal_notes (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users(id) on delete cascade,
  source_id    uuid,
  course_id    uuid,
  unit_id      uuid,
  title        text not null check (char_length(trim(title)) between 1 and 200),
  body         text,
  quote        text,
  page_ref     text,
  verification verification_status not null default 'unverified',
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  deleted_at   timestamptz,
  constraint legal_notes_id_user_uk unique (id, user_id),
  constraint ln_source_fk foreign key (source_id, user_id)
    references public.legal_sources(id, user_id) on delete set null (source_id),
  constraint ln_course_fk foreign key (course_id, user_id)
    references public.courses(id, user_id) on delete set null (course_id),
  constraint ln_unit_fk foreign key (unit_id, user_id)
    references public.course_units(id, user_id) on delete set null (unit_id)
);

create table if not exists public.flashcards (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users(id) on delete cascade,
  course_id    uuid,
  unit_id      uuid,
  concept_id   uuid,
  front        text not null check (char_length(trim(front)) >= 1),
  back         text not null check (char_length(trim(back)) >= 1),
  mastery      mastery_level not null default 'not_started',
  hits         integer not null default 0 check (hits >= 0),
  misses       integer not null default 0 check (misses >= 0),
  interval_days integer not null default 1 check (interval_days between 0 and 365),
  next_review  date,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  deleted_at   timestamptz,
  constraint flashcards_id_user_uk unique (id, user_id),
  constraint fc_course_fk foreign key (course_id, user_id)
    references public.courses(id, user_id) on delete set null (course_id),
  constraint fc_unit_fk foreign key (unit_id, user_id)
    references public.course_units(id, user_id) on delete set null (unit_id),
  constraint fc_concept_fk foreign key (concept_id, user_id)
    references public.legal_concepts(id, user_id) on delete set null (concept_id)
);

create table if not exists public.practice_questions (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users(id) on delete cascade,
  course_id     uuid,
  unit_id       uuid,
  assessment_id uuid,
  type          question_type not null default 'open',
  prompt        text not null check (char_length(trim(prompt)) >= 3),
  answer        text,
  options       jsonb not null default '[]'::jsonb,
  difficulty    smallint not null default 3 check (difficulty between 1 and 5),
  last_result   boolean,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  deleted_at    timestamptz,
  constraint practice_questions_id_user_uk unique (id, user_id),
  constraint pq_course_fk foreign key (course_id, user_id)
    references public.courses(id, user_id) on delete set null (course_id),
  constraint pq_unit_fk foreign key (unit_id, user_id)
    references public.course_units(id, user_id) on delete set null (unit_id),
  constraint pq_assessment_fk foreign key (assessment_id, user_id)
    references public.assessments(id, user_id) on delete set null (assessment_id),
  constraint pq_options_chk check (type <> 'multiple_choice' or jsonb_array_length(options) >= 2)
);

create table if not exists public.case_briefs (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  course_id   uuid,
  source_id   uuid,
  title       text not null check (char_length(trim(title)) between 1 and 200),
  facts       text,
  legal_issue text,
  rules       text,
  arguments   text,
  conclusion  text,
  status      text not null default 'draft' check (status in ('draft', 'in_review', 'done')),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  deleted_at  timestamptz,
  constraint case_briefs_id_user_uk unique (id, user_id),
  constraint cb_course_fk foreign key (course_id, user_id)
    references public.courses(id, user_id) on delete set null (course_id),
  constraint cb_source_fk foreign key (source_id, user_id)
    references public.legal_sources(id, user_id) on delete set null (source_id)
);

-- ============================================================================
-- 6. TABLAS COMPARTIDAS
-- ============================================================================

create table if not exists public.tasks (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users(id) on delete cascade,
  space         space_type not null default 'work',
  title         text not null check (char_length(trim(title)) between 1 and 300),
  description   text,
  category      text,
  assignee      text,
  priority      priority_level not null default 'medium',
  status        task_status not null default 'pending',
  due_at        timestamptz,
  brand_id      uuid,
  person_id     uuid,
  course_id     uuid,
  assessment_id uuid,
  meeting_id    uuid,
  recurrence    recurrence_type not null default 'none',
  links         jsonb not null default '[]'::jsonb,
  position      integer not null default 0,
  completed_at  timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  deleted_at    timestamptz,
  constraint tasks_id_user_uk unique (id, user_id),
  constraint tasks_brand_fk foreign key (brand_id, user_id)
    references public.brands(id, user_id) on delete set null (brand_id),
  constraint tasks_person_fk foreign key (person_id, user_id)
    references public.people(id, user_id) on delete set null (person_id),
  constraint tasks_course_fk foreign key (course_id, user_id)
    references public.courses(id, user_id) on delete set null (course_id),
  constraint tasks_assessment_fk foreign key (assessment_id, user_id)
    references public.assessments(id, user_id) on delete set null (assessment_id),
  constraint tasks_meeting_fk foreign key (meeting_id, user_id)
    references public.meetings(id, user_id) on delete set null (meeting_id),
  constraint tasks_done_chk check (status <> 'done' or completed_at is not null)
);

create table if not exists public.subtasks (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users(id) on delete cascade,
  task_id    uuid not null,
  title      text not null check (char_length(trim(title)) between 1 and 300),
  is_done    boolean not null default false,
  position   integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint subtasks_id_user_uk unique (id, user_id),
  constraint subtasks_task_fk foreign key (task_id, user_id)
    references public.tasks(id, user_id) on delete cascade
);

create table if not exists public.task_comments (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users(id) on delete cascade,
  task_id    uuid not null,
  body       text not null check (char_length(trim(body)) >= 1),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint task_comments_id_user_uk unique (id, user_id),
  constraint task_comments_task_fk foreign key (task_id, user_id)
    references public.tasks(id, user_id) on delete cascade
);

-- Acuerdos e incidencias de reunión. `task_id` guarda la tarea generada al
-- convertir un acuerdo en pendiente.
create table if not exists public.agreements (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users(id) on delete cascade,
  meeting_id uuid,
  brand_id   uuid,
  task_id    uuid,
  type       agreement_type not null default 'agreement',
  title      text not null check (char_length(trim(title)) between 1 and 250),
  detail     text,
  owner_name text,
  agreed_on  date not null default current_date,
  due_date   date,
  status     agreement_status not null default 'open',
  impact     impact_level not null default 'medium',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  constraint agreements_id_user_uk unique (id, user_id),
  constraint agreements_meeting_fk foreign key (meeting_id, user_id)
    references public.meetings(id, user_id) on delete set null (meeting_id),
  constraint agreements_brand_fk foreign key (brand_id, user_id)
    references public.brands(id, user_id) on delete set null (brand_id),
  constraint agreements_task_fk foreign key (task_id, user_id)
    references public.tasks(id, user_id) on delete set null (task_id)
);

-- Notas y apuntes. Un apunte puede colgar de asignatura, unidad y tema.
create table if not exists public.notes (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users(id) on delete cascade,
  space      space_type not null default 'work',
  type       note_type not null default 'note',
  title      text not null check (char_length(trim(title)) between 1 and 250),
  content    text,
  brand_id   uuid,
  person_id  uuid,
  course_id  uuid,
  unit_id    uuid,
  topic      text,
  meeting_id uuid,
  is_pinned  boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  constraint notes_id_user_uk unique (id, user_id),
  constraint notes_brand_fk foreign key (brand_id, user_id)
    references public.brands(id, user_id) on delete set null (brand_id),
  constraint notes_person_fk foreign key (person_id, user_id)
    references public.people(id, user_id) on delete set null (person_id),
  constraint notes_course_fk foreign key (course_id, user_id)
    references public.courses(id, user_id) on delete set null (course_id),
  constraint notes_unit_fk foreign key (unit_id, user_id)
    references public.course_units(id, user_id) on delete set null (unit_id),
  constraint notes_meeting_fk foreign key (meeting_id, user_id)
    references public.meetings(id, user_id) on delete set null (meeting_id),
  constraint notes_unit_requires_course_chk check (unit_id is null or course_id is not null)
);

-- Eventos personales: el listado pedido no tenía dónde guardarlos y la agenda
-- necesita una línea de tiempo única para los tres espacios.
create table if not exists public.personal_events (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users(id) on delete cascade,
  title      text not null check (char_length(trim(title)) between 1 and 200),
  starts_at  timestamptz not null,
  ends_at    timestamptz,
  location   text,
  notes      text,
  reminder_minutes integer not null default 30 check (reminder_minutes between 0 and 10080),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  constraint personal_events_id_user_uk unique (id, user_id),
  constraint personal_events_range_chk check (ends_at is null or ends_at >= starts_at)
);

-- Bloques de foco reservados en el día (no son eventos con participantes).
create table if not exists public.time_blocks (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users(id) on delete cascade,
  space      space_type not null default 'work',
  title      text not null check (char_length(trim(title)) between 1 and 200),
  block_date date not null,
  start_time time not null,
  end_time   time not null,
  brand_id   uuid,
  course_id  uuid,
  is_done    boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint time_blocks_id_user_uk unique (id, user_id),
  constraint time_blocks_range_chk check (end_time > start_time),
  constraint tb_brand_fk foreign key (brand_id, user_id)
    references public.brands(id, user_id) on delete set null (brand_id),
  constraint tb_course_fk foreign key (course_id, user_id)
    references public.courses(id, user_id) on delete set null (course_id)
);

create table if not exists public.tags (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users(id) on delete cascade,
  name       text not null check (char_length(trim(name)) between 1 and 50),
  color      text not null default '#6B7688' check (color ~* '^#[0-9a-f]{6}$'),
  space      space_type,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint tags_id_user_uk unique (id, user_id)
);
create unique index if not exists tags_user_name_uk on public.tags (user_id, lower(trim(name)));

create table if not exists public.entity_tags (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  tag_id      uuid not null,
  entity_type entity_kind not null,
  entity_id   uuid not null,
  created_at  timestamptz not null default now(),
  constraint entity_tags_uk unique (user_id, tag_id, entity_type, entity_id),
  constraint entity_tags_tag_fk foreign key (tag_id, user_id)
    references public.tags(id, user_id) on delete cascade
);

create table if not exists public.attachments (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users(id) on delete cascade,
  entity_type  entity_kind not null,
  entity_id    uuid not null,
  file_name    text not null check (char_length(trim(file_name)) between 1 and 260),
  storage_path text,
  external_url text,
  mime_type    text,
  size_bytes   bigint check (size_bytes is null or size_bytes >= 0),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  constraint attachments_target_chk check (storage_path is not null or external_url is not null)
);

create table if not exists public.reminders (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  entity_type entity_kind not null,
  entity_id   uuid not null,
  remind_at   timestamptz not null,
  channel     reminder_channel not null default 'in_app',
  message     text,
  sent_at     timestamptz,
  dismissed_at timestamptz,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create table if not exists public.activity_log (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  entity_type entity_kind not null,
  entity_id   uuid not null,
  action      activity_action not null,
  summary     text,
  diff        jsonb,
  created_at  timestamptz not null default now()
);

-- ============================================================================
-- 7. TRIGGERS
-- ============================================================================
do $$
declare
  t text;
  con_updated text[] := array[
    'profiles','user_settings','brands','contacts','stores','people','people_events','requests',
    'incidents','meetings','meeting_participants','message_templates','academic_periods','courses',
    'course_units','class_sessions','assessments','assessment_topics','grades','readings','study_plans',
    'study_sessions','legal_sources','legal_concepts','legal_notes','flashcards','practice_questions',
    'case_briefs','tasks','subtasks','task_comments','agreements','notes','personal_events','time_blocks',
    'tags','attachments','reminders'
  ];
  con_owner text[] := array[
    'brands','contacts','stores','people','people_events','requests','incidents','meetings',
    'meeting_participants','message_templates','academic_periods','courses','course_units','class_sessions',
    'assessments','assessment_topics','grades','readings','study_plans','study_sessions','legal_sources',
    'legal_concepts','legal_notes','flashcards','practice_questions','case_briefs','tasks','subtasks',
    'task_comments','agreements','notes','personal_events','time_blocks','tags','entity_tags',
    'attachments','reminders','activity_log'
  ];
begin
  foreach t in array con_updated loop
    execute format('drop trigger if exists trg_%1$s_updated on public.%1$I;', t);
    execute format('create trigger trg_%1$s_updated before update on public.%1$I for each row execute function public.set_updated_at();', t);
  end loop;

  foreach t in array con_owner loop
    execute format('drop trigger if exists trg_%1$s_owner on public.%1$I;', t);
    execute format('create trigger trg_%1$s_owner before update on public.%1$I for each row execute function public.lock_user_id();', t);
  end loop;
end
$$;

-- Sella `completed_at` al cerrar una tarea y lo limpia al reabrirla.
create or replace function public.tasks_stamp_completion()
returns trigger language plpgsql as $$
begin
  if new.status = 'done' and (tg_op = 'INSERT' or old.status is distinct from 'done') then
    new.completed_at = coalesce(new.completed_at, now());
  elsif new.status <> 'done' then
    new.completed_at = null;
  end if;
  return new;
end;
$$;
drop trigger if exists trg_tasks_completion on public.tasks;
create trigger trg_tasks_completion before insert or update on public.tasks
  for each row execute function public.tasks_stamp_completion();

-- Mantiene el estado de la evaluación coherente con sus notas.
create or replace function public.assessments_sync_status()
returns trigger language plpgsql as $$
declare
  objetivo uuid := coalesce(new.assessment_id, old.assessment_id);
  quedan integer;
begin
  select count(*) into quedan from public.grades where assessment_id = objetivo;
  update public.assessments
     set status = case when quedan > 0 then 'graded'::assessment_status
                       when status = 'graded' then 'pending'::assessment_status
                       else status end
   where id = objetivo;
  return null;
end;
$$;
drop trigger if exists trg_grades_sync on public.grades;
create trigger trg_grades_sync after insert or update or delete on public.grades
  for each row execute function public.assessments_sync_status();

-- Sella la fecha de resolución de una incidencia.
create or replace function public.incidents_stamp_resolution()
returns trigger language plpgsql as $$
begin
  if new.status = 'resolved' then
    new.resolved_at = coalesce(new.resolved_at, now());
  else
    new.resolved_at = null;
  end if;
  return new;
end;
$$;
drop trigger if exists trg_incidents_resolution on public.incidents;
create trigger trg_incidents_resolution before insert or update on public.incidents
  for each row execute function public.incidents_stamp_resolution();

-- Sella la fecha de verificación de una fuente jurídica.
create or replace function public.legal_sources_stamp_verified()
returns trigger language plpgsql as $$
begin
  if new.verification = 'verified' and new.verified_at is null then
    new.verified_at = now();
  elsif new.verification <> 'verified' then
    new.verified_at = null;
  end if;
  return new;
end;
$$;
drop trigger if exists trg_legal_sources_verified on public.legal_sources;
create trigger trg_legal_sources_verified before insert or update on public.legal_sources
  for each row execute function public.legal_sources_stamp_verified();

-- ============================================================================
-- 8. ÍNDICES
-- ============================================================================
create index if not exists idx_tasks_user_space      on public.tasks (user_id, space) where deleted_at is null;
create index if not exists idx_tasks_user_due        on public.tasks (user_id, due_at) where deleted_at is null and status <> 'done';
create index if not exists idx_tasks_user_status     on public.tasks (user_id, status) where deleted_at is null;
create index if not exists idx_tasks_brand           on public.tasks (user_id, brand_id) where deleted_at is null;
create index if not exists idx_tasks_course          on public.tasks (user_id, course_id) where deleted_at is null;
create index if not exists idx_tasks_assessment      on public.tasks (user_id, assessment_id) where deleted_at is null;
create index if not exists idx_subtasks_task         on public.subtasks (user_id, task_id);
create index if not exists idx_task_comments_task    on public.task_comments (user_id, task_id);

create index if not exists idx_brands_user           on public.brands (user_id) where deleted_at is null;
create index if not exists idx_contacts_brand        on public.contacts (user_id, brand_id) where deleted_at is null;
create index if not exists idx_stores_brand          on public.stores (user_id, brand_id) where deleted_at is null;
create index if not exists idx_people_brand          on public.people (user_id, brand_id) where deleted_at is null;
create index if not exists idx_people_events_person  on public.people_events (user_id, person_id, starts_on desc);
create index if not exists idx_requests_brand        on public.requests (user_id, brand_id) where deleted_at is null;
create index if not exists idx_incidents_brand       on public.incidents (user_id, brand_id) where deleted_at is null;
create index if not exists idx_meetings_user_start   on public.meetings (user_id, starts_at) where deleted_at is null;
create index if not exists idx_mp_meeting            on public.meeting_participants (user_id, meeting_id);
create index if not exists idx_agreements_meeting    on public.agreements (user_id, meeting_id) where deleted_at is null;
create index if not exists idx_agreements_brand      on public.agreements (user_id, brand_id) where deleted_at is null;

create index if not exists idx_courses_user          on public.courses (user_id) where deleted_at is null;
create index if not exists idx_course_units_course   on public.course_units (user_id, course_id, position) where deleted_at is null;
create index if not exists idx_class_sessions_start  on public.class_sessions (user_id, starts_at) where deleted_at is null;
create index if not exists idx_assessments_due       on public.assessments (user_id, due_date) where deleted_at is null;
create index if not exists idx_assessments_course    on public.assessments (user_id, course_id) where deleted_at is null;
create index if not exists idx_assessment_topics_a   on public.assessment_topics (user_id, assessment_id, position);
create index if not exists idx_grades_assessment     on public.grades (user_id, assessment_id);
create index if not exists idx_readings_due          on public.readings (user_id, due_date) where deleted_at is null;
create index if not exists idx_study_plans_target    on public.study_plans (user_id, target_date) where deleted_at is null;
create index if not exists idx_study_sessions_date   on public.study_sessions (user_id, scheduled_date) where deleted_at is null;
create index if not exists idx_study_sessions_plan   on public.study_sessions (user_id, plan_id) where deleted_at is null;
create index if not exists idx_legal_sources_user    on public.legal_sources (user_id, type) where deleted_at is null;
create index if not exists idx_legal_concepts_user   on public.legal_concepts (user_id) where deleted_at is null;
create index if not exists idx_legal_notes_source    on public.legal_notes (user_id, source_id) where deleted_at is null;
create index if not exists idx_flashcards_review     on public.flashcards (user_id, next_review) where deleted_at is null;
create index if not exists idx_practice_q_course     on public.practice_questions (user_id, course_id) where deleted_at is null;
create index if not exists idx_case_briefs_user      on public.case_briefs (user_id) where deleted_at is null;

create index if not exists idx_notes_user_created    on public.notes (user_id, created_at desc) where deleted_at is null;
create index if not exists idx_notes_course          on public.notes (user_id, course_id) where deleted_at is null;
create index if not exists idx_personal_events_start on public.personal_events (user_id, starts_at) where deleted_at is null;
create index if not exists idx_time_blocks_date      on public.time_blocks (user_id, block_date);
create index if not exists idx_entity_tags_entity    on public.entity_tags (user_id, entity_type, entity_id);
create index if not exists idx_attachments_entity    on public.attachments (user_id, entity_type, entity_id);
create index if not exists idx_reminders_pending     on public.reminders (user_id, remind_at) where sent_at is null;
create index if not exists idx_activity_log_entity   on public.activity_log (user_id, entity_type, entity_id, created_at desc);

-- Búsqueda de texto sin acentos
create index if not exists idx_tasks_search  on public.tasks  using gin (to_tsvector('spanish', coalesce(title,'') || ' ' || coalesce(description,'')));
create index if not exists idx_notes_search  on public.notes  using gin (to_tsvector('spanish', coalesce(title,'') || ' ' || coalesce(content,'')));
create index if not exists idx_concepts_search on public.legal_concepts using gin (to_tsvector('spanish', coalesce(term,'') || ' ' || coalesce(definition,'')));

-- ============================================================================
-- 9. VISTAS
-- ============================================================================

-- Línea de tiempo única para la agenda de los tres espacios.
create or replace view public.v_calendar
with (security_invoker = true) as
  select m.user_id, m.id, 'meeting'::text as kind, m.space, m.title, m.starts_at, m.ends_at,
         m.location, m.brand_id, null::uuid as course_id
    from public.meetings m where m.deleted_at is null
  union all
  select c.user_id, c.id, 'class', 'university'::space_type,
         coalesce(c.title, co.name), c.starts_at, c.ends_at, c.room, null::uuid, c.course_id
    from public.class_sessions c
    join public.courses co on co.id = c.course_id
   where c.deleted_at is null
  union all
  select a.user_id, a.id, 'assessment', 'university'::space_type, a.title,
         (a.due_date + coalesce(a.due_time, '00:00'::time)) at time zone 'America/Santiago',
         null::timestamptz, null, null::uuid, a.course_id
    from public.assessments a
   where a.deleted_at is null and a.due_date is not null
  union all
  select s.user_id, s.id, 'study_session', 'university'::space_type, s.title,
         (s.scheduled_date + coalesce(s.scheduled_time, '00:00'::time)) at time zone 'America/Santiago',
         null::timestamptz, null, null::uuid, s.course_id
    from public.study_sessions s
   where s.deleted_at is null
  union all
  select p.user_id, p.id, 'personal', 'personal'::space_type, p.title, p.starts_at, p.ends_at,
         p.location, null::uuid, null::uuid
    from public.personal_events p where p.deleted_at is null;

-- Promedio ponderado por asignatura considerando solo lo ya calificado.
create or replace view public.v_course_average
with (security_invoker = true) as
select c.user_id,
       c.id as course_id,
       c.name,
       round(sum(g.score * a.weight) / nullif(sum(a.weight), 0), 2) as partial_average,
       coalesce(sum(a.weight), 0) as graded_weight,
       (select coalesce(sum(a2.weight), 0) from public.assessments a2
         where a2.course_id = c.id and a2.deleted_at is null) as total_weight
  from public.courses c
  left join public.assessments a on a.course_id = c.id and a.deleted_at is null
  left join lateral (
        select gg.score from public.grades gg
         where gg.assessment_id = a.id
         order by gg.attempt desc limit 1
      ) g on true
 where c.deleted_at is null and g.score is not null
 group by c.user_id, c.id, c.name;

-- Carga operativa por marca.
create or replace view public.v_brand_load
with (security_invoker = true) as
select b.user_id, b.id as brand_id, b.name, b.status,
       count(t.id) filter (where t.status not in ('done','cancelled'))                  as open_tasks,
       count(t.id) filter (where t.status not in ('done','cancelled') and t.due_at < now()) as overdue_tasks,
       (select count(*) from public.requests r
         where r.brand_id = b.id and r.deleted_at is null
           and r.status in ('open','in_progress','no_reply'))                            as open_requests,
       (select count(*) from public.incidents i
         where i.brand_id = b.id and i.deleted_at is null and i.status <> 'resolved')    as open_incidents
  from public.brands b
  left join public.tasks t on t.brand_id = b.id and t.deleted_at is null
 where b.deleted_at is null
 group by b.user_id, b.id, b.name, b.status;

-- Páginas pendientes de lectura por asignatura.
create or replace view public.v_reading_pending
with (security_invoker = true) as
select r.user_id, r.course_id,
       sum(greatest(r.total_pages - r.pages_read, 0)) as pending_pages,
       count(*) filter (where r.due_date < current_date and r.pages_read < r.total_pages) as overdue_readings
  from public.readings r
 where r.deleted_at is null
 group by r.user_id, r.course_id;

-- ============================================================================
-- 10. ROW LEVEL SECURITY
-- RLS activo en TODAS las tablas. Política única: user_id = auth.uid()
-- ============================================================================
do $$
declare
  t text;
  tablas text[] := array[
    'user_settings','brands','contacts','stores','people','people_events','requests','incidents',
    'meetings','meeting_participants','agreements','message_templates','academic_periods','courses',
    'course_units','class_sessions','assessments','assessment_topics','grades','readings','study_plans',
    'study_sessions','legal_sources','legal_concepts','legal_notes','flashcards','practice_questions',
    'case_briefs','tasks','subtasks','task_comments','notes','personal_events','time_blocks','tags',
    'entity_tags','attachments','reminders','activity_log'
  ];
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

-- Perfiles: la clave primaria ES el id del usuario.
alter table public.profiles enable row level security;
alter table public.profiles force row level security;

drop policy if exists "profiles_select_own" on public.profiles;
create policy "profiles_select_own" on public.profiles
  for select to authenticated using (auth.uid() = id);

drop policy if exists "profiles_insert_own" on public.profiles;
create policy "profiles_insert_own" on public.profiles
  for insert to authenticated with check (auth.uid() = id);

drop policy if exists "profiles_update_own" on public.profiles;
create policy "profiles_update_own" on public.profiles
  for update to authenticated using (auth.uid() = id) with check (auth.uid() = id);

-- El registro de actividad es solo de escritura y lectura: nunca se edita.
drop policy if exists "activity_log_update_own" on public.activity_log;

-- ============================================================================
-- 11. PERMISOS
-- Sin RLS no hay acceso; estos GRANT solo habilitan el rol autenticado.
-- El rol `anon` no recibe permisos sobre los datos.
-- ============================================================================
grant usage on schema public to authenticated;
grant select, insert, update, delete on all tables in schema public to authenticated;
grant select on public.v_calendar, public.v_course_average, public.v_brand_load, public.v_reading_pending to authenticated;
alter default privileges in schema public grant select, insert, update, delete on tables to authenticated;

revoke all on all tables in schema public from anon;

-- ============================================================================
-- 12. ALMACENAMIENTO DE ARCHIVOS (opcional, para `attachments`)
-- ============================================================================
insert into storage.buckets (id, name, public)
values ('nexo-files', 'nexo-files', false)
on conflict (id) do nothing;

drop policy if exists "nexo_files_own" on storage.objects;
create policy "nexo_files_own" on storage.objects
  for all to authenticated
  using (bucket_id = 'nexo-files' and (storage.foldername(name))[1] = auth.uid()::text)
  with check (bucket_id = 'nexo-files' and (storage.foldername(name))[1] = auth.uid()::text);

-- ============================================================================
-- FIN DEL ESQUEMA
-- ============================================================================
