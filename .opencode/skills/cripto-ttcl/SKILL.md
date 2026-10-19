---
name: cripto-ttcl
description: La criptomoneda TTCL de El Duende: pool de liquidez (x·y = k), compra y venta, comisiones, cooldowns, tope de impacto, pausa, eventos diarios, órdenes (alertas, stop-loss, compra recurrente), venta por monedas, cartera, historial y gráficas de /cripto. Cárgala siempre que la tarea toque src/systems/cripto/, src/paneles/cripto/, src/perfil/criptoOrdenes.js, src/commands/economia/cripto.js o los ajustes cripto.*, o revise un cambio ahí. No la cargues para el resto de la economía sin TTCL.
---

Las reglas están en `src/systems/cripto/` (sin Discord; `mercado.js` es la entrada); las pantallas, en `src/paneles/cripto/`; los botones `cripto_*` en `src/commands/economia/cripto.js` y los `criptoord_*` en `src/perfil/criptoOrdenes.js`. Mapa completo en `references/mapa.md`.

## Reglas no negociables

1. **El precio sale del pool** (`cripto_pool`, fila `id = 1`): precio = monedas / TTCL, y cada operación mantiene monedas × TTCL constante. No fijes ni edites el precio a mano; un evento mueve la reserva de TTCL del pool, no el precio.
2. **Toda operación en una `db.transaction`**: leer el pool, cobrar o pagar, mover el pool, la cartera (`cripto_carteras`), el historial (`cripto_historial`) y el punto de precio (`cripto_ttcl_precios`). Nada a medias.
3. **Dinero por `dinero.js`**: comprar con `dinero.cobrar` (solo 💵 efectivo, nunca el banco) y `dinero.apuntar(…, "cripto", …, -coste)`; vender con `dinero.pagarSinImpuesto(userId, "cripto", …)`: la venta no paga impuesto de ingreso, pero sí cobra la deuda con el Duende. Carga `economia-dinero` si tocas esto.
4. **La comisión se queda en el pool** (`cripto.fee_buy_pct`, `cripto.fee_sell_pct`); se calcula con `Math.floor` sobre enteros de monedas.
5. **Orden de comprobaciones en `ejecutarCompra` / `ejecutarVenta`**: símbolo, pausa (`cripto.pausa`), mínimo y máximo, tope de impacto (`impacto.impactoDe`), y solo después el cooldown (`checkAndConsumeLimit`, `cripto_buy`/`cripto_sell`), para que una operación rechazada no gaste el cooldown.
6. **Sin dobles ventas**: la cartera se descuenta con `UPDATE … WHERE cantidad >= ?` dentro de la transacción y se comprueba `changes`. Mantén ese patrón.
7. **Órdenes una sola vez**: alerta y stop-loss se reclaman cambiando el estado (`activa` → `ejecutando`); la compra recurrente adelanta `proxima` con `UPDATE … WHERE proxima = ?` antes de comprar. Usan las mismas `ejecutarCompra`/`ejecutarVenta` que una operación manual, nunca sacan del banco, y como mucho `MAX_POR_TIPO` activas por tipo.
8. **Después de operar**: `valoracion.invalidar`, el pase y los logros (`cripto_*`, `ttcl_hold_max`), como en `ejecutarCompra`. Si añades una vía nueva de operar, pasa por esas funciones.
9. **Ajustes nuevos** `cripto.*` en `definicion.js` (`DEFAULT_FLAT` y `KEY_TYPES`) y en ⚙️ Config Global del panel admin.
10. **Gráficas sin navegador**: ECharts a SVG y `@resvg/resvg-js` a PNG, con la fuente de `assets/fonts`. No añadas `canvas`.

## Tests

Carga `estandar-tests`. Siembra el pool y la cartera en la BD en memoria y comprueba precio antes y después, saldo, cartera, historial y comisión; incluye pausa, cooldown, impacto, saldo insuficiente y venta doble. Referencias: `tests/criptoFase9.test.js`, `criptoImpacto`, `criptoSinImpuesto`, `panelesCripto`, `graficosCripto`.

## Revisión

Una operación fuera de transacción, que toque el precio sin pasar por el pool, que saque del banco o que gaste el cooldown antes de validar es **Alto** como mínimo.
