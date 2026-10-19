# Mapa de TTCL

## Reglas (`src/systems/cripto/`)

| Fichero | Qué hace |
|---|---|
| `mercado.js` | `TTCL` (precio inicial 100), `leerPool`, `getTtclPrecio`, `ttclPorMonedas`, `monedasPorTtcl`, `comprarTtcl`, `venderTtcl`, `ejecutarCompra`, `ejecutarVenta` (por % o `opciones.ttcl` exacto), `cotizarCompra`, `cotizarVenta`, `cooldownRestante` (sin gastar), `mercadoPausado`, `valorarCartera`, historial de precios con caché de 5 min. Lo usan `/cripto`, `/perfil`, el Duende (`precio_ttcl`) y las tareas. |
| `impacto.js` | `impactoDe(guildId, cot)`: % que movería el precio del mercado; `cripto.max_impacto_pct` (0 = sin tope). `mensajeImpacto`. |
| `ordenes.js` | Tabla `cripto_ordenes` (`alerta`, `stoploss`, `recurrente`; estados `activa`, `ejecutando`, `ejecutada`, `cancelada`). `revisar(avisar, mensajes)` cada minuto. `MAX_POR_TIPO = 5`; periodo de la recurrente de 1 h a 30 días. Un stop-loss que no puede vender por cooldown, límites o pausa se reintenta; sin TTCL, se cancela. |
| `ventaPorMonedas.js` | Cuánto TTCL vender para recibir N monedas netas; redondea hacia abajo. |
| `eventos.js` | Un evento al día de ±5 % a una hora aleatoria de Madrid; mueve la reserva de TTCL y avisa por DM a quien tiene TTCL. |
| `valoracion.js` | Caché de 30 s de la valoración de la cartera por servidor y persona; `invalidar` tras operar. |
| `consultas.js`, `ganancias.js`, `estadisticas.js` | Lecturas: historial, coste medio, quién tiene más, ganancia cobrada, resumen del periodo y ranking. |
| `graficos.js` | Línea de precio y donut de cartera (ECharts → SVG → PNG con resvg). |

## Pantallas e interacción

- `src/paneles/cripto/`: `index.js` (una función por pestaña), `comun.js` (pestañas y formatos), `mercado.js`, `cartera.js`, `historial.js`, `operar.js` (comprar y vender con confirmación y vista previa), `ordenes.js` (alertas, stop-loss, recurrente, vender por monedas).
- `src/commands/economia/cripto.js`: `/cripto`; botones `cripto_` y modales `cripto_modal_` (acl `cripto`).
- `src/perfil/criptoOrdenes.js`: botones, selects y modales `criptoord_` (acl `cripto`); no es un comando, el router lo registra desde `PERFIL_DIR`. Lee números del formulario con `.` de miles y `,` decimal.
- `src/discord/mensajes/criptoOrdenes.js`: textos de los avisos de órdenes.

## Tareas (`src/app/tareas.js`)

Órdenes de TTCL cada minuto; evento de TTCL cada 5 minutos (aplica el del día cuando llega su hora).

## Ajustes (`cripto.*`)

`fee_buy_pct` y `fee_sell_pct` (1 %), `cooldown_buy_sec` y `cooldown_sell_sec` (0), `min_buy`/`max_buy` y `min_sell`/`max_sell` (100 y 500.000), `pausa`, `max_impacto_pct` (0), `eventos_canal`. Se editan en `/paneladmin` → ⚙️ Config Global; el diagnóstico de TTCL está en 🩺 Sistema.

## Historia que importa

La migración 028 liquidó las criptos reales antiguas (BTC, ETH, SOL, BNB, XRP, DOGE) sin impuesto; solo queda TTCL (`ALL_CRYPTOS`). `ejecutarCompra` rechaza cualquier otro símbolo.
