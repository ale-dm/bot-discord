# Mapa de las apuestas

## Reglas (`src/systems/apuestas/`)

| Fichero | Qué hace |
|---|---|
| `apostar.js` | Cuota de cada elección (`cuotaDeEleccion`), cobro + insert en una transacción (`cobrarApuesta`), listado paginado de partidos (`partidosDePagina`, 25 por página), `partidoPorMatch` y `COLUMNAS_PARTIDO`. |
| `formularioApuesta.js` | `apostarAPartido`: todas las comprobaciones y el cobro. Devuelve `{ motivo: null, … }` o `{ motivo }` (`cantidad`, `sinEfectivo`, `sinPartido`, `cerrado`, `cuota`, `duplicada`, `limite`). Decodifica los `customId` `apuesta_{home\|draw\|away\|exacto}_<match>` y `apuesta_mercado_<mercado>_<match>`. `MIN_BET_AMOUNT`/`MAX_BET_AMOUNT` salen de `.env` (10 y 1000 por defecto). |
| `mercados.js` | Más/menos goles (`mas`/`menos`, línea 2,5) y hándicap (`casa`/`fuera`, línea 1,5). `acierta(eleccion, resultado, marcador, linea)` decide todas, también 1X2 y exacto. Líneas medias: nunca hay push. |
| `marcador.js` | Marcador exacto: elección `exacto_<l>-<v>`, premio fijo `PREMIO = 8` (la API no da cuota), hasta `MAX_GOLES = 20`. |
| `directo.js` | `ODDS_DIRECTO=1` deja apostar durante `DURACION_MS` (2 h) tras el inicio. Retos y quinielas siguen cerrando al empezar. |
| `combinadas.js` | Boletos de 2 a 5 patas, una por partido; cuota = producto. Sin marcador exacto. Borrador privado en `combinada_borrador`. `resolverPartido` y `caducarPartido` los llama la liquidación. |
| `quinielas.js`, `quinielaReglas.js`, `borradorQuiniela.js` | Jornada de 10 partidos (1/X/2 por letra), bloqueo por tiempo, cierre de la jornada, pronósticos a medias. |
| `cancelar.js` | Cancelar antes de que empiece: borra la apuesta y devuelve lo apostado menos `COMISION_PCT = 10` % (mínimo 1). Transacción con `DELETE … AND pagado = 0`. |
| `limites.js` | `comprobar(guildId, userId, cantidad, { matchId })`; ajustes `apuestas.tope_diario` y `apuestas.max_partido` (0 = sin límite). |
| `misJugadas.js`, `ranking.js`, `resumenSemanal.js`, `exportar.js`, `alertasCuota.js`, `recordatorios.js`, `liga.js`, `destacado.js` | Lecturas, ranking (`reconstruirResumen` tras cada liquidación), avisos y extras. |

## Interfaz (`src/juegos/apuestas/`)

`apuestas.js` (entrada desde `/juegos`, prefijos `apuestas_`, `apuesta_*`, modal `apuestas_modal_`), `partido.js` (ficha, botones, modal y confirmación), `rechazo.js` (texto de cada `motivo`), `combinada.js`, `repetir.js`, `alertas.js`, `listado.js`, `exportar.js` y `quiniela/` (`servicio.js` es el caso de uso: los manejadores no consultan la BD).

## Tablas

`apuestas_partidos` (estado `abierto` → `finalizado` | `caducado`, cuotas y líneas), `apuestas_usuario` (`pagado`, `premio`, `linea`), `combinadas` (`abierta` → `ganada` | `perdida` | `reembolsada`) y `combinada_patas` (`pendiente` → `acierta` | `falla` | `caducada`), `quinielas` (`abierta` → `cerrada` | `caducada`), `quiniela_partidos` (`resultado_final`), `quiniela_apuestas`, `retos`. Los movimientos van a `historial` con tipo `apuestas`.

## Fuera de esta carpeta

- `src/services/oddsApi.js`: `DEPORTES`, `DIAS_RESULTADOS` (3), `obtenerResultados`, `resultadoDeScore`, `sincronizarPartidos`, créditos restantes (`ODDS_CREDITOS_AVISO`).
- `src/systems/retos.js`: retos 1 contra 1 a un partido (`resolverPartido`, `devolverPorPartido`).
- `src/app/tareas.js`: cron de la liquidación (minuto 15 de cada hora, Madrid, `noOverlap`).
- `src/discord/envios/apuestas.js`: `avisarGanadores`, `anunciarResultados`, sonido de apuesta grande.
- `src/adminPanel/apuestas*`: ⚽ Apuestas del panel admin (liquidar ahora, canal, límites, quiniela).
