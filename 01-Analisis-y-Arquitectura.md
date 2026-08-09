# Nexo — Análisis de producto y arquitectura

**Versión:** 1.0 · **Fecha:** 08/08/2026 · **Usuario objetivo:** Carlos Quinteros — Coordinador de Trade Marketing (Touch) y estudiante de Derecho.

---

## 1. Análisis de producto

### 1.1 Problema real

No es un problema de "falta de una app de tareas". Es un problema de **fragmentación de contextos**: tres vidas (trabajo, universidad, personal) con lógicas distintas compitiendo por las mismas horas.

| Contexto | Naturaleza de los compromisos | Riesgo si falla |
|---|---|---|
| Trabajo | Reactivo, interrumpible, multi-cliente, con terceros esperando respuesta | Pérdida de confianza del cliente, quiebres de cobertura |
| Universidad | Planificable con anticipación, pero con picos duros (evaluaciones) | Nota reprobatoria, imposible de recuperar |
| Personal | Bajo volumen, alto costo emocional si se olvida | Desgaste |

El conflicto crítico: **lo laboral es urgente y lo académico es importante**. Sin un sistema, lo urgente gana siempre y lo académico colapsa la semana previa a la prueba.

### 1.2 Qué debe resolver Nexo (en orden de valor)

1. **Decidir qué hacer ahora.** Una sola pantalla que responda "¿qué es lo primero?" ponderando urgencia laboral y proximidad académica.
2. **Capturar sin fricción.** Todo lo que pasa en el día entra por WhatsApp, llamadas y pasillo. Si capturar cuesta más de 5 segundos, no se captura.
3. **Convertir una evaluación en un plan.** El planificador es el diferenciador frente a cualquier app genérica.
4. **Dar memoria por cliente y por asignatura.** "¿Qué tengo pendiente con Trauko?" y "¿qué me falta de Constitucional?" deben responderse en un clic.
5. **Ser confiable en el celular.** El 60% del uso es de pie, en tienda o en pasillo de universidad.

### 1.3 Principios de diseño del producto

- **Un solo sistema, tres lentes.** No son tres apps. Es una base de datos con un filtro de espacio (`area`) y una identidad visual por espacio.
- **Nada se ejecuta sin confirmación.** El asistente propone, Carlos aprueba. Especialmente en acciones destructivas o que crean muchos registros.
- **Cero invención jurídica.** Toda referencia legal se marca como *no verificada* hasta que se registre la fuente oficial. La app nunca genera artículos, roles ni sentencias.
- **Mínimo dato personal.** De las personas del equipo se guarda solo lo operativamente necesario (nombre, rol, tienda, estado, vigencia). No se guardan RUT, direcciones, ni datos de salud. Una licencia se registra como estado y fechas, nunca como diagnóstico.
- **Estados vacíos que enseñan.** Cada pantalla vacía explica qué crear y ofrece el botón para hacerlo.

### 1.4 Métricas de éxito

| Métrica | Meta |
|---|---|
| Tareas vencidas al cierre de semana | < 3 |
| Evaluaciones con plan de estudio creado ≥ 10 días antes | 100% |
| Sesiones de estudio completadas / planificadas | > 70% |
| Captura rápida usada por día | ≥ 5 |
| Tiempo para responder "¿qué tengo con la marca X?" | < 10 segundos |

### 1.5 Riesgos y mitigación

| Riesgo | Mitigación en el diseño |
|---|---|
| La app se llena de tareas muertas y pierde credibilidad | Estado "esperando respuesta" separado de "pendiente"; vencidas se muestran agrupadas y con acción masiva de reprogramar |
| El planificador genera sesiones irreales y se abandona | Las sesiones se generan sobre la disponibilidad declarada en Configuración, no sobre horas ideales |
| Doble digitación con Excel/BUK/GeoVictoria | V2 con importación CSV. En MVP, Nexo no reemplaza esos sistemas: los coordina |
| Riesgo legal por contenido jurídico erróneo | Banner permanente de verificación + campo `verificado` obligatorio en fuentes |

---

## 2. Arquitectura de información

### 2.1 Modelo conceptual

```
Usuario
 └── Espacio (trabajo | universidad | personal)   ← lente transversal, no un contenedor
      ├── Contextos
      │    ├── Marca (trabajo)      → tiendas, personas, solicitudes, acuerdos
      │    └── Asignatura (univ.)   → unidades, evaluaciones, lecturas, fuentes
      └── Objetos de trabajo (todos llevan `area` + contexto opcional)
           ├── Tarea      (con subtareas y checklist)
           ├── Evento     (reunión | clase | evaluación | sesión de estudio | personal)
           ├── Nota       (convertible en cualquier otro objeto)
           └── Conocimiento (concepto, ficha, caso, fuente legal)
```

**Decisión clave:** `area` es un atributo, no una carpeta. Por eso la vista "Todo" es trivial de construir y una tarea puede cambiar de espacio sin migrar nada.

### 2.2 Jerarquía de navegación

```
Nexo
├── Inicio                    (agregador, filtrado por espacio)
├── Asistente                 (entrada en lenguaje natural)
├── Tareas                    (lista · calendario · kanban)
├── Agenda                    (reuniones, clases, evaluaciones, sesiones)
├── Trabajo
│   └── Marca                 (resumen · pendientes · solicitudes · equipo · tiendas · acuerdos · notas)
├── Universidad
│   ├── Asignatura            (programa · evaluaciones · notas · lecturas · apuntes)
│   ├── Glosario jurídico
│   ├── Fuentes (legislación y jurisprudencia)
│   └── Casos prácticos
├── Estudio                   (planificador · sesiones · fichas · Pomodoro)
├── Notas
├── Herramientas              (laborales · académicas)
└── Configuración
```

### 2.3 Taxonomía de etiquetas

- **Área:** trabajo · universidad · personal
- **Estado de tarea:** pendiente · en curso · esperando respuesta · completada
- **Prioridad:** baja · media · alta · urgente
- **Semáforo de marca:** al día · requiere atención · crítico
- **Dominio de contenido:** no estudiado · inicial · en progreso · dominado
- **Tipo de evento:** reunión · clase · evaluación · sesión de estudio · personal

### 2.4 Lógica de priorización (el "qué hago primero")

Puntaje por tarea, recalculado en cada render:

```
score = peso_prioridad + urgencia_temporal + castigo_vencida + peso_contexto

peso_prioridad:    urgente 40 · alta 28 · media 15 · baja 6
urgencia_temporal: vence hoy +30 · mañana +18 · en 2-3 días +10 · esta semana +5
castigo_vencida:   +35 y marca visual roja
peso_contexto:     evaluación en <7 días suma +12 a las tareas de esa asignatura
                   marca en estado crítico suma +12 a sus tareas
estado:            "esperando respuesta" resta 12 (no depende de Carlos)
```

Las **tres prioridades del día** son simplemente el top 3 de este ranking dentro del espacio activo.

---

## 3. Pantallas y navegación

### 3.1 Patrón de navegación

| Dispositivo | Patrón |
|---|---|
| Escritorio (≥1024px) | Barra lateral fija de 240px con las 10 secciones + selector de espacio en el encabezado |
| Tablet (768–1023px) | Barra lateral colapsada a iconos |
| Móvil (<768px) | Barra inferior de 5 ítems: Inicio · Tareas · **Captura (+)** · Agenda · Más. El resto vive en "Más" |

El **selector de espacio** (Todo / Trabajo / Universidad / Personal) es persistente en el encabezado y filtra todas las vistas agregadoras. Los espacios se diferencian por color de acento y por un borde izquierdo de 3px en cada tarjeta — nunca por layout distinto.

### 3.2 Inventario de pantallas (MVP)

| # | Pantalla | Propósito | Elementos clave |
|---|---|---|---|
| 1 | Inicio | Decidir qué hacer | Saludo + fecha/hora Chile · selector de espacio · 3 prioridades · próximos eventos (72h) · vencidas · hoy · alertas · próximas fechas académicas · avance semanal · bloques de tiempo |
| 2 | Asistente | Entrada rápida en lenguaje natural | Chat · chips de ejemplo · **tarjeta de propuesta editable** · botones Confirmar / Ajustar / Descartar |
| 3 | Tareas | Gestionar el backlog | 3 vistas (lista/calendario/kanban) · filtros por área, marca, asignatura, estado, prioridad, fecha · subtareas · checklist · recurrencia |
| 4 | Agenda | Ver el tiempo comprometido | Vista semana + lista · creación de evento · acuerdos post-reunión |
| 5 | Trabajo | Panorama de cartera | Grilla de marcas con semáforo · contadores de pendientes y solicitudes vencidas |
| 6 | Ficha de marca | Memoria por cliente | Pestañas: Resumen · Pendientes · Solicitudes · Equipo · Tiendas · Acuerdos e incidencias · Notas |
| 7 | Universidad | Panorama académico | Asignaturas con % avance y promedio · próximas evaluaciones · accesos a glosario, fuentes y casos |
| 8 | Ficha de asignatura | Memoria por ramo | Pestañas: Programa (unidades + dominio) · Evaluaciones (con nota necesaria) · Lecturas · Apuntes · Fuentes |
| 9 | Estudio | Ejecutar el plan | Planes activos · sesiones de hoy · atrasadas con reprogramar masivo · Pomodoro · fichas de memoria · avance |
| 10 | Notas | Capturar y convertir | Buscador · etiquetas · botón "Convertir en…" |
| 11 | Herramientas | Cálculos del día a día | 5 laborales + 5 académicas |
| 12 | Configuración | Ajustes y datos | Perfil · horarios · disponibilidad · notificaciones · tema · exportar/importar · conexión Supabase · privacidad |

### 3.3 Flujos críticos

**A. Captura rápida (objetivo: < 5 segundos)**
```
Botón + (siempre visible) → campo único de texto → el parser detecta área, fecha y tipo
→ tarjeta de propuesta → Confirmar → toast con "Ver" / "Deshacer"
```

**B. De evaluación a plan de estudio**
```
Ficha de asignatura → Evaluación → "Crear plan"
→ formulario: fecha, unidades a cubrir, dificultad, horas/semana disponibles
→ Nexo genera N sesiones sobre los bloques libres declarados en Configuración
→ vista previa editable → Confirmar → las sesiones aparecen en Agenda e Inicio
→ repasos espaciados automáticos a 1, 3, 7 y 14 días de la sesión original
```

**C. Reunión con cliente → acuerdos → tareas**
```
Agenda → Evento (reunión) → al cerrar: "¿Acuerdos?" → cada acuerdo genera tarea
con responsable y fecha → aparece en la ficha de la marca
```

**D. Pregunta al asistente ("¿qué tengo pendiente con Trauko?")**
```
Asistente detecta intención de consulta + entidad marca
→ consulta local sobre tareas + solicitudes + acuerdos abiertos
→ responde con lista accionable (cada ítem abre el registro)
```

---

## 4. Modelo de datos

Detalle completo con tipos, índices y políticas RLS en `02-supabase-schema.sql`. Resumen de tablas y relaciones:

### 4.1 Tablas

| Tabla | Descripción | Relaciones |
|---|---|---|
| `profiles` | Perfil, zona horaria, tema, horarios, disponibilidad | 1:1 con `auth.users` |
| `brands` | Marcas/clientes que coordina | 1:N con stores, people, tasks, requests |
| `stores` | Puntos de venta | N:1 brand |
| `people` | Equipo en tienda (datos mínimos) | N:1 brand, N:1 store |
| `person_events` | Ingreso, licencia, vacaciones, reemplazo, renuncia | N:1 person |
| `requests` | Solicitudes a clientes o áreas internas, con compromiso | N:1 brand |
| `agreements` | Acuerdos e incidencias de reuniones | N:1 brand, N:1 event |
| `subjects` | Asignaturas | 1:N units, evaluations, readings |
| `units` | Unidades del programa + nivel de dominio | N:1 subject |
| `evaluations` | Pruebas, exámenes, controles, trabajos, presentaciones | N:1 subject |
| `readings` | Lecturas con páginas totales y leídas | N:1 subject |
| `glossary` | Conceptos jurídicos | N:1 subject |
| `legal_sources` | Legislación y jurisprudencia con `verificado` | N:1 subject |
| `cases` | Casos prácticos (hechos, problema, normas, argumentos, conclusión) | N:1 subject |
| `flashcards` | Fichas de memoria con repetición espaciada | N:1 subject, N:1 unit |
| `study_plans` | Plan generado desde una evaluación | N:1 evaluation, N:1 subject |
| `study_sessions` | Sesiones y repasos, con minutos efectivos | N:1 plan, N:1 unit |
| `tasks` | Tareas de las 3 áreas, con auto-referencia para subtareas | N:1 brand, N:1 subject, N:1 self |
| `events` | Reuniones, clases, evaluaciones, sesiones, eventos personales | N:1 brand, N:1 subject |
| `notes` | Notas y apuntes convertibles | N:1 brand, N:1 subject, N:1 unit |
| `time_blocks` | Bloques de tiempo reservados para trabajar o estudiar | N:1 subject/brand |

### 4.2 Convenciones transversales

- Toda tabla tiene `id uuid default gen_random_uuid()`, `user_id uuid references auth.users`, `created_at`, `updated_at`.
- `area` es `text check (area in ('trabajo','universidad','personal'))`.
- Fechas con hora usan `timestamptz`; fechas puras usan `date`. La app convierte a `America/Santiago` en presentación.
- **RLS activo en todas las tablas** con la política `user_id = auth.uid()` para `select`, `insert`, `update` y `delete`.
- Índices en `(user_id, area)`, `(user_id, due_at)`, `(user_id, brand_id)`, `(user_id, subject_id)`.

### 4.3 Reglas de negocio en base de datos

- `tasks.completed_at` se llena por trigger cuando `estado = 'completada'`.
- `evaluations.ponderacion` por asignatura debería sumar 100; la app avisa si no cuadra (no lo bloquea, porque los programas cambian).
- `study_sessions.estado` pasa a `atrasada` por cálculo en cliente cuando `fecha < hoy` y sigue `pendiente`.
- Borrado de una marca o asignatura usa `on delete set null` en tareas/eventos/notas: nunca se pierde el registro histórico.

---

## 5. MVP vs. Versión 2

### 5.1 MVP (lo que se construye ahora)

**Incluido y funcional en el prototipo:**

- Espacios Trabajo / Universidad / Personal + vista Todo
- Inicio con priorización automática, vencidas, hoy, alertas, avance semanal y bloques de tiempo
- Asistente por reglas: detección de área, intención, fecha y hora en español; propuesta estructurada con confirmación obligatoria
- Tareas: CRUD completo, subtareas, checklist, recurrencia, enlaces, filtros, vistas lista / calendario / kanban
- Trabajo: fichas de marca con semáforo, tiendas, equipo, novedades de personal, solicitudes, acuerdos e incidencias
- Universidad: fichas de asignatura, unidades con dominio, evaluaciones, cálculo de promedio y nota necesaria, lecturas con páginas pendientes, apuntes, glosario, fuentes legales con marca de verificación, casos prácticos, buscador
- Planificador: generación de sesiones desde una evaluación, repasos espaciados, sesiones atrasadas, reprogramación, Pomodoro y registro de minutos efectivos
- Agenda con reuniones, clases, evaluaciones, sesiones y eventos personales
- Notas con conversión a tarea / evento / sesión / ficha / concepto
- Herramientas laborales y académicas (10)
- Configuración: perfil, horarios, disponibilidad, tema claro/oscuro, exportar e importar JSON, conexión a Supabase
- Datos de demostración realistas para las 7 marcas y 5 asignaturas

### 5.2 Versión 2

| Función | Qué requiere |
|---|---|
| Notificaciones push reales | Service Worker + Web Push + VAPID keys en un backend (Supabase Edge Function). No es posible en un archivo HTML local |
| Asistente con IA real | Proxy en Supabase Edge Function que guarde la API key del lado servidor. **Nunca en el frontend.** El prototipo deja la interfaz y el contrato listos |
| Sincronización con Google Calendar / Outlook | OAuth con backend, tokens en servidor |
| Importación desde BUK / GeoVictoria / Excel | Parser CSV + mapeo de columnas. Se puede adelantar sin backend |
| OCR de apuntes en foto | Servicio externo de visión |
| Colaboración con el equipo | Multi-usuario, roles, RLS por organización |
| Modo offline completo | IndexedDB + cola de sincronización |
| Reportes exportables a PDF/Excel para clientes | Generación en cliente o Edge Function |
| Repetición espaciada avanzada (SM-2 completo) | Solo algoritmo; el MVP usa intervalos fijos 1/3/7/14 |
| Widgets de escritorio y atajos iOS | App nativa o PWA con Shortcuts |

### 5.3 Lo que el prototipo simula y por qué

Cumpliendo la restricción de no inventar integraciones:

| Función | Estado en el prototipo | Para conectarla de verdad |
|---|---|---|
| Asistente en lenguaje natural | **Real, por reglas.** Parser en español que entiende fechas, marcas, asignaturas e intenciones | Reemplazar `Asistente.parse()` por una llamada a `/functions/v1/nexo-ai` en Supabase, que llame al modelo con la API key del servidor |
| Notificaciones | Interfaz de preferencias funcional; las alertas se muestran dentro de la app | Service Worker + Web Push + tabla `push_subscriptions` |
| Sincronización en la nube | **Real.** Panel de conexión a Supabase con URL y anon key públicas, login por correo y sincronización de todas las tablas | Solo crear el proyecto y ejecutar el SQL |
| Búsqueda jurídica oficial | Enlaces directos a BCN, Poder Judicial y Diario Oficial + campo `verificado` | Ninguna API pública estable; se mantiene como verificación manual |
| Respaldo | **Real.** Exportar / importar JSON completo | — |

---

## 6. Seguridad y privacidad

- La **anon key** de Supabase es pública por diseño; la seguridad real la da RLS. En el prototipo se guarda en `localStorage` del navegador de Carlos, no en el código.
- **Nunca** se coloca `service_role`, ni API keys de modelos, ni secretos en el frontend.
- RLS obligatorio en las 21 tablas antes de cargar cualquier dato real.
- Datos de personas del equipo: solo nombre, rol, tienda, estado y vigencia. Sin RUT, sin dirección, sin motivo médico. El campo de licencia registra únicamente tipo y fechas.
- Exportación completa disponible siempre (portabilidad).
- Sesión con expiración; cerrar sesión borra el espejo local.

---

## 7. Siguientes pasos sugeridos

1. Abrir el prototipo y usarlo una semana con los datos demo para validar la lógica de priorización.
2. Crear el proyecto en Supabase y ejecutar `02-supabase-schema.sql`.
3. Pegar URL y anon key en Configuración → Sincronización, crear cuenta y subir los datos.
4. Ajustar disponibilidad de estudio real en Configuración antes de generar el primer plan.
5. Recién entonces migrar a un proyecto Vite + React + TypeScript para el despliegue en Cloudflare Pages, reutilizando el esquema y la lógica ya validada.
