-- ============================================================================
-- NEXO — Migración 05: sincronización entre dispositivos
--
-- Se ejecuta DESPUÉS de 01, 03 y 04 (02 es opcional y puede ir antes o después).
-- Es idempotente: puedes ejecutarla las veces que quieras.
--
-- NO BORRA NI MODIFICA DATOS. Solo agrega columnas, índices, publicación de
-- Realtime y redefine dos funciones auxiliares.
--
-- QUÉ HACE
--   1. `deleted_at` en las tablas que aún no lo tenían, para que borrar sea un
--      cambio visible por Realtime en vez de una fila que desaparece en
--      silencio en los otros dispositivos.
--   2. Columnas `tags` que el prototipo ya usaba y no tenían dónde guardarse.
--   3. Última modificación válida: una escritura con `updated_at` más antiguo
--      que el guardado no pisa al registro más nuevo.
--   4. Índices `(user_id, updated_at)` para las bajadas incrementales.
--   5. Publicación `supabase_realtime` con todas las tablas sincronizadas.
--   6. RLS y políticas propias en todo lo que se agregue aquí.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. BORRADO SUAVE EN LAS TABLAS QUE FALTABAN
--
-- Por qué. Con Realtime, un DELETE real llega a los otros dispositivos sin
-- fila nueva y, según la identidad de réplica, ni siquiera pasa el filtro por
-- usuario. Marcando `deleted_at` el borrado viaja como un UPDATE normal: lleva
-- la fila completa, respeta RLS y el otro dispositivo sabe exactamente qué
-- quitar. Además nada se pierde: la fila sigue ahí si hay que recuperarla.
-- ----------------------------------------------------------------------------
alter table public.people_events        add column if not exists deleted_at timestamptz;
alter table public.meeting_participants add column if not exists deleted_at timestamptz;
alter table public.academic_periods     add column if not exists deleted_at timestamptz;
alter table public.assessment_topics    add column if not exists deleted_at timestamptz;
alter table public.grades               add column if not exists deleted_at timestamptz;
alter table public.subtasks             add column if not exists deleted_at timestamptz;
alter table public.task_comments        add column if not exists deleted_at timestamptz;
alter table public.time_blocks          add column if not exists deleted_at timestamptz;
alter table public.reading_notes        add column if not exists deleted_at timestamptz;
alter table public.review_attempts      add column if not exists deleted_at timestamptz;
alter table public.study_intervals      add column if not exists deleted_at timestamptz;
alter table public.study_availability   add column if not exists deleted_at timestamptz;
alter table public.attachments          add column if not exists deleted_at timestamptz;
alter table public.reminders            add column if not exists deleted_at timestamptz;
alter table public.tags                 add column if not exists deleted_at timestamptz;

comment on column public.subtasks.deleted_at is
  'Borrado suave. La fila se conserva para que el borrado viaje por Realtime a los otros dispositivos.';

-- Las tablas de solo registro necesitan `updated_at` para poder ordenarse por
-- última modificación como el resto.
alter table public.review_attempts  add column if not exists updated_at timestamptz not null default now();
alter table public.study_intervals  add column if not exists updated_at timestamptz not null default now();
alter table public.activity_log     add column if not exists updated_at timestamptz not null default now();
alter table public.entity_tags      add column if not exists updated_at timestamptz not null default now();

-- ----------------------------------------------------------------------------
-- 2. COLUMNAS QUE EL PROTOTIPO YA USABA Y NO TENÍAN DESTINO
--
-- Sin esto, las etiquetas del glosario y de las notas se veían en un
-- dispositivo y desaparecían en el otro.
-- ----------------------------------------------------------------------------
alter table public.legal_concepts add column if not exists tags text[] not null default '{}';
alter table public.notes          add column if not exists tags text[] not null default '{}';

comment on column public.legal_concepts.tags is 'Etiquetas libres del término. Se sincronizan como el resto del registro.';

-- ----------------------------------------------------------------------------
-- 3. ÚLTIMA MODIFICACIÓN VÁLIDA
--
-- Regla, en una línea: gana la edición con `updated_at` más reciente.
--
-- Cómo funciona.
--   · El cliente manda el instante exacto en que TÚ editaste la fila.
--   · Si ese instante es anterior al que ya está guardado, la escritura llega
--     tarde: se descarta y el registro guardado se mantiene intacto.
--   · Si el cliente no manda nada, se usa la hora del servidor, igual que antes.
--   · Un reloj adelantado no puede secuestrar la fila: el valor se recorta a la
--     hora del servidor más un minuto de tolerancia.
--
-- Esto reemplaza a `set_updated_at()` de la migración 01, que siempre escribía
-- `now()`. El comportamiento anterior era la causa de que el último dispositivo
-- en sincronizar ganara aunque su copia fuera vieja.
-- ----------------------------------------------------------------------------
create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
declare
  entrante timestamptz;
  techo    timestamptz := now() + interval '1 minute';
begin
  if tg_op = 'INSERT' then
    new.updated_at := least(coalesce(new.updated_at, now()), techo);
    return new;
  end if;

  -- UPDATE
  entrante := new.updated_at;

  -- Sin marca del cliente, o repitiendo la anterior: es una edición nueva.
  if entrante is null or entrante = old.updated_at then
    new.updated_at := now();
    return new;
  end if;

  entrante := least(entrante, techo);

  -- Llegó tarde: ya hay una versión más nueva. Se conserva la guardada.
  if entrante < old.updated_at then
    return old;
  end if;

  new.updated_at := entrante;
  return new;
end;
$$;

comment on function public.set_updated_at() is
  'Marca updated_at y descarta escrituras obsoletas: gana la última modificación válida.';

-- Las tablas que ganaron `updated_at` recién necesitan el disparador.
do $$
declare t text;
begin
  foreach t in array array['review_attempts','study_intervals','activity_log','entity_tags'] loop
    execute format('drop trigger if exists trg_%1$s_updated on public.%1$I;', t);
    execute format('create trigger trg_%1$s_updated before update on public.%1$I for each row execute function public.set_updated_at();', t);
    execute format('drop trigger if exists trg_%1$s_owner on public.%1$I;', t);
    execute format('create trigger trg_%1$s_owner before update on public.%1$I for each row execute function public.lock_user_id();', t);
  end loop;
end
$$;

-- ----------------------------------------------------------------------------
-- 4. ÍNDICES PARA LAS BAJADAS INCREMENTALES
--
-- Cada dispositivo pide "lo que cambió desde la última vez". Sin estos índices
-- esa consulta recorre la tabla completa.
-- ----------------------------------------------------------------------------
do $$
declare
  t text;
  tablas text[] := array[
    'brands','contacts','stores','people','people_events','requests','incidents',
    'meetings','meeting_participants','agreements','academic_periods','courses',
    'course_units','class_sessions','assessments','assessment_topics','grades','readings',
    'study_plans','study_sessions','legal_sources','legal_concepts','legal_notes',
    'flashcards','practice_questions','case_briefs','tasks','subtasks','notes',
    'personal_events','time_blocks','reading_notes','review_attempts','study_intervals',
    'study_availability'
  ];
begin
  foreach t in array tablas loop
    execute format(
      'create index if not exists idx_%1$s_sync on public.%1$I (user_id, updated_at desc);', t);
  end loop;
end
$$;

-- ----------------------------------------------------------------------------
-- 5. REALTIME
--
-- `supabase_realtime` es la publicación que Supabase escucha. Cada tabla que
-- se agrega aquí empieza a emitir cambios; el filtro por `user_id` y las
-- políticas RLS siguen aplicándose, así que un usuario solo recibe lo suyo.
--
-- `replica identity full` hace que los eventos incluyan también la fila
-- anterior. Es lo que permite filtrar por usuario en un borrado real y
-- comparar versiones sin volver a consultar.
-- ----------------------------------------------------------------------------
do $$
declare
  t text;
  tablas text[] := array[
    'brands','contacts','stores','people','people_events','requests','incidents',
    'meetings','meeting_participants','agreements','courses','course_units',
    'class_sessions','assessments','grades','readings','study_plans','study_sessions',
    'legal_sources','legal_concepts','legal_notes','flashcards','practice_questions',
    'case_briefs','tasks','subtasks','notes','personal_events','time_blocks',
    'reading_notes','review_attempts','user_settings','profiles'
  ];
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    execute 'create publication supabase_realtime';
  end if;

  foreach t in array tablas loop
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

-- ----------------------------------------------------------------------------
-- 6. RLS EN TODO LO TOCADO
--
-- Repetido a propósito: si alguna tabla se creó fuera de los bucles de las
-- migraciones anteriores, aquí queda protegida igual. Es idempotente.
-- ----------------------------------------------------------------------------
do $$
declare
  t text;
  tablas text[] := array[
    'reading_notes','review_attempts','study_intervals','study_availability',
    'entity_tags','activity_log','attachments','reminders','tags'
  ];
begin
  foreach t in array tablas loop
    if not exists (select 1 from pg_tables where schemaname = 'public' and tablename = t) then
      continue;
    end if;

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

revoke all on all tables in schema public from anon;

-- ----------------------------------------------------------------------------
-- 7. COMPROBACIÓN
--
-- Ejecuta esto después de la migración. Las cuatro filas deben decir OK.
-- ----------------------------------------------------------------------------
create or replace function public.auditar_sincronizacion()
returns table (control text, resultado text, detalle text)
language plpgsql
security invoker
set search_path = public
as $$
begin
  return query
  select 'Publicación Realtime existe'::text,
         case when exists (select 1 from pg_publication where pubname = 'supabase_realtime')
              then 'OK' else 'FALLA' end,
         'supabase_realtime'::text;

  return query
  select 'Tablas publicadas en Realtime'::text,
         case when count(*) >= 30 then 'OK' else 'REVISAR' end,
         count(*)::text || ' tablas'
    from pg_publication_tables
   where pubname = 'supabase_realtime' and schemaname = 'public';

  return query
  select 'Borrado suave disponible'::text,
         case when count(*) = 0 then 'OK' else 'REVISAR' end,
         case when count(*) = 0 then 'todas las tablas sincronizadas tienen deleted_at'
              else string_agg(x.t, ', ') end
    from (
      select unnest(array[
        'brands','stores','people','people_events','requests','courses','course_units',
        'assessments','grades','readings','study_plans','study_sessions','legal_sources',
        'legal_concepts','legal_notes','flashcards','practice_questions','case_briefs',
        'tasks','subtasks','notes','time_blocks','reading_notes','review_attempts'
      ]) as t
    ) x
   where not exists (
     select 1 from information_schema.columns c
      where c.table_schema = 'public' and c.table_name = x.t and c.column_name = 'deleted_at'
   );

  return query
  select 'Última modificación válida activa'::text,
         case when exists (
           select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public' and p.proname = 'set_updated_at'
              and pg_get_functiondef(p.oid) like '%techo%'
         ) then 'OK' else 'FALLA' end,
         'set_updated_at() descarta escrituras obsoletas'::text;
end;
$$;

grant execute on function public.auditar_sincronizacion() to authenticated;

-- ============================================================================
-- FIN DE LA MIGRACIÓN
-- Comprueba con:  select * from public.auditar_sincronizacion();
-- ============================================================================
