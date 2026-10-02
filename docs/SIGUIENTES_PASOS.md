# Siguientes pasos

Para quien coja el proyecto ahora: dónde está, qué hacer primero y por dónde seguir. Escrito el 2026-10-03 al terminar
la sesión de trabajo sobre la gamificación de Plex. Si algo de aquí ya está hecho, borrarlo (y apuntarlo en el
[CHANGELOG](CHANGELOG.md)).

Para entender el proyecto en general: [README](../README.md) (puesta en marcha y convenciones),
[FUNCIONALIDADES](FUNCIONALIDADES.md) (qué hace el bot) y [DEPLOY](DEPLOY.md) (cómo se despliega).

## 1. Dónde estamos

- Todo lo de esta sesión está en la rama **`feature/elduendejavier`**, 5 commits por delante de `main`:

  | Commit | Qué |
  |---|---|
  | `c0cc4d2` | Trofeos de Plex, fases 2 y 3: fichas de Tautulli, trofeos de cada serie, temporada, saga y director, por género y década, anime aparte, trofeos de admin, rareza y "ocultar mis logros de Plex" (migración 015) |
  | `dbc3436` | Tests a fondo y 10 errores corregidos (Plex caído, series vueltas a añadir, bibliotecas vacías...) |
  | `eb872ee` | Logros por idioma (inglés, VOSE, castellano, y el anime doblado o en japonés con subtítulos) y dificultad en todos: 🟢 Fácil, 🟡 Normal, 🎰 Gordo del Plex (migración 016) |
  | `8627109` | Documentación técnica de Plex |
  | `9e2511a` | 📣 Ranking semanal de Plex: "el mayor gordito come foquitos de la semana", los lunes a las 10:00 en `874776941000020018` (migración 017) |

- **Nada de esto está en producción.** Portainer construye desde `main` ([DEPLOY](DEPLOY.md)), y `main` está en
  `63479b5` (la voz del Duende).
- **503 tests en verde** (`npm run check`: lint, formato y tests). Pero nada se ha probado contra el Tautulli ni el
  Discord de verdad: solo con tests, incluido un Tautulli de mentira por HTTP con las respuestas con su forma.
- No hay errores abiertos ([ERRORES](planificacion/ERRORES.md)) ni deuda técnica
  ([DEUDA_TECNICA](planificacion/DEUDA_TECNICA.md)).

## 2. Lo primero, en este orden

1. **Revisar y llevar a `main`** la rama `feature/elduendejavier` (un PR, o merge si se revisa a mano). Antes,
   `npm ci && npm run check` en local.
2. **Copia de seguridad** de `/compose/duende-bot/data/banco.db` (o `npm run db:backup` dentro del contenedor).
3. **Decidir lo de la economía** antes de que la gente reclame: la primera sincronización importa el historial entero y
   cada vinculado puede desbloquear decenas de logros (con los 51 de idioma, más). Si se quiere frenar, bajar
   `logros.reward_multiplier` en Config Global → Logros (o hacer [F-PX-08](planificacion/FEATURES.md#plex-y-seerr)).
4. **Desplegar**: Portainer → Stacks → `el-duende` → Pull and redeploy ([DEPLOY](DEPLOY.md)). Las migraciones 015,
   016 y 017 se aplican solas al arrancar; en el log, `[Migraciones] Aplicada 015_…`, `016_…`, `017_…` y
   `...: el ranking semanal de Plex se publica en 874776941000020018`.
5. **Vigilar la primera importación** en `logs/app-log.txt`: `Historial de ...: N reproducciones nuevas
   (primera importación)`, `Fichas de Plex de ...: N actualizadas, ... pendientes` e `Idiomas de Plex de ...: N
   reproducciones revisadas, ... pendientes`. Cada 30 min se avanza un poco (300 fichas, 1.500 idiomas); Panel admin →
   Plex → 🏆 Trofeos → 📼 Sincronizar ahora va más deprisa (1.200 y 5.000). Hasta que no queden fichas de películas
   pendientes, los trofeos de director y sagas no salen.
6. **Probar en Discord** con las listas de [TAREAS](planificacion/TAREAS.md): "🍿 Trofeos de Plex, fases 2 y 3",
   "🍿 Logros de Plex por idioma y dificultad" y "📣 Ranking semanal de Plex" (y las de antes que sigan sin marcar).

## 3. Lo que hay que comprobar con datos reales

Lo de Plex se ha escrito con la documentación y el código de Tautulli, no con los datos de este servidor. Estos son los
supuestos; si alguno falla, el arreglo está acotado:

| Supuesto | Cómo comprobarlo | Si falla, dónde tocar |
|---|---|---|
| `get_stream_data` da el idioma del audio en `stream_audio_language_code` / `audio_language_code` (o el nombre) y los subtítulos en `subtitles` + `stream_subtitle_language` | Consulta 1 de abajo: casi todo debería salir `en`, `es` o `ja`, pocos `otro` y `NULL` solo en lo antiguo | `idiomaDe` y `codigoIdioma` en `src/systems/plexIdiomas.js` |
| El latino se reconoce por el nombre de la pista ("Latino", "Latinoamérica", `es-419`) | Ver algo en latino y mirar su fila (consulta 1) | La expresión de `lat` en `codigoIdioma` |
| Las bibliotecas de anime tienen "anime" en el nombre | Panel admin → Plex → 🏆 Trofeos, línea 🎌 Anime | Botón 🎌 Bibliotecas de anime (no hace falta código) |
| Las temporadas y episodios de `get_children_metadata` cuadran con el `parent_media_index` / `media_index` del historial | Consulta 2: alguien que haya terminado una serie debería tener su trofeo | `fichaSerie` en `src/systems/plexFichas.js` |
| `get_library_media_info` pagina con `start`/`length` | En el log del primer repaso, que el número de películas cuadre con la biblioteca | `revisarBiblioteca` en `plexFichas.js` (ya no se queda en bucle si no pagina) |
| Las horas del ranking semanal se parecen a las de Tautulli | Panel admin → Plex → 📣 Ranking semanal (vista previa) contra las estadísticas de usuario de Tautulli de esa semana | `ranking` en `src/systems/plexRankingSemanal.js` |

Consultas sobre una copia de `banco.db` (con cualquier visor de SQLite):

```sql
-- 1. Idiomas detectados
SELECT audio, subs, COUNT(*) AS n FROM plex_reproducciones WHERE idioma_revisado = 1 GROUP BY audio, subs ORDER BY n DESC;
-- 2. Trofeos creados por tipo y dificultad
SELECT tipo, dificultad, COUNT(*) FROM plex_trofeos GROUP BY tipo, dificultad;
-- 3. Fichas por biblioteca
SELECT biblioteca, tipo, COUNT(*), SUM(actualizada = 0) AS pendientes FROM plex_fichas GROUP BY biblioteca, tipo;
-- 4. Monedas por reclamar de logros, por persona
SELECT userId, COUNT(*) AS logros FROM achievements_progress WHERE completedAt IS NOT NULL AND claimedAt IS NULL GROUP BY userId ORDER BY logros DESC;
```

## 4. Después: por dónde seguir

Ordenado por lo que aporta con menos trabajo. Todas están en [FEATURES](planificacion/FEATURES.md) con su detalle.

| Orden | ID | Qué | Esfuerzo | Por qué |
|---|---|---|---|---|
| 1 | F-PX-06 | `npm run plex:check` contra el Tautulli real | S | Comprueba la tabla de arriba en dos minutos, también en el futuro |
| 2 | F-PX-08 | Proteger la economía en la primera importación | S | Si no se ha decidido en el paso 3 |
| 3 | F-PX-02e | Filtro en 🏅 Logros (y esconder los de Plex a quien no lo tiene) | S | La pestaña pasa de 20 páginas |
| 4 | F-PX-09 | Pestaña 🍿 Plex en `/perfil` con "casi lo tienes" | M | Lo que más engancha; los datos ya están |
| 5 | F-PX-10 | Ranking de Plex en 🏆 Rankings | S | El menú existe |
| 6 | F-PX-02f | El Duende conoce los trofeos | S | Encaja con sus herramientas de Plex |
| 7 | F-PX-07 | Diagnóstico de idiomas en el panel | S | Si el 1 no basta |
| — | F-PX-11, 12, 13, 14 | Trofeos con fecha, sociales, roles por Gordos, nombres de Gemini de idioma | S–M | Más variedad cuando lo anterior esté probado |

Fuera de Plex, las de "Por dónde empezar" de [FEATURES](planificacion/FEATURES.md#por-dónde-empezar): resumen semanal
para admins (F-AD-02), ranking de apostadores (F-AP-03), clasificación semanal con premios (F-EC-03) y liga de
pronósticos (F-AP-12).

## 5. Decisiones pendientes (hablarlas con Javier)

- **Hora del ranking semanal**: las 10:00 de los lunes (`HORA` en `plexRankingSemanal.js`).
- **Quien oculta sus logros de Plex sale igual en el ranking semanal** (no es un logro y sus horas ya se pueden
  preguntar al Duende). Si no debe salir: filtrar con `plexTrofeos.oculto` en `ranking()`.
- **El latino no cuenta como castellano.** Si se quiere contar, en `MODOS` de `plexIdiomas.js` (`cumple`) aceptar `lat`.
- **Las recompensas** de los logros de idioma y de los trofeos (tablas en
  [FUNCIONALIDADES](FUNCIONALIDADES.md#logros-de-plex-por-idioma)) se pusieron a ojo.
- **Los 80 logros fijos de Plex los ve todo el mundo**, también quien no tiene Plex vinculado (ver F-PX-02e).

## 6. Mapa del código de Plex

El detalle técnico (flujo de cada sincronización y por qué se hizo así) está en
[tecnico/PLEX_Y_SEERR.md](tecnico/PLEX_Y_SEERR.md#6-logros-y-trofeos-de-plex-2026-10-02--2026-10-03).

| Fichero | Qué hace |
|---|---|
| `src/services/tautulliClient.js` | Cliente de la API de Tautulli (una función por `cmd`) |
| `src/systems/plexHistorial.js` | Copia del historial, estadísticas de la fase 1 y la sincronización entera (`sincronizarYCalcular`, cron) |
| `src/systems/plexFichas.js` | Fichas de películas y series (biblioteca, temporadas, géneros...) y qué es anime |
| `src/systems/plexIdiomas.js` | Idioma de cada reproducción, versiones (`MODOS`), los 51 logros de idioma (`LOGROS`) y las dificultades |
| `src/systems/plexTrofeos.js` | Trofeos automáticos y de admin, nombres de Gemini, rareza, ocultar |
| `src/systems/plexRankingSemanal.js` | Ranking semanal de los lunes |
| `src/systems/achievementsSystem.js` | Catálogo de logros (los fijos de Plex al final de `CATALOG`), aplicar eventos, reclamar, anunciar |
| `src/adminPanel/plex.js` | Panel admin → Plex, 🏆 Trofeos y 📣 Ranking semanal |
| `src/paneles/perfil.js` | `/perfil` → 🏅 Logros (rareza, dificultad, ocultar) |
| `src/core/migrations/013`–`017` | Tablas de Plex (`plex_reproducciones`, `plex_sync`, `plex_fichas`, `plex_trofeos`, `plex_preferencias`) y ajustes |
| `tests/plex*.test.js` | Tests de todo lo anterior (ver la cabecera de cada uno) |

## 7. Recetas

- **Un logro fijo de Plex más**: una fila en la lista de Plex de `CATALOG` (`achievementsSystem.js`):
  `[id, nombre, descripción, evento, objetivo, recompensa, dificultad, oculto?]`. El evento tiene que existir
  (`plexHistorial.EVENTOS`, `plexTrofeos.EVENTOS_FICHAS` o uno de idioma). Actualizar el número de logros en el test
  de `plexHistorial.test.js` y la tabla de FUNCIONALIDADES.
- **Un logro de idioma más**: una fila en `LOGROS` de `plexIdiomas.js` (`[id, nombre, modo, eps|pelis|series, objetivo,
  recompensa, dificultad]`); la descripción sale sola.
- **Una versión de idioma más** (p. ej. latino): una entrada en `MODOS` (`slug`, `anime`, `texto`, `emoji`, `cumple`) y
  sus filas en `LOGROS`. Las condiciones de admin y el trofeo de "serie entera en un idioma" la cogen solos.
- **Un tipo de trofeo automático más**: en `candidatos()` de `plexTrofeos.js`, con su entrada en `RECOMPENSA`,
  `DIFICULTAD` y `EMOJI`, y en `NOMBRE_TIPO` del panel (`adminPanel/plex.js`).
- **Una condición de admin más**: en `CONDICIONES` (con su `ayuda`), `evaluarCondicion` y `describirCondicion` de
  `plexTrofeos.js`.
- **Cambiar la hora o el día del ranking**: `HORA` en `plexRankingSemanal.js`; para otro día, el cron `"0 * * * 1"` de
  `src/index.js` y la comprobación `diaSemana(dia) !== 1` en `enviar()`. El canal, desde el panel.
- **Cambiar el esquema**: una migración nueva con el siguiente número (la próxima, `018_…`) en `src/core/migrations`.
  Nunca editar una que ya se haya aplicado en producción.

## 8. Convenciones (resumen)

- `npm run check` antes de cada commit (ESLint, Prettier y Jest). Los tests usan una BD en memoria
  (`tests/setupEnv.js`).
- En los tests que simulan Tautulli (`jest.mock("../src/services/tautulliClient", ...)`), simular todas las funciones
  que se usen (`getStreamData`, `getMetadata`...): si no, el test hace peticiones de verdad a `tautulli.local`.
- Cada cambio, en el [CHANGELOG](CHANGELOG.md) y, si cambia lo que ve la gente, en
  [FUNCIONALIDADES](FUNCIONALIDADES.md); lo que haya que probar a mano, en [TAREAS](planificacion/TAREAS.md); las
  migraciones, en [DEPLOY](DEPLOY.md). Ideas, en [FEATURES](planificacion/FEATURES.md).
- Textos para la gente en español claro, como el resto del bot. Mensajes de commit en español, explicando el porqué.
