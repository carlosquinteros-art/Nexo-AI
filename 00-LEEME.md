# Nexo — Guía del proyecto

Asistente personal de Carlos Quinteros para trabajo (Trade Marketing), universidad (Derecho) y vida personal.

---

## Archivos

```
Nexo/
├── README.md                       Instalación, migraciones, despliegue y pruebas
├── AUDITORIA.md                    Auditoría previa a publicar: hallazgos y límites
├── 00-LEEME.md                     Este documento (guía funcional)
├── 01-Analisis-y-Arquitectura.md   Producto, arquitectura, pantallas, MVP vs V2
│
├── nexo.html                       Prototipo funcional completo (un solo archivo)
├── manifest.webmanifest            Instalación como PWA
├── sw.js                           Service worker (funciona sin conexión)
├── icono.svg · icono-maskable.svg
│
├── db/
│   ├── 01-schema.sql               Esquema completo: 44 tablas, enums, RLS
│   ├── 02-seed.sql                 Datos de ejemplo opcionales
│   ├── 03-universidad.sql          Migración del módulo académico
│   ├── 04-auditoria.sql            Validaciones, índices y auditar_seguridad()
│   ├── 05-sync.sql                 Sincronización: borrado suave, Realtime, LWW
│   └── README-SUPABASE.md          Instrucciones paso a paso
│
├── supabase/functions/nexo-ai/     Edge Function: IA con la clave en el servidor
│   └── index.ts
│
└── app/                            Proyecto Vite + React + TypeScript
    ├── package.json · tsconfig.json · vite.config.ts
    ├── eslint.config.js · tailwind.config.ts · postcss.config.js
    ├── index.html · .env.example · .gitignore
    ├── public/           _headers · _redirects · iconos
    └── src/
        ├── main.tsx · App.tsx · index.css
        ├── lib/          supabase.ts · errors.ts · validation.ts
        ├── types/        database.types.ts
        ├── services/     auth · base · tasks · work · university · study · notes · search
        │   └── assistant/  types · datetime · entities · rules · assistant.service
        ├── hooks/        useAuth · useAsync · useDomain · useAssistant
        └── components/   AssistantChat.tsx
```

> Para instalar, configurar Supabase, ejecutar en local o publicar en Cloudflare Pages, usa **`README.md`**. Este documento explica **cómo funciona la aplicación**.

> El antiguo `02-supabase-schema.sql` (v1) fue reemplazado por `db/01-schema.sql`. Si alcanzaste a ejecutarlo, crea un proyecto nuevo de Supabase: los nombres de tabla cambiaron.

---

## 1. Empezar en 2 minutos (sin nube)

Doble clic en `nexo.html`. Funciona de inmediato con datos de ejemplo: 7 marcas, 15 tiendas, 12 personas, 5 asignaturas de Derecho, 13 evaluaciones y 36 tareas, todos con fechas relativas a hoy.

Los datos viven en el navegador. **En cuanto crees o edites algo, dejan de ser "de ejemplo" y pasan a ser tuyos.**

En el celular: ábrelo desde el navegador y usa "Agregar a pantalla de inicio".

---

## 2. Conectar Supabase (persistencia real)

Sigue `db/README-SUPABASE.md`. Resumen:

1. Crear proyecto en Supabase (PostgreSQL 15+).
2. SQL Editor → pegar y ejecutar `db/01-schema.sql`.
3. Ejecutar `db/03-universidad.sql` (migración del módulo académico).
4. Ejecutar `db/04-auditoria.sql` (validaciones e índices).
5. Ejecutar `db/05-sync.sql` (**indispensable** para que los datos viajen entre dispositivos).
6. (Opcional) ejecutar `db/02-seed.sql` para habilitar la carga de ejemplos.
7. Verificar con `select * from public.auditar_seguridad();` y `select * from public.auditar_sincronizacion();` → todas las filas deben decir `OK`.
8. En Nexo: **Configuración → Cuenta y sincronización → Conectar Supabase**, pegar *Project URL* y *anon public key*.
9. **Crear cuenta** con tu correo → Nexo pregunta con qué datos partir:
   - *Usar mis datos de la nube* (si ya tienes)
   - *Subir lo que tengo en este equipo* (la primera migración)
   - *Cargar datos de ejemplo en la nube*

Desde ahí, **cada cambio se envía solo**. Los botones de sincronización quedan para migraciones completas.

### Autenticación incluida

| Función | Dónde |
|---|---|
| Registro | Configuración → Crear cuenta |
| Inicio y cierre de sesión | Configuración, o el indicador del menú lateral |
| Recuperación de contraseña | Pantalla de cuenta → "¿Olvidaste tu contraseña?" |
| Cambio de contraseña | Configuración → Cambiar contraseña (pide la actual) |
| Sesión persistente | Automática: se guarda y el token se renueva solo |
| Perfil | Configuración → Perfil (nombre, nota de aprobación, horarios, tema) |

Para que lleguen los correos de confirmación y recuperación, sirve el archivo por HTTP, no con `file://`:

```bash
cd "ruta/a/Nexo" && python3 -m http.server 5173
# abre http://localhost:5173/nexo.html
```

---

## 3. Qué hace la aplicación

**Inicio** — saludo, fecha y hora de Chile, selector de espacio, 3 prioridades con su motivo, agenda del día, vencidos, marcas que requieren atención, próximas evaluaciones, lecturas pendientes, bloques de tiempo y avance semanal.

**Asistente** — ver sección 3b.

**Tareas** — CRUD completo con subtareas, checklist, recurrencia, enlaces, filtros y vistas lista / calendario / kanban.

**Trabajo** — ficha por marca con contactos, tiendas, equipo, novedades de personal, solicitudes, incidencias, reuniones y acuerdos. Un acuerdo se convierte en tarea con un clic.

**Universidad** — ver sección 3c.

**Estudio** — ver sección 3c.

**Notas** — captura rápida y conversión a tarea, reunión, sesión de estudio, ficha, concepto o novedad. La nota original nunca se modifica.

**Herramientas** — 5 laborales (horas con colación, IVA, cumplimiento de meta, generador de mensajes) y 5 académicas (notas y ponderaciones, nota necesaria, páginas, cronograma, comparador de conceptos).

**Buscador global** — `/` o `⌘K`. Recorre tareas, eventos, marcas, asignaturas, notas, conceptos, fuentes, casos y personas.

---

## 3b. El Asistente

Escribe como hablas. El motor local reconoce **19 intenciones** y extrae 15 datos de la frase.

### Qué reconoce

| Grupo | Intenciones |
|---|---|
| Crear | tarea · reunión · recordatorio · evaluación · sesión de estudio · ficha de caso · plan de estudio |
| Registrar | nota · apunte jurídico · lectura · calificación · fuente jurídica · novedad de una persona |
| Consultar | pendientes · agenda · evaluaciones |
| Producir | cálculo · mensaje · preguntas de estudio |

### Qué extrae

Espacio · marca · asignatura · persona · fecha · hora · prioridad · responsable · punto de venta · tipo de evaluación · ponderación · páginas · duración · tema · descripción.

**Fechas relativas** en zona de Chile: `hoy`, `mañana`, `pasado mañana`, `el viernes`, `el próximo viernes`, `en dos semanas`, `en 3 días`, `la próxima semana`, `este fin de semana`, `el 2 de septiembre`, `28/08`, `hasta el viernes`, `desde mañana`.

**Horas**: `a las 15:00`, `a las 3 de la tarde` → 15:00, `a las 8 de la noche` → 20:00, `a las nueve` → 09:00. Sin franja explícita, las horas de 1 a 7 se leen como tarde, que es como se habla acá.

**Cantidades**: `dos horas` → 120 min, `una hora y media` → 90, `30 páginas`, `cinco unidades`, `vale 30%`, `$678.838`.

### Cómo se comporta

1. **Siempre propone antes de guardar.** La tarjeta muestra la interpretación campo por campo. Puedes revisarla, **editarla** con el botón «Editar», confirmarla o cancelarla. Nada se escribe hasta que confirmas.
2. **Si falta un dato, pregunta.** Con opciones clicables cuando tiene sentido. No rellena huecos con suposiciones.
3. **No inventa.** Si mencionas una tienda en Osorno y no tienes ninguna registrada ahí, te lo dice y ofrece las que sí existen. Lo mismo con personas, marcas y asignaturas.
4. **Historial reciente** en la misma pantalla: toca una frase anterior para volver a ejecutarla.

### Reglas jurídicas del asistente

- Nunca presenta una ley, sentencia o doctrina como verificada. Las fuentes se guardan con estado **no verificado** y campo de enlace oficial.
- No redacta hechos ni decisiones judiciales: la ficha de caso nace con la estructura vacía para que la completes tú.
- Las preguntas de repaso salen **solo** de tu glosario y tus apuntes. Si no hay material propio sobre el tema, lo dice y no genera nada.
- Cuando guarda un apunte o una definición, **conserva tu texto tal cual**, sin reescribirlo.
- Es material de estudio, no asesoría legal.

### Reglas de seguridad

- No borra nada sin confirmación.
- No envía correos ni mensajes: los mensajes se redactan para que tú los copies y revises.
- No modifica reuniones, evaluaciones ni datos de personas sin que confirmes.
- Cada acción confirmada queda en `activity_log`.
- De las novedades de personal solo guarda tipo y fechas. No hay dónde escribir un diagnóstico.

### Activar IA (opcional)

El asistente funciona **sin IA**, con reglas locales, sin enviar tus datos a ningún servicio. Si quieres mejor comprensión:

```bash
supabase functions deploy nexo-ai
supabase secrets set ANTHROPIC_API_KEY=sk-ant-...
```

Luego actívala en **Configuración → Asistente**. La API key vive como secreto en el servidor: el navegador nunca la ve. A la función solo viajan los **nombres** de tus marcas, asignaturas, personas y tiendas para desambiguar; nunca el contenido de tus notas. Si la función falla o no está desplegada, se cae solo a reglas locales sin que te enteres.

---

## 3c. Universidad — asistente de estudio para Derecho

### Panel académico

Al entrar ves, en este orden: la **próxima evaluación** con cuenta regresiva y nivel de preparación, cuatro métricas (promedio general, horas estudiadas esta semana, páginas pendientes, sesiones atrasadas), la lista de **próximas evaluaciones** con días restantes y nota necesaria, las **asignaturas del periodo**, el **estudio de la semana** día por día, los **temas que requieren refuerzo**, el **progreso por unidad**, las **lecturas pendientes** con tiempo estimado y accesos rápidos.

### Escala de notas configurable

Parte en la escala chilena de 1,0 a 7,0 con aprobación en 4,0. En **Configuración → Escala de notas** puedes cambiar mínima, máxima y aprobación: todos los promedios y notas necesarias se recalculan. Si la nota que necesitas se sale de la escala, Nexo lo marca en rojo en vez de mostrar un número imposible.

### Asignaturas

Nueve pestañas por ramo: **Programa** (unidades con dificultad y dominio), **Evaluaciones**, **Lecturas** separadas en obligatoria y complementaria, **Apuntes**, **Legislación**, **Jurisprudencia**, **Casos**, **Repaso** y **Ficha** (profesor, horario, bibliografía, enlaces).

### Evaluaciones

Seis tipos: prueba, control, examen, trabajo, exposición y **examen oral**. Cada una guarda fecha y hora, sala, duración, ponderación, materia incluida, documentos asociados, **nota obtenida**, **nota objetivo** y **nivel de preparación** (sin empezar → leyendo → ejercitando → preparado). El promedio y la nota necesaria se recalculan solos, contra el mínimo de aprobación o contra tu meta personal.

### Planificador con verificación de realismo

Al crear un plan, Nexo calcula los días disponibles, cruza tu disponibilidad declarada con tus clases y sesiones ya agendadas, y te dice antes de generar si el plan es **holgado, ajustado o irreal**, con las horas que necesitas frente a las que realmente tienes. Reparte más tiempo a las unidades difíciles y poco dominadas, agrega repasos a 3 y 7 días y reserva un simulacro la víspera. Las sesiones no completadas se reprograman en bloque, siempre pidiendo confirmación.

### Lecturas

Título, autor, edición, asignatura, total de páginas, **página actual**, fecha límite, prioridad, minutos por página (de ahí sale el **tiempo estimado**) y porcentaje de avance. Cada lectura guarda **citas textuales y comentarios propios** separados, y desde ahí puedes agendar una sesión de lectura.

### Apuntes jurídicos

Organizados por asignatura, unidad y tema. **Tu texto original nunca se modifica**: se muestra en su propio bloque. El contenido derivado —resumen, conceptos principales, normas y jurisprudencia mencionadas— vive en una sección aparte, con la fecha y el autor de la derivación. Desde los conceptos puedes generar fichas de memoria, que nacen con la respuesta vacía para que la escribas tú.

### Análisis de casos

Plantilla completa: nombre, hechos relevantes, partes involucradas, problema jurídico, normas aplicables, argumentos del demandante y del demandado por separado, decisión, fundamentos, **tu opinión** en un bloque propio, fuente y estado de verificación.

### Legislación y jurisprudencia

Dos fichas distintas porque necesitan campos distintos.

*Legislación*: nombre, número, artículo, materia, **texto que tú copiaste**, fuente oficial, fecha de consulta y **vigencia por verificar** (nunca se asume vigente).

*Jurisprudencia*: tribunal, rol, fecha, partes, materia, hechos, decisión, fundamentos, enlace y verificación.

Para marcar cualquiera como verificada, Nexo exige el enlace oficial y te pide confirmar que lo abriste. **Los datos de ejemplo llevan el sello «Dato de ejemplo»** y el fallo de muestra se llama literalmente «[EJEMPLO] Sentencia pendiente de identificar»: ninguno puede confundirse con una fuente real.

### Modo de estudio

Antes de arrancar defines **objetivo, material, asignatura y duración** del bloque. El Pomodoro es configurable (foco, descanso corto y descanso largo cada N bloques) y hay **modo sin distracciones** que oculta toda la interfaz. Durante la sesión registras pausas. Al cerrar, Nexo pregunta el resultado, tu **nivel de concentración**, los minutos efectivos y el **próximo paso**.

### Repaso

Cuatro modalidades: fichas de memoria, selección múltiple, preguntas de desarrollo y casos prácticos. Filtras por tipo, por asignatura o por **solo temas débiles**. Cada respuesta queda registrada y alimenta la precisión por asignatura y por unidad. La repetición espaciada es simple y predecible: **1 → 3 → 7 → 14 → 30 días** al acertar, vuelta a 1 al fallar.

---

## 4. Regla jurídica del producto

Nexo **nunca** genera leyes, artículos, roles ni sentencias. Todo el material jurídico:

- nace como **no verificado** y solo tú puedes marcarlo como verificado;
- guarda el enlace a la fuente oficial;
- muestra un aviso permanente con enlaces a [BCN](https://www.bcn.cl/leychile), [Poder Judicial](https://www.pjud.cl) y [Diario Oficial](https://www.diariooficial.interior.gob.cl).

En la base esto es una columna `verification` con enum, no una casilla suelta: una fuente no puede quedar "verificada" sin fecha de verificación.

---

## 5. Seguridad

- **RLS activo y forzado** en las 40 tablas, con política `user_id = auth.uid()` para leer, crear, modificar y borrar.
- **Aislamiento reforzado con claves foráneas compuestas `(id, user_id)`**: aunque una política tuviera un error, es imposible que una fila apunte a datos de otro usuario.
- El `user_id` lo pone la capa de servicios desde la sesión, nunca el formulario. Un trigger impide además cambiar el dueño de una fila.
- El rol `anon` no tiene permisos sobre los datos: sin sesión no se lee nada.
- **`service_role` jamás en el frontend.** La app rechaza esa clave si la pegas por error.
- Validación doble: en el formulario (mensajes claros) y en la base (CHECK, enums y FKs).
- De las personas del equipo se guardan solo datos operativos. No existen columnas para RUT, dirección ni información de salud: una licencia se registra como tipo y fechas.
- Borrado suave (`deleted_at`) en todo lo que tiene historia; los hijos usan `ON DELETE CASCADE`, así no quedan huérfanos.

---

## 6. Decisiones que tomé y por qué

**Cuatro tablas que no estaban en tu lista.** Las agregué porque, sin ellas, se perdían funciones que ya existen:

| Tabla | Motivo |
|---|---|
| `people_events` | Licencias, reemplazos y renuncias. Meterlas en `incidents` mezclaría novedades de personal con incidencias de ejecución en tienda y arruinaría los reportes. |
| `requests` | Seguimiento de solicitudes al cliente. `agreements` no tiene el par *fecha solicitada / fecha comprometida*, que es justamente lo que hace útil el seguimiento. |
| `personal_events` | La lista no tenía dónde guardar un evento del espacio personal y la agenda necesita una línea de tiempo única. |
| `time_blocks` | Los bloques de foco no son eventos con participantes; son tiempo reservado. |

**La agenda es una vista, no una tabla.** `v_calendar` une reuniones, clases, evaluaciones, sesiones de estudio y eventos personales. Así no hay dos fuentes de verdad para el calendario.

**Las notas académicas viven en `grades`, separadas de `assessments`.** Permite recuperativos y correcciones sin perder el histórico, y un trigger mantiene el estado de la evaluación coherente.

**Se exige PostgreSQL 15.** Uso `ON DELETE SET NULL (columna)` para poder combinar claves compuestas con referencias opcionales. Todos los proyectos nuevos de Supabase lo cumplen.

**Los identificadores locales pasaron a UUID.** El prototipo generaba ids cortos incompatibles con la base. Al sincronizar por primera vez se reescriben junto con todas sus referencias, de forma automática.

**Actualizaciones optimistas solo donde son seguras.** Marcar una tarea, fijar una nota o cambiar el dominio de una unidad se reflejan al instante y se revierten si el servidor falla. Crear registros, generar planes o registrar notas académicas esperan la respuesta real, porque el servidor asigna ids y dispara triggers.

### Simplificación conocida

Las subtareas con fecha propia (las que crea "divide este trabajo en tareas pequeñas") se guardan en `subtasks`, que solo conserva título y estado. Si las creas y luego bajas los datos desde la nube, pierden su fecha. La alternativa era agregar `parent_task_id` a `tasks` y duplicar el concepto de subtarea; preferí respetar la tabla que pediste. Si quieres las fechas, lo cambio.

---

## 7. Lo que sigue sin existir (y qué necesita)

| Función | Estado | Qué falta |
|---|---|---|
| Notificaciones push al teléfono | Preferencias funcionales; alertas dentro de la app | Service Worker + Web Push + claves VAPID en un servidor |
| Asistente con IA real | Motor de reglas completo (19 intenciones) + Edge Function escrita | Solo desplegarla: `supabase functions deploy nexo-ai` y cargar el secreto |
| Google Calendar / Outlook | No existe | OAuth con backend y tokens en servidor |
| Importar BUK / GeoVictoria / Excel | No existe | Parser CSV + mapeo de columnas (se puede hacer sin backend) |
| Búsqueda jurídica automática | Enlaces + verificación manual | No hay API pública estable de BCN ni del Poder Judicial |

No incluí ninguna integración que no exista.

---

## 8. Migrar al proyecto Vite

La carpeta `app/` ya trae la capa de datos completa y tipada. Para levantar el proyecto:

```bash
npm create vite@latest nexo -- --template react-ts
cd nexo
npm install @supabase/supabase-js
cp -r ../Nexo/app/src/* src/
cp ../Nexo/app/.env.example .env.local   # y completa los valores
npm run dev
```

Uso típico:

```tsx
import { AuthProvider, useAuth, useTareas } from './hooks';

function Tareas() {
  const { tareas, cargando, error, alternar, crear } = useTareas({ space: 'work' });
  if (cargando) return <Skeleton />;
  if (error) return <Aviso texto={error.message} />;
  return tareas.map(t => <Fila key={t.id} tarea={t} onToggle={() => alternar.ejecutar(t)} />);
}
```

Despliegue en Cloudflare Pages: build `npm run build`, salida `dist`, variables `VITE_SUPABASE_URL` y `VITE_SUPABASE_ANON_KEY`. Nada más va al navegador.
