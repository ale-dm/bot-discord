# Integración Plex / Tautulli con el Duende

**Implementado, con la lista completa cargada y probado en vivo** (2026-09-23)
contra el Tautulli real (`https://tautulli.xelements.es`) — 12 personas
vinculadas (11 de la lista + la cuenta de prueba), con sus apodos
reconocidos por el Duende. Cualquier vínculo nuevo o cambio se gestiona
desde el panel admin (🎬 Plex).

**Seerr (Jellyseerr) también implementado** (2026-09-23), contra el
servidor real (`https://requests.xelements.es`) — ver sección 4.

## 1) Resumen

Meter la actividad de Plex (vía Tautulli) como otra fuente de datos que el
Duende puede consultar con function calling, igual que ya hace con
nivel/racha/saldo/logros. Objetivo: preguntas en lenguaje natural tipo
*"¿qué ha visto Raúl esta semana?"* o *"¿cuánto lleva visto Javier de The
Boys?"* y que el Duende conteste con datos reales, resumidos con su propia
personalidad.

Es amigos entre sí y sin problema de privacidad, así que **no hay
restricciones de visibilidad**: cualquiera puede preguntar por la actividad
de cualquiera de los usuarios vinculados. Solo se vincula un subconjunto de
los usuarios que existen en Tautulli (la lista la da el admin), no todos
automáticamente.

## 2) Arquitectura

```
Discord (Duende) ──function calling──▶ tautulliClient.js ──HTTP──▶ Tautulli API ──▶ Plex
                                              │
                                              ▼
                                       plex_links (SQLite)
                                  Discord userId ↔ usuario Tautulli
```

### 2.1 Cliente Tautulli — `src/services/tautulliClient.js`

Tautulli expone una API REST simple: `GET {TAUTULLI_URL}/api/v2?apikey={KEY}&cmd={comando}&...params`.
Respuesta siempre `{ response: { result, message, data } }`.

Config nueva en `.env` (mismo patrón que `ODDS_API_KEY`/`GIPHY_API_KEY`):

```
TAUTULLI_URL=http://host:puerto
TAUTULLI_API_KEY=...
```

Y, para que sea **personalizable por servidor** (varios Discord podrían
apuntar a distintos Tautulli en el futuro), override opcional vía
`guildSettings` igual que `duende.model`: `plex.tautulli_url`,
`plex.tautulli_api_key`. Si no hay override, usa el `.env`.

Funciones que expone el cliente (envoltorio fino sobre la API, una función
por `cmd`):

- `getUsers()` → `cmd=get_users` — lista de usuarios Tautulli conoce
  (`user_id`, `username`, `friendly_name`, `email`, `is_active`).
- `getHistory({ userId, afterDate, limit })` → `cmd=get_history` — filas de
  reproducción (`title`, `full_title`, `grandparent_title` para episodios,
  `media_type`, `started` unix ts, `date`, `percent_complete`, `duration`).
- `getUserWatchTimeStats(userId, queryDays)` → `cmd=get_user_watch_time_stats`
  — tiempo total visto agregado (`queryDays`: 0/7/30/90/365).
- `getActivity()` → `cmd=get_activity` — qué se está reproduciendo *ahora
  mismo* en el server (stream en directo, usuario, progreso).
- `getRecentlyAdded(count)` → `cmd=get_recently_added` — últimas
  pelis/episodios añadidos a la librería.
- `getLibraries()` → `cmd=get_libraries` — nº de items por librería
  (pelis, series, música...).

Todas devuelven JSON ya limpio (solo `data`), con manejo de error uniforme
(timeout, `result !== "success"` → excepción controlada).

### 2.2 Vinculación Discord ↔ Plex

Tabla nueva:

```sql
CREATE TABLE plex_links (
    guildId TEXT NOT NULL,
    discordUserId TEXT NOT NULL,
    tautulliUserId TEXT NOT NULL,
    plexUsername TEXT,
    linkedAt INTEGER NOT NULL,
    PRIMARY KEY (guildId, discordUserId)
);
```

**Gestión desde el panel admin** (no autoservicio, porque la lista la
controla el admin y es un grupo cerrado y pequeño): nueva sección
"🎬 Plex" en `/paneladmin`, con:

- Ver vínculos actuales (Discord user → usuario Tautulli).
- Añadir/editar vínculo (selector de usuario de Discord + selector de
  usuario de Tautulli, sacado de `getUsers()` — igual que el buscador de
  roles que ya existe en Niveles).
- Quitar vínculo.

Cuando me pases la lista inicial, la cargo directamente en la tabla; el
panel es para mantenerla después sin tener que pedírmelo cada vez.

### 2.3 Resolución de nombres en las herramientas

Igual que las herramientas ya existentes nunca dejan que el modelo invente
un `userId`, aquí el modelo solo puede referirse a personas por **nombre**
(ej. "Raúl"), y el ejecutor resuelve ese nombre a un Discord userId
reutilizando el mismo mapa que ya usa `duende.js` para menciones
(`nombresUsuarios` + notas de `/duende recuerda`), y de ahí busca el vínculo
en `plex_links`. Si el nombre no resuelve a nadie vinculado, la herramienta
devuelve `{ error: "No encuentro a esa persona vinculada a Plex" }` y el
Duende lo dice tal cual en vez de inventarse datos — el mismo patrón que ya
evitó el bug de datos falsos que vimos con el modelo `flash-lite`.

## 3) Catálogo de herramientas para el Duende

Diseñadas para que sea fácil añadir más sin tocar el resto (mismo patrón
`DUENDE_TOOL_DECLARATIONS` / `DUENDE_TOOL_EXECUTORS` que ya existe):

| Herramienta | Qué hace | Parámetros |
|---|---|---|
| `consultar_actividad_plex` | Historial de alguien en los últimos N días, agrupado (series con nº de capítulos, pelis sueltas) | `persona`, `dias` (por defecto 7) |
| `consultar_viendo_ahora` | Qué se está reproduciendo en el server ahora mismo, y quién | — |
| `consultar_tiempo_visto` | Horas totales vistas por alguien en un periodo | `persona`, `periodo` (semana/mes/año/total) |
| `consultar_ultima_conexion` | Última vez que alguien vio algo | `persona` |
| `consultar_novedades_plex` | Últimas pelis/capítulos añadidos a la librería | `cantidad` (opcional) |
| `comparar_actividad_plex` | Compara tiempo visto entre dos personas en un periodo | `persona1`, `persona2`, `periodo` |
| `consultar_top_visto_server` | Top pelis/series más vistas del server entero en un periodo (vía `get_home_stats`, con reproducciones y horas totales) | `periodo` |
| `buscar_en_plex` | Busca si una peli/serie existe en la biblioteca, con sinopsis, año y nota | `titulo` |
| `consultar_ranking_plex` | Ranking de quién más ha visto Plex en el server (todo el mundo, no solo vinculados) en un periodo | `periodo` |
| `consultar_bibliotecas_plex` | Nº de items por biblioteca (pelis, series, anime, música...) | — |
| `consultar_patron_visionado` | Qué día de la semana y a qué hora se ve más Plex en el server | `periodo` |

Todas de solo lectura — coherente con el mismo criterio que ya se aplicó a
las herramientas de nivel/saldo/logros (primero demostrar que funcionan
bien antes de plantear nada que "escriba" algo, relevante sobre todo de
cara a la fase 2 con Seerr).

### 3.1 Canal de novedades automático

Además de las herramientas (que responden cuando alguien pregunta), hay un
`node-cron` (`*/30 * * * *`, mismo mecanismo que ya usa la racha de
niveles) que revisa `get_recently_added` cada 30 min y publica solo lo
nuevo en un canal de Discord configurable desde el panel admin (🎬 Plex →
📢 Canal novedades). La primera vez que se activa fija la biblioteca
actual como línea base sin avisar de nada retroactivo — solo anuncia lo
que se añade *a partir de* activarlo.

### 3.1 Por qué "agrupado" y no JSON en crudo

`get_history` puede devolver decenas de filas (una por episodio visto). Se
le pasan al modelo ya resumidas server-side (ej. *"The Boys: 4 episodios
(S3E1-S3E4), última vez hace 2 días"* en vez de 4 líneas sueltas) para que
la respuesta final sea legible y no gaste de más en tokens.

## 4) Seerr (Jellyseerr) — implementado (2026-09-23)

Servidor real: **Jellyseerr v3.4.1**, backend Plex (`https://requests.xelements.es`).
Primera herramienta de IA de este bot con capacidad de **escritura real**
sobre un sistema externo (crea una solicitud de descarga de verdad), así
que lleva más guardarraíles que ninguna otra tool hasta ahora.

### 4.1 Cliente — `src/services/seerrClient.js`

API REST con header `X-Api-Key` (no query param, a diferencia de
Tautulli) — cliente separado, no reusa `tautulliClient`. Config en `.env`:

```
SEERR_URL=https://requests.xelements.es
SEERR_API_KEY=...
```

Con override opcional por servidor vía `guildSettings` (`seerr.url`,
`seerr.api_key`, `seerr.daily_request_limit`), mismo patrón que Plex.

### 4.2 Atribución automática de quién pide qué

Descubierto al explorar la API real: **Jellyseerr ya guarda el Discord ID
de cada usuario en su propio perfil** (`GET /api/v1/user/{id}` →
`settings.discordIds`). Cadena de resolución, sin necesidad de vincular
nada a mano en la mayoría de los casos:

1. `resolveSeerrUserByDiscordId` — busca el Discord ID de quien habla entre
   los `discordIds` que cada usuario tiene puestos en Seerr. Ya estaba
   relleno para varios de los 15 usuarios probados en real.
2. Si no está, fallback a la vinculación de Plex ya existente
   (`plex_links`): coge el `plexUsername` vinculado y busca un usuario de
   Seerr con ese mismo `plexUsername` (`resolveSeerrUserByPlexUsername`).
3. Si ninguna de las dos resuelve, la herramienta devuelve un error legible
   pidiendo que se vincule con un admin — nunca se pide en nombre de nadie
   sin poder identificarlo de verdad.

Los 15 usuarios se cachean 10 min en memoria (`getUsersDetailed`) para no
golpear la API de Seerr en cada mensaje.

### 4.3 Herramientas del Duende

| Herramienta | Qué hace | Parámetros |
|---|---|---|
| `buscar_contenido_seerr` | Busca título en TMDB vía Seerr: si existe, si ya está disponible en Plex, o si hace falta pedirlo | `titulo` |
| `solicitar_contenido_seerr` | Crea la solicitud real de descarga | `tmdbId`, `mediaType` (solo válidos si vienen de una búsqueda reciente, ver 4.4), `persona` opcional (para pedir en nombre de otra persona) |
| `consultar_solicitudes_seerr` | Lista las últimas solicitudes (título, estado, quién la pidió, fecha) | `cantidad` (por defecto 5) |

Gating por canal independiente del de Plex (`seerr_allowed_channels`,
mismo patrón: lista vacía = sin restricción), configurable desde
`/paneladmin` → 🍿 Seerr, para poder permitir consultar Plex en más
canales de los que se permite pedir contenido nuevo.

### 4.4 Guardarraíles de la herramienta de escritura

Mismo principio que ya rige `userId` en el resto del bot (nunca lo inventa
el modelo, siempre sale del contexto real de Discord) extendido a
`tmdbId`:

- **Caché de búsquedas reciente por canal** (`cacheSearchResults` /
  `getCachedSearchResult`, TTL 15 min): `solicitar_contenido_seerr` solo
  acepta un `tmdbId`+`mediaType` que hayan salido literalmente de una
  llamada reciente a `buscar_contenido_seerr` **en ese mismo canal**. Si el
  modelo se inventa un ID o usa uno de otra conversación, la herramienta lo
  rechaza sin llamar a la API real. Verificado en vivo y con test directo
  del caché (hit/miss).
- **Atajo de estado antes de pedir**: si el resultado cacheado ya está
  `disponible` o ya tiene una solicitud en curso (`pendiente`/`procesando`/
  `parcialmente disponible`), la herramienta devuelve eso directamente y
  **no llega a llamar a la API de creación** — verificado en vivo con
  Daredevil (ya disponible): la tool se ejecutó, devolvió `ya_disponible`,
  y no se generó ninguna solicitud real.
- **Límite diario por quien pide, no por a quién se atribuye**
  (`guildSettings.checkAndConsumeLimit`, scope `seerr_request`, clave
  `ctx.userId`): por defecto 5 peticiones/día, configurable en el panel
  admin. Deliberado: protege contra que una sola persona spamee peticiones
  aunque las reparta "en nombre de" varios amigos distintos — el límite es
  de quien manda el mensaje, no de a quién se le atribuye.
- **Se puede pedir para otra persona, con resolución de nombre real**:
  `solicitar_contenido_seerr` acepta un `persona` opcional (nombre o
  apodo). Si se omite, se atribuye a quien habla (`ctx.userId`); si se da,
  se resuelve con `resolveNameToDiscordId` (el mismo resolutor que ya usan
  las tools de Plex — nunca un ID inventado por el modelo, siempre un
  miembro real del server) y la petición se crea a nombre de esa persona
  en Seerr. Tiene sentido porque Seerr ya notifica a quien tiene vinculado
  el contenido pedido vía su propio Discord ID (ver 4.2) — si Alex pide
  "para Ddrakon", es Ddrakon quien recibe el aviso cuando esté listo, no
  Alex. Verificado: `resolverSeerrUsuarioPorId` resuelve correctamente dos
  identidades reales distintas (Ddrakon → usuario Seerr #4 "Ddrakon", Alex
  → usuario Seerr #1 "SrAaleeeo") sin disparar ninguna petición real.

**Actualización**: el camino de éxito real acabó probándose en vivo (sin
buscarlo a propósito, como efecto colateral de verificar el arreglo de la
codificación de búsquedas de 4.6) — solicitud real #362 creada, atribuida
correctamente a la persona nombrada y no a quien escribió el mensaje.
Confirma que la atribución funciona de extremo a extremo contra
producción. Todo lo demás (búsqueda,
listado, atajo de "ya disponible", rechazo de tmdbId no verificado, límite
diario) sí está verificado contra el servidor real.

### 4.6 Dos bugs reales encontrados probando en producción

Detectados por el usuario probando "pide X en nombre de Y" en el canal real, con el bot ya reiniciado con el código de atribución por persona:

- **Codificación de búsquedas rota para títulos con espacio**: `axios` serializa espacios como `+` por defecto; Jellyseerr valida estrictamente `%20` y rechaza `+` con `400 "Parameter 'query' must be url encoded"`. Cualquier búsqueda de más de una palabra fallaba (`buscar_contenido_seerr({"titulo":"Barbie 2"})` → error). Arreglado con un `paramsSerializer` propio en `seerrClient.js` usando `encodeURIComponent` (RFC3986, siempre `%20`).
- **Frase no reconocida**: "haz que el hustlehard pida barbie 2" no disparaba la herramienta — la descripción de `solicitar_contenido_seerr` solo cubría literalmente "pide X para/en nombre de Y". Ampliada con varias construcciones equivalentes y una frase explícita contra la duda de "no puedo actuar en nombre de otro".
- Recordatorio de arquitectura (no es bug, pero costó tiempo de depuración): el historial de conversación vive **en memoria** (`conversationHistory`, cargado una vez al arrancar `duende.js`) — limpiar `data/duende-history.json` a mano mientras el bot está corriendo no tiene efecto hasta el siguiente reinicio, porque `saveHistory()` sobreescribe el archivo con la copia en memoria en cuanto se genera una respuesta más.

### 4.7 Idea futura: `terminate_session` ligado a la tienda

Tautulli permite cortar el stream de alguien en directo
(`terminate_session`). Demasiado intrusivo para dársela al Duende sin
más, pero como **ítem de tienda** (comprado con monedas del propio bot,
`tienda`/`objeto`/`usar` ya existen) tiene gracia: algo tipo "🔌 Corte de
luz" que gasta el stream de otro vinculado durante unos segundos, con
cooldown y coste alto para que no sea spameable. Anotado para más
adelante — no implementado, y no debería estar detrás de una tool de IA
en ningún caso, solo detrás de un comando/botón explícito de compra y uso.

## 5) Estado

- ✅ `TAUTULLI_URL`/`TAUTULLI_API_KEY` configurados en `.env` y verificados
  (conexión real, `get_users`/`get_history`/`get_activity` funcionando).
- ✅ Tautulli accesible públicamente desde donde corre el bot (URL propia,
  sin problema de red).
- ✅ Las **11 herramientas** del apartado 3 implementadas en `duende.js` y
  probadas en vivo contra datos reales: actividad, viendo ahora, tiempo
  visto, última conexión, novedades, comparar dos personas, top del
  server (vía `get_home_stats`), buscar en Plex, ranking de usuarios, nº
  de items por biblioteca, y patrón de visionado (día/hora más activos).
- ✅ Panel admin (🎬 Plex en `/paneladmin`) para vincular/desvincular,
  probar la conexión, y configurar el canal de novedades automático.
- ✅ Canal de novedades automático: `node-cron` cada 30 min, publica solo
  lo añadido desde que se activó (sin backfill retroactivo).
- ✅ **12 vínculos cargados** (11 personas + la cuenta de prueba):
  asierbernabugimnez, Ddrakon, jorgealfonso939, jorgevilellaadsuar,
  laurap215, mario4424, martinbernabeu, miryam_diezz, paulaalfonso922,
  raulalfonsoferrandez, tomsibarralled, SrAaleeeo.
- ✅ Apodos cargados en `src/commands/duende/duende.js` (`APODOS_DISCORD_ID`,
  resuelto por ID directo — el más fiable, se comprueba antes que
  cualquier otra fuente), con normalización de tildes para que "Raúl" y
  "raul" resuelvan igual. Verificado en vivo: preguntar por "Raúl" y "el
  perro" en la misma frase resolvió a las dos personas correctas con datos
  reales (32,5h para Raúl, 0h para Javier/Ddrakon).
- Nuevos vínculos o apodos que hagan falta más adelante, o desde el panel
  admin (vínculos) o pidiéndomelo (apodos, hardcodeados en `duende.js`).
- ✅ **Seerr**: `SEERR_URL`/`SEERR_API_KEY` en `.env`, conexión verificada
  (`get_status`, versión 3.4.1). Las **3 herramientas** del apartado 4.3
  implementadas y probadas en vivo: búsqueda real (Daredevil, con estado
  "disponible" correcto), listado de últimas solicitudes con títulos
  reales, y el atajo "ya disponible" de `solicitar_contenido_seerr`
  disparado de verdad sin tocar la API de creación.
- ✅ Guardarraíl de `tmdbId` (nunca inventado por el modelo) verificado con
  test directo de caché hit/miss, además de en el flujo real.
- ✅ Panel admin (🍿 Seerr en `/paneladmin`): test de conexión, límite
  diario de peticiones, gestión de canales permitidos.
- ⏳ Pendiente probar en vivo el camino de éxito real de
  `solicitar_contenido_seerr` (crear una solicitud de verdad) — decisión
  deliberada de no disparar una descarga real ni notificar a otra persona
  sin avisar antes.
