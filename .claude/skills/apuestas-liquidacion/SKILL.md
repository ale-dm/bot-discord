---
name: apuestas-liquidacion
description: Apuestas deportivas de El Duende (src/systems/apuestas/, su liquidación y src/juegos/apuestas/). Cárgala siempre que la tarea toque apostar a un partido, mercados, marcador exacto, combinadas, quinielas, cancelaciones, límites de apuesta, la Odds API o la liquidación (cron horario o 💸 Liquidar ahora), o revise un cambio ahí. No la cargues para el casino ni para los retos sin partido.
---

Las reglas viven en `src/systems/apuestas/` (sin Discord); `src/juegos/apuestas/` solo traduce a mensajes y botones. La liquidación está en `src/systems/apuestas/liquidacion/` detrás de la fachada `liquidacion.js`. Mapa de ficheros y tablas en `references/mapa.md`; el flujo de liquidación paso a paso, en `references/liquidacion.md`.

## Reglas no negociables

1. **Cobrar y registrar, todo o nada.** Cada apuesta (simple, combinada, quiniela) cobra con `dinero.cobrarCombinado` (negro y luego efectivo) dentro de la misma `db.transaction` que inserta la fila y apunta `dinero.apuntar(userId, "apuestas", …, -cantidad)` en negativo. Así el tope diario y el historial cuadran.
2. **Comprobaciones síncronas y en orden** (`formularioApuesta.apostarAPartido`): cantidad, saldo, partido, abierto (`directo.abiertoParaApostar`), cuota, duplicado, límites y cobro, sin `await` entre medias. No metas un `await` ahí: dos formularios a la vez podrían apostar dos veces.
3. **La cuota y la línea se guardan con la apuesta** y se liquida con las suyas, aunque la API cambie después. En combinadas se vuelve a comprobar la cuota de cada pata antes de cobrar.
4. **Liquidar una sola vez.** Cada fila pasa a `pagado = 1` (o la combinada/quiniela cambia de `estado`) en la misma transacción que paga. Nunca pagues sin marcar ni marques fuera de la transacción.
5. **Un solo cerrojo**: `liquidarApuestas` devuelve `null` si ya hay una en curso; el cron va con `noOverlap`. No crees otra vía de liquidar que se lo salte.
6. **Lo que no se puede resolver se devuelve.** Pasados `DIAS_RESULTADOS` días sin resultado: partido `caducado`, quiniela `caducada`, combinada `reembolsada` y retos devueltos. Una quiniela sin nadie con el mínimo de aciertos (`minimoAciertosQuiniela`, la mitad redondeando hacia arriba) también devuelve lo apostado.
7. **No gastes cuota de la Odds API**: los resultados de cada deporte se piden una vez por pasada (`scoresDe`) y solo para partidos con algo pendiente; la liquidación automática espera `AUTO_MIN_HORAS_DESDE_INICIO` horas.
8. **Límites** (`limites.comprobar`): primero el límite de pérdidas personal, luego tope diario (hora de Madrid, sale del historial) y máximo por partido. La quiniela solo cuenta para el tope diario.
9. **Sin Discord en `systems/`**: los avisos (DM, resumen público, sonido de apuesta grande) los hace `src/discord/envios/apuestas.js` con lo que devuelve el resumen. Best-effort: un DM cerrado no rompe nada.
10. El dinero sigue `economia-dinero`: cárgala también si cambias cómo se cobra o se paga.

## Tests

Carga `estandar-tests`. La Odds API nunca de verdad: `global.fetch` simulado como en `tests/pagarapuestas.test.js` (con `ODDS_API_KEY` de prueba) o `jest.mock("../src/services/oddsApi")` como en `tests/quinielaFlujo.test.js`. Comprueba saldo final, `pagado`/`estado`, historial y que una segunda liquidación no paga nada.

## Revisión

Pagar sin marcar en la misma transacción, un `await` entre comprobación y cobro, o una liquidación que no reembolsa lo caducado es **Alto** como mínimo.
