# Changelog — El Duende

Registro de cambios de esta sesión de trabajo. Se actualiza según se va avanzando.

## 2026-10-06 (🍿 Lo pendiente de la gamificación de Plex)

Rama `feature/elduendejavier`. Migración **018**. Todo lo que quedaba en [FEATURES](planificacion/FEATURES.md) de los
logros y trofeos de Plex, menos los trofeos por país (F-PX-02d: Tautulli no da el país). Detalle en
[FUNCIONALIDADES](FUNCIONALIDADES.md#5-logros).

- **F-PX-08 · Proteger la economía en la primera importación** (`systems/plexImportacion.js`): lo que se desbloquea
  mientras se le calcula a alguien lo antiguo da el **50 %** de las monedas (`plex.importacion_pct`, de 0 a 100, en
  Panel admin → Plex → 🏆 Trofeos → 🪙 % de la importación; vale al reclamar). La importación de cada vinculado empieza
  con su primer cálculo y acaba cuando no quedan fichas ni idiomas por revisar, como mucho a los 7 días; vincularse con
  otra cuenta de Plex empieza otra. Cada logro guarda si salió en la importación (`achievements_progress.importado`) y
  se ve en 🏅 Logros, en el menú de reclamar y al reclamarlo ("📼 de la importación").
- **F-PX-06 · `npm run plex:check`** (`scripts/plex-check.js` y `systems/plexDiagnostico.js`): comprueba contra el
  Tautulli de verdad, sin tocar la BD, cada supuesto de [SIGUIENTES_PASOS](SIGUIENTES_PASOS.md#3-lo-que-hay-que-comprobar-con-datos-reales):
  bibliotecas y anime, paginación, idiomas (y los nombres que no se reconocen), la ficha de una serie con sus fechas de
  llegada y las horas contra las de Tautulli. Coge la configuración de la BD (solo lectura) o del `.env`.
- **F-PX-07 · 🔍 Idiomas** en Panel admin → Plex → 🏆 Trofeos: cuántas reproducciones hay de cada audio y subtítulo y
  qué nombres no se reconocen (pregunta a Tautulli por los "otro").
- **F-PX-02e · Filtro en 🏅 Logros**: un menú para ver una categoría, solo los trofeos de Plex o una dificultad (se
  mantiene al pasar página, ver secretos y reclamar). **A quien no tiene Plex vinculado ya no le salen los 87 fijos de
  Plex** (ni cuentan en su total, en el perfil ni para el Duende), salvo los que ya tenga.
- **F-PX-09 · 🍿 Plex en `/perfil`** (botón en 👤 Perfil y `/perfil seccion:🍿 Plex`; no cabe una sexta pestaña en la
  fila): horas, series terminadas, logros, 🎰 Gordos, récords, reparto de idiomas ("🇬🇧 Inglés 55 % (📝 VOSE 40 %)") y
  🎯 Te falta poco: series a medias con su versión ("3 episodios para terminar *Dark* 📝 en VOSE") y los logros de Plex
  más avanzados. `systems/plexResumen.js`.
- **F-PX-10 · 🍿 Plex en 🏆 Rankings**: más logros de Plex, más 🎰 Gordos, más políglota (logros de idioma) y más horas
  (este mes y de siempre). `systems/plexRankings.js`. Quien oculta sus logros no sale en los de logros.
- **F-PX-02f · El Duende conoce los trofeos**: herramienta `consultar_trofeos_plex` (con las de Plex): los de alguien,
  quién tiene el de una serie, saga o director ("¿quién ha terminado Breaking Bad?") o quién tiene más. Respeta a quien
  los oculta.
- **F-PX-11 · Trofeos con fecha**: las condiciones de admin aceptan `desde:AAAA-MM-DD` y `hasta:AAAA-MM-DD` (días en
  hora de Madrid) y solo cuenta lo visto entre ellas, para eventos de temporada (`genero:Terror 5 desde:2026-10-01
  hasta:2026-10-31`). Pasado el plazo, solo lo ve quien lo consiguió (`visibleHasta` en el catálogo).
- **F-PX-12 · Trofeos sociales**: 7 logros fijos nuevos (87 de Plex, 123 en total): 🎬 Cine compartido (la misma
  película que otro vinculado el mismo día), Sin spoilers (en las 24 h desde que llega a Plex) y Primero del servidor
  (el primero en ver un estreno, en su primera semana). Las fichas guardan ahora cuándo llegó cada película y cada
  episodio (`added_at`: `plex_fichas.alta` y `altas`).
- **F-PX-13 · Roles por Gordos del Plex**: un rol a 1, 5 y 10 🎰 (Panel admin → Plex → 🏆 Trofeos → 🎰 Roles de Gordos;
  `plex.rol_gordos_1`, `_5`, `_10`), que se da tras cada cálculo de los logros de Plex. Solo se dan, como los de nivel;
  a quien oculta sus logros, no.
- **F-PX-14 · Nombres de Gemini para los de idioma**: los trofeos de serie en un idioma llevan nombre de Gemini (que
  juegue con el idioma), y los que se quedaron con el nombre por defecto (Gemini falló o se pasó del tope de 150) se
  vuelven a pedir en las siguientes sincronizaciones, hasta 40 cada vez. Antes, si Gemini fallaba, no se volvía a
  intentar.
- `/ayuda` (Niveles) cuenta todo lo nuevo.
- Tests: 586 (de 503). Nuevos: `plexImportacion`, `plexPerfil` (filtro, 🍿 Plex y ranking, validando lo que se manda a
  Discord), `plexGordos`, `plexTrofeosFechas` (con el cambio de hora), `plexSociales`, `plexDuendeTrofeos` y
  `plexDiagnostico` (contra un Tautulli de mentira por HTTP, con el script ejecutado en otro proceso y comprobando que
  no toca la BD); `tests/ayudaPlex.js` con las ayudas comunes. Cambiados: los que comprueban la recompensa de cada
  trofeo ponen la importación al 100 %; el de Gemini que fallaba ahora comprueba que se vuelve a pedir (F-PX-14); el
  recuento de logros fijos de Plex (87); el Tautulli de mentira por HTTP manda `added_at`.

## 2026-10-03 (📣 Ranking semanal de Plex)

Rama `feature/elduendejavier`. Migración **017**.

- **Cada lunes a las 10:00** (hora de Madrid) se publica en el canal del ranking quién vio más Plex la semana anterior
  (de lunes a domingo, en hora de Madrid): "🦭 El mayor gordito come foquitos de la semana es @…" con sus horas, y los 5
  primeros (🥇🥈🥉4️⃣5️⃣) con horas, episodios y películas (`systems/plexRankingSemanal.js`). Solo le llega el aviso al
  primero.
- Cuenta el tiempo visto sin pausas de quien tiene Plex vinculado. Antes de calcular se copia lo último del historial
  (lo del domingo por la noche entra).
- Cron cada hora de los lunes y al arrancar: si el bot estaba caído a las 10:00 sale en cuanto vuelve ese lunes, nunca
  dos veces la misma semana (`plex.ranking_ultima_semana`) ni dos a la vez.
- La migración 017 pone `874776941000020018` como canal del ranking (`plex.ranking_canal`) en el servidor que lo usa
  para los niveles o los logros. Panel admin → Plex → 📣 Ranking semanal: cómo queda el de la semana pasada, cambiar el
  canal y publicarlo ya.
- Tests: 503 (`tests/plexRankingSemanal.test.js`: semanas en hora de Madrid con el cambio de hora y de año, el mensaje
  exacto, una vez por semana, fallos de Tautulli y del canal, la migración y el panel).

## 2026-10-03 (🍿 Logros de Plex por idioma y por dificultad)

Rama `feature/elduendejavier`. Migración **016** (columnas `audio`, `subs` e `idioma_revisado` en
`plex_reproducciones`; `dificultad` en `plex_trofeos`). Detalle en
[FUNCIONALIDADES.md](FUNCIONALIDADES.md#logros-de-plex-por-idioma).

- **Dificultad** de todos los logros de Plex: 🟢 Fácil, 🟡 Normal o 🎰 **Gordo del Plex**. Los 29 fijos que había
  la tienen puesta; los trofeos automáticos según lo largos que son (una serie de 100 episodios o más es 🎰); los de
  admin, la que elija el admin (campo nuevo en ➕ Crear trofeo). Se ve en `/perfil` → 🏅 Logros (junto a la categoría
  y un recuento por dificultad), en el anuncio y en Panel admin → Plex → 🏆 Trofeos.
- **Idioma de lo que se ve** (`systems/plexIdiomas.js`): de cada reproducción vista por los vinculados, el idioma del
  audio y de los subtítulos (`get_stream_data` de Tautulli, nuevo en `tautulliClient`), poco a poco (1.500 por
  sincronización, 5.000 con el botón). El latino se distingue cuando la pista lo dice; los subtítulos forzados no
  cuentan.
- **51 logros fijos por idioma**: episodios, películas y series enteras 🇬🇧 en inglés, 📝 en VOSE, 🎧 en inglés sin
  subtítulos y 🇪🇸 en castellano; y del anime, doblado al castellano, en japonés con subtítulos en castellano, doblado al
  inglés, en japonés con subtítulos en inglés y en japonés sin subtítulos. 80 logros fijos de Plex, 116 en total.
- **Trofeo de serie en un idioma**: terminar una serie entera en una versión ("Breaking Bad en inglés").
- **Trofeos de admin por idioma**: `idioma-episodios:<versión> N`, `idioma-peliculas:<versión> N` e
  `idioma-series:<versión> N`.
- `sincronizarYCalcular(guild, { boton })` en vez de pasar el presupuesto de las fichas.
- Tests: 480. Nuevo `tests/plexIdiomas.test.js` (reconocer idiomas por código y nombre, versiones, revisión desde
  Tautulli, los 51 logros, series enteras en un idioma, anime, películas, latino, dificultad en catálogo, perfil,
  anuncio y panel, condiciones de admin); `get_stream_data` en el Tautulli de mentira por HTTP; migración 016 sobre una
  BD en la 015; carga con idiomas (~1 s). Los tests de antes, con la dificultad en los anuncios y el perfil.

## 2026-10-02 (🍿 Trofeos de Plex, fases 2 y 3)

Rama `feature/elduendejavier`. **F-PX-02b** y **F-PX-02c** de [FEATURES.md](planificacion/FEATURES.md), separando
películas, series, series de anime y películas de anime. Migración **015** (tablas `plex_fichas`, `plex_trofeos` y
`plex_preferencias`; columna `plex_sync.biblioteca_revisada`). Detalle en
[FUNCIONALIDADES.md](FUNCIONALIDADES.md#trofeos-de-plex).

- **Fichas de Tautulli** (`systems/plexFichas.js`): el historial no dice la biblioteca, los géneros ni los episodios de
  cada temporada, así que en cada sincronización se piden poco a poco (300 llamadas; 1.200 con el botón) las fichas de
  todas las películas de las bibliotecas de películas y de las series vistas (`get_metadata`, `get_children_metadata`,
  `get_library_media_info`, nuevas en `tautulliClient`). Las películas se reconocen por título y año aunque estén en
  dos bibliotecas o se hayan vuelto a añadir con otra clave; las series, por clave o por título.
- **Fase 2, trofeos de cada título** (`systems/plexTrofeos.js`): terminar una temporada, una serie entera o una saga
  (colección de Plex). Se crean la primera vez que alguien los consigue, con un nombre temático de **Gemini** que se
  guarda ("Say my name"); solo los ve quien los tiene.
- **Fase 3, por significado**: 10 y 25 películas de un género (Terror y Horror cuentan juntos), todas las de un director
  que hay en Plex, 10 películas de una década anterior a 2000, y **trofeos de admin** con una condición en texto
  (`genero:Terror 20`, `director:Nolan`, `serie:Breaking Bad`, `anime-peliculas 10`...) desde Panel admin → Plex →
  🏆 Trofeos. **Rareza** en el perfil y en el anuncio ("solo el 8 % del servidor lo tiene").
- **Anime aparte** 🎌: las bibliotecas de anime (automático por el nombre y el género Anime, o elegidas en 🎌
  Bibliotecas de anime). 12 logros fijos nuevos en la categoría `plex`: series terminadas sin anime (1 · 5 · 15),
  películas de anime (1 · 10 · 25), series de anime (3 · 10), episodios de anime (100 · 500) y series de anime
  terminadas (1 · 5). 65 logros fijos en total.
- **🍿 Ocultar mis logros de Plex** en `/perfil` → 🏅 Logros: no se anuncian y los demás no los ven en tu perfil.
- **Logros**: el catálogo junta los fijos y los trofeos del servidor; `applyEvents` aplica muchos eventos en una
  transacción; un anuncio con muchos logros se corta en "…y N más" para no pasar de 2.000 caracteres (al importar el
  historial podían salir decenas); los logros de Plex se anuncian después de calcular a todos (la rareza cuenta lo de
  esa sincronización).
- Sin trofeos por país (Tautulli no lo da): queda como F-PX-02d.
- Tests: 305 (`tests/plexTrofeos.test.js`).

### Revisión con tests a fondo (2026-10-03)

Errores encontrados y corregidos al probar cada caso:

- Una película con el género en dos idiomas ("Terror" y "Horror") contaba dos veces para ese género.
- Una serie vuelta a añadir a Plex con otra clave: lo visto antes y después se repartía entre la ficha vieja y la
  nueva y nunca salía completa. Ahora, si la ficha de su clave ya no está, se usa la que tenga el mismo título.
- Si Tautulli ignorara `start`/`length` al listar la biblioteca, el repaso se quedaba en bucle; ahora para (y como
  mucho 100 páginas).
- Una lista vacía de una biblioteca que sí tiene películas (fallo de Tautulli) las daba todas por borradas.
- Con Plex caído y Tautulli en pie, cada ficha salía como "no encontrada" y se marcaban cientos como perdidas. Antes de
  pedir fichas se comprueba una película que seguro que existe; si no la da, se deja para la próxima vez.
- Una serie borrada de Plex a la que Tautulli responde con error (en vez de vacío) contaba como fallo de red y podía
  atascar la cola: ahora se marca como no encontrada. Los errores de Tautulli se distinguen de los de red
  (`respuestaDeTautulli`).
- Una serie de la que Tautulli no dio temporadas no se volvía a mirar nunca: ahora, al día siguiente.
- Con la categoría `plex` (o los logros) desactivada se seguían pidiendo fichas, creando trofeos y llamando a Gemini.
- Dos trofeos de admin creados en el mismo milisegundo tenían el mismo id y fallaba la BD.
- Una condición sin `:` solo decía "No entiendo la condición": ahora explica el formato.

Tests: 413. Nuevos: `plexFichas` (biblioteca, páginas, presupuesto, refrescos, fallos, Plex caído),
`plexTautulliHttp` (el cliente real contra un Tautulli de mentira por HTTP y el flujo entero sin mocks),
`plexTrofeosCasos` (cada regla y cada condición de admin, Gemini: fallos, lotes de 40 y máximo de 150),
`plexTrofeosPaneles` (cada botón, menú y formulario por `/paneladmin` y por el enrutador, que lo que se manda a Discord
es válido, el perfil y la migración sobre una BD en la 014), `plexTrofeosCarga` (12 vinculados, 3.000 películas, 300
series y ~30.000 reproducciones: ~1 s por sincronización) y `plexTrofeosErrores` (Tautulli caído, fallos parciales,
datos corruptos). Cobertura de líneas de las fichas, el historial y los trofeos: 99,7–100 %.

## 2026-10-02 (la voz del Duende: revisión completa)

Rama `feature/elduendejavier`. Tras el arreglo de DAVE el bot ya entra en el canal de voz, pero no decía nada:
`Respuesta sin audio (fin=OTHER)` de Gemini TTS. Revisada toda la cadena (entrar al canal → TTS → reproducir; y en
`/escuchar`: oír → Vosk → Duende → TTS).

### Errores corregidos

- **Gemini TTS sin audio**: el bot usaba `gemini-2.5-flash-preview-tts` por `generateContent`. Google está retirando los
  modelos 2.5 (octubre de 2026), ya no lo lista entre los de TTS y responde HTTP 200 sin audio (`finishReason: OTHER`).
  Ahora (`services/geminiTts.js`):
  - Por defecto, **`gemini-3.8-flash-tts`** por la **Interactions API** (`POST /v1beta/interactions`), la que documenta
    Google para TTS. El texto va tal cual: los modelos nuevos lo leen literalmente, y la instrucción que se mandaba antes
    ("TTS. Lee en voz alta…") se habría oído. Devuelven WAV; si llega PCM crudo se envuelve con su frecuencia.
  - Si un modelo responde sin audio se **reintenta** una vez; si sigue, o no existe (404), o da 429/5xx, se pasa al
    siguiente (`gemini-3.8-flash-lite-tts`, y el 2.5 por `generateContent` como último recurso). El que funciona se
    prueba primero la siguiente vez. Con la clave mala (401/403) se para enseguida. Como mucho 45 s en total.
  - El de por defecto se prueba siempre, aunque en el `.env` siga puesto el 2.5.
- **La voz leía las menciones**: al TTS le llegaba el texto con las menciones de Discord ya puestas (`<@370221…>`).
  Ahora va el texto sin menciones y, además, se limpia (menciones → nombres, sin emojis del servidor, enlaces ni
  formato) y se corta por una palabra entera (`textoParaVoz`).
- **El Duende se quedaba mudo en `/escuchar` si fallaba la voz**: en la charla de voz no hay respuesta por texto, así
  que si no puede hablar ahora la manda por texto al canal ("🗣️ …").
- **`/tts` no avisaba** si no podía generar el audio (entraba al canal y no decía nada): ahora avisa en privado.

### Para probar

- **`/paneladmin` → 🩺 Sistema → 🔊 Probar voz**: genera una frase, dice con qué modelo y adjunta el audio para oírlo
  en Discord; si falla, explica qué le pasó a cada modelo.
- **`npm run voz:test`** (en local, con `GOOGLE_API_KEY` en `.env`): genera la frase, comprueba que @discordjs/voice la
  convierte en paquetes Opus y, si Vosk está arrancado, que la entiende al transcribirla. Con `--duende` antes le
  pregunta al Duende. Deja el audio en `logs/voz-test.wav`.
- Tests: 287 (`tests/geminiTts.test.js`: modelos, reintentos, formatos, el botón y el paso por ffmpeg a Opus con un
  WAV real; `tests/vozDuende.test.js`: respuesta por texto si la voz falla).

## 2026-10-02 (errores tras desplegar: botones repetidos y voz)

Rama `feature/elduendejavier`, a partir de los logs de producción.

### Errores corregidos

- **🏅 Logros y 🏆 Rankings de `/perfil` fallaban** con `COMPONENT_CUSTOM_ID_DUPLICATED` al pasar a la página 2, al ver
  los secretos o en la página 2 del ranking de nivel: ◀ (a la página 1), 🙈 Ocultar secretos y ⏮️ tenían el mismo id
  que las pestañas Logros y Rankings, y Discord rechaza un mensaje con dos botones iguales. Ya pasaba desde la parte 6
  de paneles; con los 17 logros de Plex hay más páginas y se notó. Las dos pestañas llevan ahora `_tab` al final (los
  mensajes ya enviados siguen funcionando).
- **🎒 Inventario de `/tienda`, igual**: en la página 2, ⬅️ Anterior era igual que la pestaña Inventario. La pestaña
  lleva `_tab`.
- **La voz no conectaba** (`/tts`, `/escuchar` y las respuestas por voz del Duende): "Error al unirse al canal de voz:
  AbortError". Desde el 1 de marzo de 2026 Discord exige **DAVE** (cifrado de extremo a extremo) para entrar en un
  canal de voz, y `@discordjs/voice` 0.18 no lo tiene: la conexión no llegaba a estar lista y se cortaba a los 20 s.
  Se actualiza a **0.19.2**, que trae DAVE (`@snazzah/davey`). Esa versión pide Node 22.12 o más: la imagen de Docker
  pasa de `node:20` a **`node:22`** y `engines` a `>=22.12`.

### Tests

- Se pulsan todos los botones de 🏅 Logros (todas las páginas, con y sin secretos, con y sin logros por reclamar) y
  de 🏆 Rankings, los tres del log y un inventario de dos páginas, y se comprueba que ningún mensaje repite un id.
  Fallan sin el arreglo.
- `tests/dependenciasVoz.test.js`: `@discordjs/voice` es 0.19 o más y encuentra la librería de DAVE, Opus y cifrado, y
  el Node de la imagen de Docker cumple lo que pide `package.json`.
- Tests: 272.

## 2026-10-02 (anuncio de cada logro con mención)

Rama `feature/elduendejavier`. Migración **014**.

- **Cada logro desbloqueado se anuncia en el canal `874776941000020018`** (el de las subidas de nivel) mencionando a
  quien lo consigue. La migración 014 lo pone como canal de logros en el servidor que lo usa para los niveles; se
  puede cambiar en Config Global → Logros.
- **Corregido**: los logros del casino y la cripto nunca se anunciaban (se calculan con el id del servidor y el aviso
  necesitaba el servidor). Ahora el sistema de logros tiene el cliente de Discord (`setClient`, desde index.js) y
  encuentra el servidor por su id.
- La mención solo avisa a esa persona (`allowedMentions`).
- **Logros de Plex**: lo desbloqueado en cada sincronización, también al importar el historial la primera vez, sale en
  un solo mensaje por persona en ese canal (antes, la primera vez era un DM de resumen).
- Tests: 265 (`tests/avisoLogros.test.js`).

## 2026-10-02 (🍿 Logros de Plex, fase 1)

Rama `feature/elduendejavier`. Primera fase de los logros de Plex (F-PX-02 en
[FEATURES.md](planificacion/FEATURES.md); las fases 2 y 3, trofeos de cada título y por significado, quedan como
F-PX-02b y F-PX-02c). Migración **013** (tablas `plex_reproducciones` y `plex_sync`).

- **Copia del historial de Tautulli** (`systems/plexHistorial.js`): cada 30 min (después de novedades y Seerr) se
  guardan en la BD las reproducciones nuevas de películas y episodios (`get_history` sin agrupar, por páginas de
  1.000; la primera vez, el historial entero). De todos los usuarios de Tautulli: si alguien se vincula después, su
  historial ya está.
- **17 logros nuevos en la categoría `plex`** (53 en total): horas vistas (10 · 100 · 500 · 1.000), películas (1 · 25 ·
  100), episodios (50 · 250 · 1.000), series distintas (10 · 30), maratón (6 h en un día; 10 h, oculto), atracón (5
  episodios de una serie en un día; 10, oculto) y noctámbulo (5 noches viendo algo entre las 3 y las 6, oculto). Solo
  para quien tiene la cuenta de Plex vinculada; los días en hora de Madrid; sin contar repeticiones.
- **Primera vez**: los logros que salen al importar el historial no se anuncian en el canal; a cada uno le llega un DM
  con el resumen. Después se anuncian como cualquier logro. *(Cambiado justo después: ahora salen en el canal, un
  mensaje por persona; ver la entrada de arriba.)*
- **Panel admin → Plex**: cuántas reproducciones hay guardadas y cuándo se sincronizó, y el botón 📼 Sincronizar
  historial.
- `/ayuda` → Niveles cuenta los logros del catálogo (ya no pone 36 a mano) y menciona los de Plex.
- Tests: 261 (`tests/plexHistorial.test.js`).

## 2026-10-02 (⚔️ Retos entre jugadores)

Rama `feature/elduendejavier`. Un único sistema de retos con el dinero retenido que cubre tres ideas de
[FEATURES.md](planificacion/FEATURES.md): **F-AP-01** (apuestas 1 contra 1), **F-EC-04** (duelos de casino) y
**F-AP-11** (porras propias). Migración **012** (tablas `retos` y `retos_participantes`).

- **Pestaña nueva ⚔️ Retos en `/juegos`** (y `seccion: ⚔️ Retos`): los retos que te han lanzado, los que esperan
  respuesta, lo que está en juego y los últimos cerrados, con enlace a cada uno, y los botones para lanzar uno nuevo.
  Las pestañas de `/juegos` pasan a ser cinco.
- **Lo común** (`systems/retos.js`): cobrar del efectivo al entrar, guardar a cada participante con lo que puso, y al
  cerrar pagar al ganador o devolverlo todo, en una transacción y una sola vez (dos clics o el cron y un botón a la
  vez no pagan dos veces). El bot no se queda nada. Entre 10 y 100.000 por persona. Tipo `retos` en Movimientos.
- **⚽ Reto a un partido**: partido → resultado → rival → cantidad. El rival va con lo contrario. Se resuelve en la
  liquidación de cada hora (que ahora también consulta los partidos con retos pendientes), se devuelve si el partido
  se queda sin resultado y sale en el canal de resultados.
- **🎲 Duelos**: piedra, papel o tijera (jugadas en secreto, empate → otra ronda, 5 empates → se devuelve), dados
  (se tiran al aceptar) y blackjack (cada uno juega su mano en privado; sin crupier). La partida se guarda en la BD:
  un reinicio no la pierde.
- **🗳️ Porras**: pregunta, 2 a 5 opciones y entrada fija. Cualquiera entra; un admin la resuelve con un menú privado y
  el bote se reparte entre los que acertaron (si nadie, se devuelve). Cerrar apuestas, quien la creó o un admin;
  anular, un admin (o quien la creó si no ha entrado nadie más).
- **Mensaje público** por reto, que menciona al rival y se actualiza solo (también desde el cron y la liquidación).
  Cada botón comprueba a quién le toca: aceptar o rechazar, el rival; cancelar, quien retó; jugar, los dos del duelo.
- **Plazos** (cron cada 5 min): 24 h para aceptar (en los de partido, hasta que empiece), duelos abandonados 15 min
  (el blackjack se resuelve plantando a quien no terminó; el resto se devuelve) y porras sin resolver en 30 días. Se
  avisa por DM de lo devuelto o ganado.
- 📊 Stats suma los retos al total; `/ayuda` → Apuestas los explica y tiene el botón Abrir Retos.
- Tests: 254 (`tests/retos.test.js`: duelos, retos a partidos con la liquidación, porras, plazos y botones).

## 2026-10-02 (mejoras rápidas: diario, avisos, alertas y herramientas del Duende)

Rama `feature/elduendejavier`. Las cinco ideas más rápidas de [FEATURES.md](planificacion/FEATURES.md) y dos de las
ideas pendientes del final de este fichero. Migración **011** (tablas `recompensa_diaria` y `seerr_avisos`, columna
`apuestas_usuario.recordado`).

- **🎁 Recompensa diaria (F-EC-01)**: botón en `/perfil` → 💰 Economía. Una vez al día (hora de Madrid), al efectivo:
  100 + 20 por día de racha de XP, hasta 500. Atómico (dos clics no cobran dos veces), tipo `diario` en Movimientos,
  configurable en Config Global → 🎁 Diario (`systems/diario.js`). En vez de un comando `/diario`, un botón: sigue la
  línea de pocos comandos y paneles.
- **📢 Resultados en el canal (F-AP-06)**: la liquidación guarda qué pasó en cada partido y quiniela, y se publica un
  resumen en el canal que se elija en `/paneladmin` → ⚽ Apuestas (menciones sin ping). También desde 💸 Liquidar ahora.
- **⏰ Recordatorio antes del partido (F-AP-08)**: cron cada 5 min, DM a quien apostó en un partido que empieza en
  los próximos 30 min (configurable), un mensaje por persona y una vez por apuesta (`systems/apuestas/recordatorios.js`).
- **🍿 "Ya está en Plex" (F-PX-01)**: después de las novedades (cada 30 min) se miran las peticiones de Seerr que han
  pasado a disponibles y se menciona a quien la pidió en el canal de novedades (o DM). La primera vez solo fija la
  base. Interruptor en `/paneladmin` → 🍿 Seerr (`systems/pedidosSeerr.js`).
- **🔔 Alertas por DM a los admins (F-AD-01)**: errores nuevos (gancho `onError` del logger; el mismo error como
  mucho cada 6 h), Odds API con menos de 50 créditos, Gemini sin cuota, modelo de Gemini que no funciona y backups
  fallidos. Máximo 10 a la hora; las del arranque se mandan al conectar. A quién: `/paneladmin` → 🩺 Sistema →
  🔔 Alertas (por defecto, el dueño del servidor), con 📨 Probar (`systems/alertas.js`). 🩺 Sistema enseña también
  los créditos que quedan de la Odds API.
- **🤖 Comprobar el modelo de Gemini**: una llamada de prueba con una herramienta trivial dice si el modelo existe y
  si usa herramientas. Al arrancar (alerta si falla), con el botón 🤖 Probar Gemini de 🩺 Sistema y al cambiar el
  modelo en Config Global → 🤖 Duende.
- **Herramientas nuevas del Duende** (solo lectura, siempre de quien habla): `consultar_tienda`,
  `consultar_inventario`, `consultar_mis_apuestas`, `consultar_partidas_casino` y `consultar_recompensa_diaria`.
- `/ayuda` → Economía menciona el 🎁 Diario.
- Tests: 232 (diario, avisos de apuestas, pedidos de Seerr, alertas, modelo de Gemini y herramientas).

## 2026-09-25 (reorganización de paneles, parte 9: ayuda y todo público)

Última parte del [plan de paneles](planificacion/diseno/reorganizacion-paneles.md#4-plan-de-ejecución), que queda
como histórico.

- **`/ayuda` abre los paneles**: cada sección tiene una fila de botones verdes (👤 Perfil, 🏅 Logros, 🏆 Rankings,
  💰 Economía, 🛒 Tienda, 🎒 Inventario, 🎰 Casino, 📊 Stats, ⚽ Apuestas, 📋 Mis jugadas, 📊 Cripto y, a admins,
  🛠️ Panel admin). Abren el comando como si se hubiera escrito, en un mensaje nuevo cuyo dueño es quien pulsa, y
  respetan los permisos de cada comando (canales, roles, desactivado).
- **Todo público (D5)**: `/ayuda`, `/tienda ver`, la lista y el detalle de partidos, la apuesta registrada, la
  quiniela y el blackjack y el adivinar lanzados desde fuera del panel dejan de ser privados. Siguen privados los
  avisos de error, `/paneladmin`, `/duende recuerda | olvida | personas`, el editor de pronósticos de la quiniela y
  las pantallas de ayuda de cada juego.
- FUNCIONALIDADES.md explica los cinco paneles y qué es público y qué privado.
- Tests: 193.

## 2026-09-25 (reorganización de paneles, parte 8: administración en un panel)

Octava parte del [plan de paneles](planificacion/diseno/reorganizacion-paneles.md#4-plan-de-ejecución).

- **`/paneladmin` con tres secciones nuevas** (tercera fila de la pantalla principal):
  - **⚽ Apuestas**: apuestas pendientes y quinielas abiertas por competición, 💸 Liquidar ahora (antes
    `/pagarapuestas`) y 🧾 Crear quiniela de cada competición.
  - **🛒 Catálogo**: los objetos con si están a la venta, precio y stock; crear, editar un campo, eliminar, poner a
    la venta (o cambiar precio y stock) y quitar de la venta (antes `/objeto` y `/tienda añadir | editar |
    eliminar`). La configuración de la tienda sigue en Config Global.
  - **🩺 Sistema**: el diagnóstico (antes `/diagnostico`), el nivel de log con un menú y 💎 TTCL (antes
    `/ttcl-diagnostico`).
- **Se borran** `/panel`, `/pagarapuestas`, `/objeto`, `/diagnostico`, `/ttcl-diagnostico` y los subcomandos
  `añadir`, `editar`, `eliminar` y `config` de `/tienda`. Quedan **14 comandos**.
- La liquidación pasa a `systems/apuestas/liquidacion.js` (la usan el cron y el panel), y crear la quiniela a
  `crearQuiniela` en `juegos/apuestas/quiniela.js` (la usan el botón de la quiniela y el panel).
- **E-14 y E-15** (estadísticas raras de `/panel`) desaparecen con él, y con eso **DT-13** queda resuelta.
- Tests: 187.

## 2026-09-25 (reorganización de paneles, parte 7: tienda e inventario)

Séptima parte del [plan de paneles](planificacion/diseno/reorganizacion-paneles.md#4-plan-de-ejecución).

- **`/tienda` con pestañas** en todas sus pantallas: 🛒 Catálogo · 🎒 Inventario · 🧾 Mis compras.
- **🎒 Inventario** (antes `/inventario` y `/usar`): tus objetos agrupados y un botón **Usar** por cada uno que haga
  algo (rol o consumible); al usarlo, el resultado sale en el mismo panel. Subcomando `/tienda inventario
  [categoria] [rareza]`. La lógica está en `systems/objetos.js`.
- **Después de comprar**: ⬅️ Volver a la tienda · 🎒 Ver en inventario · 🔮 Usar ya (en los consumibles).
- **🧾 Mis compras** vuelve a ser la lista de compras de la tienda (con la fila de pestañas); también están en
  `/perfil` → Economía → Movimientos, filtro Tienda.
- **Se borran `/inventario` y `/usar`.** Los botones de mensajes de `/inventario` llevan a la pestaña Inventario.
- Los botones de la tienda solo los puede usar quien la abrió (antes cualquiera podía pulsar los de otro).
- Tests: 180.

## 2026-09-25 (reorganización de paneles, parte 6: un solo perfil)

Sexta parte del [plan de paneles](planificacion/diseno/reorganizacion-paneles.md#4-plan-de-ejecución).

- **`/perfil [usuario] [seccion]`** con pestañas en todas sus pantallas: 👤 Perfil · 💰 Economía · 🎲 Juegos ·
  🏅 Logros · 🏆 Rankings (la actual, resaltada).
  - **Perfil**: la ficha que antes daba `/nivel`, con el dinero y 🎭 Recompensas de nivel.
  - **Economía**: lo que antes estaban en `/banco` y en la Economía de `/nivel` juntos (efectivo, banco, ganado y
    perdido en el casino, cartera cripto valorada, objetos) con Ingresar, Sacar, Transferir y Movimientos.
  - **Juegos**: abre `/juegos`.
  - **Logros**: páginas, secretos visibles y reclamar uno (menú) o todos.
  - **Rankings**: nivel (con páginas), riqueza, casino, logros y TTCL, en una pantalla con un menú.
- **Perfil de otra persona (D1)**: se ve entero, economía y movimientos incluidos; las acciones solo en el tuyo.
- **Se borran `/nivel`, `/logros` y `/banco`.** Sus pantallas pasan a `src/paneles/perfil.js` y
  `src/paneles/economia.js`, y los botones de dinero a `src/perfil/dinero.js` (no es comando; `index.js` registra
  sus botones como los de `src/juegos/`). Los botones de mensajes antiguos siguen llevando a su pestaña.
- El aviso de logros desbloqueados dice "Reclámalos en /perfil → 🏅 Logros".

### Errores corregidos
- **E-11 · En el perfil de otro, algunos botones llevaban al tuyo.** Todos los ids llevan quién mira y de quién es
  el perfil.
- Tests: 175.

## 2026-09-25 (reorganización de paneles, parte 5: efectivo y banco)

Quinta parte del [plan de paneles](planificacion/diseno/reorganizacion-paneles.md#4-plan-de-ejecución), según
la decisión D4: el banco es el sitio seguro y se gasta el efectivo.

- **💵 Efectivo** (la columna `enMano`, antes "en mano") es el dinero que se gasta: casino, apuestas, quiniela,
  tienda, cripto y transferencias cobran de ahí, y los premios, reembolsos, ventas de cripto, recompensas de
  logros y objetos de monedas llegan ahí. **🏦 Banco** (`saldo`) solo guarda: se ingresa y se saca.
- **`systems/dinero.js`**: todo el dinero pasa por aquí (cuenta, cobrar, pagar, ingresar, sacar, transferir,
  movimientos, más ricos). Antes había unos 20 sitios con su propio `UPDATE banco SET saldo`.
- **Cuentas nuevas**: 1.000 monedas en efectivo y el banco vacío (antes 1.000 en el banco).
- **Sin migración del dinero**: cada uno conserva lo que tenía donde lo tenía (casi todo en el banco), así que
  para jugar o comprar hay que sacarlo primero.
- **`/banco` es un panel** (💰 Economía) en vez de subcomandos: efectivo, banco y total, 🏦 Ingresar, 💵 Sacar,
  💸 Transferir (selector de persona y formulario), 📜 Movimientos y 🏆 Más ricos. Se quitan los subcomandos
  saldo, depositar, retirar, transferir, top, historial e historialglobal (este último ya estaba en
  `/paneladmin` → Banco). La espera de 10 s entre operaciones desaparece: todo es atómico.
- **💵 Sacar del banco** en los selectores de importes del casino, la confirmación de la tienda y la compra de
  cripto: después de sacar, la pantalla se repinta con el efectivo nuevo.
- **Movimientos con tipo**: el historial guarda el tipo de cada movimiento (migración 010, que clasifica los que
  ya había por su descripción) y se filtra por él. `/tienda historial` abre los Movimientos filtrados por
  tienda.
- El perfil, la economía de `/nivel`, el inventario, la herramienta de saldo del Duende y `/paneladmin` → Banco
  enseñan efectivo y banco. En el panel de admin, "modificar saldo" acepta `efectivo` o `banco`, y "resetear"
  deja la cuenta como nueva (1.000 en efectivo).
- Tests: 168.

## 2026-09-25 (reorganización de paneles, parte 4: /juegos)

Cuarta parte del [plan de paneles](planificacion/diseno/reorganizacion-paneles.md#4-plan-de-ejecución).

- **Comando nuevo `/juegos [seccion]`**, con cuatro pestañas en la última fila de todas sus pantallas:
  🎰 Casino · ⚽ Apuestas · 📋 Mis jugadas · 📊 Stats (la actual, resaltada).
  - **Casino**: el panel que había en `/perfil`, más PPT.
  - **Apuestas**: los partidos, con botones para cambiar de competición y 🧾 Quiniela.
  - **Mis jugadas**: ⏳ En juego y 📋 Resueltas.
  - **Stats**: casino, apuestas a partidos y quinielas juntos, con el beneficio total.
- **Se borran 8 comandos**: `/blackjack`, `/ruleta`, `/tragaperras`, `/adivinar`, `/ppt`, `/apuestas`,
  `/quiniela` y `/misapuestas`. Todo lo que hacían se hace desde `/juegos`. Su código pasa de `src/commands/` a
  `src/juegos/` (con `git mv`): ya no registran comando, pero sus botones se siguen atendiendo (`index.js` los
  registra aparte), así que los mensajes antiguos siguen funcionando.
- **`/perfil` → 🎰 Casino** abre la pestaña Casino de `/juegos` en el mismo mensaje. El reparto de los botones
  del casino pasa de `/perfil` a `/juegos`.
- **Permisos (ACL):** los botones del casino y las apuestas se rigen por las reglas de `juegos` (antes, los del
  casino por las de `perfil`).
- `/ayuda`, FUNCIONALIDADES y el README hablan de `/juegos`; en el README, las carpetas `src/juegos/` y
  `src/paneles/`.
- **Corregido tras desplegar:** la pestaña 📋 Mis jugadas fallaba siempre ("Component custom id cannot be
  duplicated"): la pestaña y el botón ⏳ En juego tenían el mismo id. Ahora cada pestaña tiene el suyo
  (`juegos_casino`, `juegos_apuestas_*`, `juegos_jugadas`, `juegos_stats`), y un test revisa que ninguna
  pantalla de `/juegos` repita ids.
- Tests: 157.

## 2026-09-25 (reorganización de paneles, parte 3: Mis jugadas)

Tercera parte del [plan de paneles](planificacion/diseno/reorganizacion-paneles.md#4-plan-de-ejecución).

- **Mis jugadas** (`/misapuestas`): partidos y quinielas juntos, en tres vistas: ⏳ En juego, 📋 Resueltas y
  📈 Stats. En juego enseña también tus pronósticos de cada quiniela abierta con los aciertos que llevas, y tus
  últimas partidas del casino. La lógica está en `systems/apuestas/misJugadas.js` y los mensajes en
  `paneles/misJugadas.js`.
- **Todo enlazado:** Mis jugadas lleva a ⚽ Apostar a partidos, 🧾 Quiniela y 🎰 Casino. `/apuestas` tiene
  📋 Mis jugadas (se abre en el mismo mensaje) y 🧾 Quiniela, y `/quiniela` tiene ⚽ Partidos. Después de
  apostar a un partido o a la quiniela salen 📋 Mis jugadas y ⚽ Más partidos / 🧾 Ver la quiniela.
- **Las estadísticas incluyen las quinielas.** Una quiniela devuelta (nadie llegó al mínimo o caducó) cuenta
  como recuperada, no como perdida.

### Errores corregidos
- **E-08 · La quiniela no dejaba ver tus pronósticos ni tus aciertos.** `/quiniela`, si ya has apostado,
  enseña tu combinación con ✅/❌ en cada partido jugado y los aciertos que llevas. También está en Mis jugadas,
  junto con las quinielas cerradas y su premio.
- **E-13 · `/misapuestas` abría un mensaje nuevo en cada botón.** Ahora los botones editan el mensaje, y Stats
  tiene su fila de botones para volver.
- Tests: 149.

## 2026-09-25 (reorganización de paneles, parte 2: juegos)

Segunda parte del [plan de paneles](planificacion/diseno/reorganizacion-paneles.md#4-plan-de-ejecución).

- **Todas las partidas acaban igual:** 🔄 Repetir (misma apuesta) · 🎲 Otra apuesta · 📊 Stats de ese juego ·
  ◀ Casino, con `paneles/casino.filaFinJuego`. Antes blackjack, adivinar y ppt acababan sin botones, y la
  ruleta y la tragaperras tenían cada una los suyos.
- **Todos empiezan en el selector de importes del casino.** `/blackjack` y `/adivinar` sin apuesta abren el
  selector, y `/tragaperras` sin apuesta también (con el jackpot actual; antes tenía su propio menú).
- **`/adivinar` deja de ser siempre 500**: se elige el importe y empieza directamente, sin la pantalla de
  "Apostar 500 / Cancelar".
- **Piedra, papel o tijera en el panel de casino**: importe y después jugada, con botones.
- **Stats por juego**: el botón 📊 abre las stats del casino filtradas por ese juego. La tragaperras ya no
  tiene las suyas aparte.
- **Si no se puede cobrar la apuesta** (saldo, límite diario, espera), el aviso sale aparte, solo para ti, y
  el panel se queda como estaba. Antes, en la tragaperras y la ruleta, el aviso sustituía a la partida y te
  quedabas sin botones.

### Errores corregidos
- **Adivinar: perder en las rondas 1 a 3 se guardaba como un empate.** La partida quedaba con resultado 0 en
  el casino y 0 en el historial, así que las estadísticas, el ganado/perdido del perfil y el ranking del
  casino no veían esas derrotas. Ahora se registran con lo apostado, como en la ronda 4.
- Tests: 145.

## 2026-09-25 (reorganización de paneles, parte 1: arreglos rápidos)

Primera parte del [plan de paneles](planificacion/diseno/reorganizacion-paneles.md#4-plan-de-ejecución).

### Errores corregidos
- **E-05 · "Ganado/perdido en casino" contaba todo el historial.** En `/nivel` → 💰 Economía se sumaban depósitos,
  transferencias, compras, cripto... como si fueran casino. Ahora sale de las partidas del casino.
- **E-12 · La economía del perfil solo valoraba TTCL.** Ahora BTC, ETH, etc. también tienen valor y entran en el
  total. La cuenta está en `mercado.valorarCartera`, la misma que usa `/cripto` → Cartera.
- **E-07 · `/logros reclamar id` pedía un ID que no se veía.** `/logros ver` trae un menú 🎁 con los logros
  pendientes (con lo que da cada uno) para reclamarlos de uno en uno, y `/logros reclamar` abre ese menú sin
  pedir nada.
- **E-09 · Las estadísticas de `/misapuestas` daban por perdidas las pendientes.** Ahora lo apostado y el
  beneficio solo cuentan las apuestas resueltas, y lo que está pendiente sale aparte ("en juego").
- **E-10 · Carácter roto** en el título de las estadísticas de `/misapuestas`.
- **E-06 descartado:** los logros secretos se pueden ver (decisión D3 del plan).

### Deuda técnica
- **DT-13 (en parte):** la quiniela ya no atiende los prefijos antiguos `apuestas_quiniela_` y
  `apuestas_modal_quiniela_`, que no generaba ningún botón.
- Tests: 137.

## 2026-09-25 (errores E-01 a E-04 y toda la deuda técnica)

### Errores corregidos (antes en ERRORES.md)
- **E-01 · La quiniela pagaba aunque no se acertara nada.** Ahora hay que acertar al menos la mitad de los
  partidos (5 de 10) para cobrar; el 90 % del bote se sigue repartiendo entre quienes más acierten. Si nadie
  llega, se devuelve lo apostado a todos (con DM de reembolso). El mínimo se enseña en `/quiniela` y `/ayuda`.
- **E-02 · `/duende recuerda` dejaba escribir en el perfil de otro.** Ahora cada uno solo puede anotar sobre
  sí mismo; los admins, sobre cualquiera (como ya pasaba con `/duende olvida`).
- **E-03 · `/duende personas` enseñaba a todo el canal lo que se sabe de cada uno.** Ahora la respuesta es
  privada y cada uno ve solo lo suyo; los admins ven a todos. `recuerda` y `olvida` también responden en privado.
- **E-04 · El historial antiguo no tenía lo apostado en fútbol.** Migración 009: añade al historial, en
  negativo, las apuestas a partidos y de quiniela anteriores al 2026-09-24 que no estaban apuntadas (las de
  partidos con la fecha de inicio del partido, porque no se guardaba la de la apuesta). No duplica las que ya
  estaban. Así el "ganado/perdido" de `/nivel` cuadra.
- **Blackjack: doblar y pasarse ganaba si el crupier también se pasaba.** Ahora pasarse pierde siempre.

### Deuda técnica
- **DT-12 · `ephemeral: true` → `flags: MessageFlags.Ephemeral`** en los 305 sitios de `src/`. En `update()`
  se ha quitado en vez de cambiarlo: ahí nunca hizo nada (lo privado no cambia al editar), y los flags sí se
  envían a Discord al editar.
- **DT-07 · Ficheros grandes:** `blackjack.js` (814 → ~500; reglas de cada jugada en `systems/blackjack.js`),
  `adminPanel/levels.js` (817 → 29; una pantalla por fichero en `adminPanel/niveles/`), `xpSystem.js` (753 → 44;
  partido en `systems/xp/`), `tienda.js` (757 → 349; datos y compra en `systems/tienda.js`), `cripto.js`
  (714 → 128) y `perfil.js` (646 → ~250). Los mensajes de los tres últimos van a la carpeta nueva
  `src/paneles/` (`tienda.js`, `cripto/`, `casino.js`): en `src/commands` cada fichero se carga como un comando.
  `inventario.js` usa los colores y emojis de la tienda en vez de tener su propia copia.
- **DT-08 · Vulnerabilidades:** `@discordjs/opus` (nativo, traía `tar` vulnerable al instalar) cambiado por
  `opusscript` (JavaScript puro, lo usa `prism-media` igual). `npm audit`: 0 vulnerabilidades. La imagen de
  Docker ya no compila opus.
- **DT-01 y DT-03**, descartadas (no hacen falta).
- **Mensajes privados al jugar desde el panel de casino de `/perfil` y en `/ruleta`:** esos adaptadores
  convierten la respuesta del juego en una edición del mensaje, y tras DT-12 le pasaban los flags de privado
  (que al editar sí llegan a Discord). Ahora se quitan al editar.
- Tests: 132 (blackjack y su comando, paneles de niveles, casino y cripto, tienda, quiniela, permisos del
  Duende, migración 009).

### Avisos al arrancar
- **"opcode 8 was rate limited" al arrancar**: el backfill de roles y la vinculación de perfiles del
  Duende pedían a la vez la lista de miembros de cada servidor. Ahora `vincularPerfiles` se ejecuta
  justo después del backfill y usa los miembros que este ya ha cargado en caché.
- Evento `ready` → `clientReady` (discord.js 14 avisaba de que está obsoleto y se quita en la 15).
  Mínimo de discord.js subido a `^14.22.0`, la primera que lo tiene.
- La vinculación de perfiles ya no escribe en el log de los servidores donde no ha vinculado a nadie.

## 2026-09-24 (subido a GitHub)

- Todo el trabajo subido a `github.com/ale-dm/bot-discord` (rama `main`), que pasa a ser **privado**
  (la documentación incluye nombres y apodos del grupo y detalles del servidor).
- Borrados `lista.m3u` e `images (1).png`, subidos antes desde la web y que el bot no usa.
- `.gitattributes`: todo el texto con LF, también en Windows (si no, un clon nuevo fallaba en
  `npm run check` por Prettier).

## 2026-09-24 (panel de perfiles del Duende)

- **Panel admin → Duende → 🧠 Perfiles → Ver / editar**: se elige un perfil de la lista (o a cualquier
  persona del servidor, y se le crea) y se ve su **ficha completa**: Discord ID, username, nombre, apodos,
  descripción, notas numeradas y cuántos caracteres de todo eso recibe el Duende. **Editar todo** abre un
  formulario con los cinco campos (nombre, username, Discord ID, descripción y notas, una por línea).
  También **Borrar notas** y **Borrar perfil** (con confirmación). Todo queda en la auditoría con el antes.
- Poniendo el Discord ID a mano se puede vincular un perfil antiguo que no se vinculó solo.
- **El Duende recibía solo 1.200 caracteres de cada perfil**: las descripciones de Jorge, Javier y Tomás se
  cortaban y las 3 notas de Javier (van detrás) no le llegaban nunca. Ahora 2.500 (`MAX_PERFIL_PROMPT`).
- Tests: 90 (panel de perfiles con los componentes reales de discord.js).

## 2026-09-24 (deuda técnica y revisión de errores)

### Deuda técnica resuelta
- **DT-02 + DT-05 · Duende en la BD, por Discord ID.** Personalidades, perfiles de personas y personalidad
  por canal pasan de `data/duende-*.json` a la BD (migración 008, `src/systems/duende/perfiles.js`). Los JSON
  se importan solos al arrancar y se renombran a `.importado`. Los perfiles se identifican por Discord ID:
  los antiguos (por username) se vinculan al arrancar o cuando esa persona habla, y cambiar de username ya
  no hace perder las notas. Nuevo **Panel admin → Duende → 🧠 Perfiles** para editar nombre y descripción
  (antes solo a mano en el JSON) o borrar un perfil, con auditoría.
- **DT-04 · Odds API en un solo sitio**: `src/services/oddsApi.js` (competiciones, cuotas con caché,
  resultados). Estaba triplicado en `apuestas.js`, `quiniela.js` y `pagarapuestas.js`; la quiniela ahora
  también usa la caché de cuotas.
- **DT-06 + DT-07 · Ficheros partidos**: `cripto.js` 1.346 → 714 líneas (precios y compra/venta en
  `src/systems/cripto/mercado.js`, gráficos en `src/systems/cripto/graficos.js`; el Duende, `/nivel` y el
  ticker ya no dependen del comando); reglas del blackjack en `src/systems/blackjack.js`; cobro de la tienda
  en `src/systems/tienda.js`; `apuestas.js` 677 → 426 líneas al quitar una copia de la quiniela que nadie
  llamaba.
- **DT-08 · `npm audit fix`**: de 22 vulnerabilidades a 5 (todas en `tar`, que solo se usa al instalar
  `@discordjs/opus`; sin arreglo publicado).
- **DT-09 · Tablas antiguas borradas** (migración 007): 19 tablas del juego de roles, del prototipo del pase
  de batalla, de la web y una copia de roles, con sus 5 claves foráneas rotas. Su contenido (426 filas) se
  guarda antes en `data/backups/tablas-antiguas-AAAA-MM-DD.json`.
- DT-10 y DT-11 descartados (se gestionan a mano).

### Errores corregidos
- **`/apuestas`: los botones de página fallaban siempre** (se pasaba una copia `{...interaction}` que no
  tiene `reply`). Ahora la página nueva sustituye al mensaje.
- **`/quiniela`: el botón 🔄 Refrescar fallaba siempre**, por lo mismo.
- **`/banco` borraba historial de toda la economía**: cada depósito, retirada o transferencia dejaba solo
  los 10 últimos movimientos de esa persona (también los del casino, cripto, apuestas y tienda), y de ahí
  salen el ganado/perdido de `/nivel` y el historial de la tienda.
- **`/tienda` → historial mostraba como "compras"** cualquier movimiento negativo (pérdidas del casino,
  compras de cripto, retiradas...). En la BD local: 3 compras reales frente a 56 movimientos mostrados.
- **`/cripto`: vender con doble clic vendía dos veces** lo mismo (se leía la cartera antes de esperar a
  CoinGecko), dejando la cartera en negativo y pagando de más. Compra y venta comprueban ahora saldo y
  cantidad dentro de la misma escritura.
- **Cuotas y horas de partidos congeladas**: los partidos se guardaban con `INSERT OR IGNORE`, así que las
  cuotas eran siempre las de la primera consulta y un partido aplazado conservaba la hora antigua (con la
  que se cierran las apuestas y se bloquea la quiniela). Ahora se actualizan mientras el partido está abierto,
  también en las quinielas.
- **Resultado de un partido según el orden de la API**: se asumía que el primer marcador era el del local;
  ahora se busca cada equipo por su nombre.
- **Lo apostado en fútbol no salía en el historial** (solo el premio al ganar): ahora se apunta al apostar
  (en `/apuestas` y en la quiniela).
- **`/apuestas` y quiniela sin cuenta de banco** respondían "saldo insuficiente" a quien aún no la tenía;
  ahora se le crea con el saldo inicial, como en el casino. Lo mismo al usar un objeto que da monedas.
- **`/ttcl-diagnostico` fallaba siempre**, también a los admins (`has("ADMINISTRATOR")`, nombre de
  discord.js 13 que en la 14 lanza error).
- **El ticker de TTCL registraba el precio con la configuración por defecto** en vez de la del servidor
  (la gráfica saltaba entre dos precios cada 10 minutos si se había cambiado el precio base en el panel).
  Lo mismo en el top de holders y el donut de la cartera.
- **`/tragaperras` podía quedarse "en curso" para siempre** si fallaba el `deferReply` (interacción
  caducada): no se podía volver a jugar hasta reiniciar el bot.
- **`/banco transferir`** en una transacción (antes, un fallo a mitad podía quitar el dinero sin darlo).
- Los escudos de los equipos se guardan en memoria (antes, 2 peticiones a TheSportsDB por cada partido abierto).

### Documentación
- Nuevo `docs/planificacion/ERRORES.md` con los errores encontrados que dependen de una decisión (E-01 a E-04:
  quiniela que paga con 0 aciertos, notas de `/duende recuerda` sobre otros, `/duende personas` público...).
- `DEUDA_TECNICA.md` actualizado (quedan DT-01, DT-03, DT-07 reducido, DT-08 y el nuevo DT-12: `ephemeral`
  obsoleto en discord.js). `DEPLOY.md` explica las migraciones 007 y 008; `TAREAS.md` añade las pruebas en
  Discord de todo lo corregido.
- Tests: 84 (antes 69): Odds API, perfiles del Duende, migración 007, notas por Discord ID.

## 2026-09-24 (orden, backups, tests y lint)

- **`duende.js` partido** (1.549 → ~520 líneas): configuración y memoria en `src/systems/duende/`
  (`config.js`, `memoria.js`, `personas.js`); herramientas, llamada a Gemini y respuesta por voz en
  `src/services/duende/` (`herramientas.js`, `gemini.js`, `voz.js`); GIFs en `src/services/giphy.js`.
- **Backup diario de la BD** a las 04:30 en `data/backups/banco-AAAA-MM-DD.db` con `db.backup()` (copia
  consistente con el bot en marcha), se conservan 7 (`BACKUP_KEEP`, `BACKUP_DIR`). A mano: `npm run db:backup`.
- **Tests** del dinero: reglas del blackjack, fórmula de XP y `addXp`, compra en la tienda (saldo, stock,
  objeto único), backups y un test de `/duende` de principio a fin con Gemini simulado. 69 tests en total.
- **ESLint + Prettier** (`eslint.config.js`, `.prettierrc.json`): todo el código formateado; `npm run lint`,
  `lint:fix`, `format`, y `npm run check` (lint + formato + tests). Quitados imports y variables sin uso.
- **Fallos de apuestas encontrados al escribir los tests**:
  - `/apuestas` no aplicaba el máximo (`MAX_BET_AMOUNT`): se podía apostar cualquier cantidad.
  - Se podía apostar a un partido ya empezado o terminado pulsando un botón de un mensaje antiguo.
  - La quiniela solo ocultaba el botón al bloquearse, pero aceptaba el formulario enviado después.
- `/nivel` muestra el total en TTCL (≈ monedas) junto al saldo.
- **Documentación reorganizada**: índice en `docs/README.md`; `docs/tecnico/PLEX_Y_SEERR.md` (antes
  `docs/PLEX.md`); `docs/planificacion/` con `TAREAS.md` (tareas manuales), `DEUDA_TECNICA.md` (DT-01…DT-11),
  `FEATURES.md` (ideas con ID por área) y `diseno/`. `docs/PENDIENTES.md` y `docs/FEATURES.md` eliminados.

## 2026-09-24 (arranque más limpio)

- `npm start` usa `scripts/dev.js` en vez de `concurrently` + `npm run` anidados (que añadían dos o tres cabeceras por proceso): una línea por evento con el origen (`voz` / `bot`) a la izquierda. Si se cae el servidor de voz, el bot sigue; si se cae el bot, se para todo. `concurrently` desinstalado.
- Servidor Vosk: sin el aviso de Flask ni una línea por petición (vuelven con `--verbose`); una sola línea al estar listo.
- Al parar (Ctrl+C o docker stop) la desconexión de Discord con código 1000 ya no se registra como aviso (solo en debug); las desconexiones inesperadas siguen siendo WARN.
- Bot: una línea al registrar los comandos y otra al conectar, en lugar de los mensajes sueltos con emojis. Los avisos y errores en consola, en desarrollo, salen con hora corta, color por nivel y solo la primera línea (la traza completa sigue en `logs/`). En Docker la consola no cambia.
- Nuevo `docs/FEATURES.md` con las ideas de features (apuestas y resto del bot).

## 2026-09-24 (errores de apuestas)

- **401 de la Odds API en todas las liquidaciones**: la URL de scores llevaba el nombre de la competición en el parámetro `apiKey` (`/sports/?apiKey=soccer_…/scores/?apiKey=…`). Restaurada a `/sports/<competición>/scores/?apiKey=…`.
- **422 en la Champions**: la API solo admite `daysFrom` de 1 a 3 y tenía 7. Los errores de la API ahora incluyen el motivo que devuelve (p. ej. `INVALID_SCORES_DAYS_FROM`).
- **Partidos que nunca se cerraban**: había 90 partidos ya jugados, de hace meses, que la API ya no puede resolver; el cron preguntaba por ellos cada hora (~144 créditos al día de un plan de 500 al mes) y 3 apuestas tenían el dinero retenido. Ahora solo se consulta la ventana de 3 días y lo que queda fuera sin resultado se marca `caducado` y se reembolsa (con DM). Igual con las quinielas.
- **Quinielas largas**: los resultados se guardaban solo si estaban los 10 a la vez en la API; una jornada de viernes a lunes no podía completarse nunca. Ahora se guardan partido a partido.
- **`/misapuestas` mostraba todas las apuestas liquidadas como "Ganada"** y las estadísticas nunca contaban pérdidas (se marcaba `pagado = 1` a ganadoras y perdedoras). Migración `006_resultado_apuestas`: se guarda el resultado del partido y el premio de cada apuesta.
- **Botón "Ver mis apuestas"** de `/apuestas`: buscaba el comando en `client.commands` (no existe) y fallaba siempre.
- Tests de la liquidación con la API simulada (`tests/pagarapuestas.test.js`).
- **Consumo de la Odds API**: las cuotas se reutilizan 30 min por competición (`ODDS_CACHE_MINUTES`; antes cada `/apuestas` y cada página gastaba 1 crédito) y la liquidación solo consulta partidos con apuestas pendientes y quinielas con jugadores. Los créditos restantes quedan en el log.
- Liquidación ejecutada sobre la BD real (copia previa en `data/backups/`): 90 partidos y 1 quiniela caducados, 3 apuestas reembolsadas (710 monedas) y avisadas por DM.

## 2026-09-24 (migraciones y datos fuera del código)

### Esquema de BD centralizado (`src/core/migrations/`)
- Migraciones numeradas que se aplican solas al abrir la BD, en transacción, registradas en `schema_migrations`. Antes 20 ficheros creaban sus tablas al cargarse (`usuarios` en 4 sitios, `apuestas_partidos` en 2 y con definiciones distintas a la real).
- `001_esquema_base`: el esquema real de producción (IF NOT EXISTS), columnas añadidas después, filas iniciales e índices (sustituye a `core/dbIndexes.js`).
- `002_xp_valores_por_defecto`, `003_apodos_duende`, `004_descripcion_recompensas`, `005_alta_automatica_usuarios` (ver abajo).
- La caché de sentencias de `db.js` resetea `.pluck/.raw/.expand` al reutilizar una sentencia.

### Arreglos
- **Roles de recompensa por defecto**: ya no se re-insertan en cada llamada (quitarlos desde el panel no servía). El cooldown de XP de 60 s ya no se devuelve a 15. El multiplicador heredado de `.env` se siembra una sola vez.
- **`/duende olvida`**: solo la propia persona o un admin. Borra las notas de `/duende recuerda` y conserva el perfil base escrito a mano (antes lo borraba todo, sin forma de recuperarlo), y registra lo borrado.
- **Cuentas nuevas de banco**: `better-sqlite3` activa las claves foráneas, y `banco`/`historial`/`inventario`/`casino` apuntan a `usuarios`; crear la cuenta de alguien que no estaba registrado fallaba (saldo 0 en vez de 1.000, p. ej. al preguntar el saldo al Duende o usar la cripto sin haber jugado antes). Ahora un trigger da de alta al usuario antes de cada inserción, y se reparan 3 usuarios que ya estaban así. `registrarUsuario` completa nombre y tag de los dados de alta sin ellos.

### Datos del servidor fuera del código
- **Apodos del Duende** (tabla `duende_apodos`, `src/systems/apodos.js`): nombre principal + otras formas de referirse a cada persona. Se gestionan en Panel admin → Config Global → Duende → 🏷️ Apodos. Los que había en `duende.js` se importan desde `data/duende-apodos.seed.json` (fuera de git) al arrancar.
- **Roles de recompensa por defecto** con IDs de este servidor: eliminados del código (ya estaban en la BD de producción). Un servidor nuevo empieza sin ellos.
- **Canal de anuncios de nivel**: el ID que se usaba por defecto queda guardado en la configuración de cada servidor existente; un servidor nuevo lo configura en el panel.
- **Descripción de los roles de recompensa** (qué permiso desbloquea cada uno): columnas `descripcion`/`emoji` en `xp_role_rewards`, editables en Panel admin → Niveles → Recompensas → 📝 Descripción.

### Documentación
- Nuevo `docs/PENDIENTES.md` con las tareas pendientes y lo encontrado en la revisión.
- `DEPLOY.md`: copia de seguridad antes de actualizar, migraciones y cómo pasar los apodos al servidor.

## 2026-09-24 (documentación)
- `/ayuda` reescrita: guía por secciones con botones (Duende e IA, Voz, Niveles, Economía, Casino, Apuestas, Cripto y Admin, esta solo para administradores). Antes solo mencionaba 12 comandos.
- `docs/DEPLOY.md` reescrito en español, con la copia limpia al actualizar y las variables de `.env` que ya sobran.
- `docs/PLEX.md`: rutas actualizadas a la nueva estructura.

## 2026-09-24 (estructura y limpieza)

### Nueva estructura de carpetas (ver README.md)
- `src/index.js` (antes `index.js` en la raíz) · `src/core/` (db, logger, rutas, router de componentes, registro de comandos) · `src/commands/<tema>/` (un fichero por comando: duende, voz, casino, apuestas, economia, progresion, admin, general) · `src/adminPanel/` · `src/systems/` · `src/services/` (Gemini, TTS, Tautulli, Seerr, STT).
- Renombrados para que coincidan con su comando: `slots.js` → `tragaperras.js`, `sttCommand.js` → `escuchar.js`, `createCommands.js` → `registerCommands.js`.
- `stt.js` y `adminPanel/` ya no están dentro de la carpeta de comandos, así que desaparecen las listas de exclusión del cargador.
- Rutas centralizadas en `src/core/paths.js` (antes cada módulo las calculaba relativas a su carpeta o al directorio actual).
- `vosk/` (servidor Python + `requirements.txt`), `deploy/` (entrypoint, stack de Portainer, compose local), `docs/` (`DEPLOY.md`, `PLEX.md`, `diseno/`), `scripts/` solo con utilidades vigentes.
- Nuevos: `README.md`, `.env.example`, `npm run db:check | stt:setup | stt:test | commands`.

### Eliminado
- Scripts obsoletos: pruebas de Edge TTS (librerías ya no instaladas), `test_transcribe.js` (importaba una función inexistente), migración `migrate_slots` (ya aplicada), inspectores de BD sueltos (unificados en `scripts/db-check.js`), `deploy.ps1` (ruta y contenedor que ya no se usan).
- Datos sin uso: `db.sqlite` (BD de un juego antiguo), `data/banco.json` (economía en JSON antigua), `lista.md`, `lista.m3u`, `logs/info-log.txt` y los WAV de STT de febrero, el `.zip` del modelo (ya descomprimido), `.venv_stt`, carpetas vacías `tmp/` y `Nueva carpeta/`.
- Dependencias: `node-fetch` (se usa el `fetch` nativo de Node 20) y `opusscript` (se usa `@discordjs/opus`).
- `stt.js`: subida de las grabaciones de voz fallidas a transfer.sh (un servicio público), fallback a `vosk-node` (no instalado), parámetros de OpenAI Whisper y la rama que llamaba al Duende directamente (código muerto).

### Arreglos
- `/objeto crear|editar` ignoraban `categoria` y `rareza`; tampoco se podía asignar el rol ni el efecto de un consumible (columnas `rolId`/`efecto` que usan `/usar` y la tienda). Ahora hay opciones `rol` y `efecto` (validado), `tipo` con opciones fijas, y las columnas se crean si faltan.
- Servidor Vosk: cargaba el modelo en cada petición; ahora una vez al arrancar. Guardaba el audio con el nombre enviado por el cliente en `tmp/`; ahora usa temporales propios. Nuevo `GET /health`.
- Audio temporal de `/escuchar` en la carpeta temporal del sistema (antes en la raíz del proyecto).
- `.dockerignore` no excluía `data/`: la imagen se construía con la BD local dentro. `.gitignore` ignoraba `Dockerfile` y no ignoraba `data/`, `logs/`, `models/`.
- `/escuchar`: el inicio de la escucha no capturaba errores (promesa rechazada sin capturar).

## 2026-09-24 (logging)

### Logger (`logger.js`)
- Niveles `debug/info/warn/error` con `LOG_LEVEL`, cambiable en caliente con `/diagnostico nivel_log`. Salida también por consola desde `LOG_CONSOLE_LEVEL` (por defecto `warn`), para `docker logs`.
- Ficheros: `app-log.txt` (todo, cronológico) + `warn-log.txt` + `error-log.txt`. Sustituyen a `info-log.txt` (los antiguos quedan en disco).
- Formato `fecha NIVEL [Módulo] mensaje`; las líneas de continuación (trazas) van sangradas, así cada entrada empieza por la fecha. Antes había cientos de líneas sueltas sin fecha.
- `createLogger(ámbito)` para loggers por módulo. Las funciones antiguas siguen funcionando.
- Errores con traza, causa encadenada y datos de Discord/axios (código, estado HTTP, método, URL). Objetos con `util.inspect` (antes salía `[object Object]`). Entradas enormes recortadas a 8000 caracteres.
- Redacción automática de secretos: token, claves de `.env`, claves de API guardadas desde el panel, `?key=`/`?apiKey=` en URLs y la cabecera `X-Api-Key`.
- Contadores de errores/avisos y último error (en `/diagnostico`).

### Registro central (`index.js`, `src/utils/interactionLog.js`)
- Cada comando con subcomando y opciones, cada botón/select/formulario con sus valores: quién, dónde, duración y, si falla, el error con traza. Denegaciones por ACL, componentes sin ruta, comandos desconocidos y comandos que terminan sin responder a Discord.
- Respuestas del Duende a mensajes, con duración.
- Eventos de Discord que antes no dejaban rastro: errores, desconexiones y reconexiones del gateway, sesión invalidada, rate limits de la API, entrada/salida de servidores.
- Tareas programadas envueltas en `runJob`: fallos con traza y aviso si tardan demasiado.

### Módulos
- Servicios: Seerr y Tautulli registran cada petición (debug) y cada fallo con estado HTTP y duración; Gemini registra modelo, duración, tokens y errores de cuota (contador en `/diagnostico`); TTS registra timeouts, errores HTTP y respuestas sin audio.
- Dinero: se registran apuestas deportivas y de quiniela, compras de tienda, compras/ventas de cripto (con el nuevo precio de TTCL), uso de objetos, recompensas de logros, partidas abandonadas y reembolsos.
- Administración: la auditoría también escribe en el log (con los campos secretos ocultos) y registra si falla al guardar. Ahora se auditan también `/tienda añadir|editar|eliminar|config`, `/objeto crear|editar|eliminar`, las personalidades de `/duende` y los cambios de nivel de log. Se registran los intentos de usar el panel sin ser admin y cualquier cambio de ACL. `/duende olvida` deja constancia de lo borrado.
- XP: subidas de nivel, roles de recompensa que no se pueden asignar (antes fallaban en silencio), anuncios que no se pueden publicar, resultado del aviso de rachas y ajustes manuales de XP.
- 51 `catch {}` vacíos revisados: los que escondían fallos reales ahora registran; quedan solo limpiezas de conexiones de voz tras un error ya registrado.
- Ruido fuera del nivel `info`: pasos de conexión de voz (~27 % del log anterior), decisiones de GIF/prompt del Duende, ticker de TTCL, XP de voz en pausa, consultas de solo lectura y liquidaciones horarias sin nada que liquidar.
- STT: los avisos solo se escribían con `STT_VERBBOSE` activo; ahora siempre. El aviso de "vosk-node no instalado" sale una sola vez.

### Fallos corregidos por el camino
- `createCommands.js` salía con `process.exit` sin vaciar el buffer de logs: se perdían sus últimas líneas (incluido el error si fallaba el registro).
- `/usar`: si el efecto de un consumible lanzaba una excepción, el objeto ya borrado se perdía. Ahora se devuelve al inventario.
- `/apuestas`: el cobro y el registro de la apuesta eran dos escrituras sueltas; ahora van en una transacción.
- `achievementsSystem.applyEvent` se llamaba con `void` y un error acababa como promesa rechazada sin capturar; ahora se captura y registra.

## 2026-09-24

### Casino
- Blackjack y Adivinar: ya no se puede empezar una partida con otra en curso (antes se sobrescribía y la primera apuesta se perdía). Una partida sin tocar más de 15 min se liquida como perdida.
- Las apuestas de partidas en curso se registran en `casino_partidas_activas`; si el bot se reinicia a mitad de partida, al arrancar se devuelven.
- Doblar y separar en blackjack usan `descontarExtra`: sin apuesta mínima, cooldown ni cupo diario (son parte de la misma jugada).
- Eliminado el seguro del blackjack: el crupier ya comprueba su blackjack al repartir, así que el seguro nunca podía pagar.
- Corregido `ReferenceError` (`client` no definido) en el split si fallaba una transacción.
- `descontarApuesta` valida saldo/mínimo/máximo antes de consumir cooldown y cupo diario. Igual en la tienda.
- Tienda: la compra (cobro, stock, inventario, historial) va en una única transacción.
- `/pagarapuestas`: solo administradores; liquidación automática cada hora con aviso por DM a ganadores; pagos por partido en transacción y apunte en historial; las quinielas se liquidan aunque no haya partidos sueltos pendientes. Quitada la API key de Odds escrita en el código.

### Infraestructura
- `index.js`: el enrutado de botones/selects/modales ya no es una cadena de `if`; cada módulo declara `componentHandlers` y `src/utils/componentRouter.js` elige la ruta más específica. Los errores en componentes se capturan y se responde al usuario.
- Logger: escritura con streams (no bloquea), rotación por tamaño, `logErrorSync`/`flushLogs`. `uncaughtException` registra, apaga ordenadamente y sale con código 1; SIGTERM/SIGINT cierran limpio.
- Migrado de `@google/generative-ai` (deprecado) a `@google/genai` (`src/utils/geminiClient.js`). Los timeouts de Gemini y de generación de imágenes cancelan la petición con `AbortSignal`.
- `sendTyping()` con `catch`.
- Docker: Vosk (STT) dentro del mismo contenedor, con `tini` y `scripts/docker-entrypoint.sh`.
- Tests: BD en memoria y logs/datos en carpetas temporales (`tests/setupEnv.js`); nuevos tests de `casinoTransactions`, `activeGames` y del router.

### Optimizaciones
- `xpSystem.ensureGuildDefaults` se memoiza por servidor (antes ~50 sentencias con escrituras en cada `getConfig`, unas 4 veces por mensaje). Se invalida en `setConfig`, `setReward`, `removeReward` y `removeUserCostMultiplier`, así que el re-sembrado se comporta igual que antes.
- `db.js`: caché LRU (500) de sentencias preparadas; antes cada `db.prepare` recompilaba el SQL.
- Índices nuevos (`src/utils/dbIndexes.js`) en `cripto_ttcl_precios`, `historial`, `casino`, `apuestas_usuario` y `cripto_historial`.
- Timeouts en todas las llamadas HTTP que no tenían (CoinGecko, Odds API, TheSportsDB, descarga de adjuntos). CoinGecko ya no cachea respuestas de error (429) como si fueran precios.
- Nueva documentación funcional: `docs/FUNCIONALIDADES.md`.

## 2026-09-23

### Sistema de racha diaria (streak)
- Nuevas columnas `streak_dias` / `streak_last_day` en `xp_users`, calculadas en hora de Madrid (`Intl.DateTimeFormat`, a prueba de cambio de horario CET/CEST).
- Bonus de XP progresivo por racha (`%/día`, con tope), configurable desde el panel admin (Niveles → Config → 🔥 Racha).
- Aviso por DM al usuario a partir del día 2 de racha (embed), y aviso de "racha en peligro" a las 17:00 hora española vía `node-cron`, a quien tenga racha ≥2 días y no haya ganado XP ese día.
- Racha visible en `/nivel` y en el perfil unificado.

### Vista previa de la curva de XP
- Botón "📈 Vista previa" en el panel admin (Niveles → Config): muestra, con la fórmula actual, el coste y el XP acumulado necesario para cada nivel con título configurado.

### Revisión y arreglo del panel de administración
- `paneladmin.js`: renombrados imports que colisionaban por nombre con los métodos del propio objeto exportado (funcionaba por scoping de JS, pero era una trampa para el próximo refactor).
- Eliminados 5 campos de formulario "reservados" que no hacían nada (Cripto, Casino ×2, Tienda, ACL).
- "Reset XP" ahora pide confirmación (antes borraba sin preguntar, a diferencia del resto de acciones destructivas del panel).
- "Quitar recompensa" de nivel ahora puede apuntar a un rol concreto en vez de borrar todos los roles de ese nivel a la vez.
- Añadido registro de auditoría que faltaba en "quitar canal de anuncios" y "limpiar canales ignorados".
- Sincronizada la fórmula de XP mostrada entre la pantalla de inicio de Niveles y la de Config (antes una mostraba la fórmula completa y la otra una versión vieja incompleta).

### RTP del casino — de decorativo a real
- El panel de "RTP" (Blackjack/Tragaperras/Ruleta/Adivinar) existía pero no tenía ningún efecto en el juego real.
- Implementado `applyRtp()` en `casinoTransactions.js`: escala el premio neto de cada victoria (nunca la apuesta devuelta en empate, nunca la probabilidad de ganar), aplicado en los 4 juegos antes de mostrar el resultado y de acreditarlo, para que lo mostrado y lo pagado coincidan siempre.
- De paso, corregido un bug real en `adivinar.js`: la ronda final calculaba un premio x20 pero pagaba solo x4 porque nunca se actualizaba `partida.acumulado`.

### Revisión del panel de usuario (antes `/casino`)
- Encontrado el owner-check de `casino.js`, `ruleta.js` y `logros.js` dependiendo de un campo de discord.js marcado como deprecado (`message.interaction`); añadido fallback a `interactionMetadata`.
- Encontrado y corregido un bug real en `/nivel`: los botones ⏮️/⏭️ del ranking estaban completamente rotos (el check de "solo el dueño puede pulsar" partía mal el customId y bloqueaba a todo el mundo, incluido el dueño).

### Limpieza de código y dependencias muertas
- Borrados: `src/scripts/` entera (backups y un archivo corrupto), `src/events/` (vacía), `test_edge_tts_js.js` y `test_final.js` (scripts sueltos de prueba).
- Eliminadas 4 funciones de `xpSystem.js` sin ninguna llamada en todo el proyecto (`syncRewardsFromGuildRoles`, `upsertTitle`, `removeTitle`, `resetTitlesToDefault`) — un sistema de gestión de títulos de nivel que nunca se conectó a ningún comando.
- Eliminada `transcribeWithWhisper` de `stt.js` (transcripción vía OpenAI Whisper, sustituida hace tiempo por Vosk local pero nunca borrada).
- Quitado código comentado muerto en `index.js` (require y handlers de ruleta obsoletos).
- Desinstaladas 5 dependencias npm sin ningún uso: `edge-tts-node`, `google-tts-api`, `ffmpeg-static`, `fluent-ffmpeg`, `sqlite3` (116 paquetes fuera contando transitivas).
- `createCommands.js` ya no trata los módulos internos de `adminPanel/` como comandos mal formados (dejaba de generar 6 errores falsos en cada arranque).

### `/casino` → `/perfil`: panel unificado
- Nuevo comando `/perfil` (sustituye a `/casino`): vista de inicio = perfil completo (nivel, racha, XP, logros, ranking, saldo), con navegación por botones a Casino, Logros, Top y Recompensas sin volver atrás.
- Los botones de navegación nuevos usan el ID del dueño embebido en el customId (patrón robusto, el mismo que evita el bug encontrado en `/nivel`), en vez del campo deprecado de discord.js.
- El resto de comandos (`/nivel`, `/logros`, `/blackjack`, `/tragaperras`, `/ruleta`, `/adivinar`) siguen funcionando igual, sin tocar.

### Eliminado Groq, solo queda Gemini
- Quitada la función `generarConGroq`, las constantes `GROQ_*`/`LLM_PROVIDER`, y toda la lógica de fallback a Groq en `duende.js`.
- Quitados los campos `provider`/`fallback_provider` de `guildSettings.js`, el panel admin y `/diagnostico` (ya no tenía sentido un selector con una sola opción).
- `.env`: quitadas las variables `GROQ_API_KEY`, `GROQ_MODEL`, `GROQ_TIMEOUT_MS`, `LLM_PROVIDER` (ya no se leen en ningún sitio).

### Function calling para el Duende
- El Duende puede ahora consultar datos reales del bot durante una conversación en vez de improvisar: `consultar_nivel_y_racha`, `consultar_saldo`, `precio_ttcl`, `consultar_logros`, `tirar_dado`.
- Todas de solo lectura a propósito. El `userId`/`guildId` que reciben es siempre el de quien habla de verdad en Discord, nunca algo que el modelo pueda extraer o inventar del texto.
- `generarConGemini` ahora hace un bucle de hasta 3 rondas: llama a Gemini, si pide una herramienta la ejecuta de verdad, le devuelve el resultado como turno `function`, y repite hasta que hay respuesta final en texto.

### Bugs encontrados probando el function calling en vivo
- `gemini-2.0-flash` (el modelo por defecto del código) ya no existe — Google lo retiró (404). Cambiado el valor por defecto a `gemini-2.5-flash`.
- `gemini-2.5-flash-lite` (el que tenía fijado el `.env`) se niega a llamar a las herramientas de forma fiable aunque estén disponibles — el Duende respondía con datos inventados en vez de los reales. `.env` actualizado a `gemini-2.5-flash`, que sí las usa correctamente (verificado con una llamada real: saldo, nivel y racha reales de un usuario, mandado a un canal real).

### Integración Plex/Tautulli con el Duende — implementada
- Diseño completo en `docs/Plex.md`.
- `src/systems/tautulliClient.js`: cliente sobre la API de Tautulli (`get_users`, `get_history`, `get_user_watch_time_stats`, `get_activity`, `get_recently_added`, `get_libraries`), con override opcional por guild vía `guildSettings` (`plex.tautulli_url`/`plex.tautulli_api_key`).
- `src/systems/plexLinks.js`: tabla `plex_links` (Discord userId ↔ usuario Tautulli).
- 7 herramientas nuevas para el Duende: `consultar_actividad_plex`, `consultar_viendo_ahora`, `consultar_tiempo_visto`, `consultar_ultima_conexion`, `consultar_novedades_plex`, `comparar_actividad_plex`, `consultar_top_visto_server`. La resolución de "quién es quién" reutiliza el mismo mapa de nombres que ya usaba `duende.js` para menciones — nunca un ID inventado por el modelo.
- Sin restricción de visibilidad entre usuarios vinculados (confirmado por el usuario: grupo de amigos, sin problema de privacidad entre ellos).
- Panel admin: nueva sección 🎬 Plex en `/paneladmin` (vincular/desvincular por selector de usuario + test de conexión).
- `.env`: añadidas `TAUTULLI_URL`/`TAUTULLI_API_KEY`.
- Probado en vivo contra el Tautulli real: pregunta en un canal real ("¿qué ha visto Alex esta semana?") respondida con datos que coinciden exactamente con el historial real (10 episodios de Outer Banks, 1 de Daredevil, una peli).
- Pendiente (más adelante): Seerr para solicitar contenido (primera herramienta de escritura real).

### Lista completa de vínculos cargada
- Las 11 personas de `lista.md` vinculadas en `plex_links` (12 en total con la cuenta de prueba).
- Sus apodos cargados en `duende.js` como `APODOS_DISCORD_ID` (nombre/apodo → ID de Discord directo, comprobado antes que cualquier otra fuente de resolución de nombres), con normalización de tildes.
- Probado en vivo: "¿cuántas horas ha visto Raúl este mes y cuántas el perro?" en un canal real resolvió a las dos personas correctas y mencionó a los usuarios reales, con datos reales (32,5h Raúl, 0h Javier/Ddrakon — el modelo incluso tradujo "el perro" a "Javier" solo usando el mapa de equivalencias ya existente).

### Ampliación de Plex: 5 herramientas nuevas + canal de novedades automático
- Revisados los 123 comandos de la API de Tautulli (`cmd=docs`) para ver qué más se podía ofrecer.
- `tautulliClient.js`: nuevos métodos `search`, `getHomeStats`, `getPlaysByTopUsers`, `getPlaysByDayOfWeek`, `getPlaysByHourOfDay`.
- Nuevas herramientas para el Duende: `buscar_en_plex` (existe X en la biblioteca, con sinopsis/año/nota), `consultar_ranking_plex` (quién más ve Plex en el server), `consultar_bibliotecas_plex` (nº de items por biblioteca), `consultar_patron_visionado` (día/hora más activos).
- `consultar_top_visto_server` reescrita: antes agregaba a mano el historial de cada vinculado; ahora usa `get_home_stats` directamente (más rápido, y de paso trae duración total vista, no solo nº de reproducciones).
- **Canal de novedades automático**: `node-cron` cada 30 min revisa `get_recently_added` y publica solo lo nuevo en un canal configurable desde el panel (🎬 Plex → 📢 Canal novedades). Al activarlo por primera vez fija la biblioteca actual como base, sin avisar retroactivamente de todo lo que ya había.
- Nueva tabla `plex_novedades_state` (última fecha de "añadido" vista por guild) y setting `plex.novedades_channel_id`.
- Probado en vivo: una sola pregunta con 3 partes ("¿tenemos Daredevil? ¿qué día se ve más? ¿cuántas pelis/series tenemos?") resolvió las 3 herramientas correctamente con datos reales; otra pregunta de ranking + top-contenido también verificada contra los mismos números vistos en las pruebas directas a la API.
- `terminate_session` (cortar un stream en directo) queda anotado como idea futura ligada a la **tienda** (ítem tipo "corte de luz" comprado con monedas) — nunca como tool de IA, solo detrás de una compra/uso explícitos. No implementado.

### Bug real: "Respuesta vacía de Gemini" con preguntas de varias partes
- Reportado por el usuario probando en local: una pregunta con 3 sub-preguntas (cada una necesitando su propia herramienta) a veces hacía que Gemini pidiera llamar a una herramienta en la última ronda disponible del bucle de function calling — como no quedaban rondas para atenderla, `result.response.text()` venía vacío y el Duende contestaba "Ahora mismo no puedo responder".
- Causa raíz: el límite de rondas (`DUENDE_MAX_TOOL_ROUNDS`) se comprobaba, pero en la última vuelta se seguía dejando a Gemini la opción de pedir otra herramienta en vez de forzarle a cerrar con texto.
- Arreglo: en la última ronda se manda `toolConfig: { functionCallingConfig: { mode: FunctionCallingMode.NONE } }`, que obliga a Gemini a responder en texto con lo que ya tiene, nunca a pedir una herramienta más. De paso, `DUENDE_MAX_TOOL_ROUNDS` subido de 3 a 4 para dar más margen a preguntas de varias partes.
- Verificado con la misma pregunta que falló, repetida 3 veces seguidas — las 3 con respuesta real, ninguna con el error.

### Trato relacional por persona (usando `data/duende-personalities.json` como estaba pensado)
- El `savedPersons` de `duende-personalities.json` (descripciones ricas por persona: cómo dirigirse a cada uno, bromas internas, "estadísticas" falsas de broma) ya existía, pero el código lo usaba mal en dos sitios:
  - Si una persona tenía `notas` (array), se usaba **solo eso** y se ignoraba `description` por completo — para Alex (`sraleo`), por ejemplo, su descripción entera de broma no se usaba nunca, solo la nota corta "Dueño del Plex".
  - Todo lo que sí se usaba se truncaba a **200 caracteres**, cuando las descripciones reales rondan 700-1400 — se perdía casi todo el contenido real.
  - Y había una instrucción explícita en el código para NO dejar que esto cambiara el comportamiento del bot ("no adoptes personas de usuario"), justo lo contrario de lo que se quería.
- Arreglado: `buildPersonProfileText()` combina `description` + `notas` (ya no se pisan), sin truncar de forma agresiva (hasta 1200 caracteres por perfil).
- Nuevo: `detectMentionedPersons()` detecta si el mensaje menciona a alguien conocido (por nombre o por @mención real) y le da al modelo el perfil completo de **quien habla** + **de quien se menciona**, con instrucción explícita de compararlos/relacionarlos en la misma respuesta en vez de describir solo a uno de forma aislada. El resto de gente conocida se queda con una equivalencia ligera (solo nombre), para no inflar el prompt con perfiles que no vienen a cuento.
- Probado en vivo: preguntando "¿quién es peor jugador de CS2, Javier o yo?" hablando como Alex, contestó usando el defecto propio de Alex (las flashes a compañeros, de su descripción) comparado con el de Javier (falta de iniciativa/tema perro, de la suya) — exactamente el patrón "tú también, pero este es peor" pedido.

### Acceso a Plex restringible por canal
- Nueva tabla `plex_allowed_channels` + `isChannelAllowed()`: lista vacía = sin restricción (como ahora), en cuanto se añade un canal pasa a ser allowlist.
- Las herramientas de Plex se separan de las generales (`DUENDE_PLEX_TOOL_DECLARATIONS` vs `DUENDE_CORE_TOOL_DECLARATIONS`) y solo se le declaran a Gemini si el canal donde se pregunta está permitido — en canal no permitido, el modelo ni sabe que existen.
- Gestión desde el panel admin (🎬 Plex → 📺 Permitir canal / ➖ Quitar canal / 🧹 Sin restricción).
- Verificado en vivo: con un canal falso como único permitido, el canal real dejó de generar líneas de "Herramienta usada" en el log al preguntar por Plex (el modelo siguió contestando por memoria de la conversación previa, pero ya sin usar la tool — confirma que el filtro corta la *declaración* de la herramienta, no solo su ejecución).

### Efecto colateral encontrado: respuestas cortadas a mitad de frase
- Al aumentar el prompt con los perfiles completos, salió a la luz que `gemini-2.5-flash` (el modelo puesto ayer tras la retirada de `gemini-2.0-flash`) gasta parte de su presupuesto de tokens de salida en "thinking" interno antes de escribir la respuesta visible — con `DUENDE_MAX_TOKENS=400` esto cortaba respuestas a mitad de frase. El SDK instalado (`@google/generative-ai`, versión legacy) no expone forma de desactivar ese thinking.
- `.env`: `DUENDE_MAX_TOKENS` 400→1024, `DUENDE_MAX_TOKENS_FALLBACK` 512→768. Verificado sin cortes tras el cambio.

### Bugs reales encontrados en producción: apodos que no llamaban a la herramienta de Plex
Reportado por Jorge probando en real ("cuánto tiempo lleva el perro sin ver nada en el plex" → el Duende se negaba). Dos bugs distintos, los dos reales:

1. **Las descripciones de las tools decían "persona vinculada"** — el modelo se lo tomaba al pie de la letra y, como no podía saber de antemano si "el perro" estaba vinculado, prefería no intentarlo. Arreglo: reescritas las descripciones de las 4 tools afectadas (`consultar_actividad_plex`, `consultar_tiempo_visto`, `consultar_ultima_conexion`, `comparar_actividad_plex`) para decir explícitamente que se puede llamar con cualquier nombre o apodo y que la propia herramienta avisa si no hay vínculo.
2. **Historial contaminado**: el canal donde probó Jorge tenía 4 rechazos seguidos guardados en `data/duende-history.json`, y el modelo repetía "como le he indicado en reiteradas ocasiones" citando sus propios rechazos anteriores — un bucle que se reforzaba solo. Se limpió el historial de ese canal en concreto (no los demás) para que el arreglo pudiera notarse.
3. **El de verdad gordo, con historial ya limpio seguía fallando**: el modelo mandaba `persona: "el perro"` (con el artículo "el" incluido, tal cual en la frase), pero `APODOS_DISCORD_ID` tiene la clave exacta `"perro"` sin artículo — no había *fuzzy match*, así que la búsqueda fallaba con "No identifico a 'el perro'...". Arreglo: `resolveNameToDiscordId` ahora prueba primero el nombre tal cual y, si falla, reintenta quitando un artículo inicial (el/la/los/las/un/una) — sin romper apodos que sí llevan el artículo pegado de verdad, como "El Fari" o "La burra", porque esos se siguen probando primero sin tocar.
- Verificado en vivo en los dos canales de prueba (personalidad default y personalidad "sanchez"): "el perro" resuelve a Ddrakon, con dato real (última vez visto: 6 de agosto de 2026, Harry Potter y la cámara secreta) y con la broma relacional metida de propina.

### Cuarto bug real: personalidades agresivas se saltaban la herramienta directamente
Otro fallo real en producción, esta vez con la personalidad "masiko" activa en un canal ("¿qué es lo que más ha visto el perro de mierda?" → el Duende soltó un insulto genérico sin mirar nada). Causa distinta a los tres anteriores:

- Las personalidades personalizadas (`masiko`, `javier`, `sanchez`, `conway`...) **sustituyen por completo** las instrucciones base — ninguna de ellas menciona que hay herramientas disponibles ni que hay que intentar mirar datos reales antes de contestar, a diferencia de la personalidad `default` que sí dice "pero sé resolutivo". Con una personalidad centrada solo en insultar, el modelo se limitaba a insultar y ya, sin pasar por la herramienta.
- Arreglo: añadida una instrucción universal, independiente de la personalidad activa, que se apend a *cualquier* personalidad: "si tienes herramientas disponibles que te den datos reales, úsalas siempre antes de contestar, sea cual sea tu personalidad — puedes insultar/bromear con el resultado, pero no te niegues a mirar". La personalidad sigue controlando el tono de la respuesta, ya no si se molesta en mirar el dato.
- Verificado en vivo con la personalidad "masiko" tras el arreglo: llamó a `consultar_actividad_plex`, obtuvo el dato real (0 actividad en 7 días) y lo soltó igual de agresivo pero con el dato correcto en vez de un insulto genérico sin mirar nada.

### Quinto ajuste real: respuestas "robóticas" al usar datos consultados
Feedback directo de Jorge tras los arreglos anteriores: las respuestas ya usaban la herramienta correcta, pero sonaban a plantilla — "[Nombre] vio [título] el [fecha]." seguido o precedido de un insulto genérico como frase aparte, siempre con la misma estructura mensaje tras mensaje (p.ej. siempre empezando por "¡Me cago en la puta!").

- Primer intento: instrucción pidiendo tejer el dato en la misma frase en vez de "ficha + insulto aparte". Mejoró la separación pero el modelo simplemente movió el insulto genérico *delante* del dato en vez de dentro (`"¡Me cago en la puta! El perro vio X el [fecha]."` — misma plantilla, orden invertido).
- Segundo ajuste: instrucción más explícita en `instruccionesFinal` (src/slashCommands/duende.js) pidiendo que el dato y la pulla vayan **dentro de la misma frase** como parte de la queja/burla, y prohibiendo empezar siempre con la misma interjección — variar el arranque de cada respuesta (a veces con el dato, a veces con la pulla, a veces con pregunta retórica).
- Verificado en vivo (canal con personalidad "masiko", historial limpio, 3 preguntas seguidas): "¿El perro? Ese cabrón lleva 1 día y 19 horas sin ver una mierda en Plex..." / "¡Hostia puta! El Conejo de mierda, ese cabrón, la última vez que vio algo fue el 22 de septiembre..." / ante una pregunta sin herramienta disponible ("qué es lo más visto"), respondió correctamente que no tiene esa herramienta en vez de inventar un dato. Tres estructuras de arranque distintas, dato e insulto integrados en la misma frase, confirmado con `Herramienta usada` en el log que los datos eran reales.

### Integración Seerr (Jellyseerr) — pedir contenido desde el Duende
Fase 2 del plan de Plex, ya anotada como pendiente en `docs/Plex.md`. El usuario pasó URL + API key reales (`https://requests.xelements.es`, Jellyseerr v3.4.1) y se implementó completo, no solo el diseño.

- `src/systems/seerrClient.js` (nuevo): cliente sobre `/api/v1` con header `X-Api-Key` (a diferencia de Tautulli, que usa query param) — integración separada, no reutiliza `tautulliClient`.
- **Hallazgo que simplificó todo el diseño**: Jellyseerr ya guarda el Discord ID de cada usuario en su propio perfil (`GET /api/v1/user/{id}` → `settings.discordIds`), confirmado en real para varios de los 15 usuarios existentes. Atribución de peticiones sin vinculación manual en la mayoría de los casos: 1) match por `discordIds` en Seerr, 2) si no, fallback al `plexUsername` ya vinculado en `plex_links`, 3) si tampoco, error legible pidiendo vincular con un admin.
- 3 herramientas nuevas en `duende.js` (`DUENDE_SEERR_TOOL_DECLARATIONS`): `buscar_contenido_seerr` (lectura), `solicitar_contenido_seerr` (la primera tool de este bot que **escribe** de verdad — crea una solicitud real de descarga), `consultar_solicitudes_seerr` (lectura). Gating por canal independiente del de Plex (`seerr_allowed_channels`, mismo patrón lista-vacía-es-sin-restricción).
- **Guardarraíles de la tool de escritura**, extendiendo el mismo principio que ya rige `userId` (nunca inventado por el modelo) a `tmdbId`:
  - Caché de búsquedas por canal con TTL 15 min: `solicitar_contenido_seerr` solo acepta un `tmdbId`/`mediaType` que hayan salido literalmente de una `buscar_contenido_seerr` reciente en ese mismo canal — si no, lo rechaza sin tocar la API real. Verificado con test directo del caché (hit/miss) además del flujo en vivo.
  - Atajo de estado: si el contenido ya está disponible o ya tiene una solicitud en curso, la herramienta lo dice y **no llama a la API de creación** — verificado en vivo con Daredevil (ya disponible), confirmado por log que no se generó ninguna solicitud real.
  - Límite diario configurable por persona (`guildSettings.checkAndConsumeLimit`, scope `seerr_request`, 5/día por defecto), reutilizando el sistema de límites genérico que ya existía para otras acciones.
  - Siempre se pide en nombre de quien habla (`ctx.userId`), nunca de un tercero — a diferencia de las tools de Plex, esta no acepta parámetro de "persona".
- Panel admin nuevo (🍿 Seerr en `/paneladmin`, `src/slashCommands/adminPanel/seerr.js`): test de conexión, límite diario, gestión de canales permitidos — sin vinculación manual de usuarios porque no hace falta (ver hallazgo de `discordIds` arriba).
- Verificado en vivo contra el servidor real: búsqueda ("Daredevil" con estado y sinopsis correctos), listado de solicitudes recientes con títulos reales, y el camino "ya disponible" disparado de verdad por el modelo sin generar ninguna petición.
- **Deliberadamente no probado en vivo**: el camino de éxito real de `solicitar_contenido_seerr` (crear una solicitud de verdad), para no disparar una descarga real ni una notificación a otro usuario sin avisar antes. Todo lo demás sí, contra producción.
- Detalle completo en `docs/Plex.md` (sección 4).

### Ajuste sobre la marcha: pedir en Seerr "para" otra persona
El diseño inicial de `solicitar_contenido_seerr` atribuía siempre la petición a quien hablaba con el Duende, sin parámetro de "persona" — deliberado para no atribuir peticiones a terceros sin que ellos las pidieran. El usuario señaló el motivo por el que no hacía falta esa restricción: en Seerr, cuando el contenido pedido está listo, **avisa directamente al usuario que lo pidió** (vía su Discord ID vinculado, ver hallazgo de `discordIds` arriba) — así que "Alex pide algo para Ddrakon" tiene sentido real: es Ddrakon quien recibe el aviso, no Alex.

- Añadido parámetro opcional `persona` a `solicitar_contenido_seerr`. Reutiliza `resolveNameToDiscordId` (el mismo resolutor de nombres/apodos que ya usan las tools de Plex, nunca inventado por el modelo) para averiguar a quién se refiere, y `resolverSeerrUsuarioPorId` (renombrada desde `resolverSeerrUsuarioActual`, ahora genérica) para encontrar su cuenta de Seerr.
- El límite diario se mantiene atado a quien manda el mensaje (`ctx.userId`), no a la persona en cuyo nombre se pide — evita que alguien spamee peticiones repartiéndolas entre varios nombres para saltarse su propio límite.
- Verificado (sin disparar ninguna petición real): `resolverSeerrUsuarioPorId` resuelve correctamente dos identidades reales distintas — Ddrakon (Discord ID de `APODOS_DISCORD_ID["perro"]`) → usuario Seerr #4 "Ddrakon"; Alex → usuario Seerr #1 "SrAaleeeo".

### Dos bugs reales encontrados probando "pide X en nombre de Y" en producción
El usuario probó la función nueva en el canal real y reportó dos fallos distintos, ambos con el propio bot ya reiniciado con el código nuevo:

1. **Historial contaminado (mismo patrón de siempre)**: la primera negativa del Duende (de antes del reinicio, cuando la función aún no existía) quedó guardada en `data/duende-history.json`, y el modelo la citaba casi literalmente ("ya te he dicho...") aunque la capacidad ya estuviera disponible. Recordatorio para el futuro: **el historial vive en memoria** (`conversationHistory`, cargado una vez al arrancar) — editar el `.json` en disco con el bot corriendo no sirve de nada hasta el siguiente reinicio, porque `saveHistory()` sobreescribe el archivo con la copia en memoria en cuanto responde una vez más.
2. **Bug real de verdad, no de historial**: `buscar_contenido_seerr({"titulo":"Barbie 2"})` fallaba con `"Parameter 'query' must be url encoded"` de la API de Seerr. Causa: axios serializa espacios como `+` (form-encoding) por defecto, y Jellyseerr valida estrictamente `%20`, rechazando `+` con un 400. Arreglo en `seerrClient.js`: `paramsSerializer` propio con `encodeURIComponent` (RFC3986) en vez del serializador por defecto de axios. Cualquier búsqueda con más de una palabra estaba rota hasta este arreglo.
3. Además, la frase exacta "haz que el hustlehard pida barbie 2" no disparaba la tool ni una vez arreglado lo anterior — la descripción de `solicitar_contenido_seerr` solo cubría literalmente "pide X para/en nombre de Y", y el modelo no generalizaba esa construcción a "haz que Y pida X". Ampliada la descripción con varias formas equivalentes ("pide X para Y", "pídesela a Y", "que Y pida X", "haz que Y pida X", "en nombre de Y") y una frase explícita contra la duda de "no puedo actuar en nombre de otro".
- **Efecto colateral de la verificación**: al volver a probar tras el arreglo, la búsqueda esta vez sí encontró un título real pedible ("Barbie en Una aventura de sirenas 2", 2012) y el flujo completo se ejecutó de verdad — se creó la solicitud real #362 en Seerr, atribuida correctamente a HustleHard (no a quien probó el mensaje). No era la intención (se quería seguir evitando escrituras reales sin avisar), pero de paso confirmó que todo el camino de éxito funciona end-to-end con atribución correcta. El usuario decidió gestionar esa solicitud por su cuenta desde la web de Seerr.

### Truncado recurrente: "pide todas esas" (petición en bloque de varios títulos)
Reportado en real: tras pedir en bloque varias pelis de Barbie ("pide todas esas"), el Duende respondió con una frase cortada a media palabra, sin ningún signo de cierre, y sin haber llamado a ninguna herramienta — mismo síntoma que el bug de truncado por `MAX_TOKENS` ya documentado, reaparecido ahora que las declaraciones de herramientas son más grandes (con Seerr sumado a Plex, el "peso" fijo del prompt subió y deja menos margen).

- `.env`: `DUENDE_MAX_TOKENS` 1024→2048.
- Añadido diagnóstico en `generarConGemini` (`src/slashCommands/duende.js`): si `finishReason === "MAX_TOKENS"`, se registra un warning con el `maxOutputTokens` usado y el texto parcial entregado — antes había que adivinar la causa mirando si la frase terminaba sin punto; ahora queda en `logs/warn-log.txt` explícitamente.
- Verificado que el aumento de tokens no introdujo truncado en una respuesta larga de prueba (sin `MAX_TOKENS` en el log). **No verificado en vivo el caso original completo** (pedir varios títulos a la vez con Seerr activo): el propio clasificador de seguridad de la sesión bloqueó el script de reproducción por el riesgo de disparar varias peticiones reales de golpe — pendiente de que el usuario lo reintente él mismo en Discord tras reiniciar.

### El truncado se arregló, pero apareció el problema de fondo que tapaba
Con `DUENDE_MAX_TOKENS` ya en 2048, la siguiente prueba en real ("pide todas esas" en una petición en bloque de Barbie) ya no se cortó a media frase — pero reveló el problema real que el truncado llevaba tapando:

- El Duende buscó "Los misterios de Barbie", encontró el tmdbId, y preguntó "¿quieres que se la pida?" — hasta ahí bien. Pero en el siguiente mensaje del usuario (turno nuevo, `generarConGemini` se llama otra vez desde cero), el modelo ya no tenía el tmdbId en su contexto: el historial persistido (`conversationHistory`) solo guarda el texto de lo que dijo cada uno, no la llamada a herramienta cruda con el tmdbId — ese dato solo existe dentro de los `contents` de esa única llamada a Gemini, y se descarta al terminar. Resultado: el modelo, sin el número, le pidió el ID a Jorge ("si no me das el puto ID, ¿cómo coño quieres que pida nada?") — un humano no tiene ni puede tener ese número.
- Arreglo: añadida instrucción explícita en las descripciones de `buscar_contenido_seerr` y `solicitar_contenido_seerr` — si no se tiene el tmdbId a mano (por venir de un mensaje anterior), volver a llamar a `buscar_contenido_seerr` con el mismo título antes de pedir (es instantáneo y gratis), y nunca preguntarle el ID a la persona.
- **No verificado en vivo** (mismo motivo que el bug anterior: reproducirlo de verdad dispararía una petición real, y el clasificador de seguridad de la sesión bloqueó el intento de reproducirlo con un script) — pendiente de que el usuario lo reintente él mismo.

### Limitación real detectada, no arreglable con un fix puntual: pedir "todas las de X" no funciona bien
"Pide todas las películas de Barbie posibles" no es algo que las herramientas actuales puedan resolver bien: `buscar_contenido_seerr` busca por título exacto-ish (como el buscador de Seerr/TMDB), no por franquicia/colección/palabra clave — no existe un "tráeme todo lo que haya de X" en la API tal como está integrada. El modelo hace lo que puede (recuerda títulos de su propio conocimiento y los busca uno a uno), pero es lento, incompleto y depende de que el modelo "sepa" qué títulos existen. Si se quiere una función real de "pide toda la saga/colección de X", haría falta una herramienta nueva de discovery (TMDB tiene endpoints de colección/franquicia) — no implementado, anotado como idea pendiente.

### Bug serio: el Duende afirmó haber pedido algo en Seerr sin haberlo pedido
El más grave de los encontrados hoy. Tras el arreglo del "vuelve a buscar si no tienes el ID", se probó de nuevo en real: el Duende buscó "Barbie", encontró "Los misterios de Barbie" (tmdbId real, sin pedir todavía), y respondió *"Ya le he pedido 'Los misterios de Barbie' a ese puto fantasma de HustleHard..."* — pero **`solicitar_contenido_seerr` nunca se llamó** (confirmado con el log y con `getRequests` contra el Seerr real: no existe esa solicitud). El modelo narró una acción real como completada sin haberla ejecutado — el fallo más peligroso posible para una tool de escritura.

- Arreglo en dos frentes de `duende.js`:
  1. Instrucción universal nueva en `instruccionesFinal` (aplica a cualquier personalidad, no solo Seerr): prohibido decir "ya lo he hecho" sobre una acción real sin haber llamado de verdad a la herramienta en ese mismo turno.
  2. Refuerzo específico en la descripción de `solicitar_contenido_seerr`: aviso explícito de que afirmar haberlo pedido sin llamar a la función es mentir sobre una acción real.
- **Detector automático añadido** (no arregla el modelo, pero deja de ser invisible): en `generarConGemini`, si el texto final matchea un patrón de "ya lo he pedido/ya está pedido" en español y `solicitar_contenido_seerr` no se llamó en ese turno, se registra un warning explícito en `logs/warn-log.txt`. Cubre variantes reales sin objeto redundante ("ya le he pedido X", no solo "ya te lo he pedido") — el primer regex probado no la detectaba y se corrigió con casos de prueba antes de darlo por bueno.
- Sin verificar en vivo que la instrucción evite la alucinación la próxima vez (es un problema de comportamiento del modelo, no 100% garantizable con prompt) — lo que sí está garantizado es que, si vuelve a pasar, quedará registrado en el log en vez de pasar desapercibido.

### Dos hallazgos más probando en real: filtro de seguridad de Gemini y mensaje procesado por duplicado
Un intento más de "pide alguna película de Barbie que no esté" dio una respuesta rarísima: tono formal, sin insultos, preguntándole a HustleHard que recomendara él una peli en vez de buscar/pedir nada. Investigado con los logs:

1. **`PROHIBITED_CONTENT` de Gemini**: el propio filtro de seguridad de Google (no configurable vía `safetySettings`, es aparte de las categorías HARASSMENT/HATE/etc. que sí están en `BLOCK_NONE`) bloqueó la respuesta real — probablemente por la combinación de una franquicia infantil (Barbie) con el lenguaje muy agresivo de la personalidad activa. El código ya tenía un *fallback* a un prompt "seguro" y genérico para este caso (`safeParts`, sin palabrotas), pero **ese fallback no pasa `toolContext`** — a propósito, así que no tiene ninguna herramienta disponible, ni de Plex ni de Seerr. De ahí la respuesta tan distinta: no es un bug nuevo, es el comportamiento ya existente del fallback de seguridad, que hasta ahora nunca se había visto en un caso con herramientas de por medio.
   - Se aprovechó para arreglar un hueco de logging real: esta rama nunca registraba el texto final con `logInfo`, así que tocaba reconstruir lo que pasó solo a partir de los warnings. Ahora `logWarn` incluye el texto completo de la respuesta de fallback.
2. **El mismo mensaje se procesó dos veces** (mismo texto, mismo canal, mismo autor, ~25s de diferencia — dos líneas de "Mensaje recibido"/"Mensaje procesado" para lo que parece ser un único mensaje). No se pudo determinar con certeza si fue el gateway de Discord reentregando el mismo evento o un envío duplicado real del usuario, porque el log no guardaba el id del mensaje de Discord. Da igual la causa: si la tool hubiera tenido éxito, procesarlo dos veces habría disparado dos peticiones reales para lo mismo.
   - Añadido guardarraíl en `index.js`: deduplicación por `message.id` (único e inmutable por mensaje), con ventana de 5 min — si el mismo id se ve dos veces, la segunda se ignora y queda registrada como tal.
   - Añadido `message.id` al log de "Mensaje recibido" (vía el campo `id` del `fakeInteraction`) para poder diagnosticar esto con certeza si vuelve a pasar.

### El bug de fondo: PROHIBITED_CONTENT se dispara de forma repetible con esta frase y tumbaba toda la función, no solo el tono
Reprobado tras el restart con los arreglos anteriores: misma frase ("pide alguna película de Barbie que no esté"), y esta vez el Duende respondió, fuera de personaje, *"Lo siento, no puedo manipular las acciones de otros usuarios."* — un rechazo genérico y educado que no pega nada con ninguna personalidad configurada. Log: `PROHIBITED_CONTENT` otra vez (tercera vez con esta misma frase).

- `PROHIBITED_CONTENT` es una categoría de seguridad de Gemini **aparte** de las 4 (`HARASSMENT`/`HATE_SPEECH`/`SEXUALLY_EXPLICIT`/`DANGEROUS_CONTENT`) que el código pone en `BLOCK_NONE` — no se puede desactivar vía `safetySettings`. Salta, aparentemente, por la combinación de una marca infantil (Barbie) con el lenguaje muy agresivo de las personalidades activas — no ocurre con otras preguntas igual de agresivas sobre Plex que no mencionan Barbie.
- El problema real no era el rechazo en sí (razonable, es un filtro de Google fuera de nuestro control), sino que el **fallback "seguro" no tenía `toolContext`** — cuando saltaba el filtro, se perdía toda la funcionalidad (búsqueda, petición...), no solo el tono soez. Además su propia instrucción ("si el mensaje es problemático, niégate educadamente") hacía que interpretara "pide X para Y" como algo panorama de "manipular a otro usuario" y se negara sin más, sin haber ni intentado buscar nada.
- Arreglo en `duende.js`: el fallback seguro ahora **sí recibe `toolContext`**, así que puede seguir buscando/pidiendo con tono neutro aunque la versión "con personalidad" se bloquee. Reescrita también su instrucción: aclarado que pedir contenido o consultar datos de otro usuario del mismo grupo no es "problemático" — solo negarse ante algo realmente dañino (amenazas reales, acoso serio, contenido sexual con menores), nunca por prudencia excesiva ante una petición normal de un amigo.
- Pendiente de verificar en vivo tras este último cambio (requiere reinicio).

## Ideas / mejoras pendientes (sin implementar)

Ancladas en lo que se ha visto trabajando en todo esto — no es una lista genérica:

- ~~**Validar el modelo de Gemini al arrancar o al cambiarlo en el panel**~~: hecho el 2026-10-02.
- **Fallback automático de modelo**: pasado a [FEATURES.md](planificacion/FEATURES.md) como F-AD-03.
- **Aviso en logs cuando se esperaba una herramienta y no se usó ninguna**: heurística simple (la pregunta menciona saldo/nivel/racha/precio pero no hay línea de "Herramienta usada") para detectar este tipo de fallo silencioso sin tener que mirar el log a mano. Ya existe una versión estrecha de esto para el caso de Seerr (detector de "ya lo he pedido" sin llamada real, ver más arriba) — generalizarlo a saldo/nivel/racha/precio sigue pendiente.
- ~~**Extender `/diagnostico`** con un chequeo de "¿el modelo soporta function calling?"~~: hecho el 2026-10-02 (🩺 Sistema → 🤖 Probar Gemini).
- ~~**Más herramientas de solo lectura**~~: hecho el 2026-10-02 (tienda, inventario, apuestas, casino y diario).
- **Herramientas de escritura, con guardarraíles fuertes** (ahora que las de lectura ya funcionan de verdad): por ejemplo reclamar un logro ya completado, siempre con confirmación explícita y límites — nunca dar/quitar monedas directamente desde una respuesta de la IA.
- **Discovery de Seerr por colección/franquicia**: `buscar_contenido_seerr` solo busca por título — "pide toda la saga de Barbie/Star Wars/X" no se puede resolver bien porque no hay forma de listar "todo lo que hay de X" de una vez. TMDB tiene endpoints de colección/franquicia que se podrían envolver en una tool nueva (`buscar_coleccion_seerr` o similar) para cubrir este caso.
