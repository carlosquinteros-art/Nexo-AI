# Configurar Supabase para Nexo — paso a paso

Tiempo estimado: 15 minutos. No necesitas saber SQL: solo copiar y pegar.

---

## 1. Crear el proyecto

1. Entra a [supabase.com](https://supabase.com) y crea una cuenta.
2. **New project**.
   - **Name**: `nexo`
   - **Database Password**: genera una y guárdala en tu gestor de contraseñas. No la vas a usar en la app, pero es la única forma de recuperar acceso directo a la base.
   - **Region**: `South America (São Paulo)` — es la más cercana a Chile.
   - **Postgres version**: 15 o superior (los proyectos nuevos ya lo cumplen).
3. Espera a que termine de aprovisionar (2–3 minutos).

---

## 2. Ejecutar el esquema

1. Menú lateral → **SQL Editor** → **New query**.
2. Abre `db/01-schema.sql`, copia **todo** el contenido y pégalo.
3. **Run** (o `Ctrl/⌘ + Enter`).
4. Debe terminar con *Success. No rows returned*.

**Verificación rápida.** Ejecuta esto en una consulta nueva:

```sql
select tablename,
       rowsecurity as rls_activo
  from pg_tables
 where schemaname = 'public'
 order by tablename;
```

Deben aparecer 40 tablas y **todas** con `rls_activo = true`. Si alguna sale en `false`, vuelve a ejecutar el archivo completo.

Y esta, para confirmar que las políticas quedaron creadas:

```sql
select tablename, count(*) as politicas
  from pg_policies
 where schemaname = 'public'
 group by tablename
 order by tablename;
```

Cada tabla debe tener 4 políticas (select, insert, update, delete); `profiles` tiene 3, porque no se borra.

---

## 3. Datos de ejemplo (opcional)

1. SQL Editor → **New query**.
2. Pega el contenido de `db/02-seed.sql` y ejecútalo. Esto **solo crea las funciones**, todavía no inserta nada.
3. Después de crear tu cuenta en la app (paso 5), carga los datos desde **Configuración → Datos → Cargar datos de ejemplo**.

Para vaciar la cuenta y empezar limpio: **Configuración → Datos → Vaciar mi cuenta**.

---

## 4. Configurar la autenticación

Menú lateral → **Authentication**.

### 4.1 Providers

- **Email**: activado.
- **Confirm email**:
  - Actívalo si quieres verificación por correo (recomendado en producción).
  - Desactívalo mientras pruebas, así entras de inmediato al registrarte.

### 4.2 URL Configuration

- **Site URL**: `http://localhost:5173` en desarrollo; tu dominio de Cloudflare Pages en producción.
- **Redirect URLs**: agrega todas las que uses, una por línea:

```
http://localhost:5173/**
https://nexo.tudominio.com/**
```

Si abres el prototipo `nexo.html` con doble clic, el navegador lo sirve como `file://` y Supabase no acepta esa redirección. Para probar la confirmación por correo y la recuperación de contraseña, sirve el archivo con un servidor local:

```bash
cd "ruta/a/Nexo"
python3 -m http.server 5173
# luego abre http://localhost:5173/nexo.html
```

### 4.3 Plantillas de correo (opcional pero recomendable)

**Authentication → Email Templates**. Traduce al español los mensajes de *Confirm signup* y *Reset password*. El enlace debe mantener `{{ .ConfirmationURL }}`.

### 4.4 Protección extra

**Authentication → Policies / Settings**:

- Activa **Leaked password protection**.
- Deja **Minimum password length** en 8 o más.

---

## 5. Conectar la aplicación

Menú lateral → **Project Settings → API**. Copia:

- **Project URL** → `https://xxxxxxxx.supabase.co`
- **Project API keys → `anon` `public`** → `eyJhbGci...`

> La `anon key` es pública por diseño: va en el navegador y quien protege los datos es Row Level Security. **Nunca** copies la `service_role`: esa ignora RLS y solo sirve en el servidor.

### En el prototipo `nexo.html`

**Configuración → Sincronización** → pega URL y anon key → **Guardar conexión** → **Crear cuenta**.

### En el proyecto Vite

```bash
cd app
cp .env.example .env.local
```

Edita `.env.local`:

```
VITE_SUPABASE_URL=https://xxxxxxxx.supabase.co
VITE_SUPABASE_ANON_KEY=eyJhbGci...
VITE_AUTH_REDIRECT_URL=http://localhost:5173/auth/callback
```

Instala y levanta:

```bash
npm install
npm install @supabase/supabase-js
npm run dev
```

---

## 6. Comprobar que el aislamiento funciona

Esta es la prueba que importa. Crea una **segunda** cuenta de prueba y verifica que no ve nada de la primera:

```sql
-- Ejecutar en el SQL Editor (usa el rol de servicio, así que ve todo).
-- Sirve para confirmar que los datos están separados por user_id.
select user_id, count(*) as filas
  from public.tasks
 group by user_id;
```

Desde la app, con la segunda cuenta, la lista de tareas debe salir vacía. Si vieras datos de la otra cuenta, algo quedó mal: vuelve a ejecutar `01-schema.sql`.

---

## 7. Almacenamiento de archivos (opcional)

El esquema ya crea el bucket privado `nexo-files` con una política que limita cada archivo a la carpeta del usuario. Para subir uno, la ruta debe empezar con el id del usuario:

```ts
await supabase.storage.from('nexo-files').upload(`${user.id}/contratos/anexo.pdf`, archivo);
```

---

## 8. Respaldos

- **Database → Backups**: el plan gratuito guarda respaldos diarios de 7 días.
- Además, la app permite exportar todo a JSON desde **Configuración → Datos → Exportar respaldo**. Guárdalo tú también.

---

## 9. Problemas frecuentes

| Síntoma | Causa y solución |
|---|---|
| `permission denied for table X` | Falta ejecutar `01-schema.sql`, o estás sin sesión iniciada. |
| `new row violates row-level security policy` | Estás enviando `user_id` de otro usuario, o no hay sesión. Los servicios lo ponen solos; no lo mandes desde el formulario. |
| No llega el correo de confirmación | Revisa spam. El SMTP de prueba de Supabase tiene un límite bajo; para uso real configura un SMTP propio en **Authentication → SMTP Settings**. |
| `Invalid Refresh Token` | La sesión caducó en otra pestaña. Cierra sesión y vuelve a entrar. |
| `syntax error at or near "("` al ejecutar el esquema | Tu Postgres es anterior a la versión 15. Crea un proyecto nuevo. |
| La app carga vacía tras conectar | Normal: la cuenta está en blanco. Usa **Cargar datos de ejemplo** o crea tus registros. |
