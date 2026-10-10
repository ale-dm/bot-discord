# Changelog — El Duende

Registro de cambios de esta sesión de trabajo. Se actualiza según se va avanzando.

## 2026-10-10 (para llegar a 10: base de datos, lint y documentación, segunda pasada)

- **Índice de `tienda.objetoId`** (migración `042_indice_tienda`): era la única clave foránea sin índice. Lo usan el catálogo del panel admin y los borrados. `tests/indiceTienda.test.js` comprueba que el índice existe y que las consultas lo usan con un volumen realista (400 objetos).
- **`SELECT *` sustituido** por columnas explícitas en 68 consultas de `src/` (las del esquema actual; el resultado no cambia). La de la migración 007, que vuelca tablas de esquema desconocido, se queda a propósito. Las siete consultas de partidos repetidas en `juegos/apuestas/apuestas.js` pasan a un solo helper, `partidoPorMatch` (en `systems/apuestas/apostar.js`), para que el fichero siga por debajo de 500 líneas.
- **Plan de las consultas**: 344 consultas literales de `src/` revisadas con `EXPLAIN QUERY PLAN`. 14 recorren una tabla entera, todas agregados o listas completas (saldos, ranking, cron) o tablas pequeñas de configuración y panel. No hace falta ningún índice nuevo.
- **Lint**: `no-shadow` activo en `src/`, sin avisos. Se corrigieron los cinco casos renombrando la variable interna (`vistas.js`, `index.js`, `geminiTts.js`, `backups.js`, `plexHistorial.js`), sin cambio de comportamiento.
- **Cobertura de todo el repositorio medida**: 36 ficheros de `src/` por debajo del 60 % de líneas o del 50 % de ramas, listados en [PUNTUACION](planificacion/PUNTUACION.md).
- **DEPLOY y comentarios**: `/diagnostico` pasa a ser `/paneladmin` → 🩺 Sistema; el enlace a DT-01 (ya retirado) sale del documento, y la copia de seguridad queda como decisión registrada.
- **Merges**: a partir de ahora, los PRs de feature a `developer` se hacen con squash, como dice CONTRIBUTING; `developer` → `main`, con merge commit.
- Puntuación: Base de datos pasa a 9 y la media a 8,7. Lint se queda en 9 hasta decidir qué medida faltaba.

## 2026-10-10 (para llegar a 10: lint, TODO y documentación)

- **Límites de tamaño en el lint** (`eslint.config.js`): en `src/`, 120 líneas por función y 500 por fichero. Son los máximos actuales, no la meta (60 y 400): la regla se baja al bajar cada máximo real. El catálogo de logros queda fuera por ser datos. Comprobado: una función de 127 líneas falla el `npm run check`; el repositorio pasa con 0 avisos.
- **`TODO` de `commands/duende/ia.js` quitado**: era una idea de interfaz (selector con botones de radio) y el comentario decía 12 opciones, cuando hay 8. La idea pasa a [SIGUIENTES_PASOS](SIGUIENTES_PASOS.md) (apartado 4).
- **Documentación al día**: README (22 comandos, carpetas de comandos con `/plex`, `/pase`, `/mensaje`, `/conectar` y `/sonidos`, y los scripts que faltaban), [FUNCIONALIDADES](FUNCIONALIDADES.md) (fecha y seis comandos que faltaban en la tabla de referencia), [SIGUIENTES_PASOS](SIGUIENTES_PASOS.md) (reescrito: estado de la auditoría, releases pendientes, mapa de los refactors, y recetas corregidas: el número de migración, dónde se añade un ajuste), [PLEX_Y_SEERR](../tecnico/PLEX_Y_SEERR.md) (referencias de código al día, sin tocar el registro histórico), [docs/README](README.md) (FEATURES redirige a los issues), [TAREAS](planificacion/TAREAS.md) (T-03: comprobaciones en Discord de #243 y #244, que bloquean liberar a `main`) y [PUNTUACION](planificacion/PUNTUACION.md) (hallazgos por área para llegar a 10).
- Puntuación del código: Robustez pasa a 10 (0 `catch` vacíos, 0 `console.log` en `src/`, 0 `TODO`); la media queda en 8,6.
- Lo que no se ha corregido, a propósito, está escrito en PUNTUACION: un índice para `tienda.objetoId` (migración 042), el recuento de funciones y ficheros grandes, y la política de merge de CONTRIBUTING (squash o merge).

## 2026-10-10 (auditoría: tamaño de paneles, ajustes, quiniela y liquidación)

- **Cuatro ficheros grandes partidos** (#244): `paneles/perfil.js` (594 → 10 líneas de fachada, las pantallas en `paneles/perfil/`: básicos, embeds, logros, ficha y rankings); `systems/guildSettings.js` (526 → 20, con la lista de ajustes como datos aparte en `guildSettings/definicion.js`, y lectura, permisos y límites en sus ficheros); `juegos/apuestas/quiniela.js` (512 → 254, editor y botones en `quiniela/`); `systems/apuestas/liquidacion.js` (507 → 17, en `liquidacion/`: caducidad, partidos, quinielas, orquesta y anuncios). El fichero más grande de cada carpeta tiene 228 líneas o menos.
- **Nueva medida de la puntuación** (`docs/planificacion/PUNTUACION.md`): 8,4 / 10, antes 7,7. Cobertura de líneas 85,3 % (antes 75,4 %) y 0 `catch` vacíos (antes 7).
- Traslado de código sin cambios de comportamiento. Los tests pasan sin tocar sus expectativas. Un detalle que los tests sí detectaron: un `module.exports.run` que dejó de apuntar al fichero correcto al moverse; ahora se pide la fachada en la función que lo llama.

## 2026-10-10 (auditoría: tamaño del Duende y de la voz en directo)

- **`commands/duende/duende.js` partido** (#243): de 775 líneas a 39 (fachada del comando). El panel 💬 pasa a `paneles/duendeAcciones.js` (227 líneas) y el flujo de «hablar» a `services/duende/chat/` (contexto, generar, enviar y hablar: 94 a 175 líneas cada uno). Los nombres que usan el router y los demás ficheros no cambian.
- **`services/duende/liveVoz.js` partido** (#243): de 596 líneas a 62 (fachada con `empezarConversacion`). La carpeta `liveVoz/` tiene constantes, sesión, declaraciones de herramientas, conexión con Gemini y captura (la tertulia incluida), de 27 a 193 líneas.
- Es un traslado de código sin cambios: las funciones se copian tal cual y solo cambian las rutas de los `require`. Los tests del Duende y de la voz pasan sin tocar sus expectativas. **La voz en directo no se puede probar con tests**: hay que comprobarla en Discord (conversación, tertulia y salida por inactividad).

## 2026-10-10 (auditoría: tamaño de retos)

- **`systems/retos.js` partido en una carpeta** (#242): `systems/retos/` con `constantes`, `comun` (error, descripción, azar inyectable), `persistencia` (lectura y escritura de la tabla y consultas de paneles), `cobros` (cobrar, cerrar, devolver, ganar), `partidos`, `crear`, `duelos`, `porras` y `revision` (cron). El fichero `systems/retos.js` queda como fachada que reexporta los mismos nombres: los paneles, los juegos, las herramientas del Duende y la liquidación no cambian. El fichero más grande de la carpeta tiene 228 líneas (antes, 851).
- Los tests de retos pasan sin tocar sus expectativas. Sin cambios de comportamiento.

## 2026-10-10 (auditoría: cobertura del Duende)

- **Tests del Duende con las llamadas externas simuladas** (#239): `tests/seerrClienteCobertura.test.js` (configuración, errores de la API, búsqueda, usuarios con su caché, peticiones, caché de búsquedas y canales permitidos), `tests/sttCobertura.test.js` (grabar una intervención, transcribir con Vosk, fallos del servidor y del miembro, y a quién se escucha), `tests/iaComandoCobertura.test.js` y `tests/imagenComandoCobertura.test.js` (respuestas, errores, cooldown, reintentos y adjuntos de imagen con `fetch` simulado) y `tests/herramientasPlexCobertura.test.js` (las herramientas de Plex que consultan Tautulli). Ninguna prueba sale a la red.
- Cobertura de líneas / ramas: `services/seerrClient.js` 99 % / 84 %, `services/stt.js` 95 % / 81 %, `commands/duende/ia.js` 98 % / 84 %, `commands/duende/imagen.js` 98 % / 83 %, `services/duende/herramientas/plex.js` 72 % / 73 % (el resto, los trofeos, lo cubre `plexDuendeTrofeos.test.js`).
- Dos cosas que los tests dejan a la vista y no se cambian: un resultado de Seerr sin datos de estado muestra «desconocido» aunque su código sea «sin solicitar»; y un adjunto no válido en `/imagen` ya consume el cooldown.

## 2026-10-10 (auditoría: cobertura del panel admin de economía y niveles)

- **Tests de los caminos que cambian dinero o ajustes** (#238): `tests/adminBancoPanel.test.js` (saldos por destino, resetear y borrar historial con confirmación, búsqueda de usuario, historial paginado), `tests/adminImpuestosPanel.test.js`, `tests/adminAjustesBotones.test.js`, `tests/adminRecompensasPanel.test.js` (recompensas por selector, búsqueda paginada, ID y descripción) y `tests/adminNivelesConfigPanel.test.js` (XP de mensajes, voz, multiplicador, fórmula, racha, vista previa y canal de anuncios). Cobertura de líneas / ramas: `bank.js` 96 % / 79 %, `impuestos.js` 100 % / 85 %, `settings/botones.js` 100 % / 78 %, `niveles/recompensas.js` 100 % / 92 %, `niveles/config.js` 100 % / 92 %.
- Sin cambios en el código de producción: los tests no encontraron ningún fallo.
- Limpieza en `tests/mensajesDecisiones.test.js`: se quita un import sin uso que marcaba el lint.

## 2026-10-10 (auditoría: cobertura de casino y quiniela)

- **Tests de Adivinar y de la quiniela** (#241): `tests/adivinarRondas.test.js` (cada ronda con acierto y fallo, importes acumulados por ronda, retirarse en la 3 y la 4, partida en curso, partida abandonada) y `tests/quinielaFlujo.test.js` (crear la jornada solo como admin, editor, pronósticos, navegar, cancelar, confirmar, cantidades fuera de rango, apuesta única). Con el mazo fijo, cada carta es conocida de antemano. Cobertura: `adivinar.js` 93 % líneas / 86 % ramas; `quiniela.js` 84 % / 77 %.
- Comprobado con una mutación: cambiar el multiplicador de la ronda 2 hace fallar el test.

## 2026-10-10 (auditoría: cobertura del núcleo de XP)

- **Tests del camino que corre en cada mensaje y cada minuto** (#240): `tests/xpActividad.test.js` (cooldown, bonus por longitud, letras repetidas, canales ignorados, voz: entrar, mutear, cambiar de canal, tick), `tests/mensajesDecisiones.test.js` (bots, duplicados, comandos, canal permitido, bajo esfuerzo, cuándo contesta el Duende) y `tests/tareasProgramadas.test.js` (19 tareas de cron con su zona, intervalos y arranque). Cobertura: `actividad.js` 84 % líneas / 72 % ramas, `mensajes.js` 65 % / 54 %, `tareas.js` 92 % / 50 %.
- Comprobado con mutaciones: quitar el filtro de comandos o el de canales ignorados hace fallar su test.

## 2026-10-10 (auditoría: duplicados)

- **Hora de Madrid en un solo sitio** (#237): `src/core/zonaMadrid.js` (`momentoMadrid`). Seis copias de la misma función de fecha (día, hora, día de la semana) en tareas, eventos, liga, destacado, clasificación, resumen admin e historial de Plex pasan a usarla. Cada módulo conserva su nombre local y lo que devuelve.
- **«Ya tienes una partida en curso»** (#237): blackjack y adivinar usan `hayPartidaEnCurso` (`juegos/casino/partidaEnCurso.js`). El aviso, el texto y la liquidación de la partida abandonada no cambian.
- Los otros dos pares del escaneo (paneles de niveles) eran solo la cabecera de imports: no se tocan.

## 2026-10-10 (auditoría: errores silenciosos y exports)

- **Errores silenciosos** (#235): los 7 `catch {}` vacíos de voz, copias y tts dejan un `debug` o un `info` con el motivo; el de `logger.js` lleva un comentario (un fichero de log que no existe tiene tamaño 0). Los `console.log` de `index.js` y `registerCommands.js` pasan al logger. Solo cambia el texto de los logs de consola (se quita el ✓ inicial), no lo que ve la gente en Discord.
- **Exports sin uso** (#236): de los 13 candidatos del escaneo, solo `buildConfirmarCancelar` era un export sin uso fuera de su fichero; se quita. Los otros 12 eran variables locales, claves de opciones de `/imagen` o nombres de un mismo fichero: el escaneo da falsos positivos y hay que comprobar cada uno a mano.

## 2026-10-10 (#166: los botones llegan a su panel)

- **Mis jugadas** (`/juegos`, antes `/misapuestas`): los botones y el menú de cancelar están en `src/paneles/misJugadas.js`, con el panel. Se borra el envoltorio `src/juegos/apuestas/misapuestas.js`. Para que el panel atienda sus botones, el arranque también carga `src/paneles` (antes solo juegos y perfil).
- Se queda `src/juegos/apuestas/combinada.js`: no es un envoltorio (tiene su propio modal de apuesta), y su prueba `combinadaPanel` lo importa por esa ruta.
- Test de arranque: todos los módulos de juegos, perfil y paneles se registran sin error, y `misapuestas_` llega a `paneles/misJugadas` (`tests/componentesRutas.test.js`).

## 2026-10-10 (base de datos: lo que quedaba de los índices)

- **Índices del resto** (migración `041_indices_resto`): quinielas abiertas por competición, ranking y liga (quinielas cerradas por fecha), rachas diarias de XP e ingresos de los negocios. Los de tablas pequeñas no se notan en el uso normal; estos sí se evitan en cada consulta diaria o de página.
- **Helper compartido** (`src/core/migrations/indices.js`): la creación de índices que omite los de BD antiguas. Lo usan las migraciones 040 y 041.
- **Liquidación horaria** medida con datos realistas (la mayoría de partidos ya finalizados, unos pocos abiertos y pasados): 4,28 ms sin índice, 0,84 ms con él.

## 2026-10-10 (base de datos: índices y ajustes)

- **Índices para las consultas que se repiten** (migración `040_indices_consultas`): el listado de partidos para apostar, «Mis jugadas», las apuestas pendientes del aviso cada cinco minutos, la voz de XP cada minuto, el inventario de cada persona, las quinielas, las combinadas, los retos, el aviso de cine y la TTCL. Medido sobre datos sintéticos de tamaño realista (300.000 apuestas, 150.000 personas con XP, 300.000 objetos de inventario):
  - listado de partidos: 2,75 ms → 0,13 ms
  - «Mis jugadas»: 11,5 ms → 0,15 ms
  - voz de XP: 4,1 ms → 0,04 ms
  - inventario de una persona: 11,2 ms → menos de 0,01 ms
  Si una BD antigua no tiene alguna columna de un índice, ese índice se omite y se avisa en el log: el bot arranca igual.
- **Conexión a la BD** (`src/core/db.js`): `synchronous = NORMAL` (recomendado con WAL: la BD no se corrompe; ante un corte de luz del sistema, pueden perderse las últimas transacciones). Cada escritura suelta (cada mensaje de XP) tardó unas nueve veces menos. Además, caché de 32 MB, tablas temporales en memoria y `PRAGMA optimize` al arrancar.
- Lo que **no** se ha tocado: no se borra ningún dato. Las tablas que crecen sin límite (partidas de Plex, historial, registro de admin, precios de TTCL) necesitan una decisión de retención, en su propia issue.

## 2026-10-09 (décima ronda: lo que quedaba)

- **Etiqueta de las décadas** ([#218](https://github.com/ale-dm/bot-discord/issues/218)): los trofeos de década dicen el año entero («Máquina del tiempo: los años 1980»; antes «los 80», que con los años 1920 se leía como 2020). Los que ya existían los cambia la migración `039_decadas_nombre` (solo los que creó el código; los de Gemini no se tocan). El id no cambia, así que nadie pierde su trofeo.
- **Avisos de lint de los tests**: quitadas tres declaraciones sin uso (`mercadosGolesHcap`, `sonidos`, `trofeosPais`). `npm run check` queda sin avisos.
- Documentación: la última migración es la `039`, y el registro de la sección anterior se queda como histórico (sus rutas antiguas son del momento en que se escribió).

## 2026-10-09 (novena ronda: funciones largas restantes y reglas fuera de juegos)

- **Ninguna función pasa de 120 líneas** (escaneo con parser). Partidas por partes:
  - `/juegos` Adivinar: cada ronda y los retiros son funciones con nombre, y una tabla asigna cada botón a su ronda ([#209](https://github.com/ale-dm/bot-discord/issues/209)).
  - `/juegos` Tragaperras: animación, liquidación del giro y resultado ([#210](https://github.com/ale-dm/bot-discord/issues/210)).
  - Quinielas: botones como tabla ordenada de acciones; el formulario de apuesta, más corto.
  - Apuestas: el formulario de apuesta en comprobaciones y confirmación; la pestaña, en consulta a la API, paginación y listado.
- **Reglas fuera de `src/juegos`** ([#166](https://github.com/ale-dm/bot-discord/issues/166)):
  - `src/systems/apuestas/quinielas.js`: crear la jornada, el cierre previo al primer partido, los partidos de cada jornada, cobrar la apuesta.
  - `src/systems/apuestas/apostar.js`: cuota de cada elección, cobro (todo o nada), si ya apostó, listado de partidos abiertos.
  - `src/systems/blackjackCobros.js`: pagar una mano y cobrar doblar o separar.
  Los módulos de `src/juegos` se quedan con los botones, los formularios y lo que se muestra.
- **DT-16 resuelta** ([#166](https://github.com/ale-dm/bot-discord/issues/166)): las reglas de quinielas, apuestas y blackjack están en `src/systems/`. La fila sale del registro de deuda, que queda sin filas abiertas.
- Mensajes del Duende, panel admin y tienda: ver la octava ronda.

## 2026-10-09 (octava ronda: funciones largas del core, panel y tienda)

- **Mensajes del Duende** (`registrarMensajes`, [#215](https://github.com/ale-dm/bot-discord/issues/215)): decidir si contesta, la reacción de bajo esfuerzo, la descarga de imágenes, la interacción que espera el Duende y la respuesta, cada una en su función. Mismo orden de decisiones y de llamadas al azar.
- **Tareas programadas** (`programarTareas`, #215): agrupadas por tema, en el mismo orden de registro (importa para las tareas que se lanzan al arrancar).
- **Panel de administración** (`/paneladmin`, [#213](https://github.com/ale-dm/bot-discord/issues/213)): los seis manejadores de componentes comparten un helper (`manejador`). Mismos módulos, mismo orden y mismos textos.
- **Tienda** (`/tienda`, [#214](https://github.com/ale-dm/bot-discord/issues/214)): los botones son una tabla ordenada de acciones (el primero que encaja gana, como antes).

## 2026-10-09 (séptima ronda: cachés con tope)

- **Cachés de módulo con tope** (#216): `src/core/cacheLimitada.js`, un mapa con tope de entradas (y caducidad opcional).
  Se usa en las seis cachés que crecían sin límite: filtros de la tienda (5.000), contexto de transacciones del casino (5.000),
  búsquedas de recompensas del panel (200), escudos de apuestas (1.000), historial de precios cripto (50) y servidores ya sembrados
  de XP (500). Al pasarse se echa la entrada más antigua. Sin cambios de comportamiento con uso normal.

## 2026-10-09 (sexta ronda: avisos de la revisión)

- **Respuesta por voz del Duende** ([#217](https://github.com/ale-dm/bot-discord/issues/217)): la respuesta sonando tiene un tope
  de tiempo (`DUENDE_VOICE_PLAYBACK_MAX_MS`, 2 min por defecto). Si el audio se queda parado sin acabar ni fallar, se corta y
  la promesa se resuelve, así que `/escuchar` no se queda esperando. Una respuesta nueva en el mismo servidor corta la que
  todavía suena, porque la conexión solo tiene un reproductor suscrito.
- **Herramientas del Duende**: el nombre que pide el modelo solo se busca en las herramientas propias del mapa (no en el prototipo).
- **Trofeos de director**: la marca de anime se calcula como en las sagas (antes siempre era `false`).
- **Renombrado** `getEdgeAudioStream` → `getTtsAudioStream` (usa Gemini TTS, no Edge). Un log con el texto duplicado ("el audio el audio") corregido.
- Pendiente de decisión: la etiqueta de las décadas ([#218](https://github.com/ale-dm/bot-discord/issues/218)).

## 2026-10-09 (quinta ronda: funciones largas restantes)

- **DT-27 resuelta** ([#193](https://github.com/ale-dm/bot-discord/issues/193)): las cuatro funciones que quedaban por encima de
  100 líneas se parten en pasos con nombre, y ninguna pasa ya de 120.
  - `tryVoiceReply` (voz del Duende, 174 → varias funciones): el guild, el canal, la decisión de hablar, los permisos,
    el audio TTS, la conexión (reutilizando la viva), y la reproducción con la salida por inactividad.
  - `generarConGemini`: la configuración, el primer turno con imágenes, la ejecución de herramientas y el aviso de alucinación. El bucle se queda igual.
  - `candidatos` de trofeos: una función por tipo (series, colecciones, géneros, países, décadas). El orden de salida no cambia.
  - `buildEconomia` (panel de economía): el embed y las filas de botones van aparte. El orden de las lecturas no cambia.
- Verificado: ninguna cadena de texto cambia en estos ficheros (comparación de literales con la versión anterior).
  Pendiente de probar en Discord: la respuesta por voz del Duende y la pestaña 💰 Economía.

## 2026-10-09 (cuarta ronda: voz en directo y Duende)

- **`hablar` del Duende** (el chat, la voz y el panel 💬) partida en pasos con nombre: configuración, personalidad y tono,
  perfiles, equivalencias de usuarios, historial, instrucciones del turno, prompt, GIF, envío del texto y de la voz. Baja de
  unas 310 líneas a 109. El orden de las llamadas al azar (intervención y GIF) no cambia.
- **DT-22 resuelta** ([#172](https://github.com/ale-dm/bot-discord/issues/172)): `liquidarApuestas`, `empezarConversacion` y
  `hablar` están todas por debajo de 120 líneas. La fila sale del registro de deuda.
- **`empezarConversacion` del Duende en directo** (DT-22, [#172](https://github.com/ale-dm/bot-discord/issues/172)) partida
  en pasos con nombre: comprobar el inicio, crear la sesión, conectar al canal, la salida de audio (ffmpeg y reproductor),
  la sesión de Gemini Live, el saludo, la captura de audio por persona (ahora una sola función para la tertulia y para
  el modo normal) y los límites de inactividad y duración. El comportamiento no cambia; la voz hay que probarla en Discord.
- Verificado: ninguna cadena de texto cambia (se comparan los literales con la versión anterior; solo desaparecen dos
  copias idénticas de los manejadores de la captura, que ahora están en una sola función).

## 2026-10-09 (exports sin uso)

- **130 exports que nadie usa fuera de su fichero** se quitan de los `module.exports` (DT-25, [#191](https://github.com/ale-dm/bot-discord/issues/191)).
  Las funciones y constantes siguen en su fichero si se usan dentro. No se tocan los que usan los tests, ni los
  métodos del router (`componentHandlers`), ni los que se nombran por texto.
- **Cinco definiciones sin uso** quitadas: `getLogLevel` (logger), `RANGE_OPTIONS` (mercado), `borrarPerfil` (perfiles),
  `enDeuda` (préstamos) y `FINALES` (retos).

## 2026-10-09 (tercera ronda: funciones largas y caché de GIF)

- **Cadenas de `if` convertidas en tablas de acciones** en el banco (`handleBankButton`), la configuración de niveles
  (`boton`) y las recompensas (`modal`). Cada acción es una función con nombre, y la tabla se recorre en orden: el primer
  predicado que encaja gana, igual que la cadena original.
- **Diagnóstico de Plex** (`comprobar`): cada supuesto es una función con nombre que recibe un contexto compartido.
- **Caché de GIF del Duende** (`giphy.js`): se borran las entradas caducadas al guardar y la caché tiene un tope de 500.
  Antes crecía con cada búsqueda nueva.
- Verificado: ninguna cadena de texto cambia en `src/` (se comparan los literales con la versión anterior).

## 2026-10-09 (caché de ajustes del servidor)

- **Ajustes en memoria** (DT-23, [#189](https://github.com/ale-dm/bot-discord/issues/189)): `getSettings` lee la tabla
  una vez por servidor y sirve la copia de memoria. Cada escritura (`setSetting`, `setManySettings`) la invalida. Un
  mensaje ya no consulta los ajustes varias veces. Tests en `tests/ajustesCache.test.js`.

## 2026-10-09 (segunda ronda: consultas y duplicados)

- **Consultas fuera de los bucles** (DT-24, [#190](https://github.com/ale-dm/bot-discord/issues/190)): en `plexFichas`
  (revisar la biblioteca) y `patrimonio` (ciclo semanal) la consulta preparada se hace una vez, no por fila o por persona.
- **Duplicados** (DT-26, [#192](https://github.com/ale-dm/bot-discord/issues/192)): el bloque repetido de la quiniela
  pasa a `refrescarEditor`; `registerCommands` usa el recorrido de carpetas de `cargarModulos`.
- Los issues de la segunda ronda, pendientes: caché de ajustes (DT-23), exports sin uso (DT-25) y funciones de más de
  100 líneas (DT-27).

## 2026-10-09 (auditoría: funciones largas, parcial)

- **`liquidarApuestas`** (262 líneas) se parte en `liquidarPartidosSueltos` (96) y `liquidarQuinielas` (113). La función
  principal solo prepara el resumen, las fechas y los scores, y llama a las dos. Mismo comportamiento: la liquidación
  de partidos, retos y quinielas se prueba con los tests de liquidación (34 en verde).
- **`duende.hablar`**: la llamada a Gemini (con su reintento de prompt seguro) pasa a `pedirRespuestaGemini`.
- DT-22 queda abierto: falta `liveVoz.empezarConversacion` (376 líneas), que hay que probar con voz en Discord, y seguir
  partiendo `hablar`. ([#172](https://github.com/ale-dm/bot-discord/issues/172))

## 2026-10-09 (auditoría: paneles de admin de Plex y ajustes en partes)

- **`adminPanel/plex.js` y `adminPanel/settings.js` se parten por sección** (`adminPanel/plex/` y `adminPanel/settings/`):
  vistas, botones, modales y selects. Los dos ficheros originales quedan como fachada con la misma API.
- **Los manejadores eran cadenas de `if` por botón** (34 en Plex, 36 en ajustes, de hasta 300 líneas). Ahora cada botón o
  modal es una función con nombre, y un `Map` lo asigna a su id. Ningún manejador pasa de 10 líneas, y ninguna función
  de acción pasa de 80. El `🔗 Vincular` de Plex (un `startsWith`) es una función propia. El comportamiento no cambia.
  (DT-20, [#170](https://github.com/ale-dm/bot-discord/issues/170))
- Excepción: `buildConfigHome` (la pantalla principal de ajustes) mide 91 líneas. Es una vista, no un manejador.
- Tests: `npm run check` en verde.

## 2026-10-09 (auditoría: src/index.js más corto)

- **`src/index.js` pasa de 642 a 284 líneas**. Sale cada cosa a su sitio:
  - `core/mensajes.js`: el manejo de mensajes de texto (XP, cuándo responde el Duende) y sus filtros (duplicados y
    mensajes de bajo esfuerzo).
  - `core/tareas.js`: los cron y las tareas de arranque (`programarTareas`), con la actualización de la actividad.
  - `core/cargarModulos.js`: la búsqueda de ficheros `.js` para cargar comandos y componentes.
  El comportamiento no cambia. (DT-21, [#171](https://github.com/ale-dm/bot-discord/issues/171))
- Tests: `tests/modulosCore.test.js` carga los módulos nuevos y comprueba los filtros de mensajes. El test de Plex que
  leía `index.js` ahora lee `core/tareas.js`.

## 2026-10-09 (auditoría: herramientas del Duende en partes)

- **`services/duende/herramientas.js` (943 líneas) se parte en `services/duende/herramientas/`** por dominio: `base`
  (ayudas y `proponer`), `plex` (16 herramientas), `seerr`, `core` (recuerdos, perfil, casino…) y `economia`. Cada
  parte tiene sus declaraciones y sus ejecutores. El fichero original queda como fachada con la misma API, y
  `DUENDE_TOOL_EXECUTORS` sigue siendo un solo objeto. (DT-18, [#168](https://github.com/ale-dm/bot-discord/issues/168))
- Tests: `npm run check` en verde (1.004 tests) y ESLint sin avisos.

## 2026-10-09 (auditoría: trofeos de Plex en partes)

- **`systems/plexTrofeos.js` (1.113 líneas) se parte en `systems/plexTrofeos/`** por responsabilidad: `base` (constantes y
  utilidades), `candidatos` (qué trofeos tiene cada persona), `condiciones` (las de admin), `nombres` (creación y nombres
  de Gemini), `sociales` (eventos de estreno y sociales) y `gestion` (rarezas, ocultar, panel). Ninguna pasa de 350 líneas.
  El fichero original queda como fachada con la misma API. (DT-17, [#167](https://github.com/ale-dm/bot-discord/issues/167))
- Tests: los 164 de trofeos y el `npm run check` completo, en verde.

## 2026-10-09 (auditoría: 🏅 Liga sin wrapper)

- **`juegos/apuestas/liga.js` desaparece**: el botón 🏅 Liga lo atiende `juegos/apuestas/apuestas.js` (mismo id, mismo
  resultado). DT-16 queda parcial: falta sacar las reglas de quiniela, apuestas y blackjack a `systems/`
  ([#166](https://github.com/ale-dm/bot-discord/issues/166)).

## 2026-10-09 (auditoría: helpers compartidos)

- **Un solo sitio para los helpers repetidos** (DT-14, [#164](https://github.com/ale-dm/bot-discord/issues/164)):
  - `core/formato.js` (`fmtNumero`): sustituye 15 copias de `fmt`. Un importe vacío o no numérico sale como `0` (antes,
    en algunos mensajes, `NaN`).
  - `core/respuestas.js` (`efimero`): sustituye 6 copias. Acepta un texto o un payload.
  - `core/permisos.js` (`esAdmin`, `tienePermiso`): sustituye las 8 comprobaciones de admin. Un solo criterio: el permiso
    del miembro en la interacción.
  - `/plex` sigue cancelando sesiones con `ManageGuild` (no `Administrator`), pero ahora está escrito así a propósito.
- Tests: `npm run check` en verde (1004 tests), y ESLint sin avisos.

## 2026-10-09 (auditoría: catálogo de logros aparte)

- **`systems/logros/catalogo.js`**: el catálogo de logros (511 líneas de datos) sale de `achievementsSystem.js`, que pasa
  de 881 a 372 líneas. Mismos logros, mismos ids y recompensas. (DT-19, [#169](https://github.com/ale-dm/bot-discord/issues/169))
- Se descarta DT-15 (ruleta y ppt): no están muertos. Ver [#165](https://github.com/ale-dm/bot-discord/issues/165).
- Tests: `npm run check` en verde (1004 tests).

## 2026-10-08 (✉️ `/mensaje`)

- **`/mensaje usuario`**: un admin elige a quién y escribe el texto en un formulario; el bot lo manda por DM tal cual,
  sin cabecera. Cada envío queda en la auditoría (sin el texto). Solo admins.
- Tests: `tests/mensaje.test.js`; `tests/parte8Admin.test.js` cuenta 19 comandos.

## 2026-10-08 (arreglos de los logs: 🍿 Para ti, sincronización de Plex y avisos)

- **`/plex` → 🎯 Para ti** fallaba con «must be url encoded» cuando un título tenía `:`, `&`, `#` o `/` (p. ej. «Star
  Wars: Episode IV»). La búsqueda de Seerr ya quita esos caracteres antes de enviarla.
- **Sincronización de fichas de Plex**: un 400 de Tautulli (el elemento no existe, p. ej. una película borrada de Plex)
  se toma como «no tiene esa ficha», no como caída. Antes, unas pocas fichas así cortaban la sincronización en cada
  pasada y nunca avanzaba. Los 401 y 500 siguen contando como fallo.
- **Aviso de Discord.js**: se quitó la opción `fetchReply` (obsoleta) de `/sonidos`, `/ping` y `/plex`.
- Tests: `tests/seerrBusqueda.test.js` y un caso en `tests/plexTautulliHttp.test.js`.

## 2026-10-08 (🔊 sonidos: se reproducen enteros y sin dejar nada colgado)

- **Los sonidos suenan enteros**: antes se cortaban a los 30 s. Ahora acaban solos, con un tope de 4 minutos por si el
  reproductor se atasca.
- **Limpieza al acabar**: se quita la suscripción y se para el reproductor, también en la presencia de `/conectar`.
  Si Discord cierra la conexión a mitad, no se espera al tope.
- **`/conectar`** no se sale ni sustituye la presencia mientras suena un sonido; lo reintenta unos segundos después.
- **`/sonidos`** confirma «Sonando…» cuando el sonido empieza, en vez de cuando acaba.
- Tests: `tests/sonidos.test.js` y `tests/presencia.test.js` (sonido largo, tope, limpieza, aviso al empezar, cierre a mitad).

## 2026-10-08 (cabos sueltos: ayuda, logros, combinadas y premios de liga)

- **`/ayuda`** tiene sección 🍿 Plex y nombra `/sonidos`, `/conectar` y `/pase`; `/pase` tiene su botón en 📈 Niveles.
- **Pase de batalla**: cada logro completado da 20 XP de pase (tope 120 al día). Los que salen al importar el historial
  de Plex no dan XP.
- **Mis jugadas y Stats** muestran las 🧩 combinadas: las que están en juego, las resueltas y sus cifras.
- **`/paneladmin` → ⚽ Apuestas → 🏆 Premios de liga**: los tres premios de la liga de pronósticos se editan con un
  formulario, sin tocar los ajustes a mano.
- Tests: `tests/cabosSueltos.test.js`.

## 2026-10-08 (🔌 `/conectar`, y los sonidos se suben desde /paneladmin)

- **`/conectar`**: el bot entra al canal de voz que elijas y se queda 30 minutos. `/sonidos` suena ahí sin entrar y salir
  cada vez. Sin canal, si ya está conectado se sale. No corta una conversación con el Duende en marcha.
- **`/sonidos`** ya solo reproduce: subir y borrar sonidos pasa a **`/paneladmin` → 🔊 Sonidos** (formulario con archivo,
  y un menú para borrar).
- Tests: `tests/presencia.test.js`, `tests/adminSonidos.test.js`; `tests/sonidos.test.js` actualizado.

## 2026-10-08 (🍿 `/plex` y 🔊 `/sonidos`; el Wrapped, por DM y privado)

- **`/plex`**: todo lo de Plex en un panel con botones, como `/tienda` y `/duende`: 🎬 Sesión de cine (formulario),
  🎯 Para ti, 🎞️ Wrapped (tu resumen, solo tú) y 🏅 Mi Plex. Sustituye a `/cine` y `/recomendar`, que se quitan.
- **Plex Wrapped (#23)**: ya no se publica en un canal. El día 1, cada persona recibe por DM solo su resumen del mes.
  Migración 038 (`plex_wrapped_enviados`), para no repetir un mes.
- **`/sonidos`**: panel público con un botón por sonido. Al pulsar, el bot entra a tu canal de voz, toca el sonido y se
  sale. Un sonido a la vez por servidor; no interrumpe una conversación del Duende. Los admins suben (`archivo` y
  `nombre`) o borran (`borrar`) sonidos. Migración 037 (`sonidos`).
- Tests: `tests/sonidos.test.js`, `tests/plexComando.test.js` y `tests/plexWrapped.test.js` (reescrito para los DM).

## 2026-10-08 (🛡️ Pase de batalla con `/pase` (#36))

- Temporadas de 15 días, 20 niveles. Cada mensaje, minuto en voz, partida de casino, operación de cripto, apuesta
  resuelta y compra en la tienda da XP de pase, con topes diarios. Cada día hay 3 misiones (70 XP al completarlas).
- Las recompensas son monedas (80 🪙 en el nivel 1 hasta 2.500 🪙 en el 20, y 2.000 🪙 de bonus final). Se cobran con 🎁 Reclamar.
- **No se conceden roles de Discord** (moderación, emojis...) como en el diseño: se dejó fuera a propósito y se dice en
  el documento de diseño.
- Pendiente: los logros no dan XP de pase; el "bonus de XP normal" del diseño no se aplica.
- Migración 036. Tests: `tests/pasePase.test.js`.

## 2026-10-08 (🔴 Apuestas en directo (#12))

- Con `ODDS_DIRECTO=1`, un partido admite apuestas durante sus 2 primeras horas, con las cuotas que se refrescan cada
  10 minutos mientras se juega. Sin la variable, nada cambia.
- Las apuestas simples y las combinadas usan la misma regla (`systems/apuestas/directo.js`). Retos y quinielas siguen
  cerrándose al empezar.
- Cada refresco gasta 3 créditos por competición con partido en juego: por eso va apagado por defecto.
- Tests: `tests/apuestasDirecto.test.js`.

## 2026-10-08 (🎙️ Tertulia en `/conversación`: escucha a todo el canal a la vez (#16))

- Opción nueva `tertulia: sí` en `/conversación`: el Duende escucha a todo el canal a la vez, sin turnos. Las voces se
  mezclan en un solo flujo de 16 kHz (`services/duende/mezclador.js`) y se mandan a Gemini Live cada 20 ms.
- Por defecto no cambia nada. No se combina con `con`.
- **Sin probar con voz real**: el mezclador tiene tests, pero el comportamiento de Gemini Live con voces solapadas hay
  que comprobarlo en Discord.

## 2026-10-08 (🧠 Recuerdos automáticos del Duende (#15))

- El Duende mira la conversación cada 10 mensajes con texto de verdad y propone lo que merezca recordarse de cada persona.
- La propuesta llega por DM a los admins, con ✅ Guardar / ❌ Descartar. Nada se guarda sin aprobación.
- Migración 035: `duende_recuerdos_propuestos`. Tests: `tests/recuerdosAuto.test.js`.

## 2026-10-08 (🌍 Trofeos por país de Plex (#19))

- Nuevo tipo de trofeo: **🌍 País**, con 5 y 10 películas de un mismo país de producción ("Viajero de Japón").
- Los países salen de TMDB, a partir del id que Tautulli da en los guids de cada película. Hace falta `TMDB_API_KEY`
  (opcional). Sin ella no hay trofeos por país, y el resto no cambia.
- Cada sincronización pide los países de hasta 60 películas nuevas; si TMDB falla, lo que falta se pide en la siguiente.
- Migración 034: `plex_fichas.tmdb` y `plex_fichas.paises`. Tests: `tests/trofeosPais.test.js`.

## 2026-10-08 (🎯 Recomendaciones personales de Plex: `/recomendar` (#22))

- `/recomendar` (efímero): propone qué ver según lo que has visto en Plex en los últimos 6 meses. Se parte de tus 3
  títulos más vistos, se piden a Seerr sus recomendaciones y salen primero las que recomiendan más. Se descarta lo ya
  visto y lo que ya está en Plex.
- 📥 pide la sugerencia en Seerr a tu nombre (tu perfil de Seerr vinculado a tu Discord).
- Seerr: nueva llamada `recomendaciones` (`/{movie|tv}/{id}/recommendations`). Tests: `tests/recomendaciones.test.js`.

## 2026-10-08 (🎞️ Plex Wrapped mensual (#23))

El día 1 de cada mes, desde las 10:00 (Madrid), el canal del ranking de Plex recibe el resumen del mes anterior: horas
por persona con su gráfica, las series más vistas y quién es el más viciado. Una vez por mes y servidor.
Tests: `tests/plexWrapped.test.js`.

## 2026-10-08 (🎬 Sesión de cine: `/cine` con botones para apuntarse (#24))

- `/cine peli hora`: convoca una sesión de cine a una hora de Madrid. Quien convoca se apunta solo; los demás, con 🙋
  Me apunto. Se sale con 🚪 Me salgo, y se cancela con 🛑 (quien convoca o un admin).
- 10 minutos antes se avisa en el canal, con menciones a quien se apuntó. Una vez por sesión.
- Migración 033: `cine_sesiones` y `cine_asistentes`. Tests: `tests/sesionCine.test.js`.

## 2026-10-08 (🧩 Combinadas: un boleto con varios partidos (#1))

- Un boleto de **2 a 5 partidos** (un partido por pata), con la cuota total como producto de las patas. Gana si
  aciertan todas; una pata que falla lo pierde al liquidarse su partido; un partido caducado devuelve el boleto entero.
- Se arma en privado: ⚽ Apuestas → 🧩 Combinada, y en cada partido el menú 🧩 Sumar a mi combinada. Antes de pagar se
  comprueba que los partidos sigan abiertos y las cuotas no hayan cambiado.
- Elecciones: 1X2, goles (2,5) y hándicap (±1,5). No el marcador exacto.
- La liquidación de cada partido paga o pierde las combinadas que tenían una pata en él, en la misma pasada que las
  apuestas simples. El tope diario cuenta lo apostado.
- Migración 032: `combinadas`, `combinada_patas` y `combinada_borrador`.
- Tests: `tests/combinadas.test.js`, `tests/combinadasLiquidacion.test.js` (liquidación de punta a punta con la API
  simulada) y `tests/combinadaPanel.test.js`.

## 2026-10-08 (⚽ Apuestas de más/menos goles y de hándicap (#9, #10))

- **Más/menos 2,5 goles**: botones ⬆️ y ⬇️ debajo del 1/X/2, con la cuota que da la API.
- **Hándicap ±1,5**: 🏠 local −1,5 y ✈️ visitante +1,5 (gana por 2 o más, o pierde por 1 o menos).
- Cada apuesta guarda su línea, así que la liquidación no cambia si la API la mueve después.
- **🧾 Mis jugadas**: lo máximo que se puede cobrar de un partido se calcula mirando todos los marcadores posibles, para
  que cuenten a la vez el 1X2, el marcador exacto, los goles y el hándicap.
- **Coste**: las cuotas piden ahora tres mercados (h2h, totals y spreads), 3 créditos por actualización de cada
  competición. `ODDS_MERCADOS=h2h` lo deja como antes.
- Migración 031: columnas de cuota y línea en `apuestas_partidos`, y `linea` en `apuestas_usuario`.
- Tests: `tests/mercadosGolesHcap.test.js`.

## 2026-10-08 (⚽ Más competiciones de apuestas: Mundial, Eurocopa, Copa del Rey y Europa League (#11))

Las apuestas y las quinielas admiten cuatro competiciones más, además de LaLiga, Premier y Champions:

- 🌍 Mundial (`soccer_fifa_world_cup`), 🇪🇺 Eurocopa, 👑 Copa del Rey y 🟠 Europa League.
- En ⚽ Apuestas, los botones de competición pasan a varias filas (cada fila admite 5). Lo mismo en el crear quiniela de
  `/paneladmin`.
- Las claves de la Eurocopa, la Copa del Rey y la Europa League no están verificadas contra la API. Con
  `ODDS_API_KEY=... node scripts/competicionesOdds.js` se ven las claves de fútbol que tiene la API y cuáles faltan.
- Coste: cada competición se consulta solo cuando alguien la abre (cuotas, 1 crédito, con caché de 30 min) o cuando hay
  apuestas pendientes en ella (resultados).

## 2026-10-08 (🏅 Liga de pronósticos por temporada (F-AP-12, #8))

Cada acierto de una quiniela cerrada suma 1 punto. La temporada va de julio a junio (hora de Madrid).

- **⚽ Apuestas → 🏅 Liga**: la clasificación de la temporada actual con puntos y quinielas jugadas, tu posición y los
  campeones de las temporadas anteriores.
- **Premio de temporada**: el 1 de julio, desde las 10:00, se publica la clasificación final en el canal de la
  clasificación y se paga al efectivo a los tres primeros (5.000 / 2.500 / 1.000 🪙 por defecto, en los ajustes
  `liga.premio_1..3`). Una vez por temporada y servidor; sin canal no se paga nada.
- Los puntos salen de `quiniela_apuestas.aciertos`, así que no hay tabla de puntos nueva. La migración 030 solo añade
  `liga_temporadas`, con los campeones liquidados de cada servidor.
- Tests: `tests/ligaPronosticos.test.js` (temporada y límites, clasificación con desempate, liquidación una vez por
  temporada, el panel y el botón).

## 2026-10-08 (📈 `/cripto` con pestañas y vista previa antes de operar (F-EC-12e, #121))

`/cripto` ya no tiene botones sueltos: es un panel con cinco pestañas (📈 Mercado, 🛒 Comprar, 💸 Vender, 💼 Cartera y
🧾 Historial), y la fila de pestañas sale siempre debajo.

- **📈 Mercado**: precio, gráfica con rango (24 h, 7 días, 30 días, todo), pool, último evento y quién tiene más TTCL.
- **🛒 Comprar**: importes fijos o cantidad escrita con ✏️ Otra cantidad. Antes de pagar, una vista previa: lo que
  pagas con comisión, lo que recibes, el precio medio y cómo se mueve el precio. Sin efectivo, no se puede confirmar y
  se ofrece 💵 Sacar del banco.
- **💸 Vender**: 25, 50 o 100 % de tu TTCL, también con vista previa (lo que recibes, la comisión y el precio). Sin impuestos.
- **💼 Cartera**: cantidad, valor, coste medio, ganancia sin vender y donut.
- **🧾 Historial**: compras y ventas, con páginas.

Se quitan los botones de precios, gráfico, top de inversores e información, que pasan a la pestaña 📈 Mercado. Ya no
hay botones de criptos retiradas.

- `src/paneles/cripto/` se reparte por pestañas (`mercado`, `operar`, `cartera`, `historial`); `resumen` y `consultas`
  se quitan.
- Las compras y ventas se confirman desde el panel (`cripto_comprar_ok_*`, `cripto_vender_ok_*`); la cantidad escrita
  llega por modal.
- `/perfil` → Rankings → 💎 TTCL ya no depende del panel antiguo.
- Tests: `tests/panelesCripto.test.js` reescrito (pestañas, vista previa sin mover dinero, límites, sacar del banco,
  modal, cartera, historial y el repintado).

## 2026-10-08 (🤖 `/duende` como un solo comando con panel de botones (F-DU-06, #113))

Igual que `/tienda`: `/duende` ya no tiene subcomandos. Abre un panel (solo lo ve quien lo abre) con:

- **💬 Hablar**: formulario con el texto. La respuesta sale en el canal como siempre.
- **🧠 Recuerdos**: lo que el Duende recuerda de ti, con ✏️ Anotar algo y 🧹 Olvidar notas. Los admins eligen a otra
  persona con un selector. Quien no es admin solo gestiona lo suyo, como antes.
- **🎭 Personalidad**: la del canal. Los admins la eligen con un menú, y pueden **añadir** y **quitar** personalidades
  con formularios.

Se quitan `talk`, `set`, `list`, `add`, `remove`, `recuerda`, `olvida` y `personas`, sin alias. El chat de texto
y `/escuchar` siguen funcionando igual: llaman a `hablar` directamente.

- Tests nuevos en `tests/duendePanel.test.js`: el panel, recuerdos (anotar, olvidar y los permisos de cada caso),
  personalidades (ver, elegir la del canal, añadir y quitar, solo admins) y el formulario de Hablar. Los tests que
  usaban `olvida`, `recuerda` y `personas` se han movido a ese fichero.

## 2026-10-08 (🛒 `/tienda` como un solo comando con panel de botones (F-EC-11, #110))

Antes `/tienda` tenía tres subcomandos (`ver`, `inventario`, `historial`), cada uno con sus opciones de filtro. Ahora
`/tienda` no tiene subcomandos ni opciones: abre directamente el 🛒 Catálogo, con las pestañas de siempre.

- Los filtros pasan a ser botones dentro del panel: un menú de **categoría**, un menú de **rareza** y un botón **🔍 Buscar**
  por nombre o tipo (formulario). Se aplican al catálogo y al inventario, y se recuerdan para cada persona.
- Se quitan `ver`, `inventario` e `historial` sin alias. La opción `solo_disponibles` desaparece: el catálogo ya
  muestra los objetos agotados con el botón desactivado.
- Ayuda: el botón de la pestaña 💰 Economía abre `/tienda`.
- Tests nuevos en `tests/tiendaPanel.test.js`: `/tienda` sin opciones, filtrar por categoría y por búsqueda, quitar
  los filtros, filtros por persona y búsqueda en el inventario. Los tests antiguos de los subcomandos se adaptan.

## 2026-10-08 (📰 Eventos diarios de TTCL (F-EC-12d, #120))

Cada día hay un evento de mercado: el precio de TTCL sube o baja un **5 %**, a una hora aleatoria. Da algo que seguir
sin que un solo jugador mueva el precio a su antojo.

- El minuto (hora de Madrid) y la dirección se eligen al empezar el día y se guardan (`cripto_eventos`).
- Al llegar la hora, el evento mueve la reserva de TTCL del pool: para subir un 5 %, el TTCL del pool se divide entre 1,05;
  para bajar, entre 0,95. El precio cambia exactamente ese porcentaje, y queda registrado en el historial del gráfico.
- Se avisa por DM a quien tenga TTCL en cartera (una vez por evento). Quien no tiene TTCL no recibe nada, y un aviso que
  falla no para a los demás.
- Migración 029 (`cripto_eventos`). Cron cada 5 min (`systems/cripto/eventos.revisarYAvisar`).
- Tests nuevos en `tests/eventosTtcl.test.js`: la hora de Madrid, que no se aplica antes de su hora, la subida y la bajada
  exactas, un evento por día, y el aviso solo a quien tiene TTCL.

## 2026-10-08 (💸 Las ventas de cripto no pagan impuesto de ingresos (F-EC-12c, #119))

Vender TTCL dejaba de ser una operación de intercambio y pasaba a ser un ingreso más, con el 5 % por defecto. Ahora la
venta es íntegra: lo que devuelve el pool (menos su comisión) entra en el efectivo sin línea de impuesto.

- `dinero.pagarSinImpuesto`: como `pagarConImpuesto`, pero sin impuesto. Sigue cobrando la deuda con el Duende: si no,
  se podría vender cripto para no devolver un préstamo.
- Las compras no cambian. Las liquidaciones de la migración 028 tampoco pagaban impuesto.
- Tests nuevos en `tests/criptoSinImpuesto.test.js`: venta con una regla general del 5 % sin línea de impuesto, y deuda
  con el Duende descontada de la venta.

## 2026-10-08 (📊 Gráficas de /cripto con ECharts + resvg, sin canvas (F-EC-12f, #122))

Las gráficas se dibujaban a mano con `canvas`, una librería nativa: el estilo era tosco y el texto dependía de las fuentes
del servidor. Ahora ECharts dibuja la gráfica en SVG y resvg la convierte en PNG.

- Línea de precio de TTCL (24 h, 7 días, 30 días, todo) y donut de la cartera, con el mismo tamaño y la misma información.
- Fuente Outfit (licencia OFL) incluida en `assets/fonts`, así el texto se ve igual en local y en Docker.
- Se quita la dependencia `canvas`. El Dockerfile ya no necesita cairo para las gráficas.
- En las gráficas la unidad es la palabra "monedas": el emoji 🪙 no tiene glifo en la fuente.
- Tests nuevos en `tests/graficosCripto.test.js`: PNG válido en la gráfica y el donut, y `null` sin cartera.

## 2026-10-08 (🧹 Se quitan BTC, ETH, SOL, BNB, XRP y DOGE; solo queda TTCL (F-EC-12b, #118))

Las criptos reales dependían de CoinGecko, no tenían oferta limitada y no aportaban nada al mercado del servidor. Ahora
`/cripto` opera solo con TTCL.

- Se quitan del mercado BTC, ETH, SOL, BNB, XRP y DOGE: ni se compran ni se venden, y ya no se consulta CoinGecko.
- **Migración 028**: lo que tenga cada persona de esas criptos se convierte en monedas al último precio que se operó
  (`cripto_historial`) y va al efectivo, **sin impuesto** (es una liquidación, no una venta). Queda una línea de tipo
  cripto en Movimientos. Si una cripto nunca tuvo precio operado, se liquida a 0 y se deja constancia en el log.
- Se quitan el historial, el gráfico y el donut de esas criptos; el donut de la cartera solo tiene TTCL.
- Tests nuevos en `tests/liquidarCriptos.test.js`: liquidación al último precio sin impuesto, y la cripto sin precio.

## 2026-10-08 (💧 TTCL como pool de liquidez (F-EC-12a, #117))

Primera parte del rediseño de las criptos (#116). El precio de TTCL dejaba de ser una función de la circulación, y eso
permitía ganar dinero con un ciclo compra→venta: la compra se cobraba al precio de antes de sumar las monedas propias,
y la venta al de después.

- **Pool de liquidez global** (`cripto_pool`): 1.000.000 monedas y 10.000 TTCL al arrancar, precio inicial 100. El
  precio es monedas / TTCL del pool, y cada operación se cobra contra el pool manteniendo el producto constante.
- **Comisión en el pool**: la compra y la venta cobran la comisión (1 % por defecto, configurable) y la comisión se queda
  en el pool. Comprar y vender de vuelta ya no sale gratis.
- **Migración 027**: el precio vuelve a 100. Las unidades que tiene cada persona se conservan. Se borra la tabla
  `cripto_ttcl` (la circulación ahora es lo que suma `cripto_carteras`).
- Se quitan los ajustes `ttcl_base_price` y `ttcl_volatility` de Config Global → Cripto; las reservas van fijas en el código.
- Pantallas y diagnóstico de TTCL actualizados: el pool (monedas y TTCL) sustituye a la curva de supply.
- Tests nuevos en `tests/ttclPool.test.js`: precio inicial, cálculo de una compra, que la comisión queda en el pool, que
  el ciclo comprar→vender de vuelta ya no da beneficio, y los límites.
- Pendiente de #116: quitar las criptos reales (#118), las ventas exentas de impuesto (#119), los eventos (#120), las
  gráficas (#122) y el panel (#121).

## 2026-10-08 (🏦 Patrimonio (F-EC-10, #81): interés e impuesto semanal sobre el banco)

El patrimonio se gestiona aparte del motor de impuestos de ingresos y compras (#77), porque no es una regla más sino
su propio ciclo.

- **Ciclo semanal por persona**: cada una tiene su propio ciclo (7 días por defecto). En cada ciclo paga primero el
  **interés** del banco (0,5 %) y después el **impuesto** (1 %) sobre lo que pasa del umbral (50.000).
- **La base del impuesto** es el banco más lo pagado por sus negocios (#80). El interés solo se calcula sobre el banco.
- Lo que no se pueda pagar del banco **no se cobra y no genera deuda**.
- **Destino**: el impuesto va al bote del servidor donde se usó la economía por última vez, o desaparece (sumidero).
  Como el dinero es global, el servidor se toma de la última actividad de la persona.
- Tipos nuevos en Movimientos: 🏦 Patrimonio (interés) e 🏛️ Impuesto (el cobro).
- **Configuración** en Panel admin → Config Global → 🏛️ Impuestos → 🏦 Patrimonio: umbral, porcentaje, interés, días
  entre cobros y destino. Se valida y queda auditada.
- Migración 026 (`patrimonio_usuario`). Cron cada hora (`systems/patrimonio.revisar`); la primera vez que aparece
  una persona solo se marca su fecha, sin cobrar.
- Tests nuevos en `tests/patrimonio.test.js`: orden interés → impuesto, negocios en la base, umbral, lo que no hay en
  el banco, bote o sumidero, ciclo semanal y validación de la configuración.

## 2026-10-08 (🏪 Negocios y blanqueo (F-EC-06d, #80): cierra la economía de robos y dinero negro (#37))

Última pieza de #37: los negocios convierten el dinero negro en dinero limpio, poco a poco.

- Cuatro negocios comprables con el **banco** (🧺 Lavandería, 📦 Oficina de correos, 🚗 Túnel de lavado, 🌮 Taco
  Ticklers), uno de cada tipo por persona. Venta por el 50 % del precio pagado, al banco.
- **Blanqueo**: el dinero negro depositado se limpia en 24 h, repartido a lo largo del día, con un tope diario
  conjunto (suma de la capacidad de los negocios) que se reinicia a las 00:00 (hora de Madrid). Al limpiarse, pasa al
  efectivo y paga impuesto como cualquier ingreso (tipo 🧼 Blanqueo).
- **Ingreso diario** de cada negocio en efectivo (100 / 250 / 500 / 800), una vez por día, también con impuesto
  (tipo 🏪 Negocios).
- Migración 025 (`negocios_usuario`, `blanqueo_lotes`, `blanqueo_dia`). Cron cada 5 min (`systems/negocios.revisar`).
- Panel en 💰 Economía → 🏪 Negocios: comprar o vender con un menú, y 🧼 Depositar dinero negro con un formulario.
- Tests nuevos en `tests/negocios.test.js`: compra y venta con el banco, tope diario y su reinicio a medianoche en
  Madrid, limpieza proporcional con impuesto (sin pagar dos veces), ingreso diario una vez al día, y el panel.

## 2026-10-08 (🧙 El Duende en la economía: retos, apuestas y préstamos desde el chat (F-DU-03, #14))

El Duende ya puede jugarse monedas contigo desde el chat: retarte a 🪨 piedra, papel o tijera, apostar contigo a un
partido y prestarte monedas. Decidido con Javier en la #14:

- **Él solo propone.** Herramientas nuevas (`retar_piedra_papel_tijera`, `apostar_partido_con_duende` y
  `ofrecer_prestamo`) que no mueven dinero: dejan una propuesta y, debajo de su respuesta, sale un mensaje con
  **✅ Acepto / ❌ No**. El dinero solo se mueve cuando la persona pulsa ✅, así que se mantiene lo de "nunca dar/quitar
  monedas directamente desde una respuesta de la IA". La propuesta solo la acepta a quien se la hizo, caduca a los 10
  minutos y va entera en el id de los botones (sin tabla). Solo en el chat de texto: por voz no hay dónde pulsar, así
  que ahí no se le ofrecen esas herramientas.
- **Su dinero, como la banca del casino**: el Duende no tiene saldo. En los retos es un participante más
  (`retos.DUENDE`) al que no se le cobra al entrar ni se le paga si gana: si pierde, su parte del premio se crea; si
  gana, lo apostado desaparece. Lo ganado paga el impuesto del servidor como cualquier reto. **Tope: 1.000 🪙.**
- **🪨 Piedra, papel o tijera**: al aceptar empieza ya en juego, con la jugada del Duende elegida al azar; se resuelve
  en cuanto eliges (si empatáis, él vuelve a elegir). La propuesta pasa a ser el mensaje del reto, con sus botones de
  siempre.
- **⚽ Apuesta a un partido** ("te apuesto 200 a que gana el Betis"): busca el partido entre los próximos de ⚽
  Apuestas por el nombre de los equipos (`retos.buscarPartido` y `eleccionPara`); vas con un resultado y el Duende con
  lo contrario. Se resuelve en la liquidación de cada hora, como cualquier reto a un partido, y sale en el canal de
  resultados con "🧙 el Duende" en vez de una mención.
- **🧙 Préstamos** (`systems/prestamos.js`, migración **024** `prestamos_duende`): de 10 a 1.000 🪙, uno a la vez, con un
  **10 %** de interés y **7 días** para devolverlo (antes, cuando quieras, con 🧙 Devolver en `/perfil` → 💰 Economía,
  que ahora lo enseña). Al vencer, el cron (cada 5 min) **lo cobra solo**: del efectivo y, si no llega, del banco, y
  avisa por DM. Lo que falte queda como **deuda**: se va cobrando de lo que ganes (lo que entra por
  `dinero.pagarConImpuesto`, ya sin su impuesto) y, mientras dure, ni otro préstamo ni apuestas con el Duende. Tipo
  nuevo **🧙 Préstamos** en Movimientos (y excluido de los impuestos: no es un ingreso).
- `consultar_saldo` le dice al Duende también si le debes algo.
- Tests nuevos en `tests/duendeEconomia.test.js` (los retos y su dinero, empates, límites y abandono, el partido con
  la liquidación y su anuncio, préstamos de aceptar a deuda, las herramientas desde el chat con Gemini simulado y los
  botones). El de la importación de Plex cuenta ahora 7 migraciones desde la 018.

## 2026-10-07 (🛡️ Objetos de protección contra robos (F-EC-06c, #79))

Tercera pieza del backlog de economía (#37), encima de `/robar` (#78): dos objetos nuevos en la tienda que protegen de
los robos con solo tenerlos en el inventario. Sin sistema nuevo: son objetos normales del catálogo (tipo coleccionable)
con un efecto que `/robar` mira en el inventario de la víctima antes de cada intento.

- 🔒 **Candado** (150 🪙, `antirrobo:30`): le quita 30 puntos a la probabilidad de éxito del ladrón (del 65 % al 35 %).
  Se gasta con ese intento, salga bien o mal (si no, uno solo protegería para siempre).
- 💣 **Trampa para ladrones** (100 🪙, `trampa:3`): si el robo falla, la multa se multiplica por 3 (con el mismo tope de
  siempre: no más de lo que tenga el ladrón). Se gasta solo cuando salta. En Movimientos del ladrón la multa lleva el
  nombre de la trampa.
- Con varios del mismo tipo se usa el más fuerte, y solo se gasta ese. A una víctima con menos del mínimo para robarle no
  se le gasta nada (no hay intento).
- El ladrón se entera en el mensaje de `/robar`; la víctima, como hasta ahora, no recibe aviso.
- La migración **023** los crea y los pone a la venta (solo si no hay ya objetos con esos efectos). Después se cambian
  como cualquier otro en `/paneladmin` → 🛒 Catálogo, que ahora acepta `antirrobo:N` (1-100) y `trampa:N` (2-10) como
  efecto, también al crear un coleccionable.
- Tests nuevos en `tests/objetosAntirrobo.test.js` (la migración, comprarlos en la tienda de verdad, el candado, la
  trampa, cuándo se gasta cada uno, el más fuerte, el mensaje de `/robar` y el catálogo). Dos tests de la tienda
  (`dinero.test.js` y `herramientasDuende.test.js`) empiezan ahora vaciando el catálogo, porque daban por hecho que
  estaba vacío.

## 2026-10-07 (🤖 Cambio automático de modelo de Gemini (F-AD-03, #39))

Al arrancar ya se probaba el modelo del Duende de cada servidor y, si fallaba, solo se avisaba a los admins: hasta que
alguien lo cambiara a mano, el Duende no respondía (modelo retirado) o se inventaba los datos (modelo que no usa las
herramientas). Ahora, en esos dos casos, **se cambia solo** por uno que funcione:

- Se prueban, en orden, el de `GEMINI_MODEL` (.env) y los de `GEMINI_FALLBACK_MODELS` (nuevo; por defecto
  `gemini-2.5-flash,gemini-2.5-pro`), sin repetir. El primero que existe y usa las herramientas pasa a ser el modelo
  del servidor (Config Global → 🤖 Duende), en todos los servidores que tenían el que fallaba.
- Queda en la auditoría (`settings.duende.modelo_automatico`, actor `bot`, con el modelo de antes, el nuevo y el
  motivo) y la alerta lo dice: "🤖 He cambiado el modelo de Gemini … usa ahora **…**".
- Un fallo **de paso** (cuota agotada, timeout, red) no cambia nada: el modelo no tiene la culpa y se avisa como antes.
  Para distinguirlo, `comprobarModelo` devuelve ahora `error: true` en esos casos.
- Si ninguno de respaldo funciona, se queda como estaba y el aviso lo dice.
- Código en `src/systems/duende/modeloGemini.js` (lo llama el arranque de `index.js`). Tests nuevos en
  `tests/modeloGeminiAutomatico.test.js` (404, sin herramientas, error de paso, ninguno de respaldo, sin modelo en el
  panel, cada modelo probado una sola vez y la auditoría).

## 2026-10-07 (📊 Resumen semanal para admins (F-AD-02, #38))

Cada lunes a las 09:00 (hora de Madrid) llega por DM a quien recibe las alertas (`systems/alertas`: los IDs del panel o,
si no hay, el dueño del servidor) un resumen de los últimos 7 días, con lo que ya estaba en los logs y en 🩺 Sistema:

- ❌ **Errores**: los de `logs/error-log*.txt` de la semana (también los rotados), agrupados como las alertas (el mismo
  error con otros números es uno), los 5 más repetidos.
- ⌨️ **Comandos más usados**: las líneas `[Comando] /…` de `logs/app-log*.txt` de la semana, solo los que terminaron
  bien (sin los denegados por ACL ni los que fallaron).
- 🤖 **Gemini**: los contadores de 🩺 Sistema, restando los del resumen anterior. Viven en memoria, así que si el bot
  se reinició durante la semana cuentan desde el arranque, y el resumen lo dice.
- ⚽ **Odds API**: los créditos que quedaban en la última respuesta.
- Los logs rotan por tamaño (5 ficheros de 5 MB): si ya se han borrado rotados y no queda nada anterior a la semana, el
  resumen avisa de que puede faltar el principio.
- Cron cada hora de los lunes y al arrancar, una vez por semana (`resumen_admin_semana` en la tabla `config`, sin
  migración nueva). Con las alertas desactivadas no se manda.
- `/paneladmin` → 🩺 Sistema → 🔔 Alertas → **📊 Resumen semanal**: vista previa, solo a quien lo pulsa (no cuenta como
  enviado).
- Código en `src/systems/resumenAdmin.js`. Tests nuevos en `tests/resumenAdmin.test.js` (con ficheros de log de verdad
  en una carpeta temporal: errores agrupados, comandos, logs rotados, Gemini desde el arranque y desde el anterior, el
  DM una vez por semana y la vista previa).

## 2026-10-07 (🎉 Eventos temporales: happy hour de XP y fin de semana del casino (F-EC-02, #34))

Dos eventos que suben solos, durante un rato, los multiplicadores que ya había. Vienen **desactivados**: se activan y
ajustan en `/paneladmin` → ⚙️ Config Global → 🎉 Eventos (pantalla nueva, con si están en marcha ahora).

- **⚡ Happy hour de XP**: cada día, de una hora a otra (hora de Madrid; 20:00–22:00 por defecto, y puede pasar la
  medianoche, p. ej. 22–2), la XP se multiplica (×2 por defecto, de 1 a 5). Va encima del multiplicador global de XP y
  antes del bonus de racha (`xp/progreso.addXp`), así que sirve para mensajes y voz. Mientras dura, `/perfil` → 👤
  Perfil lo dice debajo de la barra de XP.
- **🎰 Fin de semana del casino**: sábado y domingo (hora de Madrid) el premio neto de cada victoria de blackjack,
  tragaperras, ruleta y adivinar sube (al 150 % por defecto, de 100 a 300), encima del RTP de cada juego
  (`casinoTransactions.applyRtp`, el mismo sitio donde se aplica el RTP: el mensaje de la partida y lo cobrado
  coinciden). Nunca toca la probabilidad ni la apuesta devuelta en un empate. Mientras dura, la pantalla de 🎰 Casino
  lo dice arriba (`buildHome` recibe ahora el servidor).
- Ajustes nuevos por servidor `eventos.*` en `guildSettings`; la lógica, en `src/systems/eventos.js`. Tests nuevos en
  `tests/eventosTemporales.test.js` (horas y fines de semana en hora de Madrid, la XP que se gana con `addXp`, los
  premios con `applyRtp` junto al RTP, el aviso en el casino y el panel).

## 2026-10-07 (🕐 Tono del Duende según la hora o el canal (F-DU-02, #13))

El Duende puede cambiar de tono según la hora y el canal, **encima de la personalidad** que toque (no la sustituye:
cambiar la personalidad entera de un canal ya se hacía con `/duende set`). Viene desactivado; se configura en
`/paneladmin` → ⚙️ Config Global → 🤖 Duende → **🕐 Tono** (botón nuevo, en una segunda fila: la primera ya tenía cinco).

- 🌙 **Más borde de madrugada**: de una hora a otra (hora de Madrid; de 00:00 a 07:00 por defecto, y puede pasar la
  medianoche, p. ej. 23 a 5) recibe la instrucción de estar más borde, seco y gruñón, con la hora de ese momento.
- 👔 **Más formal en ciertos canales**: en los canales de la lista (IDs separados por comas; vale también pegar la
  mención `<#…>`), más formal y educado, sin tacos ni insultos, aunque mantenga la ironía.
- Se suman: un canal formal de madrugada recibe las dos. Se aplica a las respuestas del chat (`duende.js`, junto al
  resto de instrucciones); los mensajes espontáneos ya solo salen de 11:00 a 23:00.
- La pantalla de 🤖 Duende enseña cómo está (horas y canales). Ajustes nuevos `duende.madrugada_*` y
  `duende.canales_formales`; la lógica, en `src/systems/duende/tono.js`.
- Tests nuevos en `tests/tonoDuende.test.js` (horas en Madrid, canales formales, las dos a la vez, lo que llega de verdad
  a Gemini con `/duende` y el panel con su validación).

## 2026-10-07 (⭐ Partido destacado del día (F-AP-07, #5))

Cada día, desde las 10:00 (hora de Madrid), se publica en el canal de resultados de las apuestas el **partido grande de
la jornada**: el partido, la competición, la hora, las tres cuotas y los botones 🏠/🤝/🚩 para apostar sin pasar por
`/juegos` (los mismos de siempre: abren el formulario, y si el partido ya ha empezado no deja apostar).

- **Qué partido**: de los de hoy (Madrid) que aún no han empezado y tienen cuotas, el que más apuestas tiene ya; a
  igualdad, el más igualado (cuotas de local y visitante más parecidas, que suele ser un partido entre dos buenos
  equipos), y si no, el primero. El issue no decía cómo elegirlo; esto es lo más sencillo que no depende de una lista
  de equipos a mano.
- **Sin gastar créditos** de la Odds API (el issue lo pedía: "usa la caché"): sale de los partidos ya guardados en
  `apuestas_partidos`, que se rellenan cada vez que alguien mira las cuotas. Un día sin partidos guardados no se
  publica nada.
- Cron cada hora de 10 a 20 y al arrancar, una vez al día por servidor (`apuestas.destacado_dia`), como el ranking
  semanal de Plex: si el bot estaba caído a las 10, sale en cuanto vuelve.
- `/paneladmin` → ⚽ Apuestas: la línea ⭐ en 📢 Avisos y el botón para publicarlo o no (`apuestas.destacado`, activado
  por defecto; sin canal de resultados no se publica).
- **🎯 Marcador exacto (#7)**: el mensaje lleva también su botón, el mismo que en `/juegos` (abre su formulario).
- Código en `src/systems/apuestas/destacado.js`. Tests nuevos en `tests/partidoDestacado.test.js` (cuál se elige, el
  mensaje y su botón, una vez al día, la hora de Madrid, sin peticiones a ninguna API y el panel).

## 2026-10-07 (🎯 Apuesta al marcador exacto (F-AP-10, #7))

En `/juegos` → ⚽ Apuestas, el detalle de cada partido tiene un cuarto botón, **🎯 Marcador exacto (×8)**: un formulario
con los goles de cada equipo (0 a 20) y la cantidad. Si el partido acaba con ese marcador, se cobra **×8 lo apostado**.

- **Premio fijo, no bote**: el issue dejaba elegir entre un premio fijo (p. ej. ×8) o un bote repartido como la
  quiniela. Se ha hecho el fijo porque no depende de cuánta gente apueste (con un bote, quien acierta solo se lleva lo
  suyo) y encaja con la liquidación de cada hora. `PREMIO` en `src/systems/apuestas/marcador.js`.
- Se guarda como una apuesta a partido más (`apuestas_usuario`, elección `exacto_2-1` y cuota 8), sin tabla nueva:
  así la liquidación, 📋 Mis jugadas, 📊 Stats, el recordatorio por DM, los resultados en el canal y la herramienta de
  apuestas del Duende la tratan como cualquier otra. Solo cambia cómo se acierta (`marcador.acierta`) y cómo se
  enseña ("Marcador exacto 2-1").
- Se puede apostar a varios marcadores distintos del mismo partido, pero no dos veces al mismo (como con 1/X/2).
- El marcador se compara con los goles de cada equipo buscados por nombre, como el resultado: si la API los da en otro
  orden, se paga igual bien.
- **💼 Cartera (#3)**: el 🏆 posible premio de cada partido ya no es solo la apuesta de más premio. Un marcador exacto
  se cobra a la vez que el resultado que implica (el 2-1 y "gana el local"), así que cada marcador apostado es un
  escenario más y cuenta el mejor (`maximoDelPartido` en `src/systems/apuestas/misJugadas.js`, con su test en
  `tests/carteraApuestas.test.js`).
- Tests nuevos en `tests/marcadorExacto.test.js` (botón y formulario, goles válidos, marcador repetido, liquidación
  con la API simulada y Mis jugadas).

## 2026-10-07 (🚦 Límites por jugador en las apuestas (F-AP-09, #6))

Dos límites nuevos en `/paneladmin` → ⚽ Apuestas → 🚦 Límites (con su línea en el resumen del panel). Los dos vienen a 0
(sin límite), como el cupo diario del casino y de la tienda, así que nada cambia hasta que un admin los ponga.

- **Tope diario**: lo que cada uno puede apostar en un día (hora de Madrid), sumando partidos y quiniela. Sale del
  historial (lo apostado se apunta en negativo con tipo `apuestas`), así que no hace falta guardar la fecha de cada
  apuesta; lo cobrado o devuelto no resta.
- **Máximo por partido**: lo que cada uno puede tener apostado a un mismo partido, sumando sus apuestas a distintos
  resultados.
- El sistema de límites del casino (`checkAndConsumeLimit`) cuenta **partidas**, no monedas, así que no servía tal
  cual: se reutiliza la forma de configurarlo (ajustes por servidor `apuestas.tope_diario` y `apuestas.max_partido`,
  formulario del panel con "0 sin límite" y auditoría), y la cuenta va en `src/systems/apuestas/limites.js`.
- Se comprueba justo antes de cobrar, sin esperas por medio: dos formularios enviados a la vez no pueden pasarse del
  límite entre los dos. Si se pasa, no se cobra nada y el mensaje dice cuánto queda ("como mucho puedes apostar **30**
  🪙 más hasta mañana").
- Las apuestas son globales pero los límites son por servidor: vale el del servidor donde se envía el formulario.
- Tests nuevos en `tests/limitesApuestas.test.js` (los dos límites con los formularios de verdad de partidos y
  quiniela, el día en hora de Madrid y el panel). Al escribirlos salió que las etiquetas del formulario se pasaban
  de los 45 caracteres que admite Discord; se acortaron antes de llegar a producción.

## 2026-10-07 (↩️ Cancelar una apuesta (F-AP-05, #4))

En `/juegos` → 📋 Mis jugadas → ⏳ En juego hay un menú nuevo, **↩️ Cancelar una apuesta**, con tus apuestas a partidos
que aún no han empezado. Al elegir una sale cuánto se devuelve y la comisión, con ↩️ Sí, cancélala y ◀ No, volver.

- Se devuelve al 💵 efectivo lo apostado menos un **10 % de comisión** (redondeando hacia arriba, mínimo 1 🪙), que
  desaparece. `COMISION_PCT` en `src/systems/apuestas/cancelar.js`.
- Solo mientras el partido no haya empezado: se vuelve a comprobar al confirmar (un mensaje antiguo no sirve). La
  apuesta se borra y la devolución se hace en la misma transacción, así que un doble clic no la devuelve dos veces.
- La apuesta borrada no cuenta en 📊 Stats ni en los rankings; en 📜 Movimientos quedan la apuesta y la devolución
  ("Apuesta cancelada: … (comisión de N)", tipo Apuestas). Después se puede volver a apostar a ese partido.
- Solo la puede cancelar quien la hizo (los botones de Mis jugadas ya eran solo de quien los abrió).
- Tests nuevos en `tests/cancelarApuesta.test.js` (apostar con el formulario de verdad, cancelar desde el panel, el
  doble clic, un partido ya empezado y otra persona intentándolo).

## 2026-10-07 (💼 Cartera de apuestas en 📋 Mis jugadas (F-AP-04, #3))

`/juegos` → 📋 Mis jugadas → ⏳ En juego (lo que antes era `/misapuestas`) empieza con un resumen de tu cartera:

- 💰 **En juego**: todo lo apostado que aún no se ha resuelto (partidos y quinielas), con cuántos partidos y quinielas
  son. Antes solo se veía apuesta a apuesta, y la lista de partidos se corta en 10.
- 🏆 **Posible premio**: lo máximo que puedes cobrar de tus partidos pendientes. En un mismo partido solo puede acertar
  una de tus apuestas (p. ej. a local y a empate), así que de cada partido cuenta la de más premio. La quiniela no suma:
  su premio depende del bote y de cuántos acierten.
- 📅 **Beneficio del mes**: lo cobrado menos lo apostado en lo resuelto este mes, en hora de Madrid (los partidos por el
  día del partido; las quinielas, por el día en que se cerraron). Lo reembolsado por falta de resultado, y las quinielas
  devueltas, cuentan como recuperadas (ni ganan ni pierden).
- Sin tabla nueva: sale de `apuestas_usuario` y `quiniela_apuestas` (`misJugadas.cartera`). Tests nuevos en
  `tests/carteraApuestas.test.js` (lo máximo por partido, el cambio de mes en hora de Madrid, lo reembolsado y el
  panel con y sin apuestas).

## 2026-10-07 (🏆 Clasificación semanal con premios (F-EC-03, #35))

Cada lunes a las 10:00 (hora de Madrid) se publica en el canal de la clasificación y se paga el mismo premio (500 🪙 por
defecto) a 💰 el más rico, 💬 el más activo y ⚽ el mejor apostador de la semana, con mención solo a los premiados.

- **El más rico**: más efectivo + banco en ese momento (`dinero.masRicos`, el mismo de 🏆 Rankings → Riqueza).
- **El más activo**: más XP ganada en el servidor desde la clasificación anterior. No había forma de saber la XP de una
  semana, así que la migración **022** crea `clasificacion_xp`, con la XP de cada uno al publicar (se rellena ya al
  migrar, para que la primera semana cuente desde el despliegue).
- **El mejor apostador**: más beneficio en lo resuelto de lunes a domingo, con lo del ranking de apostadores (F-AP-03,
  `apuestas/ranking.beneficioEntre`); solo si ganó algo.
- El premio va al efectivo con `pagarConImpuesto` (tipo nuevo **🏆 Premios** en Movimientos), así que paga el impuesto de
  ingresos del servidor como cualquier otro ingreso. Primero se publica y después se paga: si el canal falla, no se paga
  nada y se reintenta a la hora siguiente.
- Cron cada hora de los lunes y al arrancar, una vez por semana y servidor (`clasificacion.ultima_semana`), como el
  ranking semanal de Plex.
- **Sin canal no se publica ni se paga nada** (viene sin canal: no empieza a crear dinero hasta que un admin lo decida).
  `/paneladmin` → ⚙️ Config Global → 🏆 Semanal: canal, premio y quién ganaría si fuera ahora.
- Código en `src/systems/clasificacionSemanal.js` y `src/adminPanel/clasificacion.js`. Tests nuevos en
  `tests/clasificacionSemanal.test.js` (quién gana, la semana en hora de Madrid, el mensaje, los premios con impuesto,
  una vez por semana, el canal que falla, la migración y el panel).

## 2026-10-07 (⚽ Ranking de apostadores (F-AP-03, #2))

`/perfil` → 🏆 Rankings tiene una opción más en el menú, **⚽ Apostadores**: los 10 que más han ganado apostando, con
su % de acierto y su mejor racha de partidos ganados seguidos. Todo sale de lo que ya se guardaba de cada apuesta (el
premio, 0 si se perdió); no hay tabla nueva.

- **Beneficio**: el mismo que el de 📊 Stats (`misJugadas.estadisticas`): partidos ya resueltos y quinielas cerradas o
  caducadas (una quiniela devuelta cuenta como recuperada). Lo que está en juego no cuenta.
- **Acierto y racha**: solo de las apuestas a partidos (una quiniela no se gana o se pierde entera). La racha va por
  la fecha del partido, no por el orden en que se apostó; las reembolsadas por falta de resultado no la cortan.
- Para salir hacen falta **5 apuestas resueltas** (como el mínimo de 5 partidas del ranking del casino). A igualdad
  de beneficio, va antes quien tiene más acierto.
- Código: `src/systems/apuestas/ranking.js` (`ranking`, `cifras`, `mejorRacha`) y `embedRankingApuestas` en
  `src/paneles/perfil.js`. Tests nuevos en `tests/rankingApostadores.test.js`.

## 2026-10-07 (🏅 Logros: lo de Plex, agrupado dentro del filtro 🍿 Plex)

El menú del filtro de `/perfil` → 🏅 Logros tenía mezclados con las categorías los cuatro filtros de Plex (🏆 Solo
trofeos de Plex y las tres dificultades). Ahora ese menú solo tiene las categorías, y al elegir 🍿 Plex sale debajo
otro menú con todo lo de Plex: 🍿 Todos los de Plex, 🏆 Solo trofeos, 🟢 Fácil, 🟡 Normal y 🎰 Gordo del Plex. Con un
filtro de dentro puesto, arriba sigue marcado 🍿 Plex; al elegir otra categoría, el de Plex desaparece.

- Las claves de los filtros no cambian (`cat-plex`, `trofeos`, `dif-…`): los botones y menús de los mensajes de antes
  siguen funcionando. El menú de dentro lleva `_plex` al final del id (`perfil_logrosfiltro_{o}_{t}_{secretos}_plex`),
  que se ignora al leerlo.
- Con todo (reclamar y los dos menús), la pantalla llega a las 5 filas que admite Discord.
- El recuadro **🍿 Plex por dificultad** sale solo dentro de 🍿 Plex (en todos sus filtros) y dice, de cada dificultad,
  cuántos tienes de los que hay (`🟢 Fácil: **3**/26 · 🟡 Normal: **1**/33 · 🎰 Gordo del Plex: **0**/25`), para ver
  cuánto falta. Antes salía en cualquier filtro y solo contaba los conseguidos. Como en Completados, los secretos solo
  cuentan si los tienes, y los trofeos de cada serie, saga... también (no se ven hasta conseguirlos).
- Tests en `tests/plexPerfil.test.js`: las opciones de cada menú, que el de Plex solo sale dentro de 🍿 Plex, y que
  elegir desde él filtra igual y lo conservan los botones (páginas y secretos). En `tests/plexIdiomas.test.js`, el
  recuadro por dificultad: solo dentro de 🍿 Plex, con lo que hay, y el mismo con los secretos a la vista o sin ellos.

## 2026-10-07 (🥷 `/robar` y dinero negro (F-EC-06b): segunda pieza de la economía de robos/blanqueo)

Segunda entrega del backlog de economía (#37), encima del motor de impuestos (#77): `/robar @persona`
para quitarle efectivo a alguien, con un cooldown **global** de 2 horas por ladrón (a diferencia de
`/trabajar`, que es por servidor — aquí no tenía sentido: el dinero ya es global).

- La víctima necesita al menos 150 de efectivo para que merezca la pena robarle (si no llega, ni se
  gasta el intento ni el cooldown). 65 % de probabilidad de éxito.
- **Éxito**: roba del efectivo de la víctima (nunca del banco) entre 50-150 + 2 por nivel del ladrón,
  sin pasar de lo que tenga. Sin aviso a la víctima en el momento — solo se nota en su saldo o sus
  Movimientos.
- **Fallo**: multa de 30-80 del propio efectivo del ladrón (o lo que tenga, si es menos).
- Lo robado se guarda como **🥷 dinero negro** (columna nueva en `banco`), aparte del efectivo normal:
  se puede gastar igual en tienda/casino/apuestas (`dinero.cobrarCombinado`: tira primero del negro y
  completa con el efectivo normal si no llega — así el negro se va gastando en vez de quedarse siempre
  acumulado), pero no se puede meter en el banco ni cuenta como patrimonio hasta blanquearse (negocios
  de blanqueo, F-EC-06d, todavía sin hacer).
- `/perfil` → 💰 Economía muestra el dinero negro como un tercer número, siempre visible (0 si no se ha
  robado nunca). Panel admin → 🏦 Banco: modificar saldo y resetear usuario ya tienen en cuenta el
  dinero negro.
- Tests nuevos (`tests/robar.test.js`): éxito y fallo, tope al efectivo real de la víctima, tope a la
  multa si el ladrón no tiene para pagarla, cooldown global (no por servidor) y por ladrón (no afecta a
  otros), y que no gastar el intento cuando la víctima no llega al mínimo. Más tests del saldo combinado
  en `tests/dinero.test.js` (negro primero, luego efectivo, todo o nada, fuera del total/ranking).

## 2026-10-07 (🏛️ Motor de impuestos configurable (F-EC-06a): primera pieza de la economía de robos/blanqueo)

Primera entrega del backlog de economía (#37): un motor de impuestos genérico y configurable por servidor,
en vez de un % fijo en el código — para poder montar luego robos/dinero negro (F-EC-06b), objetos de
protección (F-EC-06c) y negocios de blanqueo (F-EC-06d) encima de algo ya flexible.

- **Reglas configurables por servidor** (`impuestos_reglas`): sobre **ingresos** (general o limitada a un
  tipo concreto, p. ej. solo casino — y si hay una regla general y otra específica para el mismo tipo,
  gana siempre la específica, nunca se suman) o sobre **compras** en la tienda (% extra sobre el precio).
  Cada regla tiene un destino: 💰 bote del servidor (acumula, sin repartir por ahora) o sumidero
  (desaparece, control de inflación). Redondeo siempre hacia abajo.
- Los ingresos se gravan **por exclusión**: todo tipo de movimiento salvo transferencias, banco y admin (y,
  en el futuro, dinero negro sin blanquear). Migrados a la nueva ruta con impuesto: 💼 trabajar, 🎁 diario,
  🏅 logros, 🎲 retos, 💱 venta de cripto, 🛍️ objetos consumibles de monedas y 🎰 casino (solo sobre la
  ganancia neta, nunca sobre la apuesta devuelta). Queda **silencioso**: no se avisa al cobrarlo, solo
  aparece como línea aparte ("🏛️ Impuesto") en 📜 Movimientos.
- Si un servidor no tiene ninguna regla, se le crea sola una por defecto (5 % sobre ingresos, al bote) la
  primera vez que hace falta, para no quedarse sin impuestos por no haberlos configurado nunca.
- **Panel admin** nuevo en Config Global → 🏛️ Impuestos: lista de reglas (con su ámbito, % y destino) y
  botones para añadir, activar/desactivar y quitar, más el bote acumulado. Todo auditado.
- `dinero.pagarConImpuesto(userId, guildId, tipo, descripcion, cantidad)`: wrapper que sustituye a
  `pagar`+`apuntar` donde aplica, para no repetir la lógica de impuesto en cada sitio que paga un ingreso.
- Fuera de alcance a propósito: las apuestas de fútbol/quiniela (`apuestas_usuario`/`quiniela_apuestas`) no
  tienen `guildId` en su esquema (sistema global, no por servidor) y se quedan sin impuesto hasta que eso
  cambie — requeriría tocar su esquema, no algo para meter de paso aquí.
- Tests nuevos para el motor (`tests/impuestos.test.js`: regla por defecto, exclusión, redondeo, regla
  específica gana a la general, regla inactiva no se aplica, impuesto de compra aparte del de ingresos,
  acumulación en el bote, sumidero no toca el bote) y ajustados los importes esperados en los tests
  existentes que cobran algún ingreso (ahora con el 5 % por defecto ya restado).

## 2026-10-07 (🎚️ `/conversación con @persona`: volver a escuchar solo a una, cuando hay mucha gente)

Escuchar a cualquiera del canal por turnos (de la entrada anterior) se vuelve un caos con mucha
gente a la vez — todo el rato interrumpiéndose. Nuevo parámetro `con` en `/conversación`: si se
indica a alguien, solo esa persona puede abrir turno, igual que el comportamiento original antes
de soportar varias personas; sin indicarlo, sigue escuchando a cualquiera, por turnos.

- `sesion.soloEscuchaA`: si está puesto, `onSpeakingStart` ignora a cualquiera que no sea esa
  persona, antes incluso de mirar si hay un turno abierto.
- Test nuevo: con `soloEscuchaA` puesto, ignora a cualquier otra persona y solo escucha a la
  indicada.
- De paso, la descripción del nuevo parámetro superaba el límite de 100 caracteres que impone
  Discord en las opciones de un slash command — habría roto el registro del comando entero al
  desplegarlo. Acortada antes de que llegara a producción.

## 2026-10-07 (👥 `/conversación` ya escucha a cualquiera del canal, no solo a quien la pidió)

Confirmado en producción con dos personas a la vez: solo contestaba a quien había lanzado
`/conversación` — el resto del canal era invisible para el bot, ni se intentaba escuchar. Era así
desde el principio (`if (userId !== targetUserId) return;`), no un fallo al azar.

- Ahora cualquiera del canal puede hablarle. Por turnos: mientras alguien tiene el turno abierto
  (`sesion.hablanteActivo`), se ignora a quien más empiece a hablar — no hay forma de mezclar a
  dos personas en el mismo turno de Gemini (no hace diarización). En cuanto esa persona acaba, el
  turno queda libre para la siguiente.
- Antes de cada turno, se identifica a quien va a hablar — igual que el chat de texto, que
  resuelve el perfil de quien escribe en cada mensaje: nombre y lo que se sepa de ella (mismo
  sistema de perfiles/apodos), mandado con `sendClientContent({ turnComplete: false })` justo
  antes del audio de verdad de esa persona. Sin esto, Gemini solo sabía identificar a quien
  pidió la conversación (perfil fijado una única vez al conectar); ahora lo sabe de cualquiera,
  en cada turno.
- La suscripción al audio de cada persona (coste real: un stream de Discord por persona) se
  sigue haciendo una sola vez por persona y dura toda la llamada, igual que antes.
- Tests nuevos: cualquiera del canal puede hablarle, se ignora a una segunda persona mientras la
  primera tiene el turno abierto (y se libera al acabar), y se identifica a quien habla ante
  Gemini antes de su turno.

Nota: mezclar `sendClientContent` (la identificación) con audio en tiempo real dentro del mismo
turno no está 100% garantizado por la Live API ("no hay garantías" según su propia documentación)
— es la única forma de decírselo, pero si en producción Gemini no reacciona bien a esto, habría
que revisarlo.

## 2026-10-07 (🗣️ `/conversación` ya funciona de verdad: reconoce a la gente, modo "solo si le llaman" y colgar por voz)

Con `/conversación` funcionando de extremo a extremo, tres mejoras pedidas tras probarlo en real:

- **No reconocía a nadie**: a diferencia del chat de texto (`duende.js`, que inyecta el perfil de
  quien habla y de cualquier persona mencionada en cada mensaje), la llamada de voz nunca mandaba
  ningún perfil — el `systemInstruction` se fija una sola vez al conectar. Ahora sí lleva el
  perfil de quien pide la conversación (resuelve "quién soy"), y se añade una herramienta nueva,
  `consultar_perfil_persona`, para que Gemini pueda consultar la de cualquier otra persona por
  nombre — mismo mecanismo que ya usa para Plex/saldo/ranking.
- **Modo "solo si le llaman"**: por defecto (`/conversación modo: mención`, o sin indicar nada),
  el Duende sigue escuchando todo pero solo contesta si dices "Duende" en la frase — pensado para
  que ruido de fondo o un clic que Discord confunda con que estás hablando no le haga interrumpir
  o repetirse. `modo: siempre` vuelve al comportamiento de antes (contesta a todo). Se implementa
  con la transcripción de entrada que ya se recibía (antes solo se logueaba): en cuanto el turno
  actual contiene "duende", se deja pasar la respuesta; si no, se descarta sin reproducirla (se
  sigue pagando esa llamada a Gemini, pero no se oye).
- **Colgar por voz**: herramienta nueva `colgar_llamada` (solo tiene sentido en la llamada, no
  en el chat de texto) — si le pides que se vaya o cuelgue, termina la conversación igual que
  `/conversación` otra vez.
- Tests nuevos: `consultar_perfil_persona` (por nombre y con "yo"), las instrucciones de sistema
  incluyen a quien habla, `colgar_llamada` termina la conversación, y los tres casos del modo
  mención (sin decir "duende" se ignora, diciéndolo se deja pasar, `modo: siempre` contesta a
  todo).

Pendiente, para otra ronda: el propio "ruido confundido con que hablas" (Discord marca "hablando"
con cualquier sonido que pase su sensibilidad, no solo voz real) — el modo mención amortigua el
síntoma (ya no interrumpe/repite tan molesto), pero la causa de fondo seguiría sin optimizar.

## 2026-10-07 (🎯 `Precondition check failed` seguía saliendo: campo equivocado para el audio)

La bandera `hablando` de la entrada anterior no lo arregló — en producción, el mismo corte volvió
a salir unos segundos después de empezar a hablar. Esta vez, en vez de fiarme de un resumen de
búsqueda (que decía que el problema era audio "colándose" entre `activityEnd` y el siguiente
`activityStart` — al ir a la fuente original, ese hilo de Google no tenía ninguna solución
confirmada), fui a la documentación oficial de la Live API y comparé su ejemplo de código con el
nuestro.

El ejemplo oficial manda el audio del usuario por el campo `audio: { data, mimeType }`.
Nuestro código lo mandaba por `media: { data, mimeType }` — un campo genérico y más antiguo
("Realtime input", pensado para varios tipos de datos) que el SDK traduce a `mediaChunks`, no al
`audio` que la API espera para el audio en tiempo real de verdad. Con detección automática
(como era al principio) el servidor es permisivo y lo acepta de todas formas; con la detección
manual puesta, necesita el audio por el campo correcto para poder casarlo con los
`activityStart`/`activityEnd` — y si no, corta la sesión con "Precondition check failed".

- `sendRealtimeInput({ media: {...} })` → `sendRealtimeInput({ audio: {...} })`.
- Test nuevo: el audio del usuario se manda por `audio`, no por `media`.

## 2026-10-07 (🎯 `/conversación` se cortaba sola justo al hablar: "Precondition check failed")

Con el VAD manual (activityStart/activityEnd) puesto, el primer intento en producción se cortó a
los 3 segundos de que el usuario empezara a hablar:

```
WARN [Duende:VozEnVivo] Conversación en directo cerrada (socket): Precondition check failed.
```

Es un error conocido de la Live API con detección manual: Gemini corta la sesión si le llega
audio **fuera** de un `activityStart`/`activityEnd` — y eso pasa de verdad, porque el "end" que
manda Discord y el último trozo que suelta el decoder de Opus no llegan perfectamente a la vez
(el decoder puede soltar algún trozo con el stream ya "parado" según Discord). Mandábamos
cualquier trozo que llegara, sin mirar si estábamos dentro de un turno abierto.

- Nueva bandera `hablando`: se pone a `true` en el `activityStart`, a `false` en el
  `activityEnd`, y el envío de audio a Gemini la comprueba antes de mandar nada — cualquier
  trozo que llegue fuera de ese hueco se descarta en vez de mandarse.
- Test nuevo: un trozo de audio llegado justo después del `activityEnd` no se manda a Gemini.

## 2026-10-07 (🎯 `/conversación` ya respondía el saludo y oía al usuario, pero no contestaba después)

Con el fix de `maxMissedFrames` el log ya mostraba el pipeline funcionando de verdad: saludo
reproducido, reproductor en `playing`, y la captura de audio del usuario llegando bien a Gemini
(`Primer trozo de audio de ... capturado`). El problema era más sutil: tras hablar, Gemini nunca
respondía — se quedaba "escuchando" para siempre.

Causa: la detección de actividad automática de Gemini (la que decide sola cuándo ha acabado el
turno del usuario) se basa en analizar silencios **dentro del propio audio que recibe**. Discord
no manda paquetes durante los silencios reales (no hay "silencio codificado" que mandar) — así
que el audio que le llega a Gemini tiene huecos, no silencio de verdad, y su detección automática
nunca ve un final de turno claro. Se queda esperando audio para siempre.

- `realtimeInputConfig: { automaticActivityDetection: { disabled: true } }` al conectar: ya no
  es Gemini quien decide cuándo acaba el turno.
- En su lugar, usamos la propia detección de Discord (el `speaking` del receptor, basado en
  paquetes de voz reales, mucho más fiable): al "empieza a hablar" se manda
  `sendRealtimeInput({ activityStart: {} })`, y al "deja de hablar" (Discord lo marca ~100ms
  después del último paquete) `sendRealtimeInput({ activityEnd: {} })`. Esto se manda cada vez
  que habla, no solo la primera — a diferencia de la suscripción al audio en sí, que sigue siendo
  de una vez por llamada.
- Tests nuevos: que la detección automática queda desactivada al conectar, que se avisa a Gemini
  de inicio/fin de turno con las señales de voz de Discord, y que ese aviso se manda en cada
  turno (no solo el primero).

## 2026-10-07 (🎯 `/conversación` dice el saludo y luego se queda muda: `maxMissedFrames`)

Progreso real: con el modelo corregido, el saludo inicial SÍ se oía — pero luego no volvía a
hablar nunca más, con este error en el log:

```
WARN [Duende:VozEnVivo] Error en ffmpeg (salida de voz en directo): Premature close
```

`@discordjs/voice` tiene un comportamiento pensado para reproducir pistas de audio normales, no
para una conversación en directo: si el reproductor no consigue leer un paquete del stream
durante `maxMissedFrames` ciclos (5 por defecto, 100 ms), da la pista por acabada y **destruye**
el stream de ffmpeg de raíz — justo lo que pasaba en el hueco normal entre el saludo y el
siguiente turno (Gemini puede tardar segundos en volver a mandar audio, esperando a que hables).
Una vez destruido, ese `ffmpeg.write(...)` de cada mensaje nuevo de Gemini ya no iba a ningún
sitio: de ahí el silencio total después del saludo.

- `createAudioPlayer({ behaviors: { maxMissedFrames: Infinity } })`: el reproductor ya no da la
  conversación por acabada por un hueco de audio. El corte de verdad sigue siendo cosa de los
  timers de inactividad/duración que ya había (`IDLE_DISCONNECT_MS`/`MAX_DURATION_MS`), no del
  reproductor.
- Test nuevo: que `createAudioPlayer` se llama con ese `behaviors.maxMissedFrames: Infinity`.

## 2026-10-07 (🎯 El motivo real: el nombre del modelo estaba obsoleto, no la versión de la API)

El cambio a `v1alpha` de la entrada anterior era un diagnóstico equivocado: en producción, el
mismo error salió igual en `v1alpha` ("models/gemini-live-2.5-flash-preview is not found for API
version v1alpha, or is not supported for bidiGenerateContent"). Si fallaba en las dos versiones,
el problema nunca fue la versión — era el nombre del modelo, que ya no existe. `gemini-3.8-live`
es el modelo de voz en directo actual (el mismo cambio de generación que ya se ve en
`gemini-3.8-flash-tts`, que SÍ funciona para `/tts`), y según la documentación usa `v1beta` normal.

- `DUENDE_LIVE_MODEL` por defecto: `gemini-live-2.5-flash-preview` → `gemini-3.8-live`.
- Revertido `getGenAILive()`/`v1alpha` de la entrada anterior: `liveVoz.js` vuelve a usar
  `getGenAI()` (v1beta), igual que el resto del bot.

## 2026-10-07 (🎯 Encontrado el motivo real de `/conversación` muda: el modelo pide v1alpha, no v1beta — DESCARTADO, ver entrada de arriba)

Con los logs de la ronda anterior, el primer intento en producción lo dejó clarísimo:

```
WARN [Duende:VozEnVivo] Conversación en directo cerrada (socket): models/gemini-live-2.5-flash-preview
is not found for API version v1beta, or is not supported for bidiGenerateContent.
```

La conexión de voz y el `AudioPlayer` estaban bien (se ve `idle -> buffering`); el problema era que
el cliente de Gemini (`getGenAI()`, compartido con el resto del bot) usa `v1beta` por defecto, y la
Live API con este modelo solo está disponible en `v1alpha` para la API de desarrollador (no Vertex).

- Nuevo `getGenAILive()` en `geminiClient.js`: un cliente aparte, cacheado igual que `getGenAI()`,
  pero con `httpOptions: { apiVersion: "v1alpha" }`. Solo lo usa `liveVoz.js` — el resto del bot
  (chat, `/trabajar`, embeddings...) sigue en `v1beta` sin tocar, que es donde ya funciona bien.
- Tests nuevos (`tests/geminiClient.test.js`): que `getGenAI()` no fuerza versión, que
  `getGenAILive()` sí pide `v1alpha`, y que cachea el cliente igual que el otro.

Con esto debería sonar de verdad. Si no, los logs de la ronda anterior (conexión, ffmpeg,
`AudioPlayer`, captura de entrada) deberían decir exactamente dónde se corta esta vez.

## 2026-10-07 (🔊 `/conversación` sigue sin sonar: logs de verdad en todo el camino del audio, y voz por defecto Charon)

Los dos fixes anteriores de `/conversación` (suscripción reactiva + bugs de `prism-media`) no
eran suficientes en producción y, sin más datos, no se podía saber en qué paso se rompía. Antes de
seguir adivinando, se añaden logs en cada punto del camino del audio, en los dos sentidos:

- **Conexión de voz**: al unirse al canal, cuando queda lista, y si la conexión da un error o
  cambia de estado (`VoiceConnection` tiene su propio `error`, no solo el de ffmpeg/Gemini).
- **Salida (Gemini → ffmpeg → Discord)**: cuántos bytes genera ffmpeg de verdad (si no genera
  nada, el problema es ffmpeg, no Discord), en qué estado está el `AudioPlayer`
  (`stateChange`: Idle/Buffering/Playing/Paused — si se queda en Idle nada más empezar, el
  recurso no tiene datos), y si `connection.subscribe(player)` devuelve algo o no.
- **Entrada (usuario → Gemini)**: confirma cuándo se detecta que alguien empieza a hablar, el
  primer trozo de audio capturado y decodificado, y errores del stream de Opus o del decoder que
  antes podían perderse en silencio.
- **Mensajes de Gemini Live**: qué claves trae cada mensaje (debug), y confirmación del primer
  trozo de audio de salida que llega de verdad.
- El error final, si no consigue arrancar la conversación, ahora se registra con el `stack`
  completo, no solo el mensaje.
- La mayoría son `log.info` (no se ven en consola por defecto, solo en `logs/app-log.txt`, salvo
  que se ponga `LOG_CONSOLE_LEVEL=info`); los de clave en clave de cada mensaje son `log.debug`
  (necesitan además `LOG_LEVEL=debug`).
- Tests: el mock de `prism-media`/`@discordjs/voice` en `liveVoz.test.js` no tenía `.on()` en la
  conexión ni en el stream de Opus — se añade, para que estos listeners nuevos no rompan nada.
- **Voz por defecto**: `Puck` → `Charon` en `/tts`, en el Duende y en `/conversación`
  (`DUENDE_TTS_VOICE`/`DUENDE_LIVE_VOICE`). Sigue siendo configurable igual que antes.

## 2026-10-07 (🐛 `/conversación` seguía muda: dos bugs más, en `prism-media`/ffmpeg)

El arreglo anterior (suscripción reactiva a la voz de entrada) no era suficiente: ni siquiera el
saludo inicial, que no depende de capturar audio de nadie, se oía — la salida estaba rota, no solo
la entrada. Leyendo el código fuente de `prism-media` (`FFmpeg.js`) salieron dos bugs reales, de
cómo se usa esa librería, no de Discord:

- **`pipe:1` duplicado**: `prism.FFmpeg.create()` ya añade `pipe:1` solo al final de los
  argumentos; el código también lo ponía, así que el comando de ffmpeg salía con `... pipe:1
  pipe:1` y probablemente fallaba al arrancar. Se quita el que ponía este código (el de entrada,
  `pipe:0`, sí hace falta: es nuestro).
- **`ffmpeg.stdin.write(...)` no existe**: la clase `FFmpeg` de `prism-media` es un `Duplex` que
  copia `write`/`end` directamente en la instancia (del stdin interno del proceso), no los deja
  bajo `.stdin`. Esa línea lanzaba un `TypeError` cada vez que llegaba audio de Gemini —
  silenciado porque estaba dentro de un `try/catch` sin relanzar, así que nunca se vio en el log
  como lo que era. Ahora es `ffmpeg.write(...)`.
- Añadidos `ffmpeg.on("error", ...)` y `player.on("error", ...)` para que un fallo de ffmpeg o del
  reproductor de audio salga en el log en vez de quedarse callado.
- Tests: `liveVoz` comprobaba la forma antigua (incorrecta) de la API de `prism-media`, así que no
  pilló ninguno de los dos bugs — el mock de `FFmpeg` ahora tiene la forma real
  (`write`/`end`/`on`/`destroy`, sin `.stdin`), con dos tests nuevos: que los argumentos no llevan
  `pipe:1` duplicado, y que el audio de Gemini se escribe con `ffmpeg.write(...)` de verdad.

## 2026-10-07 (🐛 Dos bugs vistos en producción: `/trabajar` cortado y `/conversación` muda)

Los dos, con el primer despliegue real de ayer.

- **`/trabajar` salía cortado a una palabra** ("Sraleo"): con `maxOutputTokens` bajo (150), el
  "pensamiento" que Gemini 2.5 hace por defecto antes de responder se comía casi todo el
  presupuesto, sin dejar casi nada para el texto de verdad (`finishReason: MAX_TOKENS`, ya se
  avisaba en el log, pero no se actuaba). `generarConGemini` admite ya `thinkingBudget` en las
  opciones; `/trabajar` y los mensajes espontáneos lo ponen a 0 (una frase suelta no necesita
  razonar) y suben el `maxTokens` a 400 de colchón.
- **`/conversación` no decía nada**: la entrada de audio se suscribía al conectar, antes de que
  Discord hubiera asociado tu voz a ese canal — igual que si `services/stt.js` se suscribiera sin
  esperar a `receiver.speaking.on("start", ...)`. Sin audio de entrada, Gemini no tenía nada a lo
  que responder: la sesión se abría bien (sin ningún error en el log) y se quedaba en silencio
  hasta que se cortaba a mano. Ahora se suscribe reactivamente, igual que STT. También se añade un
  saludo inicial al conectar (`sendClientContent`), para que confirme la voz nada más entrar y no
  solo cuando alguien habla.
- Tests: 626 (de 621). Nuevos en `liveVoz` (el saludo inicial, que no se suscribe hasta que habla
  el objetivo, que ignora a otras personas del canal, que no se suscribe dos veces) y en
  `trabajar` (que `thinkingBudget: 0` llega de verdad a la llamada).

## 2026-10-07 (💼 `/trabajar`)

[F-EC-07](https://github.com/ale-dm/bot-discord/issues/48), idea nueva (no venía del backlog original).

- **`/trabajar`**: ingreso con cooldown corto (30 min, `TRABAJAR_COOLDOWN_SEC`), distinto de la 🎁 recompensa
  diaria (esa es gratis una vez al día; esto exige estar activo). Da 20-50 monedas al azar
  (`TRABAJAR_BASE_MIN`/`MAX`) + 2 por nivel (`TRABAJAR_BONUS_NIVEL`), con un 12 % de las veces
  (`TRABAJAR_PROB_FALLO`) de no dar nada.
- El texto de "en qué has trabajado" lo escribe el Duende con Gemini **cada vez** (con su personalidad del
  canal y el perfil de quien lo use, si tiene), no una frase fija de una lista.
- Cooldown por persona con `guildSettings.checkAndConsumeLimit` (ya existía, sin usar en ningún sitio hasta
  ahora — pensado justo para esto: cooldown + cupo diario opcional por `scope`).
- Nuevo tipo de movimiento 💼 Trabajo en Movimientos (`dinero.js`).
- Tests: 621 (de 616). Nuevos: `trabajar` (da dinero con el bonus de nivel correcto, no da nada cuando sale
  mal, cooldown por persona, y que no rompe si falla la llamada a Gemini).

## 2026-10-06 (📢 Mensajes espontáneos del Duende)

Pedido porque el server estaba "un poco muerto": que el Duende anime a la gente a hacer cosas sin que nadie le hable.

- De vez en cuando (probabilidad baja cada hora, de 11:00 a 23:00, `DUENDE_ESPONTANEO_PROB`), si el canal elegido
  lleva un rato sin mensajes de verdad (`DUENDE_ESPONTANEO_QUIET_MS`, 2h por defecto — no interrumpe una
  conversación activa), el Duende se dirige a alguien **al azar de quien tenga perfil** (🧠 Perfiles, con
  descripción o notas de `/duende recuerda`): le menciona y le suelta algo basado en lo que sabe de él, en su
  estilo, para picarle y que conteste. Si no hay nadie con perfil al que dirigirse, no dice nada — nunca un mensaje
  genérico de relleno. (Primera versión: pensada para tirar de datos del server —tienda, apuestas, ranking de
  dinero—, pero mencionar a quien más dinero tiene no convenció y se cambió por esto antes de llegar a `main`.)
- Se activa o desactiva y se elige el canal en **Config Global → Duende → 💬 Mensajes solos** (`guild_settings`,
  no hace falta tocar el `.env`).
- `systems/duende/espontaneo.js`: la lista de "ganchos" es fácil de ampliar más adelante (cada uno devuelve
  `{ texto, discordId? }` o `null` si no aplica); la mención la añade el código, no Gemini (para no depender de que
  copie bien un ID), y el texto lo escribe con la personalidad del canal, igual que el resto del Duende.
- Tests: 616 (de 600). Nuevos: `duendeEspontaneo` (el gancho con y sin perfiles válidos, cuándo se considera un
  canal "en calma", y la decisión completa con probabilidad/canal/calma simulados).

## 2026-10-06 (🎙️ Conversación de voz en directo)

[F-DU-07](https://github.com/ale-dm/bot-discord/issues/18).

- **`/conversación`**: conversación de voz en directo con el Duende (Gemini Live API), audio
  bidireccional real en vez de por turnos — no hace falta esperar a que termines de hablar.
  **No sustituye a `/escuchar`** (Vosk + TTS por lotes, que sigue exactamente igual): es una
  funcionalidad nueva y aparte, pedida explícitamente así.
- Usa las mismas herramientas que el chat de texto (saldo, nivel, Plex, Seerr...) con el mismo
  criterio de qué Plex/Seerr se permite según el canal de texto desde donde se invoca.
- **Dos cortes de coste obligatorios**, no opcionales: se cobra mientras la conexión esté
  abierta, no solo cuando se habla. `DUENDE_LIVE_IDLE_DISCONNECT_MS` (5 min por defecto) corta
  tras ese tiempo sin que nadie hable; `DUENDE_LIVE_MAX_DURATION_MS` (30 min) es un tope duro
  pase lo que pase. `/conversación` otra vez también la termina a mano.
- Nuevo servicio `services/duende/liveVoz.js`: une el audio de Discord (Opus → PCM 16kHz) con
  la sesión en directo de Gemini, y la respuesta (PCM 24kHz) con la salida de voz de Discord
  (vía `ffmpeg`, ya en la imagen para Vosk). Sin tabla ni migración nueva.
- Tests: 600 (de 590). Nuevos: `liveVoz` (una conversación a la vez por servidor, los dos
  cortes de coste con temporizadores simulados, las herramientas se ejecutan y responden, una
  desconocida no rompe nada) — todo con el audio y la conexión a Discord simulados: queda
  pendiente de probar de verdad en Discord.

## 2026-10-06 (🧠 Memoria del Duende por similitud, no solo por fecha)

[F-DU-06](https://github.com/ale-dm/bot-discord/issues/17). Migración **019**.

- **Las notas de `/duende recuerda` se eligen por lo relacionado que esté con el mensaje actual**,
  no solo por ser las últimas: con más de 6 notas guardadas, se embeben con Gemini
  (`gemini-embedding-001`, $0,15/M tokens de entrada) y se comparan por similitud coseno contra
  el mensaje que se está respondiendo (`perfiles.notasRelevantes`). Antes, con más de
  `MAX_PERFIL_PROMPT` (2.500) caracteres entre descripción y notas, las más recientes podían
  quedarse fuera por el truncado; ahora se eligen las que de verdad vienen a cuento.
- **Con 6 notas o menos no se llama a Gemini** — se dan todas, como antes. Los vectores se
  cachean por nota (`duende_notas_vectores`, tabla nueva) para no volver a calcular los de
  siempre en cada mensaje; solo se pide el de las notas nuevas y el del mensaje actual.
- **Si la llamada a Gemini falla** (sin API key, sin cuota, red...) cae a las últimas notas, el
  comportamiento de siempre — nunca rompe la respuesta del Duende por esto.
- Nuevo servicio `services/duende/embeddings.js` (`embedTexts`, `cosineSimilarity`), sin base de
  datos vectorial: con el volumen de este server, comparar a pelo en SQLite basta.
- Tests: 590 (de 586). Nuevos: `notasEmbeddings` (umbral sin llamar a Gemini, similitud,
  fallback si falla, caché entre llamadas).

## 2026-10-06 (🎬 Resync de Plex y herramientas que sobreviven al cambio de personalidad)

- **🔄 Resincronizar IDs en `/paneladmin` → 🎬 Plex**: el `tautulliUserId` guardado en `plex_links` es interno de cada
  instalación de Tautulli; al reinstalarla (p. ej. al mover Plex/Tautulli a otro servidor) se reparte desde cero y los
  vínculos antiguos quedaban apuntando a otra persona o a nadie, sin ningún error visible — solo devolvían historial
  vacío o ajeno. El botón nuevo re-busca cada `plexUsername` guardado contra la lista actual de Tautulli (por
  `username` o `friendly_name`, para las cuentas Managed/Home) y actualiza el ID si ha cambiado (`plexLinks.relinkAll`).
  Al vincular a mano también se admite ya `friendly_name` como alternativa al username exacto.
- **El Duende dejaba de usar las herramientas (Plex, saldo...) con ciertas personalidades**: el recordatorio de "usa
  las herramientas siempre" iba mezclado dentro del texto de la personalidad, compitiendo en igualdad de condiciones
  con ella; una personalidad suficientemente agresiva podía seguir ignorándolo. Ahora vive en el `systemInstruction`
  real de la llamada a Gemini (`services/duende/gemini.js`), que no cambia con la personalidad activa.

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
