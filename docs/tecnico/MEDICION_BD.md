# Medición de la BD con volumen realista (#281)

> **Nota (después de la medición, #285):** el ranking ya no recorre las apuestas. Lee `apuestas_resumen` (migración 043), que se reconstruye al terminar cada liquidación, y tarda 3 ms con 49.251 apostadores. Los hallazgos de abajo sobre `ranking()` (7,3 s, 690 ms) son de la versión anterior y se conservan como historia.

Base: e636c84. Esquema y migraciones del propio `src/core/db.js`, así que la medición usa el mismo arranque y la misma caché de sentencias que el bot.

## Volumen

Datos sintéticos con semilla fija (scripts en el scratchpad, no en el repo):

- usuarios y banco 50.000; historial 200.000; inventario 50.000; casino 100.000; cripto 76.461.
- apuestas_partidos 20.000 (1.200 abiertos a futuro, 500 sin liquidar); apuestas_usuario 300.000; quinielas 5.000 (40.000 partidos, 50.000 apuestas); combinadas 5.000; negocios 30.000; préstamos 2.000.
- objeto 300 y tienda 150 son supuestos. Sin retos, xp ni plex.

Método: 3 calentamientos y 20 ejecuciones (media), caché caliente, un contenedor. `EXPLAIN QUERY PLAN` antes y después de `ANALYZE`: ningún plan cambia.

## Consultas (25)

| # | Consulta (origen) | Plan | ms | Filas |
|---|---|---|---|---|
| Q01 | saldo (dinero.js:53) | SEARCH banco (PK) | 0,005 | 1 |
| Q02 | total historial (dinero.js:245) | SEARCH covering idx_historial_user_fecha | 0,057 | 1 |
| Q03 | historial página (dinero.js:248) | SEARCH idx_historial_user_fecha | 0,016 | 4 |
| Q04 | historial por tipo (dinero.js:248) | SEARCH idx_historial_usuario_tipo | 0,013 | 1 |
| Q05 | apostado hoy (limites.js:20) | SEARCH idx_historial_usuario_tipo | 0,010 | 0 |
| Q06 | ranking de riqueza (dinero.js:257) | SCAN banco + TEMP B-TREE | 2,95 | 10 |
| Q07 | partidos de la jornada (apostar.js:51) | SEARCH idx_apuestas_partidos_estado_deporte_inicio | 0,153 | 25 |
| Q08 | total de partidos (apostar.js:69) | SEARCH idx_apuestas_partidos_estado_deporte_inicio | 0,064 | 1 |
| Q09 | mis apuestas abiertas (misJugadas.js:13) | SEARCH idx_apuestas_usuario_user + TEMP B-TREE | 0,043 | 1 |
| Q10 | usuarios con apuestas (ranking.js:52) | SCAN de 2 índices covering + UNION | **71,1** | 49.498 |
| Q11 | mejor racha (ranking.js:17) | SEARCH idx_apuestas_usuario_user | 0,022 | 4 |
| Q12 | cron: partidos a liquidar (liquidacion/partidos.js:25) | SEARCH idx_apuestas_partidos_estado_inicio + EXISTS | 1,29 | 249 |
| Q13 | apuestas pendientes de partido (liquidacion/partidos.js:42) | SEARCH idx_apuestas_usuario_match | 0,052 | 15 |
| Q14 | cron: partidos caducados (caducidad.js:37) | SEARCH idx_apuestas_partidos_estado_inicio | 1,65 | 387 |
| Q15 | cron: quinielas caducadas (caducidad.js:44) | SEARCH idx_quinielas_estado_cerrada + EXISTS | 0,010 | 0 |
| Q16 | partidos para quiniela (quinielas.js:91) | SEARCH idx_apuestas_partidos_estado_deporte_inicio | 0,068 | 10 |
| Q17 | quiniela de la semana (quinielas.js:98) | SEARCH idx_quinielas_estado_deporte + TEMP B-TREE | 0,164 | 1 |
| Q18 | catálogo tienda (tienda.js:11) | SCAN tienda + SEARCH objeto (PK) | 0,50 | 152 |
| Q19 | protecciones (robar.js:42) | SEARCH covering idx_inventario_user | 0,017 | 0 |
| Q20 | inventario agrupado (objetos.js:28) | SEARCH idx_inventario_user + TEMP B-TREE | 0,026 | 0 |
| Q21 | cartera cripto (mercado.js:98) | SEARCH PK (userId, cripto) | 0,008 | 0 |
| Q22 | cron: cobro de negocios (negocios.js:161) | MULTI-INDEX OR (idx_negocios_usuario_ingreso) | 49,9 | 25.514 |
| Q23 | cron: usuarios del patrimonio (patrimonio.js:94) | SCAN covering banco | 24,8 | 50.000 |
| Q24 | cron: préstamos vencidos (prestamos.js:107) | SEARCH covering idx_prestamos_duende_vence | 0,23 | 650 |
| Q25 | total banco, panel admin (adminPanel/views.js:35) | SCAN banco | 2,03 | 1 |

Usuario muy activo (índice 0): Q11 2,63 ms (1.190 filas); Q19 0,18 ms (108 filas); Q20 0,71 ms (154 filas). Cruce con funciones reales del bot (`movimientos`, `masRicos`, `partidosDePagina`, `itemsTienda`): mismo orden de magnitud.

**Las tres más lentas**

1. Q10 (71 ms): SCAN de dos índices covering para obtener usuarios distintos. Ningún índice nuevo lo abarata: hay que leer 350.000 filas.
2. Q22 (50 ms): MULTI-INDEX OR, no SCAN. Devuelve 25.514 filas, y el bucle hace un UPDATE por fila (no medido).
3. Q23 (25 ms): SCAN de banco por diseño (cron sobre todos los usuarios).

**`ranking()` completo:** 7,3 s con 49.498 apostadores, llamado de forma síncrona desde `paneles/perfil/rankings.js:26`. Bloquea el proceso durante ese tiempo: varias consultas por apostador. Sin implementar: cachear el ranking o mantener agregados por apostador.

## SCAN que quedan

- Q06, Q18, Q23 y Q25: aceptables. Ranking, catálogo, cron de todos los usuarios y total admin; ninguno pasa de 25 ms.
- Q10: supera 50 ms, pero ya usa índices covering. No se propone índice; la vía es algorítmica (ver arriba).

## Listas de columnas

Cinco muestras, 1.000 ejecuciones cada una:

| Muestra | Lista explícita | SELECT * | Bytes por fila |
|---|---|---|---|
| C3 apuestas_partidos (lista = tabla) | 0,137 ms | 0,137 ms | 331 y 331 |
| C4 apuestas_usuario (lista = tabla) | 0,052 ms | 0,054 ms | igual |
| C5 quiniela_partidos (lista = tabla) | 0,027 ms | 0,027 ms | igual |
| C1 historial (omite id y userId) | 0,015 ms | 0,018 ms | 100 y 141 |
| C2 banco (omite userId y ultimoSueldo) | 0,003 ms | 0,004 ms | 43 y 102 |

**Decisión: se mantienen las listas explícitas, sin poda columna a columna.** En la mayoría de tablas la lista ya es toda la tabla. Donde omite columnas, el ahorro son microsegundos, y las consultas de página devuelven 10 a 25 filas. Una lista explícita además evita que una columna nueva cambie en silencio la forma del resultado. Podar las 68 listas no aporta nada medible y sí añade riesgo.

## Limitaciones

Datos sintéticos; Q15 devuelve 0 filas; solo lecturas, caché caliente y una máquina; `ranking()` medido una vez.
