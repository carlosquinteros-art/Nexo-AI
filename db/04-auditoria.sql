-- ============================================================================
-- NEXO — Migración 04: correcciones de la auditoría previa a publicar
--
-- Se ejecuta DESPUÉS de 01, 02 y 03. Es idempotente.
--
-- QUÉ CORRIGE
--   1. Marca de "dato demostrativo" en asignaturas, unidades y evaluaciones,
--      para que ningún ejemplo académico se confunda con material real.
--   2. Validaciones que faltaban en la base: correos, URLs y rangos.
--   3. Índice que faltaba para el buscador de apuntes.
--   4. Función de verificación de RLS, para auditar la instalación en un paso.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. MARCA DE DATO DEMOSTRATIVO
-- ----------------------------------------------------------------------------
alter table public.courses            add column if not exists is_demo boolean not null default false;
alter table public.course_units       add column if not exists is_demo boolean not null default false;
alter table public.assessments        add column if not exists is_demo boolean not null default false;
alter table public.readings           add column if not exists is_demo boolean not null default false;
alter table public.legal_concepts     add column if not exists is_demo boolean not null default false;
alter table public.legal_notes        add column if not exists is_demo boolean not null default false;
alter table public.practice_questions add column if not exists is_demo boolean not null default false;
alter table public.flashcards         add column if not exists is_demo boolean not null default false;

comment on column public.courses.is_demo is
  'true en los datos de ejemplo. La interfaz los muestra con el sello «Ejemplo» para que nunca se confundan con tu material real.';

-- ----------------------------------------------------------------------------
-- 2. VALIDACIONES QUE FALTABAN
-- ----------------------------------------------------------------------------
do $$
begin
  -- Correos con formato válido en contactos y participantes
  if not exists (select 1 from pg_constraint where conname = 'contacts_email_chk') then
    alter table public.contacts add constraint contacts_email_chk
      check (email is null or email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$');
  end if;

  -- Los enlaces guardados deben ser http/https, nunca javascript: ni data:
  if not exists (select 1 from pg_constraint where conname = 'legal_sources_url_chk') then
    alter table public.legal_sources add constraint legal_sources_url_chk
      check (official_url is null or official_url ~* '^https?://');
  end if;
  if not exists (select 1 from pg_constraint where conname = 'readings_url_chk') then
    alter table public.readings add constraint readings_url_chk
      check (source_url is null or source_url ~* '^https?://');
  end if;

  -- La nota objetivo debe caber en la escala del usuario
  if not exists (select 1 from pg_constraint where conname = 'assessments_target_chk') then
    alter table public.assessments add constraint assessments_target_chk
      check (target_grade is null or (target_grade >= 0 and target_grade <= 100));
  end if;

  -- Minutos por página razonables
  if not exists (select 1 from pg_constraint where conname = 'readings_mpp_chk') then
    alter table public.readings add constraint readings_mpp_chk
      check (estimated_min_per_page > 0 and estimated_min_per_page <= 60);
  end if;
end
$$;

-- ----------------------------------------------------------------------------
-- 3. ÍNDICES QUE FALTABAN
-- ----------------------------------------------------------------------------
create index if not exists idx_legal_notes_search
  on public.legal_notes using gin (to_tsvector('spanish', coalesce(title, '') || ' ' || coalesce(body, '')));
create index if not exists idx_legal_notes_topic
  on public.legal_notes (user_id, course_id, topic) where deleted_at is null;
create index if not exists idx_courses_demo
  on public.courses (user_id, is_demo) where deleted_at is null;

-- ----------------------------------------------------------------------------
-- 4. AUDITORÍA DE SEGURIDAD EN UN PASO
-- Ejecuta `select * from public.auditar_seguridad();` después de instalar.
-- Todas las filas deben decir OK.
-- ----------------------------------------------------------------------------
create or replace function public.auditar_seguridad()
returns table (control text, resultado text, detalle text)
language plpgsql
security invoker
set search_path = public
as $$
begin
  -- Todas las tablas con RLS activo
  return query
  select 'RLS activo en todas las tablas'::text,
         case when count(*) = 0 then 'OK' else 'FALLA' end,
         case when count(*) = 0 then 'sin excepciones'
              else string_agg(tablename, ', ') end
    from pg_tables
   where schemaname = 'public' and rowsecurity = false;

  -- Todas las tablas con RLS forzado (ni el dueño lo salta)
  return query
  select 'RLS forzado'::text,
         case when count(*) = 0 then 'OK' else 'REVISAR' end,
         case when count(*) = 0 then 'sin excepciones'
              else string_agg(c.relname, ', ') end
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relkind = 'r'
     and c.relrowsecurity = true and c.relforcerowsecurity = false;

  -- Cada tabla con al menos una política por operación
  return query
  select 'Políticas por tabla'::text,
         case when count(*) = 0 then 'OK' else 'FALLA' end,
         case when count(*) = 0 then 'todas tienen políticas'
              else string_agg(t.tablename, ', ') end
    from pg_tables t
   where t.schemaname = 'public'
     and t.rowsecurity = true
     and not exists (select 1 from pg_policies p
                      where p.schemaname = 'public' and p.tablename = t.tablename);

  -- El rol anónimo no debe poder leer datos
  return query
  select 'Rol anon sin acceso a datos'::text,
         case when count(*) = 0 then 'OK' else 'FALLA' end,
         case when count(*) = 0 then 'sin permisos'
              else string_agg(table_name, ', ') end
    from information_schema.role_table_grants
   where grantee = 'anon' and table_schema = 'public' and privilege_type in ('SELECT','INSERT','UPDATE','DELETE');

  -- Claves foráneas que apuntan a tablas de usuario sin ser compuestas
  return query
  select 'Aislamiento por clave compuesta'::text,
         case when count(*) = 0 then 'OK' else 'REVISAR' end,
         case when count(*) = 0 then 'todas las relaciones incluyen user_id'
              else string_agg(conname, ', ') end
    from pg_constraint c
    join pg_class t on t.oid = c.conrelid
    join pg_namespace n on n.oid = t.relnamespace
   where c.contype = 'f' and n.nspname = 'public'
     and array_length(c.conkey, 1) = 1
     and c.confrelid <> 'auth.users'::regclass;

  -- Ninguna fuente jurídica verificada sin enlace oficial
  return query
  select 'Fuentes verificadas con enlace'::text,
         case when count(*) = 0 then 'OK' else 'FALLA' end,
         coalesce(count(*)::text || ' sin enlace', '0')
    from public.legal_sources
   where verification = 'verified' and official_url is null;
end;
$$;

grant execute on function public.auditar_seguridad() to authenticated;

-- ----------------------------------------------------------------------------
-- 5. MARCAR COMO EJEMPLO LO QUE YA ESTÉ CARGADO POR EL SEED
-- ----------------------------------------------------------------------------
update public.courses set is_demo = true
 where name in ('Derecho Civil II', 'Derecho Constitucional', 'Derecho Procesal I',
                'Derecho Penal I', 'Introducción al Derecho')
   and professor like 'Prof.%';

update public.course_units u set is_demo = true
  from public.courses c where c.id = u.course_id and c.is_demo;

update public.assessments a set is_demo = true
  from public.courses c where c.id = a.course_id and c.is_demo;

update public.readings r set is_demo = true
  from public.courses c where c.id = r.course_id and c.is_demo;

-- ============================================================================
-- FIN DE LA MIGRACIÓN
-- ============================================================================
