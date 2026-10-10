# Puntuación del código: línea base (2026-10-10)

Medida sobre `developer` en `2439efb`. Es una valoración propia con criterios fijos, no una medición externa. Sirve para
comparar la siguiente puntuación con esta, usando la misma escala y los mismos comandos.

## Medidas

| Criterio | Valor | Cómo se mide |
|---|---|---|
| Ficheros en `src/` | 243 (36.732 líneas) | conteo de `.js` |
| Funciones de más de 120 líneas | 0 (la mayor, 114: `ia.js`) | parser (espree), no awk |
| Funciones de más de 60 líneas | 53 | parser |
| Ficheros de más de 400 líneas | 16 (el mayor, `retos.js`, 852) | conteo de líneas |
| Avisos de lint | 0 | `npx eslint .` |
| Tests | 1038 en 114 suites, todos en verde | `npm test` |
| Cobertura | líneas 75,4 %, ramas 62,7 %, funciones 78,2 % | `jest --coverage` |
| Dependencias con vulnerabilidades | 0 | `npm audit --omit=dev` |
| `catch` vacíos | 7 | búsqueda por texto (aproximada) |
| `TODO` / `FIXME` | 2 (uno dentro de un texto de panel) | búsqueda por texto |
| `console.log` en `src/` | 2 | búsqueda por texto |
| Índices de BD | 40 | migraciones 001–041 |
| Filas abiertas en el registro de deuda | 0 | `DEUDA_TECNICA.md` |

## Escala

Cada criterio se puntúa de 0 a 10 con la misma regla: 10 = sin hallazgos en ese criterio; cada hallazgo de la auditoría
resta según su peso. La media es la puntuación global.

| Área | Puntos | Por qué |
|---|---|---|
| Tamaño de funciones | 8 | Ninguna pasa de 120 líneas; quedan ficheros grandes |
| Organización | 7 | Reglas en `systems/`, UI en `paneles/`; `juegos/` aún mezcla handlers y reglas |
| Tests | 7 | Muchos tests y todo en verde; ramas al 63 % y 16 ficheros con cobertura baja |
| Lint y formato | 9 | Cero avisos |
| Base de datos | 8 | Índices medidos, ajustes de conexión, migraciones numeradas y probadas |
| Robustez | 7 | `catch` vacíos, `console.log` sueltos y algún `TODO` |
| Documentación | 8 | Changelog al día, registro de deuda vacío |

**Media: 7,7 / 10.**

## Hallazgos de la auditoría

- **Cobertura baja** en ficheros con lógica real: `xp/actividad.js` (7 % de líneas), `core/tareas.js` (11 %),
  `services/stt.js` (11 %), `commands/duende/ia.js` (13 %), `commands/duende/imagen.js` (15 %), `adminPanel/bank.js`
  (18 %), `core/mensajes.js` (23 %), `adminPanel/impuestos.js` (24 %), `services/seerrClient.js` (29 %).
- **Ficheros grandes:** `retos.js` (852), `commands/duende/duende.js` (776), `services/duende/liveVoz.js` (597),
  `paneles/perfil.js` (595), `systems/guildSettings.js` (527), `juegos/apuestas/quiniela.js` (513),
  `systems/apuestas/liquidacion.js` (508). `logros/catalogo.js` (518) es un catálogo de datos: no cuenta.
- **Duplicación:** tres pares de bloques casi idénticos de 8 líneas: `juegos/casino/adivinar.js` y `blackjack.js`;
  `systems/apuestas/destacado.js` y `clasificacionSemanal.js`; `adminPanel/niveles/config.js` e `ignorados.js`.
- **Errores silenciosos:** 7 `catch` vacíos (`services/duende/voz.js` x2, `systems/backups.js`, `core/logger.js`,
  `commands/voz/tts.js` x3).
- **Salida sin logger:** `console.log` en `index.js` y `core/registerCommands.js`.
- **Exports sin uso aparente:** 13 candidatos, varios probablemente falsos positivos (claves de objetos). Hay que
  verificarlos antes de quitar nada.
- **Sin hallazgos:** dependencias (0 vulnerabilidades), secretos literales (ninguno detectado), SQL con interpolación
  (todo revisado antes: solo placeholders o listas fijas).

## Segunda medida (2026-10-10, tras la auditoría)

Misma escala y mismos comandos que la línea base. Sobre `developer` tras #238, #239, #241, #242, #243 (merge a
developer, sin liberar) y #244 (merge a developer, sin liberar).

| Criterio | Línea base | Ahora | Cambio |
|---|---|---|---|
| Ficheros en `src/` | 243 (36.732 líneas) | 281 (37.161 líneas) | +38 ficheros: las piezas nuevas de los traslados |
| Funciones de más de 120 líneas | 0 (la mayor, 114: `ia.js`) | 0 (la mayor, 114: `ia.js`) | sin cambio |
| Funciones de más de 60 líneas | 53 | 53 | sin cambio (los traslados no tocaron funciones largas) |
| Ficheros de más de 400 líneas | 16 (el mayor, `retos.js`, 852) | 9 (el mayor, `catalogo.js`, 518, que es un catálogo de datos) | 8 sin contar el catálogo |
| Avisos de lint | 0 | 0 | sin cambio |
| Tests | 1038 en 114 suites | 1281 en 129 suites, todos en verde | +243 tests |
| Cobertura | líneas 75,4 %, ramas 62,7 %, funciones 78,2 % | líneas 85,3 %, ramas 71,0 %, funciones 87,9 % | +9,9 / +8,3 / +9,7 puntos |
| Dependencias con vulnerabilidades | 0 | 0 | sin cambio |
| `catch` vacíos | 7 | 0 | -7 |
| `TODO` / `FIXME` | 2 | 0 (el de `ia.js` se quitó el 2026-10-10) | -2 |
| `console.log` en `src/` | 2 | 0 | -2 |
| Índices de BD | 40 | 43 `CREATE INDEX` en migraciones | el recuento de la línea base no se pudo repetir igual: 43 es el número bruto de `CREATE INDEX` |
| Filas abiertas en el registro de deuda | 0 | 0 | sin cambio |

| Área | Puntos antes | Puntos ahora | Por qué |
|---|---|---|---|
| Tamaño de funciones | 8 | 9 | Ya no hay ficheros de código de más de 500 líneas; quedan 53 funciones de más de 60 líneas |
| Organización | 7 | 8 | Las reglas de quiniela y liquidación están fuera de `juegos/`; `juegos/` aún mezcla formularios y reglas en `apuestas.js` |
| Tests | 7 | 8 | 243 tests más y cobertura de ramas por encima del 70 %; quedan ficheros de administración con cobertura baja |
| Lint y formato | 9 | 9 | Cero avisos, igual que antes |
| Base de datos | 8 | 8 | Sin cambios en esta pasada |
| Robustez | 7 | 10 | Sin `catch` vacíos, `console.log` sueltos ni `TODO` |
| Documentación | 8 | 8 | Changelog al día y registro de deuda vacío; este documento se actualiza con cada medida |

**Media: 8,4 / 10** (antes 7,7). Con Robustez en 10, que es el estado tras quitar el último `TODO`, la media sube a 8,6. Es una valoración propia con los mismos criterios, no una medición externa.

### Lo que queda

- **Funciones largas:** 53 funciones de más de 60 líneas (la mayor, 114 en `ia.js`). Ninguna pasa de 120.
- **Ficheros grandes:** `juegos/apuestas/apuestas.js` (499), `juegos/casino/blackjack.js` (487), `juegos/casino/tragaperras.js` (473),
  `paneles/retos.js` (472), `paneles/casino.js` (467), `juegos/casino/adivinar.js` (439), `systems/duende/perfiles.js` (439) y
  `systems/plexFichas.js` (425). Están por debajo de 500 pero por encima de 400.
- **Cobertura baja que queda** (de la medida por fichero de la administración): `adminPanel/apodos.js` (28 %), `adminPanel/audit.js` (29 %),
  `adminPanel/niveles/usuarios.js` (32 %) y `adminPanel/seerr.js` (46 %). Los de la auditoría (#238, #239, #241) ya cumplen.
- **Duplicación:** los tres pares de la línea base no se han vuelto a medir en esta pasada.
- **Exports sin uso:** no se ha vuelto a medir.
- **Pendiente fuera del código:** las comprobaciones en Discord de #243 (voz en directo) y #244 (quiniela, perfil, rankings) antes de liberar a `main`.

## Para llegar a 10: hallazgos por área

Estado tras la segunda pasada del 2026-10-10. Un área llega a 10 cuando no le queda ningún hallazgo medido.

| Área | Puntos | Qué falta | Esfuerzo |
|---|---|---|---|
| Robustez | 10 | Nada: 0 `catch` vacíos, 0 `console.log` en `src/`, 0 `TODO`/`FIXME`. | — |
| Lint | 10 | `eqeqeq` pasa de `smart` a `always` (los `== null` siguen permitidos) y `no-shadow` está activo en `src/`. Cero avisos con las dos reglas. Las reglas de complejidad y `require-await` no se activan: darían 27 a 62 avisos, y son decisiones de estilo, no fallos. | — |
| Tamaño de funciones | 10 | Hecho (#278, #279): ninguna función de más de 60 líneas ni fichero de más de 400 en `src/`, salvo el catálogo de logros (datos). El lint vigila esos dos límites. | — |
| Organización | 9 | Hecho en #280: las reglas de quiniela, liquidación, apuestas, ruleta, tragaperras, adivinar y ppt están en `systems/`; `juegos/` tiene textos, handlers y flujo. Blackjack ya tenía sus reglas en `systems/blackjack.js`. Falta revisar fichero a fichero que no quede lógica suelta en `juegos/`. | Bajo |
| Tests | 10 | Los 11 fallos de producto que encontraron los tests están corregidos (lista abajo, cada test ya comprueba el comportamiento correcto). Totales: líneas 91,1 %, ramas 80,5 %, funciones 92,6 %, en 168 suites y 2010 tests. | — |
| Base de datos | 10 | Hecho (#281): consultas medidas con 50.000 usuarios y 300.000 apuestas (`docs/tecnico/MEDICION_BD.md`). No hace falta ningún índice nuevo; la decisión sobre las listas de columnas está escrita. El ranking lee un resumen por apostador (#285, cerrado: 3 ms con 49.251 apostadores). | — |
| Documentación | 8 | Revisado y corregido en esta pasada: README, FUNCIONALIDADES, SIGUIENTES_PASOS, PLEX_Y_SEERR, DEPLOY (sin `/diagnostico`, el enlace a DT-01 retirado y la copia de seguridad como decisión registrada). La política de merge quedó decidida (squash para feature, merge commit para `developer` → `main`). Falta: la sección de configuración de GitHub de CONTRIBUTING no se puede verificar desde aquí, no hay herramienta para la protección de ramas. | Bajo |

Media tras la quinta pasada: (10 + 10 + 10 + 10 + 9 + 10 + 8) / 7 = 9,6. Lo que queda: Documentación (#282, configuración de GitHub sin verificar) y Organización (revisión de `juegos/` fichero a fichero).

### Anexo: ficheros de src/ por debajo del objetivo (2026-10-10)

Objetivo: 60 % de líneas y 50 % de ramas. Formato: líneas / ramas.

| Fichero | Líneas | Ramas |
|---|---|---|
| `commands/voz/tts.js` | 11 % | 0 % |
| `services/duende/herramientas/seerr.js` | 14 % | 0 % |
| `core/interactionLog.js` | 19 % | 15 % |
| `commands/voz/escuchar.js` | 22 % | 7 % |
| `commands/voz/sonidos.js` | 22 % | 0 % |
| `services/giphy.js` | 22 % | 9 % |
| `paneles/cripto/mercado.js` | 26 % | 0 % |
| `commands/voz/conversacion.js` | 27 % | 0 % |
| `adminPanel/apodos.js` | 28 % | 18 % |
| `systems/xp/roles.js` | 28 % | 33 % |
| `adminPanel/audit.js` | 29 % | 25 % |
| `commands/economia/trabajar.js` | 29 % | 0 % |
| `commands/general/ping.js` | 30 % | 100 % |
| `commands/plex/plex.js` | 30 % | 9 % |
| `commands/progresion/pase.js` | 31 % | 0 % |
| `adminPanel/niveles/usuarios.js` | 32 % | 30 % |
| `systems/plexLinks.js` | 44 % | 32 % |
| `juegos/apuestas/combinada.js` | 45 % | 14 % |
| `adminPanel/seerr.js` | 46 % | 36 % |
| `commands/duende/duende.js` | 46 % | 0 % |
| `services/tautulliClient.js` | 48 % | 38 % |
| `systems/duende/memoria.js` | 48 % | 18 % |
| `systems/duende/personas.js` | 48 % | 43 % |
| `services/duende/chat/enviar.js` | 49 % | 38 % |
| `systems/guildSettings/acl.js` | 50 % | 30 % |
| `commands/duende/bola8.js` | 56 % | 100 % |
| `paneles/cripto/index.js` | 56 % | 25 % |
| `commands/economia/robar.js` | 57 % | 46 % |
| `systems/objetos.js` | 57 % | 41 % |
| `systems/adminAudit.js` | 59 % | 62 % |
| `juegos/casino/blackjack.js` | 62 % | 49 % |
| `systems/xp/rachas.js` | 66 % | 43 % |
| `juegos/casino/ruleta.js` | 71 % | 49 % |
| `services/geminiClient.js` | 74 % | 31 % |
| `services/duende/chat/generar.js` | 74 % | 40 % |
| `juegos/casino/ppt.js` | 75 % | 44 % |

Nota: `commands/duende/duende.js` aparece bajo porque es la fachada del comando; la lógica de `hablar` está en `services/duende/chat/`, y la cobertura de la voz en directo no se mide con tests (ver T-03).

## Tercera pasada: cobertura y fallos encontrados por los tests (2026-10-10)

Todos los ficheros de src/ están por encima del objetivo. Los tests escritos para llegar ahí encontraron fallos de
producto. En la cuarta pasada están **todos corregidos** (issues #263 a #277). Los tests que los documentaban con
`test.failing` ya comprueban el comportamiento correcto, y la columna «Estado» dice qué se cambió.

| # | Fichero | Fallo | Dónde está el test | Estado |
|---|---|---|---|---|
| 1 | `juegos/casino/ruleta.js` 181-187 | Se ignora el resultado de `procesarGanancia` / `procesarPerdida`: si falla la transacción, el embed anuncia el resultado y el saldo no cambia | `tests/ruletaCobertura.test.js` | Corregido: si el pago falla, la ruleta avisa del error y no anuncia resultado |
| 2 | `juegos/casino/blackjack.js` `responderNatural` 184-187 | Si falla el cobro de un blackjack natural no se llama a `terminarPartida`: la partida queda en memoria y bloquea al jugador hasta que se liquida por abandono | `tests/blackjackCobertura.test.js` | Corregido: el blackjack termina la partida aunque no se pueda cobrar |
| 3 | `systems/dinero.js` 21-37 | El tipo `"pase"` no está en el mapa de tipos: el cobro de las recompensas del pase aparece en el historial como `"otro"` | `tests/paseCobertura.test.js` | Corregido: `pase` se añade a TIPOS |
| 4 | `services/duende/herramientas/seerr.js` 86 | El cupo diario se gasta antes de resolver a la persona y antes de llamar a Seerr: una petición que falla también gasta el cupo | `tests/seerrHerramientasCobertura.test.js` | Corregido: el cupo de Seerr solo se gasta cuando Seerr acepta la petición |
| 5 | `services/duende/chat/enviar.js` 60 | `parseFloat(DUENDE_GIF_PROB) \|\| 0.08`: con `DUENDE_GIF_PROB=0` se usa el 8 %, así que no se pueden apagar los GIF | `tests/duendeEnviarCobertura.test.js` | Corregido: `DUENDE_GIF_PROB=0` apaga los GIF |
| 6 | `services/duende/chat/enviar.js` 80 | `recortarParaDiscord` puede dejar hasta 2015 caracteres, por encima del límite de 2000 de Discord (lo usa también `/escuchar` sin voz) | `tests/duendeEnviarCobertura.test.js` | Corregido: el margen incluye el aviso de truncado |
| 7 | `systems/duende/personas.js` 40 | El `\\b` sin la bandera `u` no reconoce letras acentuadas como límite de palabra: un nombre que empieza o acaba en tilde nunca se convierte en mención | `tests/duendePersonasCobertura.test.js` | Corregido: límites de palabra Unicode en las menciones |
| 8 | `systems/duende/personas.js` 73-75 | La comparación sin tildes no encuentra a un miembro con tildes en el nombre (`Tonin` no encuentra a `Tonín`) | `tests/duendePersonasCobertura.test.js` | Corregido: nombres con tildes se normalizan en los dos lados |
| 9 | `adminPanel/niveles/usuarios.js` 61 | La etiqueta del botón de multiplicador tiene 47 caracteres (límite de Discord: 45): el botón falla y no abre su formulario | `tests/nivelesUsuariosCobertura.test.js` | Corregido: etiqueta de 45 caracteres como máximo |
| 10 | `systems/xp/roles.js` 52 | `member?.toString?.()` devuelve `[object Object]` con un objeto plano: el anuncio de subida de nivel puede decir `[object Object] alcanzó el Nivel N` | `tests/xpRolesCobertura.test.js` | Corregido: se menciona por id cuando el miembro no está en caché |
| 11 | `adminPanel/audit.js` 5 | Pide 200 acciones, pero `adminAudit.listRecent` devuelve como mucho 100: el panel solo navega 100 | `tests/auditPanelCobertura.test.js` | Corregido: el panel pide 100 acciones, el máximo de `listRecent` |

Observaciones que no eran fallos de test, también resueltas en la cuarta pasada: `services/tautulliClient.js` ya no
marca las novedades como vistas si el canal no existe (se publican cuando vuelve); `adminAudit` guarda los detalles con
los secretos enmascarados (en la BD y en el log); el límite de Seerr rechaza los decimales; y el mensaje del multiplicador
muestra el valor que se guarda de verdad, no el que se pidió.

Cifras de la cobertura al cierre de la tercera pasada: líneas 91,1 %, ramas 80,5 %, funciones 92,6 % (antes 85,3 / 71,0 / 87,9).
