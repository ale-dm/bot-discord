# Liquidación paso a paso

Entrada única: `liquidarApuestas({ minHorasDesdeInicio, origen })` en `liquidacion/orquesta.js`. La llaman el cron de `src/app/tareas.js` (con `AUTO_MIN_HORAS_DESDE_INICIO = 2`) y el botón 💸 Liquidar ahora de `/paneladmin` → ⚽ Apuestas (antes `/pagarapuestas`).

1. **Cerrojo**: si `liquidacionEnCurso`, devuelve `null`. Sin `ODDS_API_KEY`, lanza error.
2. **Cortes**: `corte` = ahora − `minHorasDesdeInicio`; `limite` = ahora − `DIAS_RESULTADOS` días.
3. **Caducidad** (`caducidad.caducarSinResultado`): partidos abiertos y quinielas con partidos sin resultado anteriores a `limite`. En una transacción: reembolso de apuestas sueltas (`pagado = 1`, `premio = cantidad`), combinadas con una pata en el partido (`reembolsada`), retos (`retos.devolverPorPartido`) y quinielas (`premio = 0`, estado `caducada`, se borran los borradores).
4. **Partidos sueltos** (`partidos.liquidarPartidosSueltos`): solo los abiertos entre `limite` y `corte` con apuestas, patas o retos pendientes. Resultados con `scoresDe(deporte)` (una petición por deporte y pasada; si falla, se salta). Cada partido con resultado se cierra en su propia transacción (`cerrarPartidoEnTransaccion`): `finalizado`, cada apuesta gana (`round(cantidad × cuota)`) o pierde, `pagado = 1`; combinadas (`combinadas.resolverPartido`); retos (`retos.resolverPartido`). Registra el pase (`pase.registrarEnTodos`).
5. **Quinielas** (`quinielas.liquidarQuinielas`): guarda cada `resultado_final` en cuanto se conoce (una jornada dura de viernes a lunes y el primer partido sale de la ventana de la API). Cuando están todos: aciertos por letra, premio = `floor(bote × 0,9 / ganadores)` para los que tienen el máximo, si llega al mínimo; si no, se devuelve todo. Pago y cierre en una transacción.
6. **Ranking**: `reconstruirResumen()` en el `finally`; si falla, solo se registra.
7. **Después** (fuera de `systems/`): `avisarGanadores` (DM salvo silenciados), `anunciarResultados` (canal de resultados del servidor) y `retos.actualizarMensajes`.

## El resumen

`{ pagadas, fallidas, total, partidosProcesados, quinielasCerradas, premiosQuiniela, caducados, reembolsos, pagos: [{ userId, premio, descripcion, reembolso? }], partidos, quinielas, retos, retosCerrados }`. Si añades un efecto nuevo, apúntalo aquí y deja que el adaptador de Discord lo publique.

## Al cambiar algo

- Pagos con `dinero.pagar` + `dinero.apuntar(…, "apuestas", …, premio)`, como el resto de la liquidación: no metas impuestos ni otro tipo sin decidirlo antes.
- Un estado nuevo de partido, combinada o quiniela necesita migración (`migracion-sqlite`) y revisar todas las consultas que filtran por `estado`.
- Tests de referencia: `pagarapuestas`, `combinadasLiquidacion`, `quinielaFlujo`, `quinielaReglas`, `cancelarApuesta`, `limitesApuestas`, `mercadosGolesHcap`, `marcadorExacto`, `apuestasDirecto`, `retos*`.
