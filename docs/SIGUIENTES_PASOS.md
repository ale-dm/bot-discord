# Siguientes pasos

Para quien coja el proyecto ahora: dónde está, qué hacer primero y por dónde seguir. Actualizado el 2026-10-06 al
terminar todo lo pendiente de la gamificación de Plex. Si algo de aquí ya está hecho, borrarlo (y apuntarlo en el
[CHANGELOG](CHANGELOG.md)).

Para entender el proyecto en general: [README](../README.md) (puesta en marcha y convenciones),
[FUNCIONALIDADES](FUNCIONALIDADES.md) (qué hace el bot) y [DEPLOY](DEPLOY.md) (cómo se despliega).

## 1. Dónde estamos

- **La gamificación de Plex está completa** (logros y trofeos de películas, series, series de anime y películas de
  anime), salvo los trofeos por país (F-PX-02d), que necesitan una fuente de datos que no es Tautulli.
- En `main` (`b93f101`): fases 1, 2 y 3, idiomas y dificultad, y el ranking semanal (migraciones 013–017).
- En la rama **`feature/elduendejavier`**, encima de eso (2026-10-06, migración **018**): la primera importación da
  menos monedas (F-PX-08), `npm run plex:check` (F-PX-06), 🔍 Idiomas en el panel (F-PX-07), filtro en 🏅 Logros y los
  de Plex escondidos a quien no lo tiene (F-PX-02e), 🍿 Plex en `/perfil` (F-PX-09), ranking de Plex (F-PX-10), el
  Duende conoce los trofeos (F-PX-02f), trofeos con fecha (F-PX-11), trofeos sociales (F-PX-12), roles por Gordos del
  Plex (F-PX-13) y nombres de Gemini para los de idioma (F-PX-14). Detalle en el [CHANGELOG](CHANGELOG.md).
- **586 tests en verde** (`npm run check`: lint, formato y tests), incluido `npm run plex:check` ejecutado de verdad
  contra un Tautulli de mentira por HTTP. Pero nada se ha probado contra el Tautulli ni el Discord de verdad.
- Portainer construye desde `main` ([DEPLOY](DEPLOY.md)). Si 015–017 no están desplegadas todavía, conviene desplegarlas
  **a la vez que 018** (ver el paso 3).
- No hay errores abiertos ([ERRORES](planificacion/ERRORES.md)) ni deuda técnica
  ([DEUDA_TECNICA](planificacion/DEUDA_TECNICA.md)).

## 2. Lo primero, en este orden

1. **Revisar y llevar a `main`** la rama `feature/elduendejavier`. Antes, `npm ci && npm run check` en local.
2. **`npm run plex:check`** contra el Tautulli de verdad (en local con `TAUTULLI_URL` y `TAUTULLI_API_KEY` en el `.env`,
   o con `--bd` apuntando a una copia de `banco.db`; en el servidor, `docker exec -it duende-bot npm run plex:check`).
   Comprueba en un par de minutos la tabla del apartado 3; si algo sale ⚠ o ✗, la línea dice dónde tocar.
3. **La economía de la primera importación**: lo que se desbloquea con lo antiguo da el **50 %** de las monedas (solo
   desde que existe la migración 018: lo ya desbloqueado antes da todo). Si se quiere otro %, cambiarlo **antes de que
   la gente reclame** en Panel admin → Plex → 🏆 Trofeos → 🪙 % de la importación (cuenta al reclamar).
4. **Copia de seguridad** de `/compose/duende-bot/data/banco.db` (o `npm run db:backup` dentro del contenedor).
5. **Desplegar**: Portainer → Stacks → `el-duende` → Pull and redeploy ([DEPLOY](DEPLOY.md)). En el log,
   `[Migraciones] Aplicada 018_plex_importacion_y_sociales` (y las de antes que faltaran).
6. **Vigilar la primera importación** en `logs/app-log.txt`: `Importación de Plex de …: empieza`, `Historial de …: N
   reproducciones nuevas (primera importación)`, `Fichas de Plex de …: N actualizadas, … pendientes`, `Idiomas de Plex
   de …: N reproducciones revisadas, … pendientes` y, cuando no quede nada, `Importación de Plex de …: terminada`. Cada
   30 min se avanza un poco (300 fichas, 1.500 idiomas); 📼 Sincronizar ahora va más deprisa (1.200 y 5.000).
7. **Elegir los roles de Gordos** (Panel admin → Plex → 🏆 Trofeos → 🎰 Roles de Gordos), si se quieren. El bot necesita
   "Gestionar roles" y estar por encima de ellos.
8. **Probar en Discord** con las listas de [TAREAS](planificacion/TAREAS.md): "🍿 Lo pendiente de la gamificación de
   Plex" y las de antes que sigan sin marcar.

## 3. Lo que hay que comprobar con datos reales

Lo de Plex se ha escrito con la documentación y el código de Tautulli, no con los datos de este servidor. Estos son los
supuestos; `npm run plex:check` los comprueba todos (el paso que lo mira, entre paréntesis). Si alguno falla, el arreglo
está acotado:

| Supuesto | Cómo comprobarlo | Si falla, dónde tocar |
|---|---|---|
| `get_stream_data` da el idioma del audio en `stream_audio_language_code` / `audio_language_code` (o el nombre) y los subtítulos en `subtitles` + `stream_subtitle_language` | plex:check (Idiomas) o Panel admin → 🔍 Idiomas: casi todo `en`, `es` o `ja`, pocos "no reconocidos" | `idiomaDe` y `codigoIdioma` en `src/systems/plexIdiomas.js` |
| El latino se reconoce por el nombre de la pista ("Latino", "Latinoamérica", `es-419`) | Ver algo en latino y mirar plex:check o 🔍 Idiomas | La expresión de `lat` en `codigoIdioma` |
| Las bibliotecas de anime tienen "anime" en el nombre | plex:check (Bibliotecas y anime) o la línea 🎌 Anime del panel | Botón 🎌 Bibliotecas de anime (no hace falta código) |
| Las temporadas y episodios de `get_children_metadata` cuadran con el `parent_media_index` / `media_index` del historial | plex:check (Ficha de una serie) | `fichaSerie` en `src/systems/plexFichas.js` |
| `get_children_metadata` y `get_metadata` traen `added_at` (cuándo llegó a Plex) | plex:check (Ficha de una serie: "Fecha de llegada… en N de N episodios") | `alta` en `plexFichas.js`; sin eso, "Sin spoilers" y "Primero del servidor" no salen |
| `get_library_media_info` pagina con `start`/`length` | plex:check (Paginación) | `revisarBiblioteca` en `plexFichas.js` (ya no se queda en bucle si no pagina) |
| Las horas del historial se parecen a las de Tautulli | plex:check (Horas), o 📣 Ranking semanal (vista previa) contra las estadísticas de Tautulli | `ranking` en `src/systems/plexRankingSemanal.js` |

Consultas sobre una copia de `banco.db` (con cualquier visor de SQLite):

```sql
-- 1. Idiomas detectados
SELECT audio, subs, COUNT(*) AS n FROM plex_reproducciones WHERE idioma_revisado = 1 GROUP BY audio, subs ORDER BY n DESC;
-- 2. Trofeos creados por tipo y dificultad
SELECT tipo, dificultad, COUNT(*) FROM plex_trofeos GROUP BY tipo, dificultad;
-- 3. Fichas por biblioteca (y cuántas tienen ya la fecha de llegada)
SELECT biblioteca, tipo, COUNT(*), SUM(actualizada = 0) AS pendientes, SUM(alta IS NOT NULL OR altas IS NOT NULL) AS con_fecha FROM plex_fichas GROUP BY biblioteca, tipo;
-- 4. Monedas por reclamar de logros, por persona (y cuántos son de la importación)
SELECT userId, COUNT(*) AS logros, SUM(importado) AS de_la_importacion FROM achievements_progress WHERE completedAt IS NOT NULL AND claimedAt IS NULL GROUP BY userId ORDER BY logros DESC;
-- 5. Quién está todavía en su primera importación
SELECT userId, datetime(inicio / 1000, 'unixepoch') AS desde, fin FROM plex_importacion;
```

## 4. Después: por dónde seguir

De la gamificación de Plex solo queda **F-PX-02d (trofeos por país)**: Tautulli no da el país, así que haría falta
leerlo de Plex directamente (un token de Plex) o de TMDB a partir del `guid` (una clave de TMDB). Esfuerzo M.

En Plex, pero no son gamificación: recomendaciones personales con "Pedir en Seerr" (F-PX-03), Plex Wrapped mensual
(F-PX-04) y sesión de cine (F-PX-05). Fuera de Plex, las de "Por dónde empezar" de
[FEATURES](planificacion/FEATURES.md#por-dónde-empezar): resumen semanal para admins (F-AD-02),
clasificación semanal con premios (F-EC-03) y liga de pronósticos (F-AP-12). El ranking de apostadores (F-AP-03) ya está.

## 5. Decisiones pendientes (hablarlas con Javier)

- **El % de la primera importación**: 50 % por defecto (paso 3 del apartado 2).
- **Qué roles dar por Gordos del Plex** (1, 5 y 10), si se quieren.
- **Hora del ranking semanal**: las 10:00 de los lunes (`HORA` en `plexRankingSemanal.js`).
- **Quien oculta sus logros de Plex sale igual en el ranking semanal y en los rankings de horas** (no son logros y sus
  horas ya se pueden preguntar al Duende); en los de logros, no. Si no debe salir: filtrar con `plexTrofeos.oculto` en
  `plexRankingSemanal.ranking()` y en `segundos()` de `plexRankings.js`.
- **El latino no cuenta como castellano.** Si se quiere contar, en `MODOS` de `plexIdiomas.js` (`cumple`) aceptar `lat`.
- **Las recompensas** de los logros de idioma, sociales y de los trofeos (tablas en
  [FUNCIONALIDADES](FUNCIONALIDADES.md#5-logros)) se pusieron a ojo.

## 6. Mapa del código de Plex

El detalle técnico (flujo de cada sincronización y por qué se hizo así) está en
[tecnico/PLEX_Y_SEERR.md](tecnico/PLEX_Y_SEERR.md#6-logros-y-trofeos-de-plex-2026-10-02--2026-10-06).

| Fichero | Qué hace |
|---|---|
| `src/services/tautulliClient.js` | Cliente de la API de Tautulli (una función por `cmd`) |
| `src/systems/plexHistorial.js` | Copia del historial, estadísticas de la fase 1 y la sincronización entera (`sincronizarYCalcular`, cron) |
| `src/systems/plexFichas.js` | Fichas de películas y series (biblioteca, temporadas, géneros, cuándo llegó cada cosa...) y qué es anime |
| `src/systems/plexIdiomas.js` | Idioma de cada reproducción, versiones (`MODOS`), los 51 logros de idioma (`LOGROS`) y las dificultades |
| `src/systems/plexTrofeos.js` | Trofeos automáticos, sociales y de admin (con fechas), nombres de Gemini (y `renombrar`), rareza, ocultar, `buscar` |
| `src/systems/plexImportacion.js` | Quién está en su primera importación (lo que sale da menos monedas) |
| `src/systems/plexGordos.js` | Roles por 🎰 Gordos del Plex |
| `src/systems/plexResumen.js` | Los datos de la pantalla 🍿 Plex de `/perfil` (idiomas, series a medias, casi conseguidos) |
| `src/systems/plexRankings.js` | Los rankings de Plex de 🏆 Rankings |
| `src/systems/plexDiagnostico.js` | 🔍 Idiomas del panel y las comprobaciones de `npm run plex:check` (`scripts/plex-check.js`) |
| `src/systems/plexRankingSemanal.js` | Ranking semanal de los lunes |
| `src/systems/achievementsSystem.js` | Catálogo de logros (los fijos de Plex al final de `CATALOG`), aplicar eventos, reclamar (con el % de la importación), anunciar |
| `src/services/duende/herramientas.js` | `consultar_trofeos_plex` (con las demás herramientas de Plex) |
| `src/adminPanel/plex.js` | Panel admin → Plex, 🏆 Trofeos (importación, roles de Gordos, 🔍 Idiomas) y 📣 Ranking semanal |
| `src/paneles/perfil.js` | `/perfil` → 🏅 Logros (filtro, rareza, dificultad, ocultar), 🍿 Plex y 🏆 Rankings → 🍿 Plex |
| `src/core/migrations/013`–`018` | Tablas de Plex (`plex_reproducciones`, `plex_sync`, `plex_fichas`, `plex_trofeos`, `plex_preferencias`, `plex_importacion`) y ajustes |
| `tests/plex*.test.js` | Tests de todo lo anterior (ver la cabecera de cada uno); `tests/ayudaPlex.js`, las ayudas comunes |

## 7. Recetas

- **Un logro fijo de Plex más**: una fila en la lista de Plex de `CATALOG` (`achievementsSystem.js`):
  `[id, nombre, descripción, evento, objetivo, recompensa, dificultad, oculto?]`. El evento tiene que existir
  (`plexHistorial.EVENTOS`, `plexTrofeos.EVENTOS_FICHAS`, `plexTrofeos.EVENTOS_SOCIALES` o uno de idioma). Actualizar
  el número de logros en el test de `plexHistorial.test.js` y la tabla de FUNCIONALIDADES (y su unidad en `unidad()`
  de `plexResumen.js`, para "Te falta poco").
- **Un logro de idioma más**: una fila en `LOGROS` de `plexIdiomas.js` (`[id, nombre, modo, eps|pelis|series, objetivo,
  recompensa, dificultad]`); la descripción sale sola.
- **Una versión de idioma más** (p. ej. latino): una entrada en `MODOS` (`slug`, `anime`, `texto`, `emoji`, `cumple`) y
  sus filas en `LOGROS`. Las condiciones de admin y el trofeo de "serie entera en un idioma" la cogen solos (y
  `PREFERENCIA` de `plexResumen.js`, para decir la versión de una serie a medias).
- **Un tipo de trofeo automático más**: en `candidatos()` de `plexTrofeos.js`, con su entrada en `RECOMPENSA`,
  `DIFICULTAD` y `EMOJI`, y en `NOMBRE_TIPO` del panel (`adminPanel/plex.js`). Si lleva nombre de Gemini, también en
  `TIPOS_CON_IA`.
- **Una condición de admin más**: en `CONDICIONES` (con su `ayuda`), `evaluarCondicion` y `describirCondicion` de
  `plexTrofeos.js`. Las fechas (`desde:`/`hasta:`) valen solas para cualquiera.
- **Un umbral más de roles de Gordos**: `UMBRALES` en `plexGordos.js` y la clave `plex.rol_gordos_N` en
  `guildSettings.js` (las tres listas).
- **Un filtro más en 🏅 Logros**: una entrada en `FILTROS_LOGROS` de `paneles/perfil.js` (la clave, sin "_"). Si es de
  Plex, con `plex: true` y su `opcion` (el nombre en el menú de dentro de 🍿 Plex).
- **Una comprobación más en `npm run plex:check`**: un `paso(...)` en `comprobar()` de `plexDiagnostico.js` (y en
  `tests/plexDiagnostico.test.js`, el Tautulli de mentira).
- **Cambiar la hora o el día del ranking**: `HORA` en `plexRankingSemanal.js`; para otro día, el cron `"0 * * * 1"` de
  `src/index.js` y la comprobación `diaSemana(dia) !== 1` en `enviar()`. El canal, desde el panel.
- **Cambiar el esquema**: una migración nueva con el siguiente número (la próxima, `019_…`) en `src/core/migrations`.
  Nunca editar una que ya se haya aplicado en producción.

## 8. Convenciones (resumen)

- `npm run check` antes de cada commit (ESLint, Prettier y Jest). Los tests usan una BD en memoria
  (`tests/setupEnv.js`). Ojo con `node -e "require('./src/...')"` fuera de los tests: abre `data/banco.db` y le aplica
  las migraciones pendientes; para curiosear, `DB_PATH=:memory:` delante.
- En los tests que simulan Tautulli (`jest.mock("../src/services/tautulliClient", ...)`), simular todas las funciones
  que se usen (`getStreamData`, `getMetadata`...): si no, el test hace peticiones de verdad a `tautulli.local`.
- Cada cambio, en el [CHANGELOG](CHANGELOG.md) y, si cambia lo que ve la gente, en
  [FUNCIONALIDADES](FUNCIONALIDADES.md); lo que haya que probar a mano, en [TAREAS](planificacion/TAREAS.md); las
  migraciones, en [DEPLOY](DEPLOY.md). Ideas, en [FEATURES](planificacion/FEATURES.md).
- Textos para la gente en español claro, como el resto del bot. Mensajes de commit en español, explicando el porqué.
