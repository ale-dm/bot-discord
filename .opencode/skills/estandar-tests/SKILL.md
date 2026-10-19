---
name: estandar-tests
description: Convenciones de tests Jest de El Duende. Úsala solo cuando vayas a crear, modificar o revisar tests, mapear su cobertura o investigar un test que falla de forma intermitente.
---

Esta skill recoge las convenciones de tests que ya usa el repositorio. No es una guía genérica de Jest. Aquí están las reglas mínimas; el detalle está en `references/` y solo se lee cuando la tarea lo necesita.

## Reglas no negociables

1. **`test`, no `it`.** El repo usa `test(...)` de forma exclusiva.
2. **Nombres en español y orientados a comportamiento**: qué se espera, no qué función se llama.
3. **Un test, un comportamiento.**
4. **Sin servicios reales**: nunca Discord, Gemini, Odds API, Tautulli, Seerr, TMDB, Giphy, STT ni red real.
5. **Sin BD real**: nunca `data/banco.db`. `tests/setupEnv.js` fija `DB_PATH=:memory:`.
6. **Sin `.only`, `.skip`, `test.failing`, snapshots ni `test.concurrent`.**
7. **Sin `console.*`**: `setupEnv.js` ya apaga los logs.
8. **Restaura todo lo que cambies**: mocks, timers, `process.env`, `global.fetch`, temporales y estado global.
9. **Determinismo**: controla reloj, azar, orden de datos e IDs.
10. **Assertions sobre estado y efectos** (BD, saldo, inventario), no solo sobre la llamada a `reply`.
11. **Verificación real**: `npm test` en verde; si tocaste código de producción, `npm run check`.

## Comandos

Los tests viven en `tests/*.test.js` (entorno `node`, CommonJS, `tests/setupEnv.js` como `setupFiles`).

| Comando | Para qué |
|---|---|
| `npx jest tests/foo.test.js` | Un solo archivo. |
| `npx jest -t "texto del test"` | Un test o grupo por nombre. |
| `npm test` | Toda la suite; es lo que corre la CI. |
| `npx jest --coverage` | Cobertura por líneas, ramas y funciones. |
| `npm run check` | ESLint + Prettier + Jest. Obligatorio antes de cerrar un cambio de código. |

La CI (`.github/workflows/test.yml`) ejecuta `npm test` en PR y push a `main` y `developer`. Cuando reportes, indica el comando exacto y el resultado real.

## Qué leer según la tarea

| Si vas a… | Lee |
|---|---|
| Crear un archivo de tests o decidir qué casos cubrir | `references/escritura.md` (organización, anatomía, nombres, casos mínimos, cobertura, anti-patrones) |
| Preparar datos, probar migraciones, mockear APIs o controlar reloj y azar | `references/datos-y-mocks.md` |
| Probar comandos, botones, menús o modales | `references/discord-falso.md` |
| Revisar tests o cerrar el trabajo | `references/checklist.md` (checklist y Definition of Done) |

Lee solo el fichero que corresponda. Si la tarea no encaja en ninguna fila, bastan las reglas de arriba.

## Plantilla

Para un archivo nuevo, copia `templates/test-base.template.js` a `tests/<área>.test.js` y adáptalo; no lo dejes con nombres genéricos.
