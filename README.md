# Nexo

Asistente personal de Carlos Quinteros: coordinación de Trade Marketing, carrera de Derecho y vida personal en un solo lugar.

Dos formas de usarlo:

| | Qué es | Cuándo usarlo |
|---|---|---|
| **`nexo.html`** | Prototipo completo en un solo archivo. Abre con doble clic y funciona. | Uso diario hoy |
| **`app/`** | Proyecto Vite + React + TypeScript con la capa de datos tipada. | Base para la versión desplegada |

---

## 1. Probarlo ahora, sin instalar nada

```bash
open nexo.html          # macOS
xdg-open nexo.html      # Linux
start nexo.html         # Windows
```

Funciona de inmediato con datos de ejemplo. Todo se guarda en el navegador.

Para que funcionen los correos de confirmación de Supabase y la instalación como PWA, hay que servirlo por HTTP:

```bash
cd "ruta/a/Nexo"
python3 -m http.server 5173
# abre http://localhost:5173/nexo.html
```

---

## 2. Configurar Supabase

### 2.1 Crear el proyecto

1. Entra a [supabase.com](https://supabase.com) → **New project**.
2. Región: **South America (São Paulo)**.
3. PostgreSQL **15 o superior** (los proyectos nuevos ya lo cumplen).
4. Guarda la contraseña de la base en tu gestor de contraseñas.

### 2.2 Ejecutar las migraciones — en este orden exacto

SQL Editor → New query → pegar el contenido completo de cada archivo → **Run**.

| Orden | Archivo | Qué hace | Obligatorio |
|---|---|---|---|
| 1 | `db/01-schema.sql` | 40 tablas, enums, RLS, vistas | Sí |
| 2 | `db/03-universidad.sql` | Módulo académico: preparación, lecturas, apuntes, repaso | Sí |
| 3 | `db/04-auditoria.sql` | Validaciones, índices y función de auditoría | Sí |
| 4 | `db/02-seed.sql` | Crea las funciones de datos de ejemplo | Opcional |

> **Importante sobre el paso 2.** `03-universidad.sql` contiene un `ALTER TYPE ... ADD VALUE`, que PostgreSQL no admite dentro de una transacción. Si el editor te devuelve *"cannot run inside a transaction block"*, ejecuta **solo esa línea** por separado y luego el resto del archivo:
>
> ```sql
> alter type assessment_type add value if not exists 'oral_exam';
> ```

### 2.3 Verificar que quedó bien

```sql
select * from public.auditar_seguridad();
```

Las seis filas deben decir `OK`. Si alguna dice `FALLA`, vuelve a ejecutar `01-schema.sql` completo.

Conteo rápido:

```sql
select count(*) as tablas from pg_tables where schemaname = 'public';
-- esperado: 44

select count(*) as politicas from pg_policies where schemaname = 'public';
-- esperado: 175 o más
```

### 2.4 Autenticación

**Authentication → Providers → Email**: activado.

**Authentication → URL Configuration**:

- *Site URL*: `http://localhost:5173` en desarrollo; tu dominio en producción.
- *Redirect URLs*, una por línea:

```
http://localhost:5173/**
https://nexo.tudominio.com/**
```

**Authentication → Settings**: activa *Leaked password protection* y deja el largo mínimo en 8.

### 2.5 Conectar la app

**Project Settings → API** → copia *Project URL* y la clave **`anon` `public`**.

- En `nexo.html`: **Configuración → Cuenta y sincronización → Conectar Supabase**.
- En `app/`: cópialas a `.env.local` (siguiente sección).

> La `anon key` es pública por diseño: viaja al navegador y quien protege los datos es Row Level Security. **Nunca uses la clave de servicio en el frontend**; la app la rechaza si la pegas por error.

---

## 3. Ejecutar el proyecto Vite en tu computador

```bash
cd app
cp .env.example .env.local
```

Edita `.env.local` con tus dos valores:

```
VITE_SUPABASE_URL=https://xxxxxxxx.supabase.co
VITE_SUPABASE_ANON_KEY=eyJhbGciOi...
VITE_AUTH_REDIRECT_URL=http://localhost:5173
```

Instala y levanta:

```bash
npm install
npm run dev
# abre http://localhost:5173
```

### Comandos disponibles

```bash
npm run dev         # servidor de desarrollo
npm run typecheck   # TypeScript sin emitir archivos
npm run lint        # ESLint, falla con cualquier advertencia
npm run build       # typecheck + build de producción en dist/
npm run preview     # sirve dist/ localmente
npm run check       # typecheck + lint + build, todo junto
```

---

## 4. Publicar en Cloudflare Pages

### 4.1 Subir el repositorio

```bash
cd "ruta/a/Nexo"
git init
git add .
git commit -m "Nexo: primera versión"
git branch -M main
git remote add origin https://github.com/TU-USUARIO/nexo.git
git push -u origin main
```

`app/.gitignore` ya excluye `node_modules/`, `dist/` y cualquier `.env`.

### 4.2 Crear el proyecto en Cloudflare

Cloudflare Dashboard → **Workers & Pages** → **Create** → **Pages** → **Connect to Git**.

| Campo | Valor |
|---|---|
| Framework preset | `Vite` |
| Build command | `npm run build` |
| Build output directory | `dist` |
| Root directory | `app` |
| Node version | `20` (variable `NODE_VERSION = 20`) |

**Settings → Environment variables**, para *Production* y *Preview*:

```
VITE_SUPABASE_URL         = https://xxxxxxxx.supabase.co
VITE_SUPABASE_ANON_KEY    = eyJhbGciOi...
VITE_AUTH_REDIRECT_URL    = https://nexo.tudominio.com
NODE_VERSION              = 20
```

Al terminar el despliegue, agrega la URL de Cloudflare a las *Redirect URLs* de Supabase (paso 2.4).

`app/public/_headers` y `app/public/_redirects` ya vienen configurados: cabeceras de seguridad, caché de assets y ruteo de una sola página.

### 4.3 Desplegar desde la terminal (alternativa)

```bash
npm install -g wrangler
cd app
npm run build
wrangler pages deploy dist --project-name nexo
```

### 4.4 Edge Function del asistente (opcional)

Solo si quieres que el asistente use IA. Sin esto funciona con reglas locales.

```bash
npm install -g supabase
supabase login
supabase link --project-ref TU-PROJECT-REF
supabase functions deploy nexo-ai
supabase secrets set ANTHROPIC_API_KEY=tu-clave
```

Luego actívala en la app: **Configuración → Asistente**.

---

## 5. Datos de ejemplo

Después de crear tu cuenta:

- Desde la app: **Configuración → Datos → Cargar datos de ejemplo**.
- O desde el SQL Editor con sesión iniciada: `select public.seed_demo_data();`

Incluye las siete marcas reales de tu cartera —Gnomo Wear, Luau Shoes, Trauko, Dolce Gusto, Hypnos, Inztinto y Arde x Athar— con tiendas, equipo, solicitudes, incidencias, reuniones y acuerdos.

La parte académica es **demostrativa y está marcada como tal**: cinco asignaturas de Derecho con profesores ficticios, evaluaciones, lecturas, apuntes y fichas. Todas llevan `is_demo = true` y la interfaz las muestra con el sello «Asignatura de ejemplo». Ninguna fuente jurídica está verificada y el fallo de muestra se llama literalmente «[EJEMPLO] Sentencia pendiente de identificar».

Para vaciar la cuenta: `select public.wipe_my_data();`

---

## 6. Pruebas manuales antes de publicar

Marca cada una. Toma unos 20 minutos.

### Autenticación
1. Crear una cuenta con correo nuevo → llega el correo de confirmación.
2. Cerrar sesión y volver a entrar → la sesión persiste al recargar.
3. «¿Olvidaste tu contraseña?» → llega el enlace y permite cambiarla.
4. Cambiar contraseña desde Configuración con la clave actual incorrecta → la rechaza.

### Aislamiento de datos (la prueba más importante)
5. Crear una **segunda cuenta** con otro correo.
6. Con la segunda cuenta, la lista de tareas, marcas y asignaturas debe salir **vacía**.
7. Volver a la primera cuenta → los datos siguen ahí.

### Trabajo
8. Crear una marca, una tienda y una persona.
9. Registrar una novedad de licencia → el estado de la persona cambia solo.
10. Crear una reunión, agregar un acuerdo y convertirlo en tarea.
11. Una tarea recurrente completada genera la siguiente ocurrencia.

### Universidad
12. Crear una asignatura, dos unidades y una evaluación con ponderación.
13. Registrar una nota → el promedio y la nota necesaria se recalculan.
14. Cambiar la escala en Configuración a 1–10 con aprobación 5,5 → los números cambian.
15. Crear un plan de estudio → aparece el indicador de realismo antes de generarlo.
16. Registrar una lectura y avanzar páginas → el porcentaje y el tiempo estimado se actualizan.
17. Crear un apunte, derivar contenido → **el texto original no cambia**.
18. Registrar una norma sin enlace y tratar de marcarla verificada → la rechaza.

### Asistente
19. «Recuérdame pedir las ventas de Gnomo mañana a las 10» → propone tarea con fecha correcta.
20. «Crea una tarea para reemplazar a la persona de Osorno» → pregunta por la tienda en vez de inventarla.
21. «Dame el monto neto de $678.838» → responde $570.452.
22. «Calcula nueve horas menos una hora de colación» → responde 8 h 0 min.
23. Cancelar una propuesta → no se guarda nada.

### Interfaz
24. En celular: la barra inferior no tapa contenido y el botón central abre «Agregar rápidamente».
25. Cambiar entre Todo / Trabajo / Universidad / Personal → el color de la app cambia y las listas se filtran.
26. Tema oscuro → todo legible, sin texto sobre fondo del mismo tono.
27. Navegar solo con teclado: `Tab`, `/` para buscar, `Esc` para cerrar modales.
28. Desconectar la red y recargar → si instalaste la PWA, la app abre igual.

### Datos
29. Configuración → Exportar respaldo → se descarga un JSON con todo.
30. Importar ese mismo JSON en otro navegador → los datos aparecen.

---

## 7. Comprobaciones automáticas

```bash
cd app
npm install
npm run check      # typecheck + lint + build
```

En la base de datos:

```sql
select * from public.auditar_seguridad();
```

Para el prototipo de un solo archivo, solo se puede validar la sintaxis:

```bash
node --check sw.js
```

---

## 8. Estructura del repositorio

```
Nexo/
├── README.md                    Este archivo
├── 00-LEEME.md                  Guía funcional detallada
├── 01-Analisis-y-Arquitectura.md
├── AUDITORIA.md                 Resultado de la auditoría previa a publicar
│
├── nexo.html                    Prototipo completo
├── manifest.webmanifest         PWA del prototipo
├── sw.js                        Service worker del prototipo
├── icono.svg · icono-maskable.svg
│
├── db/
│   ├── 01-schema.sql            Esquema base
│   ├── 02-seed.sql              Datos de ejemplo (opcional)
│   ├── 03-universidad.sql       Módulo académico
│   ├── 04-auditoria.sql         Validaciones y auditoría
│   └── README-SUPABASE.md       Guía detallada de Supabase
│
├── supabase/functions/nexo-ai/  Edge Function de IA (opcional)
│
└── app/                         Proyecto Vite + React + TypeScript
    ├── package.json · tsconfig.json · vite.config.ts
    ├── eslint.config.js · tailwind.config.ts · postcss.config.js
    ├── index.html · .env.example · .gitignore
    ├── public/ (_headers, _redirects, iconos)
    └── src/
        ├── lib/          supabase · errors · validation
        ├── types/        database.types.ts
        ├── services/     auth · base · tasks · work · university · study · notes · search
        │   └── assistant/
        ├── hooks/        useAuth · useAsync · useDomain · useAssistant
        └── components/   AssistantChat.tsx
```

---

## 9. Qué no está incluido

Con honestidad, para que no te lleves sorpresas:

| Función | Estado |
|---|---|
| Notificaciones push al teléfono | No implementadas. Requieren un servidor con claves VAPID. |
| Sincronización con Google Calendar | No implementada. Requiere OAuth con backend. |
| Importar desde BUK, GeoVictoria o Excel | No implementada. |
| Búsqueda jurídica automática | No existe API pública estable de BCN ni del Poder Judicial. Nexo guarda enlaces y exige verificación manual. |
| IA en el asistente | La Edge Function está escrita pero **no probada contra el modelo real**. Hay que desplegarla para saberlo. |
| Interfaz completa en `app/` | La cáscara React demuestra la capa de datos. La interfaz completa vive en `nexo.html`. |

Nexo es material de estudio y organización personal, **no entrega asesoría legal**.
# Nexo-AI
# Nexo-AI
