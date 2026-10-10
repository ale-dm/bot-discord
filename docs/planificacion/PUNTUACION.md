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
| Lint | 9 | Hecho: `no-shadow` activo, con 5 casos corregidos renombrando variables internas. Sigue en 9 porque no quedó anotado qué le faltaba en la línea base, así que no sé si el punto era otra regla. Medido por si acaso: `complexity` 15 da 62 avisos y 20 da 27; `require-await` 55; `consistent-return` 48. Hay que decidir cuál de ellas cuenta. | Bajo, pero necesita una decisión |
| Tamaño de funciones | 9 | 53 funciones de más de 60 líneas en 42 ficheros (lista en la sección anterior). Ficheros de más de 400 líneas: 8. | Alto |
| Organización | 8 | `juegos/` mezcla textos, reglas y flujo en `apuestas.js` (499) y en los juegos de casino. Hay que decidir caso por caso qué regla sale a `systems/`. | Medio |
| Tests | 8 | Cobertura de todo el repositorio medida: 36 ficheros de `src/` están por debajo del 60 % de líneas o del 50 % de ramas (anexo abajo). | Medio-alto: son muchos tests nuevos |
| Base de datos | 9 | Hecho: índice de `tienda.objetoId` (migración 042), 0 claves foráneas sin índice, `SELECT *` sustituido por columnas explícitas en 68 consultas (la de la migración 007 se queda a propósito, porque vuelca tablas de esquema desconocido), y el plan revisado en 344 consultas literales: 14 con `SCAN`, todas agregados o listas completas (saldos, ranking, cron) o tablas pequeñas de configuración y panel. Falta medir con volumen real: las pruebas usan muestras de 400 filas. El coste: esas listas de columnas hay que mantenerlas a mano si cambia el esquema. | Bajo |
| Documentación | 8 | Revisado y corregido en esta pasada: README, FUNCIONALIDADES, SIGUIENTES_PASOS, PLEX_Y_SEERR, DEPLOY (sin `/diagnostico`, el enlace a DT-01 retirado y la copia de seguridad como decisión registrada). La política de merge quedó decidida (squash para feature, merge commit para `developer` → `main`). Falta: la sección de configuración de GitHub de CONTRIBUTING no se puede verificar desde aquí, no hay herramienta para la protección de ramas. | Bajo |

Con los cambios de esta pasada, la media queda en 8,7 (Lint, Base de datos y Robustez, según la tabla).

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
