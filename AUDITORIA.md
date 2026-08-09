# Auditoría previa a publicar — Nexo

Fecha: 08/08/2026 · Versión auditada: la de este repositorio.

---

## Antes que nada: qué pude y qué no pude verificar

El entorno donde trabajé **no tiene acceso a internet ni a npm**. Eso significa que:

**No pude ejecutar** `tsc`, `eslint`, `vite build` ni levantar una base PostgreSQL real. Cualquier afirmación sobre que "el proyecto compila" sería inventada, así que no la hago. Los comandos exactos para que los corras tú están en el README, sección 7.

**Sí pude ejecutar**, con analizadores que escribí para este proyecto:

| Comprobación | Herramienta | Resultado |
|---|---|---|
| Sintaxis JavaScript del prototipo | `node --check` | Sin errores |
| Sintaxis del service worker | `node --check` | Sin errores |
| Resolución de importaciones TS | Analizador propio de módulos | 0 rotas |
| Nombres importados que el módulo destino no exporta | Analizador propio | 0 |
| Estructura de los 26 archivos TS/TSX | Balance de llaves, paréntesis y corchetes | Equilibrado |
| Ejecución real del prototipo | Máquina virtual de Node con DOM simulado | 0 fallos |
| Renderizado de 109 pantallas y modales | Volcado + parser HTML | 109/109 bien formadas |
| Botones sin controlador | Cruce de `data-act` emitidos contra manejados | 0 huérfanos |
| Rutas inexistentes | Cruce de enlaces `#/` contra vistas | 0 |
| Cálculos (CLP, IVA, horas, notas) | Aserciones numéricas | 24/24 correctas |
| Fechas relativas y zona horaria | Aserciones contra fechas conocidas | 10/10 correctas |
| Asistente: 21 frases del enunciado | Prueba de clasificación | 21/21 |
| Validez de los archivos SQL | Analizador de estructura, FKs, enums y RLS | 0 inconsistencias |
| Secretos expuestos | Búsqueda de patrones de claves | 0 |

---

## Hallazgos y qué hice con cada uno

### Bloqueantes para publicar

**1. El proyecto `app/` no era compilable ni desplegable.**
Faltaba todo el andamiaje: `package.json`, `tsconfig.json`, `vite.config.ts`, `index.html`, el punto de entrada React, la configuración de ESLint, Tailwind y PostCSS. Sin eso no había forma de correr `npm run build` ni de publicar en Cloudflare.
→ **Creados los 12 archivos.** Además `src/main.tsx` y `src/App.tsx`, una cáscara React que ejercita de verdad la capa de datos: autenticación, panel, tareas y asistente, con estados de carga, error y vacío.

**2. No era instalable como PWA.**
Ni el prototipo ni el proyecto tenían manifest ni service worker.
→ **Prototipo**: `manifest.webmanifest`, `sw.js` con estrategia *network-first* para el HTML y *stale-while-revalidate* para los recursos, más dos iconos. El service worker se registra solo cuando la página se sirve por `http/https`, nunca con `file://`.
→ **Proyecto Vite**: `vite-plugin-pwa` configurado, con las rutas de datos y autenticación explícitamente excluidas de la caché.

**3. Faltaba `README.md`.**
→ Creado, con comandos exactos, orden de migraciones y 30 pruebas manuales.

### Errores de TypeScript

**4. `Record<string, never>` en `assistant.service.ts`.**
Ese tipo impide leer cualquier propiedad: `tsc` habría fallado en cada acceso a `d.dias`, `d.courseId`, etc.
→ Reemplazado por un objeto con accesores tipados uno a uno.

**5. `@ts-expect-error` en `base.service.ts`.**
Se usaba para aplicar un operador de filtro dinámico. Es frágil: si el error desaparece, TypeScript falla al revés.
→ Sustituido por un mapa de funciones tipado que cubre los diez operadores.

**6. `resumen()` en `tasks.service.ts` con castings encadenados.**
Tenía tres niveles de `as never` que casi con seguridad no compilaban.
→ Reescrita con tres consultas paralelas legibles y comprobación de error explícita.

**7. `Record<string, never>` en las funciones RPC.**
→ Cambiado a `Record<PropertyKey, never>`, que es lo que genera el CLI de Supabase.

### Lint

**8. Tres importaciones sin usar** (`useCallback` y `unitsService` en `useDomain.ts`, `unitsService` en `study.service.ts`).
→ Eliminadas. La regla `@typescript-eslint/no-unused-vars` queda en `error`, no en advertencia.

### Formularios sin validación

**9. Los correos y las URL no se validaban en el cliente.**
La base sí los rechazaba, pero el usuario veía un error críptico del servidor.
→ El constructor de formularios ahora valida formato de correo, formato de URL, rangos numéricos `min`/`max` y largo máximo, y marca en rojo el campo con el problema.
→ En la base agregué las restricciones que faltaban: correo en `contacts`, `official_url` y `source_url` obligados a empezar con `http/https` (bloquea `javascript:` y `data:`), rango de `target_grade` y de `estimated_min_per_page`.

### Seguridad

**10. Sin hallazgos de exposición de secretos.** El único patrón detectado era el nombre de la variable de servicio dentro de un comentario de `.env.example`.
→ Reescrito ese bloque para que ni siquiera aparezca el nombre de la variable, y se explique que va como secreto de Supabase.

**11. RLS: 44 tablas, 44 con RLS activo y forzado, 175 políticas.** Ninguna tabla quedó sin proteger. El rol `anon` no tiene permisos sobre datos.

**12. Acceso indirecto: no encontré ninguna vía.** Todas las relaciones entre tablas de usuario usan clave foránea **compuesta `(id, user_id)`**, así que una fila no puede apuntar a datos de otro usuario aunque una política tuviera un error. Un trigger impide además cambiar el dueño de una fila.
→ Agregué `public.auditar_seguridad()`, que comprueba los seis controles en una sola consulta para que lo verifiques tú en la instalación real.

### Cálculos — todos verificados con aserciones

| Cálculo | Comprobación | Resultado |
|---|---|---|
| Formato CLP | `$678.838`, `$1.234.567`, `$0`, sin decimales | Correcto |
| IVA sobre monto con IVA | $678.838 → neto $570.452 + IVA $108.386 | Correcto |
| IVA sobre neto | $100.000 → IVA $19.000, total $119.000 | Correcto |
| Horas con colación | 09:00–18:30 menos 60 min = 8 h 30 | Correcto |
| Turno nocturno | 22:00–06:00 = 480 min | Correcto |
| Promedio ponderado | Contrastado contra cálculo manual independiente | Coincide |
| Nota necesaria | Contrastada contra fórmula independiente | Coincide |
| Nota fuera de escala | Detecta que 9,0 es inalcanzable en escala 1–7 | Correcto |
| Zona horaria | Enero UTC−3, julio UTC−4 (horario de verano) | Correcto |
| Fechas relativas | hoy, mañana, pasado mañana, en 3 días, en dos semanas, el próximo viernes | 10/10 |

### Separación entre espacios

Verificado con datos reales: 13 tareas de trabajo, 8 de universidad, 5 personales. El filtro por espacio aísla correctamente y **no hay ninguna tarea que mezcle marca con asignatura**. Los apuntes jurídicos existen solo en el espacio académico.

### Apuntes originales

Prueba directa: derivé contenido de un apunte y comprobé que `texto_original` quedó **byte por byte igual**, y que el resumen y los conceptos se guardaron en campos separados. En la base, la columna lleva un comentario que lo declara explícitamente.

### Información jurídica

- Las cinco fuentes de ejemplo: **ninguna marcada como verificada**, todas con `es_demo = true` y vigencia «por verificar».
- El fallo de muestra se llama «**[EJEMPLO] Sentencia pendiente de identificar**» y sus campos de rol y tribunal dicen «(por completar)».
- Ningún rol judicial inventado en todo el repositorio.
- Para marcar una fuente como verificada, la app exige el enlace oficial y pide confirmación explícita; la base lo refuerza con una restricción.
- **Nuevo en esta auditoría**: las asignaturas académicas ahora llevan `is_demo` y la interfaz las muestra con el sello «Asignatura de ejemplo». Los profesores son ficticios y así queda dicho en el seed.

### Accesibilidad

| Control | Estado |
|---|---|
| Idioma declarado (`lang="es"`) | Sí |
| Enlace para saltar al contenido | Sí |
| Botones de solo icono con `aria-label` | 8/8 |
| `role="tablist"` y `aria-selected` en pestañas | Sí |
| Anillo de foco visible | Sí, con `:focus-visible` |
| `prefers-reduced-motion` | Respetado |
| Tipografía mínima 16 px en móvil | Sí, evita el zoom de iOS |
| Objetivos táctiles ≥ 40 px | Sí |
| Errores anunciados (`role="alert"`) | Sí |

### Responsive

Barra lateral solo desde `md`, barra inferior solo bajo `md`, áreas seguras del notch respetadas, más de 20 grillas adaptativas, `viewport-fit=cover`. Verificado por análisis de clases, no visualmente: **no pude tomar capturas de pantalla**.

### Rendimiento

- `nexo.html` pesa 544 KB. Es grande para un archivo único, pero carga de una sola vez y sin dependencias de build.
- Cada interacción redibuja la vista completa. Con el volumen de datos actual (decenas a cientos de registros) es imperceptible; con miles habría que pasar a renderizado incremental.
- **Advertencia honesta**: el prototipo usa Tailwind por CDN, que compila el CSS en el navegador. Sirve para uso personal, pero **no es adecuado para producción**. El proyecto `app/` usa Tailwind compilado, que es el camino correcto para publicar.

---

## Lo que sigue sin poder verificarse

No voy a decir que estas funciones andan, porque no lo puedo comprobar con lo entregado:

1. **Que `npm run build` termine sin errores.** El código está corregido según análisis estático, pero solo `tsc` lo confirma. Córrelo tú: `cd app && npm install && npm run check`.
2. **Que las migraciones corran sin error en PostgreSQL.** Validé estructura, claves foráneas, enums y políticas con un analizador, pero no ejecuté el SQL contra una base real. La prueba es pegarlas en el SQL Editor.
3. **Que la Edge Function `nexo-ai` responda.** Está escrita y valida su salida, pero nunca se ejecutó contra el modelo.
4. **El aspecto visual en dispositivos reales.** Sin capturas de pantalla, la revisión de superposiciones es estructural.
5. **La entrega de correos de Supabase.** Depende del SMTP de tu proyecto.

---

## Riesgo conocido que conviene decidir

El motor del asistente **está escrito dos veces**: en JavaScript dentro de `nexo.html` y en TypeScript en `app/src/services/assistant/`. Hoy son equivalentes, pero van a divergir con el tiempo. Cuando migres definitivamente a `app/`, borra la copia del prototipo.

Lo mismo aplica al motor académico (`Academico` en el prototipo, `academicService` en el proyecto).
