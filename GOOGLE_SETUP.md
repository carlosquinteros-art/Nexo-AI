# Conectar Nexo con tus cuentas de Google

Guía completa, de principio a fin. Toma unos 40 minutos la primera vez.

Al terminar podrás conectar tu cuenta de trabajo y la de la universidad al mismo tiempo, y ver en Nexo los correos que necesitan acción, la agenda de las dos y los documentos recientes.

**Antes de empezar, dos cosas importantes:**

- Nexo solo **lee**. No envía correos, no responde, no borra mensajes, no crea ni modifica eventos y no toca tus archivos.
- Tu contraseña de Google nunca pasa por Nexo. La escribes en la pantalla de Google y nada más.

---

## 1. Crear el proyecto en Google Cloud

1. Entra a [console.cloud.google.com](https://console.cloud.google.com).
2. Arriba, en el selector de proyectos → **Proyecto nuevo**.
3. Nombre: `Nexo`. Sin organización si te la pide y puedes elegir.
4. **Crear**, y asegúrate de que el selector quede en `Nexo`.

> Usa tu cuenta personal de Google para crear el proyecto, no la del trabajo. Si el proyecto vive dentro del Workspace de la empresa, el administrador puede borrarlo o bloquearlo.

---

## 2. Habilitar las tres APIs

**APIs y servicios → Biblioteca**. Busca y habilita, una por una:

| API | Para qué |
|---|---|
| **Gmail API** | Leer remitente, asunto, fecha y etiquetas |
| **Google Calendar API** | Leer tus eventos |
| **Google Drive API** | Leer nombre, tipo y fecha de tus archivos |

Cada una: buscar → clic en el resultado → **Habilitar**. Espera a que diga «API habilitada».

> Si más adelante ves el error *«has not been used in project»*, es que alguna quedó sin habilitar.

---

## 3. Pantalla de consentimiento

**APIs y servicios → Pantalla de consentimiento de OAuth** (en la consola nueva puede aparecer como *Google Auth Platform*).

### 3.1 Tipo de usuario

Elige **Externo**.

> **Por qué externo y no interno.** «Interno» solo permite cuentas del mismo dominio de Workspace. Como quieres conectar la del trabajo *y* la de la universidad, que son dominios distintos, necesitas «Externo». Mientras la app esté en modo prueba, solo funcionarán los correos que agregues como usuarios de prueba: nadie más puede usarla.

### 3.2 Información de la aplicación

| Campo | Qué poner |
|---|---|
| Nombre de la aplicación | `Nexo` |
| Correo de asistencia | tu correo |
| Logotipo | opcional, sáltalo |
| Dominios autorizados | `pages.dev` y `supabase.co` |
| Correo del desarrollador | tu correo |

### 3.3 Permisos

**Agregar o quitar permisos** y marca exactamente estos. Ni uno más:

```
openid
.../auth/userinfo.email
.../auth/userinfo.profile
.../auth/gmail.metadata
.../auth/calendar.events.readonly
.../auth/drive.metadata.readonly
```

Y **solo si** quieres leer el contenido de los correos dentro de Nexo (opcional, se activa por cuenta):

```
.../auth/gmail.readonly
.../auth/drive.file
```

Qué significa cada uno, en palabras simples:

| Permiso | Qué deja ver | Qué **no** deja hacer |
|---|---|---|
| `gmail.metadata` | Remitente, asunto, fecha, etiquetas, leído o no | No deja ver el cuerpo del correo. No deja enviar ni borrar. |
| `gmail.readonly` | Además, el contenido del correo | Sigue sin poder enviar, responder ni borrar |
| `calendar.events.readonly` | Tus eventos | No crea, no edita, no borra |
| `drive.metadata.readonly` | Nombre, tipo, dueño y fecha de los archivos | No abre archivos ni ve su contenido |
| `drive.file` | Los archivos que tú elijas uno por uno | No da acceso al resto de tu Drive |

> **Sobre la verificación de Google.** `gmail.readonly`, `gmail.metadata` y `drive.file` son *permisos restringidos*. Mientras la app esté en modo prueba con tus propias cuentas, funcionan sin verificación. Si algún día la publicaras para otras personas, Google exigiría una revisión de seguridad que puede tardar semanas y cuesta dinero. Para uso personal no hace falta: deja la app en modo prueba.

### 3.4 Usuarios de prueba

**Usuarios de prueba → Agregar usuarios**. Pon las direcciones exactas de las cuentas que vas a conectar:

```
tu-correo@touch-jobs.com
tu-correo@universidad.cl
tu-correo-personal@gmail.com
```

Sin esto, Google rechazará la conexión con un mensaje de «acceso no verificado». Puedes agregar hasta 100.

---

## 4. Crear las credenciales

**APIs y servicios → Credenciales → Crear credenciales → ID de cliente de OAuth**.

| Campo | Valor |
|---|---|
| Tipo de aplicación | **Aplicación web** |
| Nombre | `Nexo web` |

### Orígenes autorizados de JavaScript

```
https://nexo-asistente.pages.dev
http://localhost:5173
```

### URI de redireccionamiento autorizados

Aquí va **la dirección de tu Edge Function**, no la de Nexo. Reemplaza `TU-PROJECT-REF` por el identificador de tu proyecto de Supabase (lo ves en la URL del panel, o en *Settings → General → Reference ID*):

```
https://TU-PROJECT-REF.supabase.co/functions/v1/google-oauth-callback
```

> Tiene que coincidir **carácter por carácter**. Sin barra al final, con `https`, y `functions/v1` en el medio. El 90 % de los errores `redirect_uri_mismatch` son una barra de más.

**Crear**. Google te muestra el **ID de cliente** y el **secreto de cliente**. Cópialos a un lugar seguro; el secreto se puede volver a ver después, pero no lo guardes en un archivo del repositorio.

---

## 5. Preparar la base de datos

En Supabase → **SQL Editor**, ejecuta en este orden si aún no lo has hecho:

| Orden | Archivo |
|---|---|
| 1 | `db/01-schema.sql` |
| 2 | `db/03-universidad.sql` |
| 3 | `db/04-auditoria.sql` |
| 4 | `db/05-sync.sql` |
| 5 | **`db/06-google-integrations.sql`** |

Después, con tu sesión iniciada:

```sql
select public.instalar_reglas_urgencia();
select * from public.auditar_google();
```

Las cinco filas deben decir `OK`.

### Comprobación de seguridad importante

**Settings → API → Exposed schemas** debe decir únicamente:

```
public, graphql_public
```

Si aparece `private`, **quítalo**. Ese esquema es donde viven los tokens de Google y no debe ser accesible desde ninguna URL.

---

## 6. Instalar la CLI de Supabase

```bash
npm install -g supabase
supabase login
cd "ruta/a/Nexo"
supabase link --project-ref TU-PROJECT-REF
```

---

## 7. Guardar los secretos

Aquí van las credenciales. **Nunca las escribas en un archivo del repositorio**: los secretos de Supabase viven en el servidor y no llegan al navegador.

Primero genera la llave de cifrado de los tokens:

```bash
openssl rand -base64 32
```

Copia el resultado y ejecuta, reemplazando cada valor:

```bash
supabase secrets set GOOGLE_CLIENT_ID="...apps.googleusercontent.com"
supabase secrets set GOOGLE_CLIENT_SECRET="GOCSPX-..."
supabase secrets set GOOGLE_REDIRECT_URI="https://TU-PROJECT-REF.supabase.co/functions/v1/google-oauth-callback"
supabase secrets set GOOGLE_TOKEN_ENCRYPTION_KEY="la-llave-que-generaste"
supabase secrets set ORIGENES_PERMITIDOS="https://nexo-asistente.pages.dev,http://localhost:5173"
```

Comprueba que quedaron (verás los nombres, nunca los valores):

```bash
supabase secrets list
```

> **Guarda la llave de cifrado en tu gestor de contraseñas.** Si la pierdes o la cambias, los tokens guardados quedan ilegibles y hay que volver a conectar cada cuenta. Nexo lo detecta y te lo dice, pero es una molestia evitable.

---

## 8. Desplegar las Edge Functions

Ocho funciones. La del callback va con `--no-verify-jwt` porque a esa dirección llega el navegador siguiendo un redirect de Google, sin cabecera de sesión; su seguridad viene del `state` firmado, no del JWT.

```bash
supabase functions deploy google-oauth-start
supabase functions deploy google-oauth-callback --no-verify-jwt
supabase functions deploy google-refresh-token
supabase functions deploy google-sync
supabase functions deploy google-calendar-sync
supabase functions deploy google-drive-sync
supabase functions deploy google-disconnect
supabase functions deploy google-email-detail
```

O todas de una vez y luego arreglando el callback:

```bash
supabase functions deploy
supabase functions deploy google-oauth-callback --no-verify-jwt
```

Verifica que estén arriba:

```bash
supabase functions list
```

---

## 9. Conectar tus cuentas

1. Abre `https://nexo-asistente.pages.dev` e inicia sesión en Nexo.
2. **Configuración → Cuentas conectadas → Conectar cuenta Google**.
3. Elige el tipo (Trabajo, Universidad o Personal) y qué quieres que lea.
4. Se abre una ventana de Google. Elige la cuenta y acepta.
5. La ventana se cierra sola y la cuenta aparece en la lista.
6. Repite para la segunda cuenta.

Si el navegador bloquea la ventana emergente, permítela para el sitio y vuelve a intentar.

---

## 10. Si tu Google Workspace bloquea la aplicación

Es lo más probable con la cuenta del trabajo. Verás un mensaje que menciona **`admin_policy_enforced`** o «tu administrador no permite el acceso a esta aplicación».

**No es un error de Nexo ni de tu contraseña.** Es una política de la organización.

### Qué pedirle al administrador

Envíale algo así:

> Hola, necesito autorizar una aplicación propia para organizar mi trabajo. Es de **solo lectura**: no envía correos, no borra nada y no modifica archivos ni eventos.
>
> En la Consola de Administración de Google: **Seguridad → Control de datos y acceso → Controles de API → Administrar el acceso de apps de terceros → Configurar app nueva → ID de cliente de OAuth**.
>
> ID de cliente: `<tu ID de cliente>`
>
> Marcarla como **De confianza** para mi unidad organizativa.
>
> Permisos que solicita:
> - `openid`, `userinfo.email`, `userinfo.profile` — identificar la cuenta
> - `gmail.metadata` — remitente, asunto y fecha, **sin acceso al contenido**
> - `calendar.events.readonly` — leer eventos
> - `drive.metadata.readonly` — nombre y fecha de archivos, **sin abrirlos**

### Mientras tanto

Conecta la cuenta de la universidad y la personal, que suelen permitirlo. Nexo funciona igual con las cuentas que sí pudiste conectar.

---

## 11. Cuando algo falla

| Lo que ves | Qué pasa | Cómo se arregla |
|---|---|---|
| `redirect_uri_mismatch` | La URI de redirección no coincide exactamente | Compárala carácter por carácter con la del paso 4. Ojo con la barra final. |
| `admin_policy_enforced` | Tu Workspace bloquea apps externas | Paso 10 |
| `access_denied` | Cancelaste, o tu correo no está en usuarios de prueba | Agrégalo en el paso 3.4 |
| «Esta app no está verificada» | Normal en modo prueba | **Configuración avanzada → Ir a Nexo (no seguro)**. Es tu propia app. |
| `has not been used in project` | Falta habilitar una API | Paso 2 |
| «Reconexión requerida» en Nexo | Google canceló el permiso | Configuración → la cuenta → **Volver a conectar** |
| `falta_configuracion` | Faltan secretos en Supabase | Paso 7, y vuelve a desplegar |
| `falta_llave` | Falta `GOOGLE_TOKEN_ENCRYPTION_KEY` | Paso 7 |
| «No se pudo leer el permiso guardado» | Cambió la llave de cifrado | Vuelve a conectar la cuenta |
| La ventana no se abre | El navegador bloqueó el emergente | Permítelo para el sitio |

Para ver qué pasó por dentro:

```bash
supabase functions logs google-sync --limit 50
```

Los registros no contienen tokens ni contenido de correos, por diseño.

---

## 12. Cómo se protegen tus datos

Vale la pena que sepas exactamente qué se guarda y dónde.

**Los tokens de Google**

- Viven en el esquema `private` de PostgreSQL, que **no está publicado en la API**. No existe ninguna URL capaz de leerlos: ni con tu sesión, ni con la clave pública, ni armando una consulta a mano.
- Están cifrados con AES-GCM de 256 bits. La llave vive solo en los secretos de Supabase.
- Solo las Edge Functions, que corren en el servidor, pueden descifrarlos.
- **Nunca llegan al navegador.** Puedes comprobarlo: abre las herramientas de desarrollo, mira `localStorage` y la pestaña de red. No hay ningún token de Google.

**El secreto de cliente**

Solo lo lee un archivo, `supabase/functions/_shared/google.ts`, en el servidor. No está en el repositorio ni en `nexo.html`.

**Lo que se guarda de tus correos**

Remitente, destinatarios, asunto, fecha, etiquetas, si está leído y un fragmento de 300 caracteres —el mismo que Gmail ya muestra en la lista—. **El cuerpo no se guarda.** Si activaste la lectura completa y abres un correo en Nexo, el contenido se pide en ese momento y no se archiva.

**Lo que se guarda de Drive**

Solo metadatos: nombre, tipo, dueño, fecha y el enlace al original. Ningún archivo se descarga.

**Aislamiento**

Cada tabla tiene Row Level Security con la regla `auth.uid() = user_id`. Dos cuentas de Nexo no pueden verse entre sí, aunque compartan el mismo servidor.

**Revocar**

Configuración → la cuenta → **Desconectar**. Nexo revoca el permiso en Google y borra los tokens de verdad. También puedes hacerlo desde tu cuenta de Google, en [Seguridad → Tus conexiones con aplicaciones de terceros](https://myaccount.google.com/connections).

---

## 13. Comprobar que quedó bien

```bash
supabase functions list          # las 8 funciones desplegadas
supabase secrets list            # los 5 secretos configurados
```

```sql
select * from public.auditar_google();
```

Y en la aplicación:

1. Conecta dos cuentas distintas → aparecen separadas, con su color.
2. **Sincronizar ahora** → llegan correos y eventos.
3. Un correo urgente muestra **por qué** lo es, citando su texto.
4. Una tarea sugerida **no se crea sola**: hay que confirmarla.
5. Desconecta una cuenta → deja de sincronizar y desaparece de la lista.
6. Herramientas de desarrollo → `localStorage` y consola: **ningún token**.

---

## 14. Lo que todavía no está

Con honestidad:

| | Estado |
|---|---|
| Enviar o responder correos | No implementado. Requiere permisos de escritura que esta etapa no pide. |
| Crear o mover eventos | No implementado. |
| Editar archivos de Drive | No implementado. |
| Sincronización automática en segundo plano | Nexo sincroniza al abrir, al volver el foco y con el botón. Para que corra sola con la app cerrada hay que programar un cron en Supabase que llame a `google-sync`. |
| Notificaciones push | No implementadas. |
| Gmail push (webhooks) | No implementado. La sincronización usa `historyId`, que es eficiente pero no instantánea. |

**Nada de esto se probó contra un Google real desde este entorno.** El código está escrito y verificado estáticamente, pero la primera conexión de verdad la haces tú siguiendo esta guía. Si algo no calza, la tabla del paso 11 cubre los tropiezos habituales.
