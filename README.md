# Nexo

Asistente personal de Carlos Quinteros: coordinación de Trade Marketing, carrera de Derecho y vida personal en un solo lugar.

Publicado en **https://nexo-asistente.pages.dev**

| | Qué es | Cuándo usarlo |
|---|---|---|
| **`nexo.html`** | La aplicación completa en un solo archivo. Es la fuente. | Lo que editas |
| **`site/index.html`** | Copia idéntica de `nexo.html`. Es lo que publica Cloudflare Pages. | No lo edites a mano |
| **`app/`** | Proyecto Vite + React + TypeScript con la capa de datos tipada. | Base para una versión futura |

> Después de cambiar `nexo.html`, copia el resultado: `cp nexo.html site/index.html`. Los dos archivos deben quedar idénticos (`diff nexo.html site/index.html` no debe mostrar nada).

---

## Cómo funciona la sincronización

**Supabase es la fuente principal.** El navegador guarda una copia de trabajo, no la verdad.

1. **Al abrir**, Nexo restaura tu sesión y descarga todo lo de tu cuenta.
2. **Al editar**, el cambio se guarda al instante en el equipo y entra a una cola de salida. La cola se vacía sola en menos de un segundo.
3. **Tus otros dispositivos** reciben el cambio por Supabase Realtime, filtrado por tu `user_id`. Los cambios simples se aplican solos; los que Nexo arma juntando varias tablas (agenda, acuerdos, fichas) disparan una recarga con 1,2 s de retardo para no repetirla muchas veces seguidas.
4. **Sin conexión** todo sigue funcionando. Lo que edites queda en la cola y se envía cuando vuelve internet. **Nada local se descarta hasta que Supabase confirma la escritura.**
5. **Si dos dispositivos editan lo mismo**, gana la edición más reciente: cada cambio viaja con el instante exacto en que lo hiciste y la base descarta las escrituras que llegan con fecha más antigua.
6. **La caché está separada por cuenta** (`nexo.db.v1::<tu id>`). Al cerrar sesión se limpia de memoria y no queda nada de una cuenta visible en otra.
7. **Como red de seguridad**, Nexo también se refresca al volver el foco a la pestaña, al recuperar la conexión, cada 5 minutos y con el botón **Sincronizar ahora** (Configuración → Sincronización, o la píldora de estado del encabezado).

El encabezado muestra siempre en qué estado estás: *Sincronizado*, *Sincronizando*, *N cambios por enviar*, *Sin conexión* o *Error de sincronización*.

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
| 1 | `db/01-schema.sql` | 44 tablas, enums, RLS, vistas | Sí |
| 2 | `db/03-universidad.sql` | Módulo académico: preparación, lecturas, apuntes, repaso | Sí |
| 3 | `db/04-auditoria.sql` | Validaciones, índices y función de auditoría | Sí |
| 4 | **`db/05-sync.sql`** | **Sincronización entre dispositivos: borrado suave, Realtime, última modificación válida** | **Sí** |
| 5 | `db/06-google-integrations.sql` | Cuentas de Google: conexiones, correos, eventos, archivos y motor de urgencia | Solo si conectas Google |
| 6 | `db/02-seed.sql` | Crea las funciones de datos de ejemplo | Opcional |

> **`05-sync.sql` es indispensable.** Sin ella los cambios no viajan entre tu computador y tu celular: faltan las columnas de borrado suave, la publicación de Realtime y la regla que decide qué edición gana. Es idempotente y no toca ningún dato existente.

> **`06-google-integrations.sql`** crea el esquema `private`, donde viven los tokens de Google cifrados y fuera del alcance del navegador. Después de ejecutarla: `select public.instalar_reglas_urgencia();`. La guía completa está en **`GOOGLE_SETUP.md`**.

> **Importante sobre el paso 2.** `03-universidad.sql` contiene un `ALTER TYPE ... ADD VALUE`, que PostgreSQL no admite dentro de una transacción. Si el editor te devuelve *"cannot run inside a transaction block"*, ejecuta **solo esa línea** por separado y luego el resto del archivo:
>
> ```sql
> alter type assessment_type add value if not exists 'oral_exam';
> ```

### 2.3 Verificar que quedó bien

```sql
select * from public.auditar_seguridad();
select * from public.auditar_sincronizacion();
select * from public.auditar_google();       -- solo si ejecutaste la 06
```

Todas las filas deben decir `OK`. Si alguna dice `FALLA`, vuelve a ejecutar el archivo correspondiente completo.

También conviene revisar **Database → Replication** en el panel de Supabase: la publicación `supabase_realtime` debe listar unas 39 tablas.

**Comprobación crítica si usas Google.** En **Settings → API → Exposed schemas** debe decir únicamente `public, graphql_public`. Si aparece `private`, quítalo: ese esquema guarda los tokens de Google y no debe ser accesible desde ninguna URL.

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

El sitio en producción sale de la carpeta **`site/`**, no de `app/`.

### 4.1 Publicar un cambio

```bash
cd "ruta/a/Nexo"
cp nexo.html site/index.html          # obligatorio: los dos deben ser idénticos
diff nexo.html site/index.html        # no debe imprimir nada
git add -A
git commit -m "Describe el cambio"
git push origin HEAD:main
```

Cloudflare despliega solo al recibir el push. El `.gitignore` de la raíz ya excluye `node_modules/`, `dist/`, `.DS_Store`, `*.tsbuildinfo` y cualquier `.env`.

### 4.2 Configuración del proyecto en Cloudflare

Cloudflare Dashboard → **Workers & Pages** → tu proyecto → **Settings → Builds & deployments**.

| Campo | Valor |
|---|---|
| Build command | *(vacío)* |
| Build output directory | `site` |
| Root directory | `/` |

No hacen falta variables de entorno: la URL y la anon key se pegan una vez desde la propia aplicación (**Configuración → Conectar Supabase**) y quedan guardadas en tu navegador.

Recuerda tener la URL de producción en las *Redirect URLs* de Supabase (paso 2.4):

```
https://nexo-asistente.pages.dev/**
```

### 4.3 Si prefieres desplegar la versión React de `app/`

Es otro proyecto de Pages, con *Root directory* `app`, *Build command* `npm run build` y *Build output* `dist`, más las variables `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `VITE_AUTH_REDIRECT_URL` y `NODE_VERSION=20`. `app/public/_headers` y `app/public/_redirects` ya vienen configurados.

### 4.4 Cuando publiques una versión nueva

El service worker está versionado (`VERSION` en `sw.js`). El HTML se sirve con «red primero», así que un cambio se ve al recargar. Si alguna vez cambias mucho el service worker, sube ese número para forzar el borrado de las cachés viejas.

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

### Sincronización entre dispositivos

Estas son las importantes. Abre `https://nexo-asistente.pages.dev` en dos navegadores con la misma cuenta (por ejemplo Chrome en el computador y el celular, o una ventana normal y otra de incógnito).

31. **Crear**: crea una tarea en el navegador A. En menos de 3 segundos aparece en el B, sin recargar.
32. **Editar**: cámbiale el título desde el B. El A se actualiza solo.
33. **Borrar**: bórrala desde el A. Desaparece del B.
34. **Recargar**: recarga el B con `F5`. Todo sigue igual.
35. **Cerrar y abrir**: cierra el navegador por completo, vuelve a entrar. La sesión y los datos siguen.
36. **Los tres espacios**: repite 31 a 33 con una asignatura (Universidad) y una nota personal.
37. **Universidad completa**: crea un apunte jurídico y una cita de lectura en el A → aparecen en el B con el texto original intacto.
38. **Aislamiento**: entra con una segunda cuenta en otro navegador. No debe ver **nada** de la primera. Vuelve a la primera: todo sigue ahí.
39. **Sin conexión**: en el A activa el modo avión (o DevTools → Network → Offline). Crea dos tareas. El encabezado dice *«2 cambios por enviar»* y las tareas se ven igual. Vuelve a conectar → se envían solas y aparecen en el B.
40. **Cerrar sesión**: cierra sesión en el A. Debe quedar sin datos de la cuenta a la vista. Vuelve a entrar → todo regresa.
41. **Consola limpia**: abre DevTools → Console. No debe haber errores en rojo durante todo lo anterior.

Si algo de 31 a 33 no funciona, casi siempre es que falta ejecutar `db/05-sync.sql`. Compruébalo con `select * from public.auditar_sincronizacion();`.

### Cuentas de Google

Requieren haber seguido `GOOGLE_SETUP.md` completo.

42. **Conectar**: Configuración → Cuentas conectadas → conectar la cuenta de trabajo y la de la universidad. Aparecen las dos, con su color.
43. **Separación**: los correos de trabajo salen en el espacio Trabajo y los de la universidad en Universidad. Nada se mezcla.
44. **Sincronizar**: «Sincronizar ahora» trae correos y eventos de ambas.
45. **Conflicto**: si tienes dos eventos que se pisan, aparecen en «Conflictos de agenda».
46. **Urgencia explicada**: abre un correo de la bandeja prioritaria. Debe decir *por qué* está ahí, citando su texto y con el puntaje.
47. **Confirmación**: una tarea sugerida **no se crea sola**. Solo aparece como tarea después de pulsar «Crear tarea» y aceptar el formulario.
48. **Sin duplicados**: vuelve a sincronizar. La misma sugerencia no se repite.
49. **Revocar**: desconecta una cuenta. Deja de sincronizar y, en [myaccount.google.com/connections](https://myaccount.google.com/connections), Nexo ya no aparece.
50. **Aislamiento**: con la segunda cuenta de Nexo, no debe verse ninguna cuenta de Google de la primera.
51. **Sin tokens**: DevTools → Application → Local Storage y la pestaña Network. Busca `access_token`, `refresh_token`, `ya29.` o `GOCSPX-`. **No debe haber nada.**
52. **Bloqueo corporativo**: si la cuenta del trabajo falla con `admin_policy_enforced`, Nexo abre una explicación con el texto exacto para pedirle la autorización a tu administrador.

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
| Enviar, responder o borrar correos | No implementado a propósito. Los permisos de Google son de solo lectura. |
| Crear o modificar eventos y archivos | No implementado a propósito. |
| Sincronización de Google en segundo plano | Nexo sincroniza al abrir y con el botón. Para que corra sola con la app cerrada hay que programar un cron en Supabase que llame a `google-sync`. |
| Importar desde BUK, GeoVictoria o Excel | No implementada. |
| Búsqueda jurídica automática | No existe API pública estable de BCN ni del Poder Judicial. Nexo guarda enlaces y exige verificación manual. |
| IA en el asistente | La Edge Function está escrita pero **no probada contra el modelo real**. Hay que desplegarla para saberlo. |
| Interfaz completa en `app/` | La cáscara React demuestra la capa de datos. La interfaz completa vive en `nexo.html`. |

Nexo es material de estudio y organización personal, **no entrega asesoría legal**.
# Nexo-AI
# Nexo-AI
