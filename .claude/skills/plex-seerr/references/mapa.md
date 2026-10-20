# Mapa de Plex y Seerr

## Clientes (`src/services/`)

- `tautulliClient.js`: `call(guildId, cmd, params)` con timeout de 10 s; una función por `cmd` (`getUsers`, `getHistory`, `getHistoryPage`, `getMetadata`, `getChildrenMetadata`, `getLibraryMediaInfo` con 60 s, `getStreamData`, `getActivity`, `getRecentlyAdded`…). Canales permitidos con `canalesPermitidos("plex")`. `checkAllGuildsForNewContent` publica las novedades.
- `seerrClient.js`: `paramsSerializer` propio con `encodeURIComponent` (Jellyseerr rechaza `+` en lugar de `%20`). Usuarios cacheados 10 min (`getUsersDetailed`). Caché de búsquedas por canal (`cacheSearchResults`, TTL 15 min). `getConfig(guildId).dailyRequestLimit`.
- `tmdbClient.js`: opcional (`TMDB_API_KEY`), para los trofeos por país.

## Sistemas (`src/systems/`)

| Módulo | Qué hace |
|---|---|
| `plexLinks.js` | Tabla `plex_links` (`guildId`, `discordUserId`, `tautulliUserId`, `plexUsername`). `setLink` con otra cuenta borra su importación. |
| `plexHistorial.js` | Copia `get_history` a `plex_reproducciones` (la primera vez entero; luego desde dos días antes de lo último) y `actualizarLogros`. `sincronizarTodos` es la entrada del cron. |
| `plexFichas.js` (+ `plexFichas/`) | Fichas en `plex_fichas` con presupuesto de llamadas (300, 1.200 con el botón 📼 Sincronizar) y 4 en paralelo. |
| `plexIdiomas.js` | Audio y subtítulos con `get_stream_data` (1.500 por vez, 5.000 con el botón). |
| `plexTrofeos.js` (+ `plexTrofeos/`) | Trofeos (`plex_trofeos`, id `plext:<tipo>:…`), sociales, fechas `desde:`/`hasta:`, nombres con Gemini en lotes de 40. |
| `plexImportacion.js` | Primera importación por vinculado; lo desbloqueado entonces se paga al `plex.importacion_pct`. |
| `plexGordos.js`, `plexRankings.js`, `plexRankingSemanal.js`, `plexResumen.js`, `plexWrapped.js`, `plexCampeones.js`, `plexAvisos.js`, `plexDiagnostico.js`, `plexExtras.js` | Roles de Gordos, rankings, ranking semanal (lunes desde las 10:00, Madrid), perfil 🍿 Plex, wrapped, avisos de series y «quiero ver», diagnóstico (`scripts/plex-check.js`). |
| `pedidosSeerr.js` | «Ya está en Plex»: avisa a quien lo pidió (canal de novedades o DM) y los rechazos. Estados de Seerr: 4 parcial, 5 disponible. |
| `seerrCupo.js` | `comprobar` (sin gastar) y gastar tras éxito; el día va por UTC. |

## Herramientas del Duende (`src/services/duende/herramientas/`)

- `plex.js` (y `plexTrofeos.js`): las de consulta de la tabla del apartado 3 del documento. Base común en `base.js` (`resolverPersonaVinculada`, `summarizeWatchHistory`, `periodoADias`).
- `seerr.js`: `buscar_contenido_seerr`, `solicitar_contenido_seerr` (con `persona` opcional), `consultar_solicitudes_seerr`. Los ejecutores reciben dependencias inyectables (`d = REALES_SEERR`) para los tests.
- `gemini.js` registra un aviso si el texto dice «ya lo he pedido» y `solicitar_contenido_seerr` no se llamó en el turno.

## Tareas programadas (`src/app/tareas.js`)

Cada 30 min, en orden y con `noOverlap`: novedades de Plex → avisos de pedidos de Seerr → rechazados → series seguidas → quiero ver → historial y logros de Plex. Ranking semanal `0 * * * 1` y al arrancar; Plex Wrapped cada hora.

## Panel admin

`src/adminPanel/plex/` (`botones`, `modales`, `selects`, `vistas`; fachada `plex.js`, prefijo `paneladmin_plex_`) y `src/adminPanel/seerr.js` (`paneladmin_seerr_`): vínculos, canal de novedades, canales permitidos, bibliotecas de anime, roles de Gordos, límite diario, prueba de conexión.

## Migraciones relacionadas

011 (pedidos de Seerr), 013 (reproducciones), 015 (fichas), 016 (idiomas), 017 (ranking semanal), 018 (importación y altas). Comprueba siempre el número más alto real antes de añadir otra.
