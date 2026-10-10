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
