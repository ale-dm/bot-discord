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
| `TODO` / `FIXME` | 2 | 1 (un comentario de `ia.js` sobre una API de Discord futura) | -1 |
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
| Robustez | 7 | 9 | Sin `catch` vacíos ni `console.log` sueltos; queda un `TODO` |
| Documentación | 8 | 8 | Changelog al día y registro de deuda vacío; este documento se actualiza con cada medida |

**Media: 8,4 / 10** (antes 7,7). Es una valoración propia con los mismos criterios, no una medición externa.

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
