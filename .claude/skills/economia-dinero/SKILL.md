---
name: economia-dinero
description: Reglas del dinero de El Duende (src/systems/dinero.js). Cárgala siempre que la tarea cobre, pague, transfiera, aplique impuestos o toque efectivo, banco, dinero negro, tienda, trabajo, robos, préstamos, negocios o patrimonio, o revise un cambio que mueva saldos.
---

El dinero de cada usuario está en la tabla `banco` en tres sitios: 💵 efectivo (`enMano`, lo que se gasta), 🏦 banco (`saldo`, solo se ingresa y se saca) y 🥷 negro (`negro`, lo robado: se gasta antes que el efectivo, no entra al banco ni paga impuestos hasta blanquearse).

## Reglas no negociables

1. **Todo movimiento pasa por `src/systems/dinero.js`.** Nada de `UPDATE banco` fuera de ese módulo. Únicas excepciones documentadas: `src/systems/casinoTransactions.js` y `src/adminPanel/bank.js`.
2. **Elige la función por el sitio del dinero**:
   - Cobrar al usuario para gastar: `cobrarCombinado` (negro primero, luego efectivo) o `cobrar` si solo vale efectivo; comprueba antes con `saldoGastable`.
   - Pagar al usuario: `pagar` (efectivo), `pagarNegro`, `pagarBanco`; con impuestos `pagarConImpuesto(userId, guildId, tipo, descripcion, cantidad)`, sin ellos `pagarSinImpuesto`.
   - Mover entre efectivo y banco: `ingresar` / `sacar`. Entre usuarios: `transferir`.
3. **Siempre con `tipo`** del objeto `TIPOS` para que aparezca en Movimientos. Si el tipo no existe, añádelo a `TIPOS` con su emoji; no uses `otro` por comodidad.
4. **Enteros y validación**: cantidades enteras positivas (`validarCantidad`), respetando `LIMITE_OPERACION`. Nada de decimales ni redondeos implícitos.
5. **Atomicidad**: si un cobro y otro efecto (crear apuesta, dar objeto) deben ir juntos, envuélvelos en `db.transaction(...)`. Nunca cobres y luego falles sin devolver.
6. **Sin saldos negativos** salvo que la mecánica lo diga explícitamente (préstamos): comprueba el saldo antes de cobrar y gestiona el «no tienes suficiente».
7. **Idempotencia** en premios y reembolsos: una liquidación repetida o un doble clic no puede pagar dos veces (marca el estado en la misma transacción).
8. Los textos al usuario usan `core/formato.js` para las cantidades.

## Tests

Carga `estandar-tests`. Comprueba el saldo final en cada sitio (efectivo, banco, negro) y la fila del historial con su `tipo`, incluidos los casos de saldo insuficiente, cantidad 0, negativa o no entera y doble ejecución.

## Revisión

Un cambio que mueve dinero sin pasar por `dinero.js`, sin transacción o sin tipo es como mínimo **Alto**.
