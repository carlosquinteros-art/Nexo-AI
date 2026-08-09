-- ============================================================================
-- NEXO — Migración 06: cuentas de Google (Gmail, Calendar y Drive)
--
-- Se ejecuta DESPUÉS de 01, 03, 04 y 05. Es idempotente.
-- NO borra ni modifica nada de lo anterior.
--
-- LO MÁS IMPORTANTE DE ESTE ARCHIVO
--
--   Los tokens de Google viven en el esquema `private`, que **no está
--   publicado en PostgREST**. Eso significa que no existe ninguna URL que
--   pueda leerlos: ni con tu sesión, ni con la anon key, ni con una consulta
--   armada a mano desde el navegador. Solo las Edge Functions, que corren en
--   el servidor con la clave de servicio, pueden tocarlos. Y además llegan
--   cifrados con AES-GCM: aunque alguien viera la fila, vería ruido.
--
--   Todo lo demás (conexiones, correos, eventos, archivos) sí vive en
--   `public`, con RLS y políticas por `auth.uid()`, porque la aplicación
--   necesita leerlo.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 0. ESQUEMA PRIVADO
-- ----------------------------------------------------------------------------
create schema if not exists private;

comment on schema private is
  'Nunca se publica en la API. Aquí viven los secretos por usuario: tokens de Google y estados de OAuth.';

-- Nadie que venga del navegador entra acá.
revoke all on schema private from public, anon, authenticated;
grant usage on schema private to postgres, service_role;

-- ----------------------------------------------------------------------------
-- 1. ENUMS
-- ----------------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_type where typname = 'google_account_type') then
    create type google_account_type as enum ('work', 'university', 'personal');
  end if;
  if not exists (select 1 from pg_type where typname = 'google_connection_status') then
    create type google_connection_status as enum ('active', 'paused', 'reauth_required', 'revoked', 'error');
  end if;
  if not exists (select 1 from pg_type where typname = 'google_service') then
    create type google_service as enum ('gmail', 'calendar', 'drive');
  end if;
  if not exists (select 1 from pg_type where typname = 'sync_run_status') then
    create type sync_run_status as enum ('running', 'ok', 'partial', 'failed');
  end if;
  if not exists (select 1 from pg_type where typname = 'message_category') then
    create type message_category as enum ('urgent', 'important', 'waiting', 'informative', 'no_action');
  end if;
  if not exists (select 1 from pg_type where typname = 'suggestion_status') then
    create type suggestion_status as enum ('pending', 'accepted', 'dismissed', 'expired');
  end if;
  if not exists (select 1 from pg_type where typname = 'suggestion_kind') then
    create type suggestion_kind as enum ('task', 'reply', 'meeting_prep', 'deadline', 'document', 'event');
  end if;
end
$$;

-- ----------------------------------------------------------------------------
-- 2. CONEXIONES
--
-- Una fila por cuenta de Google conectada. Puedes tener la del trabajo y la de
-- la universidad al mismo tiempo, cada una con su color y sus permisos.
-- Aquí NO hay ningún token.
-- ----------------------------------------------------------------------------
create table if not exists public.google_connections (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references auth.users(id) on delete cascade,
  google_sub      text not null,
  email           text not null,
  display_name    text,
  avatar_url      text,
  account_type    google_account_type not null default 'work',
  color           text not null default '#0D5C63',
  status          google_connection_status not null default 'active',

  -- Qué servicios autorizaste. Se piden por separado, no todos de una vez.
  gmail_enabled    boolean not null default false,
  calendar_enabled boolean not null default false,
  drive_enabled    boolean not null default false,
  scopes           text[] not null default '{}',

  last_sync_at    timestamptz,
  last_error_code text,
  last_error      text,
  token_expires_at timestamptz,

  is_demo         boolean not null default false,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  deleted_at      timestamptz,

  constraint google_connections_id_user_uk unique (id, user_id),
  constraint google_connections_cuenta_uk unique (user_id, google_sub),
  constraint google_connections_email_chk check (email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  constraint google_connections_color_chk check (color ~* '^#[0-9a-f]{6}$')
);

comment on table public.google_connections is
  'Cuentas de Google conectadas. Sin tokens: esos viven en private.google_tokens.';
comment on column public.google_connections.status is
  'active · paused (no sincroniza) · reauth_required (Google revocó el permiso) · revoked · error';
comment on column public.google_connections.last_error is
  'Mensaje entendible del último fallo. Nunca contiene tokens ni contenido de correos.';

-- ----------------------------------------------------------------------------
-- 3. TOKENS — ESQUEMA PRIVADO Y CIFRADOS
--
-- `access_token_enc` y `refresh_token_enc` guardan el resultado de AES-GCM en
-- base64, junto con su vector de inicialización. La llave de cifrado
-- (GOOGLE_TOKEN_ENCRYPTION_KEY) vive solo en los secretos de Supabase y jamás
-- toca la base de datos ni el navegador.
-- ----------------------------------------------------------------------------
create table if not exists private.google_tokens (
  connection_id     uuid primary key,
  user_id           uuid not null references auth.users(id) on delete cascade,
  access_token_enc  text,
  access_token_iv   text,
  refresh_token_enc text,
  refresh_token_iv  text,
  token_type        text not null default 'Bearer',
  scope             text,
  expires_at        timestamptz,
  key_version       smallint not null default 1,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  constraint google_tokens_conn_fk foreign key (connection_id, user_id)
    references public.google_connections(id, user_id) on delete cascade
);

comment on table private.google_tokens is
  'Tokens de Google cifrados con AES-GCM. Inaccesible desde PostgREST: solo las Edge Functions con la clave de servicio pueden leerla.';

-- Estados de OAuth: viven minutos y se borran al usarlos.
create table if not exists private.google_oauth_states (
  state          text primary key,
  user_id        uuid not null references auth.users(id) on delete cascade,
  code_verifier  text not null,
  account_type   google_account_type not null default 'work',
  services       text[] not null default '{}',
  connection_id  uuid,
  redirect_to    text,
  created_at     timestamptz not null default now(),
  expires_at     timestamptz not null default now() + interval '10 minutes'
);

comment on table private.google_oauth_states is
  'Estado temporal del flujo OAuth con PKCE. Se borra apenas se usa y caduca en 10 minutos.';

create index if not exists idx_oauth_states_exp on private.google_oauth_states (expires_at);

-- Limpieza: los estados vencidos no sirven para nada.
create or replace function private.limpiar_oauth_states()
returns integer language plpgsql security definer set search_path = private as $$
declare n integer;
begin
  delete from private.google_oauth_states where expires_at < now();
  get diagnostics n = row_count;
  return n;
end;
$$;

-- Aunque el esquema ya está cerrado, se refuerza tabla por tabla.
revoke all on all tables in schema private from public, anon, authenticated;
revoke all on all functions in schema private from public, anon, authenticated;
grant all on all tables in schema private to service_role;
grant execute on all functions in schema private to service_role;

alter table private.google_tokens       enable row level security;
alter table private.google_oauth_states enable row level security;
-- Sin políticas: nadie salvo service_role (que las omite) puede leer.

-- ----------------------------------------------------------------------------
-- 4. CORREOS
--
-- Se guarda lo mínimo para poder priorizar: quién, qué asunto, cuándo, sus
-- etiquetas y un fragmento corto. **El cuerpo completo no se almacena.**
-- Para leerlo, Nexo abre el mensaje original en Gmail o lo pide al momento.
-- ----------------------------------------------------------------------------
create table if not exists public.google_messages (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references auth.users(id) on delete cascade,
  connection_id   uuid not null,
  external_id     text not null,
  thread_id       text,

  from_name       text,
  from_email      text,
  to_emails       text[] not null default '{}',
  cc_emails       text[] not null default '{}',
  subject         text,
  sent_at         timestamptz,
  labels          text[] not null default '{}',
  is_unread       boolean not null default false,
  is_important    boolean not null default false,
  is_starred      boolean not null default false,
  has_attachments boolean not null default false,

  -- Máximo 300 caracteres. Es el resumen que Gmail ya entrega.
  snippet         text,
  web_link        text,

  -- Lo que el motor determinístico detectó. Cada elemento dice qué regla y por qué.
  detected        jsonb not null default '[]'::jsonb,
  category        message_category,
  category_manual message_category,
  urgency_score   integer not null default 0,
  urgency_reasons jsonb not null default '[]'::jsonb,
  space           space_type not null default 'work',
  answered_at     timestamptz,

  is_demo         boolean not null default false,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  deleted_at      timestamptz,

  constraint google_messages_id_user_uk unique (id, user_id),
  constraint google_messages_externo_uk unique (user_id, connection_id, external_id),
  constraint google_messages_conn_fk foreign key (connection_id, user_id)
    references public.google_connections(id, user_id) on delete cascade,
  constraint google_messages_snippet_chk check (snippet is null or char_length(snippet) <= 300)
);

comment on column public.google_messages.snippet is
  'Fragmento corto que entrega Gmail, recortado a 300 caracteres. El cuerpo completo nunca se guarda.';
comment on column public.google_messages.urgency_reasons is
  'Lista [{regla, texto, puntos}]. Cada alerta tiene que poder explicarse.';
comment on column public.google_messages.category_manual is
  'Si tú reclasificas un correo a mano, esto manda sobre lo que calculó el motor.';

-- ----------------------------------------------------------------------------
-- 5. EVENTOS DE CALENDARIO
-- ----------------------------------------------------------------------------
create table if not exists public.google_calendar_events (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null references auth.users(id) on delete cascade,
  connection_id  uuid not null,
  calendar_id    text not null default 'primary',
  calendar_name  text,
  external_id    text not null,
  ical_uid       text,

  title          text,
  description    text,
  location       text,
  meeting_link   text,
  starts_at      timestamptz,
  ends_at        timestamptz,
  all_day        boolean not null default false,
  organizer_email text,
  attendees      jsonb not null default '[]'::jsonb,
  attendees_count integer not null default 0,
  response_status text,
  event_status   text,
  recurring_id   text,
  web_link       text,
  color          text,

  space          space_type not null default 'work',
  needs_prep     boolean not null default false,
  is_demo        boolean not null default false,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  deleted_at     timestamptz,

  constraint gce_id_user_uk unique (id, user_id),
  constraint gce_externo_uk unique (user_id, connection_id, calendar_id, external_id),
  constraint gce_conn_fk foreign key (connection_id, user_id)
    references public.google_connections(id, user_id) on delete cascade,
  constraint gce_descripcion_chk check (description is null or char_length(description) <= 1000)
);

comment on column public.google_calendar_events.description is
  'Recortada a 1000 caracteres: sirve para detectar preparación pendiente, no para archivar el evento.';

-- ----------------------------------------------------------------------------
-- 6. ARCHIVOS DE DRIVE
--
-- Solo metadatos. Nexo no descarga ni guarda copias de tus documentos.
-- ----------------------------------------------------------------------------
create table if not exists public.google_drive_items (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null references auth.users(id) on delete cascade,
  connection_id  uuid not null,
  external_id    text not null,

  name           text not null,
  mime_type      text,
  icon_link      text,
  web_link       text,
  owner_email    text,
  modified_at    timestamptz,
  size_bytes     bigint,
  parent_id      text,
  parent_name    text,

  -- De dónde salió: reciente, mencionado en un correo o evento, o elegido por ti.
  origin         text not null default 'recent'
                 check (origin in ('recent', 'linked', 'selected')),
  linked_from    text,
  space          space_type not null default 'work',
  is_selected    boolean not null default false,

  is_demo        boolean not null default false,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  deleted_at     timestamptz,

  constraint gdi_id_user_uk unique (id, user_id),
  constraint gdi_externo_uk unique (user_id, connection_id, external_id),
  constraint gdi_conn_fk foreign key (connection_id, user_id)
    references public.google_connections(id, user_id) on delete cascade
);

comment on table public.google_drive_items is
  'Solo metadatos y enlace al original. Nexo nunca descarga ni almacena el contenido de tus archivos.';

-- ----------------------------------------------------------------------------
-- 7. CURSORES DE SINCRONIZACIÓN
--
-- Gmail usa historyId, Calendar usa syncToken y Drive usa pageToken. Guardar
-- el cursor es lo que permite pedir solo lo nuevo en vez de los 30 días otra vez.
-- ----------------------------------------------------------------------------
create table if not exists public.google_sync_state (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null references auth.users(id) on delete cascade,
  connection_id  uuid not null,
  service        google_service not null,
  cursor_value   text,
  page_token     text,
  window_start   timestamptz,
  full_done      boolean not null default false,
  last_ok_at     timestamptz,
  fail_count     smallint not null default 0,
  next_retry_at  timestamptz,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  constraint gss_uk unique (user_id, connection_id, service),
  constraint gss_id_user_uk unique (id, user_id),
  constraint gss_conn_fk foreign key (connection_id, user_id)
    references public.google_connections(id, user_id) on delete cascade
);

comment on column public.google_sync_state.fail_count is
  'Fallos seguidos. Alimenta el reintento con espera creciente (backoff).';

-- ----------------------------------------------------------------------------
-- 8. BITÁCORA DE SINCRONIZACIONES
--
-- Para poder responder "¿por qué no apareció ese correo?". Sin tokens y sin
-- contenido: solo cuántos elementos entraron y qué error hubo.
-- ----------------------------------------------------------------------------
create table if not exists public.google_sync_runs (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null references auth.users(id) on delete cascade,
  connection_id  uuid,
  service        google_service,
  status         sync_run_status not null default 'running',
  started_at     timestamptz not null default now(),
  finished_at    timestamptz,
  items_new      integer not null default 0,
  items_updated  integer not null default 0,
  items_removed  integer not null default 0,
  error_code     text,
  error_message  text,
  trigger_source text not null default 'manual'
                 check (trigger_source in ('manual', 'open_app', 'schedule', 'realtime')),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  constraint gsr_id_user_uk unique (id, user_id),
  constraint gsr_error_chk check (error_message is null or char_length(error_message) <= 500)
);

comment on column public.google_sync_runs.error_message is
  'Mensaje saneado y recortado. Por diseño no incluye tokens, encabezados ni contenido de mensajes.';

-- ----------------------------------------------------------------------------
-- 9. ACCIONES SUGERIDAS
--
-- Nexo nunca crea una tarea solo. Propone, tú confirmas.
-- `dedupe_key` es lo que impide que el mismo correo genere cinco tareas: es
-- única por usuario, así que reprocesar el mismo mensaje no duplica nada.
-- ----------------------------------------------------------------------------
create table if not exists public.suggested_actions (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null references auth.users(id) on delete cascade,
  dedupe_key     text not null,
  kind           suggestion_kind not null default 'task',
  status         suggestion_status not null default 'pending',

  source_type    text not null default 'message'
                 check (source_type in ('message', 'event', 'drive', 'manual')),
  source_id      uuid,
  source_external_id text,
  connection_id  uuid,

  title          text not null check (char_length(trim(title)) between 1 and 250),
  detail         text,
  reason         text,
  reasons        jsonb not null default '[]'::jsonb,
  due_at         timestamptz,
  space          space_type not null default 'work',
  priority       priority_level not null default 'medium',
  confidence     smallint not null default 50 check (confidence between 0 and 100),

  created_task_id uuid,
  decided_at     timestamptz,
  is_demo        boolean not null default false,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  deleted_at     timestamptz,

  constraint sa_id_user_uk unique (id, user_id),
  constraint sa_dedupe_uk unique (user_id, dedupe_key),
  constraint sa_task_fk foreign key (created_task_id, user_id)
    references public.tasks(id, user_id) on delete set null (created_task_id)
);

comment on column public.suggested_actions.dedupe_key is
  'Identificador estable derivado del origen. Evita que el mismo correo proponga la misma tarea dos veces.';
comment on column public.suggested_actions.reasons is
  'Lista [{regla, texto}] con el motivo de la sugerencia. Si no se puede explicar, no se propone.';

-- ----------------------------------------------------------------------------
-- 10. REGLAS DE URGENCIA
--
-- El motor es determinístico y editable. Cada regla suma puntos y deja escrito
-- por qué. Nada de cajas negras.
-- ----------------------------------------------------------------------------
create table if not exists public.urgency_rules (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  code        text not null,
  label       text not null,
  description text,
  enabled     boolean not null default true,
  weight      smallint not null default 10 check (weight between 0 and 100),
  params      jsonb not null default '{}'::jsonb,
  applies_to  text not null default 'message'
              check (applies_to in ('message', 'event', 'both')),
  position    smallint not null default 100,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  deleted_at  timestamptz,
  constraint ur_id_user_uk unique (id, user_id),
  constraint ur_code_uk unique (user_id, code)
);

-- Remitentes que para ti siempre son prioritarios.
create table if not exists public.priority_senders (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users(id) on delete cascade,
  email      text not null,
  label      text,
  space      space_type not null default 'work',
  weight     smallint not null default 25 check (weight between 0 and 100),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  constraint ps_id_user_uk unique (id, user_id),
  constraint ps_email_uk unique (user_id, email)
);

-- ----------------------------------------------------------------------------
-- 11. REGLAS POR DEFECTO
--
-- Se instalan una vez por cuenta. Puedes desactivarlas o cambiarles el peso
-- desde Configuración; volver a ejecutar esto no pisa lo que ajustaste.
-- ----------------------------------------------------------------------------
create or replace function public.instalar_reglas_urgencia()
returns integer
language plpgsql
security invoker
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  n integer := 0;
begin
  if uid is null then raise exception 'Necesitas una sesión iniciada'; end if;

  insert into public.urgency_rules (user_id, code, label, description, weight, params, applies_to, position)
  values
    (uid, 'plazo_24h',        'Vence en menos de 24 horas',
     'La fecha límite detectada en el mensaje o el evento cae dentro de las próximas 24 horas.', 40,
     '{"horas": 24}', 'both', 10),
    (uid, 'plazo_48h',        'Vence en menos de 48 horas',
     'La fecha límite cae dentro de los próximos dos días.', 25, '{"horas": 48}', 'both', 20),
    (uid, 'palabras_urgencia','Dice que es urgente',
     'El asunto o el fragmento usa expresiones de plazo inmediato.', 25,
     '{"palabras": ["urgente","hoy mismo","antes de","último plazo","ultimo plazo","plazo máximo","a más tardar","necesito respuesta","respuesta hoy","para hoy","cuanto antes","lo antes posible","impostergable"]}',
     'message', 30),
    (uid, 'remitente_prioritario', 'Viene de alguien prioritario',
     'El remitente está en tu lista de contactos prioritarios.', 25, '{}', 'message', 40),
    (uid, 'sin_responder',    'Lleva días sin respuesta',
     'Te escribieron directamente y todavía no has respondido.', 20, '{"dias": 3}', 'message', 50),
    (uid, 'evento_sin_preparar', 'Reunión próxima sin preparación',
     'Hay una reunión dentro del plazo configurado y no tienes tareas ni notas asociadas.', 20,
     '{"horas": 24}', 'event', 60),
    (uid, 'conflicto_agenda', 'Choque de horario',
     'Dos eventos se pisan en el calendario.', 30, '{}', 'event', 70),
    (uid, 'traslado_insuficiente', 'Traslado imposible',
     'Dos eventos presenciales seguidos en lugares distintos sin tiempo para moverse.', 25,
     '{"minutos": 30}', 'event', 80),
    (uid, 'solicitud_directa', 'Te piden algo directamente',
     'El mensaje contiene una petición explícita dirigida a ti.', 20, '{}', 'message', 90),
    (uid, 'incidencia_operacional', 'Incidencia en tienda',
     'Menciona quiebre, caída, falta de cobertura u otro problema operacional.', 30,
     '{"palabras": ["quiebre","sin stock","sin cobertura","no llegó","no llego","falta personal","reclamo","caída","caida","urgencia en tienda","sin promotor","cerrada"]}',
     'message', 100),
    (uid, 'evaluacion_proxima', 'Evaluación o entrega cerca',
     'Hay una prueba, examen o entrega universitaria dentro del plazo configurado.', 35,
     '{"dias": 3}', 'both', 110),
    (uid, 'pago_remuneracion',  'Pagos o remuneraciones',
     'Menciona pagos, liquidaciones, boletas o remuneraciones.', 20,
     '{"palabras": ["pago","liquidación","liquidacion","remuneración","remuneracion","boleta","factura","transferencia","finiquito"]}',
     'message', 120),
    (uid, 'contrato_documento', 'Contratos y documentos por firmar',
     'Menciona contratos, anexos o firmas pendientes.', 20,
     '{"palabras": ["contrato","anexo","firma","firmar","buk","documento pendiente"]}', 'message', 130),
    (uid, 'aprobacion_pendiente','Aprobación pendiente',
     'Alguien está esperando tu visto bueno.', 20,
     '{"palabras": ["aprobación","aprobacion","aprobar","visto bueno","confirmar","validar","autorizar"]}',
     'message', 140)
  on conflict (user_id, code) do nothing;

  get diagnostics n = row_count;
  return n;
end;
$$;

comment on function public.instalar_reglas_urgencia() is
  'Instala las reglas por defecto del motor de urgencia. No pisa las que ya ajustaste.';

grant execute on function public.instalar_reglas_urgencia() to authenticated;

-- ----------------------------------------------------------------------------
-- 12. DISPARADORES, ÍNDICES Y RLS
-- ----------------------------------------------------------------------------
do $$
declare
  t text;
  tablas text[] := array[
    'google_connections','google_messages','google_calendar_events','google_drive_items',
    'google_sync_state','google_sync_runs','suggested_actions','urgency_rules','priority_senders'
  ];
begin
  foreach t in array tablas loop
    -- Marca de tiempo y bloqueo de propietario
    execute format('drop trigger if exists trg_%1$s_updated on public.%1$I;', t);
    execute format('create trigger trg_%1$s_updated before update on public.%1$I for each row execute function public.set_updated_at();', t);
    execute format('drop trigger if exists trg_%1$s_owner on public.%1$I;', t);
    execute format('create trigger trg_%1$s_owner before update on public.%1$I for each row execute function public.lock_user_id();', t);

    -- Aislamiento por usuario
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

    -- Índices de sincronización y tiempo real
    execute format('create index if not exists idx_%1$s_sync on public.%1$I (user_id, updated_at desc);', t);

    -- Tiempo real
    execute format('alter table public.%I replica identity full;', t);
    if not exists (
      select 1 from pg_publication_tables
       where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t
    ) then
      execute format('alter publication supabase_realtime add table public.%I;', t);
    end if;
  end loop;
end
$$;

create index if not exists idx_gmsg_bandeja on public.google_messages (user_id, sent_at desc) where deleted_at is null;
create index if not exists idx_gmsg_conexion on public.google_messages (user_id, connection_id) where deleted_at is null;
create index if not exists idx_gmsg_sin_responder on public.google_messages (user_id, answered_at) where deleted_at is null and answered_at is null;
create index if not exists idx_gce_agenda on public.google_calendar_events (user_id, starts_at) where deleted_at is null;
create index if not exists idx_gdi_recientes on public.google_drive_items (user_id, modified_at desc) where deleted_at is null;
create index if not exists idx_sa_pendientes on public.suggested_actions (user_id, status, created_at desc) where deleted_at is null;
create index if not exists idx_gsr_recientes on public.google_sync_runs (user_id, started_at desc);

-- La anon key no toca nada de esto.
revoke all on all tables in schema public from anon;

-- ----------------------------------------------------------------------------
-- 13. VISTAS DE APOYO
-- ----------------------------------------------------------------------------

-- Agenda consolidada de todas las cuentas, con su color de origen.
create or replace view public.v_google_agenda as
select
  e.id, e.user_id, e.connection_id, c.email as cuenta, c.account_type, c.color as color_cuenta,
  e.title, e.starts_at, e.ends_at, e.all_day, e.location, e.meeting_link,
  e.attendees_count, e.space, e.needs_prep, e.web_link,
  (e.location is null or trim(e.location) = '') and (e.meeting_link is null or trim(e.meeting_link) = '') as sin_lugar
from public.google_calendar_events e
join public.google_connections c on c.id = e.connection_id and c.user_id = e.user_id
where e.deleted_at is null and c.deleted_at is null and e.event_status is distinct from 'cancelled';

-- Choques de horario entre eventos de cualquier cuenta.
create or replace view public.v_google_conflictos as
select
  a.user_id,
  a.id as evento_a, a.title as titulo_a, a.starts_at as inicio_a, a.ends_at as fin_a, a.connection_id as cuenta_a,
  b.id as evento_b, b.title as titulo_b, b.starts_at as inicio_b, b.ends_at as fin_b, b.connection_id as cuenta_b,
  greatest(a.starts_at, b.starts_at) as choque_inicio,
  least(a.ends_at, b.ends_at) as choque_fin
from public.google_calendar_events a
join public.google_calendar_events b
  on b.user_id = a.user_id
 and b.id > a.id
 and b.deleted_at is null
 and a.starts_at < b.ends_at
 and b.starts_at < a.ends_at
where a.deleted_at is null
  and a.event_status is distinct from 'cancelled'
  and b.event_status is distinct from 'cancelled'
  and a.all_day = false and b.all_day = false;

comment on view public.v_google_conflictos is
  'Pares de eventos que se pisan. Sirve para avisarte antes de comprometerte dos veces.';

-- ----------------------------------------------------------------------------
-- 14. COMPROBACIÓN
-- ----------------------------------------------------------------------------
create or replace function public.auditar_google()
returns table (control text, resultado text, detalle text)
language plpgsql
security invoker
set search_path = public
as $$
begin
  return query
  select 'Tokens fuera del alcance del navegador'::text,
         case when not exists (
           select 1 from information_schema.role_table_grants
            where table_schema = 'private' and grantee in ('anon', 'authenticated')
         ) then 'OK' else 'FALLA' end,
         'private.google_tokens sin permisos para anon ni authenticated'::text;

  return query
  select 'Esquema private no publicado'::text,
         case when not exists (
           select 1 from information_schema.role_usage_grants
            where object_schema = 'private' and grantee in ('anon', 'authenticated')
         ) then 'OK' else 'REVISAR' end,
         'PostgREST solo expone los esquemas configurados; private no debe estar'::text;

  return query
  select 'RLS en las tablas de Google'::text,
         case when count(*) = 0 then 'OK' else 'FALLA' end,
         case when count(*) = 0 then 'todas protegidas' else string_agg(tablename, ', ') end
    from pg_tables
   where schemaname = 'public' and tablename like 'google\_%' and rowsecurity = false;

  return query
  select 'Sugerencias sin duplicados'::text,
         case when exists (
           select 1 from pg_constraint where conname = 'sa_dedupe_uk'
         ) then 'OK' else 'FALLA' end,
         'suggested_actions.dedupe_key es única por usuario'::text;

  return query
  select 'Reglas de urgencia instaladas'::text,
         case when count(*) >= 14 then 'OK' else 'PENDIENTE' end,
         count(*)::text || ' reglas en tu cuenta (ejecuta select public.instalar_reglas_urgencia())'
    from public.urgency_rules where deleted_at is null;
end;
$$;

grant execute on function public.auditar_google() to authenticated;

-- ============================================================================
-- FIN DE LA MIGRACIÓN
--
-- Después de ejecutarla:
--   select public.instalar_reglas_urgencia();
--   select * from public.auditar_google();
--
-- Y comprueba en Supabase → Settings → API que "Exposed schemas" diga
-- solamente `public, graphql_public`. Si aparece `private`, quítalo.
-- ============================================================================
