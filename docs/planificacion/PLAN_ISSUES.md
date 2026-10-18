# Plan de las issues (terminado)

Estado a 2026-10-18: **plan terminado, 0 issues abiertas**. Las 185 issues (bugs, rendimiento, features, verificaciones
de modales y los tres refactors de la fase 2) están hechas, probadas en Discord y en `main`; el detalle, en el
[CHANGELOG](../CHANGELOG.md). Las ideas nuevas se añaden como issue con la etiqueta `feature-idea`.

| Tipo | Nº | Números |
|---|---|---|
| Refactor (arquitectura limpia) | 3 | #472, #474, #475 (cerradas) |
| Bugs, rendimiento, features y modales | 182 | cerradas (ver [CHANGELOG](../CHANGELOG.md)) |

Este documento recoge el orden en que se trabajó. Cada issue aparece **una sola vez**, en una fase. Se conserva como
registro; lo que falte, en [SIGUIENTES_PASOS](../SIGUIENTES_PASOS.md) y en las issues nuevas con `feature-idea`.

## Principios

1. **Medir antes de optimizar.** Las cifras de rendimiento salen de benchmarks aislados. #481 mide en producción, y las
   demás issues de rendimiento citan esa medida antes de tocar código.
2. **Bugs antes que features.** Los bugs del plan (#468, #469 y #470) ya están corregidos y en `main`.
3. **Cimientos antes que el área.** Un grupo de features que toca código acoplado empieza después de su refactor (columna
   *Requiere*). Así no se añade acoplamiento nuevo.
4. **Los refactors no cambian el comportamiento.** Su criterio es que los tests de comportamiento pasen sin tocar sus
   expectativas, y que el grep de dependencias quede limpio.
5. **Cada fase termina con una prueba en Discord** de lo que se ha tocado. No se pasa a la siguiente fase sin ella.
6. **Un grupo, un PR a `developer`** (squash). De `developer` a `main`, cuando se pida la release.

## Fases de un vistazo

Estado: **todas las fases (0 a 15) están terminadas, probadas en Discord y cerradas**, incluida la fase 2 de refactor
(#472, #474, #475). No queda nada por hacer.

| Fase | Qué contiene | Nº | Condición de salida |
|---|---|---|---|
| [0](#fase-0-cerrar-lo-abierto-y-medir) | Cerrar lo abierto: bugs de sonidos, PR de sonidos, verificación de modales, medición | 14 | Sonidos en `developer`; medición publicada; decisiones tomadas |
| [1](#fase-1-victorias-rápidas-sin-refactor) | Victorias rápidas que no dependen de refactors | 11 | Sonidos y dedupe probados en Discord; mediciones antes/después |
| [2](#fase-2-cimientos-refactor-y-rendimiento-que-depende-de-ellos) | Refactors de arquitectura y los dos rendimientos que los necesitan | 12 | `grep` de dependencias limpio; tests de comportamiento sin cambios |
| [3](#fase-3-juego-responsable-y-casino) | Juego responsable y casino | 13 | Probado en Discord y cerrado |
| [4](#fase-4-apuestas-y-quinielas) | Apuestas y quinielas | 11 | Probado en Discord y cerrado |
| [5](#fase-5-pase-de-batalla-y-sonidos-avanzados) | Pase de batalla y sonidos avanzados | 13 | Probado en Discord y cerrado |
| [6](#fase-6-niveles-xp-y-logros) | Niveles, XP y logros | 11 | Probado en Discord y cerrado |
| [7](#fase-7-economía-y-tienda) | Economía y tienda | 12 | Probado en Discord y cerrado |
| [8](#fase-8-impuestos-y-robos) | Impuestos y robos | 2 | Probado en Discord y cerrado |
| [9](#fase-9-perfil-clasificación-y-patrimonio) | Perfil, clasificación y patrimonio | 12 | Probado en Discord y cerrado |
| [10](#fase-10-criptomonedas) | Criptomonedas | 13 | Probado en Discord y cerrado |
| [11](#fase-11-retos-entre-jugadores) | Retos entre jugadores | 12 | Probado en Discord y cerrado |
| [12](#fase-12-el-duende-e-ia) | El Duende e IA | 13 | Probado en Discord y cerrado |
| [13](#fase-13-plex-y-seerr) | Plex y Seerr | 13 | Probado en Discord y cerrado |
| [14](#fase-14-administración-y-tareas-automáticas) | Administración y tareas automáticas | 12 | Probado en Discord y cerrado |
| [15](#fase-15-utilidades-y-comandos-generales) | Utilidades y comandos generales | 11 | Probado en Discord y cerrado |

Las fases 0 a 2 van en orden. Las fases 3 a 15 son independientes entre sí: cada una empieza cuando la fase 2 está
hecha y sus requisitos (columna *Requiere* de cada grupo) también. Dentro de una fase, los grupos pueden ir en paralelo.
Ninguna fase tiene más de 13 issues.

## Riesgos

| Riesgo | Mitigación |
|---|---|
| Un refactor cambia un comportamiento sin que los tests lo vean | Tests de caracterización antes de mover código (en #479 y en cada refactor) |
| Límites de Discord (25 opciones en un menú, 45 caracteres en una etiqueta) | #470 lo resuelve de forma general; revisarlo en cada feature nueva |
| Una decisión de producto bloquea una feature a mitad | Las decisiones se toman en la fase 0 (sección final), no al empezar el grupo |
| Dos migraciones con el mismo número | Número libre en el momento de crear la migración (hoy, el 071); #325 y #484 la usan |
| Un PR de un grupo arrastra cambios de otro | Un grupo por PR; si toca un refactor a medias, esperar a que se mergee |

---

## Fase 0: cerrar lo abierto y medir

Es la fase que bloquea todo lo demás: sin ella, la rama de sonidos no se puede subir.

### Bugs que bloquean la rama de sonidos

| # | Título | Prioridad | Nota |
|---|---|---|---|
| [#468](https://github.com/ale-dm/bot-discord/issues/468) | Cambiar el archivo mientras suena otro lo sobrescribe | Alta | Corregido en la rama `claude/compassionate-newton-udiuga` (cambio de archivo reserva el servidor). Falta probarlo en Discord |
| [#469](https://github.com/ale-dm/bot-discord/issues/469) | La descarga del archivo no tiene tiempo límite | Media | Corregido en la rama (descarga con tiempo límite y tamaño anunciado). Falta probarlo en Discord |
| [#470](https://github.com/ale-dm/bot-discord/issues/470) | Listas de Discord cortadas a 25 sin avisar | Media | Existía antes. #323 (fase 1) depende de ella |

### Sonidos listos para mergear

| # | Título | Estado |
|---|---|---|
| [#321](https://github.com/ale-dm/bot-discord/issues/321) | Renombrar y cambiar archivo | En la rama, sin probar en Discord. Mergear tras #468 y #469 |
| [#322](https://github.com/ale-dm/bot-discord/issues/322) | Probar desde el panel | En la rama, sin probar en Discord. Mergear tras #468 y #469 |

### Verificación en Discord (sin código nuevo)

| # | Qué probar | Estado |
|---|---|---|
| [#305](https://github.com/ale-dm/bot-discord/issues/305) | G1: sí/no en grupos de radio | Hecho |
| [#306](https://github.com/ale-dm/bot-discord/issues/306) | G2: canales con selector | Hecho |
| [#307](https://github.com/ale-dm/bot-discord/issues/307) | G3: roles y personas con selector | Hecho |
| [#308](https://github.com/ale-dm/bot-discord/issues/308) | G4: opciones cerradas y horas | Hecho |
| [#309](https://github.com/ale-dm/bot-discord/issues/309) | G5: importes rápidos | Hecho |
| [#310](https://github.com/ale-dm/bot-discord/issues/310) | G6: ruleta en dos pasos y cine | Hecho |
| [#303](https://github.com/ale-dm/bot-discord/issues/303) | Idea original de los modales | Cerrada |
| [#282](https://github.com/ale-dm/bot-discord/issues/282) | Protección de ramas y Project board | Protección hecha; Project board pendiente |

### Medición

| # | Título | Medido |
|---|---|---|
| [#481](https://github.com/ale-dm/bot-discord/issues/481) | Medir latencias por manejador antes de optimizar | Es la medida que valida el resto de rendimiento |

### Decisiones a tomar en esta fase

Ninguna de estas bloquea código ahora, pero cada una bloquea un grupo de la fase 3 si no se toma:

- **#432 o #414**: avisar a la víctima de `/robar` siempre, o solo si lo activa. Se excluyen entre sí. Bloquea las fases 8 y 15.
- **#422 o #431**: alertas de administración y preferencias personales, unidas o separadas. Bloquea las fases 14 y 15.
- **#319**: pérdidas netas o total apostado. Bloquea la fase 3.
- **#397**: si el interés del impuesto de patrimonio se exime también. Bloquea la fase 9.
- **#324**: si el cooldown de sonidos aplica a los admins (propuesta: no). Bloquea la fase 1.
- **#297**: si el probar del admin cuenta en las estadísticas (propuesta: sí). Bloquea la fase 1.

**Condición de salida de la fase 0:** #321 y #322 mergeadas a `developer` con #468 y #469 arreglados; #481 publicada; los
modales (#305–#310) verificados en Discord; las decisiones de arriba registradas en su issue.

---

## Fase 1: victorias rápidas sin refactor

Features y rendimientos que no necesitan ningún refactor de la fase 2. Son de riesgo bajo y mejoran la experiencia
en cuanto salen.

### 1.1 Sonidos (5)

| # | Título | Requiere | Decisión pendiente |
|---|---|---|---|
| [#323](https://github.com/ale-dm/bot-discord/issues/323) | Buscar en /sonidos por nombre | #470 (fase 0) | — |
| [#324](https://github.com/ale-dm/bot-discord/issues/324) | Cooldown por persona y sonido aleatorio | — | ¿El cooldown aplica a los admins? (propuesta: no) |
| [#297](https://github.com/ale-dm/bot-discord/issues/297) | Estadísticas de uso de sonidos | — | Si cuenta el probar del admin (propuesta: sí) |
| [#325](https://github.com/ale-dm/bot-discord/issues/325) | Categorías para agrupar | Migración nueva | ¿Listas fijas o libres? (propuesta: libres) |
| [#327](https://github.com/ale-dm/bot-discord/issues/327) | Cola de sonidos en vez de rechazar | — | Tamaño de la cola (propuesta: 5) |

### 1.2 Sonidos, ajustes (3)

| # | Título | Decisión pendiente |
|---|---|---|
| [#328](https://github.com/ale-dm/bot-discord/issues/328) | Volumen por sonido | Rango (propuesta: 25 % a 200 %) |
| [#329](https://github.com/ale-dm/bot-discord/issues/329) | Sonidos solo para ciertos roles | — |
| [#330](https://github.com/ale-dm/bot-discord/issues/330) | Horario de silencio | — |

### 1.3 Rendimiento (3)

| # | Título | Medido |
|---|---|---|
| [#482](https://github.com/ale-dm/bot-discord/issues/482) | El dedupe de mensajes recorre todo el mapa | 25 µs → 248 µs por mensaje (500 → 20.000). Independiente |
| [#485](https://github.com/ale-dm/bot-discord/issues/485) | Fuga de memoria en el buffer de recuerdos del Duende | Estimado. Independiente |
| [#486](https://github.com/ale-dm/bot-discord/issues/486) | El historial del Duende se escribe entero tras cada respuesta | 1 ms por guardado (300 KB). Independiente |

**Condición de salida de la fase 1:** sonidos probados en Discord (buscar, cooldown, categorías, cola, volumen, roles,
horario); cada issue de rendimiento con su medida antes y después.

---

## Fase 2: cimientos (refactor y rendimiento que depende de ellos)

Refactors de arquitectura que no cambian el comportamiento. Orden de dependencias:

1. **Primero, sin dependencias:** #479 (medir ciclos y bloquear los nuevos), #477 (`core/` sin Discord).
2. **Después:** #471 (composición de tareas), #473 (repositorios).
3. **Después:** #472 (`systems/` sin Discord), #474 (reglas de juegos), #478 (clientes HTTP), #475 (herramientas del Duende).
4. **Al final:** #476 (`perfil/dinero.js`, necesita #473), #480 (catálogo de logros, independiente).

| # | Título | Desbloquea | Criterio |
|---|---|---|---|
| [#479](https://github.com/ale-dm/bot-discord/issues/479) | Medir ciclos de dependencias y bloquear los nuevos | Todos | `npm run check` falla con un ciclo nuevo |
| [#477](https://github.com/ale-dm/bot-discord/issues/477) | `core/` sin `discord.js` | #471, #472 | `grep` de `discord.js` en `core/` vacío |
| [#471](https://github.com/ale-dm/bot-discord/issues/471) | Punto de composición para las tareas | Admin (#420, #421), sonidos (#326) | `core/` no importa `systems` |
| [#473](https://github.com/ale-dm/bot-discord/issues/473) | Repositorios para el SQL de paneles y juegos | Economía, perfil, cripto, apuestas, admin, #483 | Sin `db.prepare` en paneles, admin, juegos |
| [#472](https://github.com/ale-dm/bot-discord/issues/472) | `systems/` sin embeds ni Discord | Pase, niveles, perfil, retos, Duende, #326, #301 | `grep` de `discord.js` en `systems/` vacío |
| [#474](https://github.com/ale-dm/bot-discord/issues/474) | Reglas de los juegos separadas de los manejadores | Casino, apuestas, retos, juego responsable | Quiniela con tests sin Discord |
| [#478](https://github.com/ale-dm/bot-discord/issues/478) | Cliente HTTP separado de la caché | Plex y Seerr, cuotas | Clientes sin `core/db` |
| [#475](https://github.com/ale-dm/bot-discord/issues/475) | Herramientas del Duende con dependencias inyectadas | Duende | Sin `require` diferido en herramientas |
| [#476](https://github.com/ale-dm/bot-discord/issues/476) | `perfil/dinero.js` partido en enrutador y casos de uso | Economía | Enrutador sin cálculos |
| [#480](https://github.com/ale-dm/bot-discord/issues/480) | Dividir el catálogo de logros | Niveles y logros | Ningún archivo de `logros/` > 400 líneas |

### Rendimiento que depende de la fase 2 (2)

| # | Título | Requiere | Medido |
|---|---|---|---|
| [#483](https://github.com/ale-dm/bot-discord/issues/483) | La XP por mensaje hace demasiadas consultas | #473 | 263 µs por mensaje |
| [#484](https://github.com/ale-dm/bot-discord/issues/484) | El resumen del casino suma todas las jugadas | — | 6 ms por render con 50.000 jugadas |

**Condición de salida de la fase 2:** `grep` de dependencias limpio en `core/`, `systems/` y paneles; ciclos medidos y
sin ciclos nuevos (#479); tests de comportamiento sin cambios en sus expectativas; #483 medido antes y después.

---

## Fase 3: Juego responsable y casino

Requiere: la fase 2 completa, y lo que indique cada grupo.

Condición de salida: cada issue de la fase probada en Discord y cerrada, con `npm run check` en verde.

### Juego responsable (4)

*Requiere: #474.*

| # | Título | Decisión pendiente |
|---|---|---|
| [#319](https://github.com/ale-dm/bot-discord/issues/319) | Límite de pérdidas que se pone uno mismo | Pérdidas netas o total apostado (propuesta: netas) |
| [#460](https://github.com/ale-dm/bot-discord/issues/460) | Tope de apuesta por juego | — |
| [#461](https://github.com/ale-dm/bot-discord/issues/461) | Cooldown por juego | — |
| [#463](https://github.com/ale-dm/bot-discord/issues/463) | Autoexclusión temporal del casino | — |

### Casino (9)

*Requiere: #474, #484 (el resumen, antes de añadir nuevas jugadas).*

| # | Título | Decisión pendiente |
|---|---|---|
| [#333](https://github.com/ale-dm/bot-discord/issues/333) | Seguro en blackjack | — |
| [#337](https://github.com/ale-dm/bot-discord/issues/337) | Rendirse en blackjack | Mitad de la apuesta |
| [#343](https://github.com/ale-dm/bot-discord/issues/343) | Pista de estrategia básica | — |
| [#354](https://github.com/ale-dm/bot-discord/issues/354) | Tirada automática en la tragaperras | — |
| [#456](https://github.com/ale-dm/bot-discord/issues/456) | Historial de jackpots ganados | — |
| [#457](https://github.com/ale-dm/bot-discord/issues/457) | PPT al mejor de tres | — |
| [#458](https://github.com/ale-dm/bot-discord/issues/458) | Últimos números de la ruleta | — |
| [#459](https://github.com/ale-dm/bot-discord/issues/459) | Apuesta a calle en la ruleta | Pago 11 a 1 |
| [#462](https://github.com/ale-dm/bot-discord/issues/462) | Doble o nada tras ganar | — |

## Fase 4: Apuestas y quinielas

Requiere: la fase 2 completa, y lo que indique cada grupo.

Condición de salida: cada issue de la fase probada en Discord y cerrada, con `npm run check` en verde.

### Apuestas y quinielas (11)

*Requiere: #473, #474.*

| # | Título | Decisión pendiente |
|---|---|---|
| [#296](https://github.com/ale-dm/bot-discord/issues/296) | Cancelar una combinada antes de que empiece algún partido | — |
| [#340](https://github.com/ale-dm/bot-discord/issues/340) | Recordatorio de quiniela a quien no ha apostado | — |
| [#345](https://github.com/ale-dm/bot-discord/issues/345) | Alerta por DM cuando la cuota llega a un valor | — |
| [#349](https://github.com/ale-dm/bot-discord/issues/349) | Repetir la última apuesta | — |
| [#356](https://github.com/ale-dm/bot-discord/issues/356) | Exportar mis apuestas a CSV | — |
| [#361](https://github.com/ale-dm/bot-discord/issues/361) | Resumen semanal de apuestas por DM | — |
| [#366](https://github.com/ale-dm/bot-discord/issues/366) | Sugerir pronósticos según las cuotas | — |
| [#370](https://github.com/ale-dm/bot-discord/issues/370) | Probabilidad implícita en la ficha | — |
| [#375](https://github.com/ale-dm/bot-discord/issues/375) | Cuota apostada frente a la actual | — |
| [#380](https://github.com/ale-dm/bot-discord/issues/380) | Liga de pronósticos por competición | — |
| [#384](https://github.com/ale-dm/bot-discord/issues/384) | Guardar el borrador de la quiniela | — |

## Fase 5: Pase de batalla y sonidos avanzados

Requiere: la fase 2 completa, y lo que indique cada grupo.

Condición de salida: cada issue de la fase probada en Discord y cerrada, con `npm run check` en verde.

### Pase de batalla (11)

*Requiere: #472, #473.*

| # | Título | Decisión pendiente |
|---|---|---|
| [#300](https://github.com/ale-dm/bot-discord/issues/300) | Historial de temporadas anteriores | — |
| [#331](https://github.com/ale-dm/bot-discord/issues/331) | Ver los topes diarios que quedan | — |
| [#332](https://github.com/ale-dm/bot-discord/issues/332) | Tu posición fuera del top 10 | — |
| [#334](https://github.com/ale-dm/bot-discord/issues/334) | Bonus por las 3 misiones del día | Cuánto XP extra |
| [#335](https://github.com/ale-dm/bot-discord/issues/335) | Racha de días con las misiones completas | Qué rachas dan XP |
| [#338](https://github.com/ale-dm/bot-discord/issues/338) | Misiones de tienda y de logros | — |
| [#344](https://github.com/ale-dm/bot-discord/issues/344) | Anuncio en canal al subir de nivel | — |
| [#348](https://github.com/ale-dm/bot-discord/issues/348) | Avisar de recompensas sin reclamar antes de acabar la temporada | Cuántos días antes |
| [#353](https://github.com/ale-dm/bot-discord/issues/353) | Ajustes del pase en `/paneladmin` | — |
| [#359](https://github.com/ale-dm/bot-discord/issues/359) | XP de pase por retos ganados | Tope propio |
| [#364](https://github.com/ale-dm/bot-discord/issues/364) | Un nivel puede dar un objeto | — |

### Sonidos avanzados (2)

*Requiere: #471, #472.*

| # | Título | Decisión pendiente |
|---|---|---|
| [#326](https://github.com/ale-dm/bot-discord/issues/326) | Sonidos ligados a eventos | ¿Cuántos eventos en la primera versión? (propuesta: dos) |
| [#301](https://github.com/ale-dm/bot-discord/issues/301) | Sonido de entrada al usar `/conectar` | — |

## Fase 6: Niveles, XP y logros

Requiere: la fase 2 completa, y lo que indique cada grupo.

Condición de salida: cada issue de la fase probada en Discord y cerrada, con `npm run check` en verde.

### Niveles, XP y logros (11)

*Requiere: #472, #480, #483 (la XP por mensaje, para no añadir consultas).*

| # | Título | Decisión pendiente |
|---|---|---|
| [#336](https://github.com/ale-dm/bot-discord/issues/336) | Logros por rachas de días seguidos | Días de los logros (3, 7, 30, 100) |
| [#339](https://github.com/ale-dm/bot-discord/issues/339) | Mejor racha histórica y ranking de rachas | — |
| [#342](https://github.com/ale-dm/bot-discord/issues/342) | DM al perder una racha larga | Umbral (propuesta: 3 días) |
| [#346](https://github.com/ale-dm/bot-discord/issues/346) | Día de gracia para no perder la racha | — |
| [#352](https://github.com/ale-dm/bot-discord/issues/352) | Tope diario de XP por persona | — |
| [#358](https://github.com/ale-dm/bot-discord/issues/358) | XP por reacciones recibidas | Cooldown por autor |
| [#362](https://github.com/ale-dm/bot-discord/issues/362) | Roles sin XP | — |
| [#369](https://github.com/ale-dm/bot-discord/issues/369) | Multiplicador de XP por canal | — |
| [#373](https://github.com/ale-dm/bot-discord/issues/373) | Desactivar mis anuncios de subida de nivel | — |
| [#378](https://github.com/ale-dm/bot-discord/issues/378) | Recordatorio semanal de logros sin reclamar | — |
| [#383](https://github.com/ale-dm/bot-discord/issues/383) | Logros de XP ganada en un solo día | Umbrales (1.000 y 3.000) |

## Fase 7: Economía y tienda

Requiere: la fase 2 completa, y lo que indique cada grupo.

Condición de salida: cada issue de la fase probada en Discord y cerrada, con `npm run check` en verde.

### Economía, tienda y banco (12)

*Requiere: #473, #476, y #484 (el resumen del casino, de la fase 2).*

| # | Título | Decisión pendiente |
|---|---|---|
| [#302](https://github.com/ale-dm/bot-discord/issues/302) | Regalar un objeto del inventario | — |
| [#374](https://github.com/ale-dm/bot-discord/issues/374) | Mercado de objetos entre jugadores | Comisión |
| [#379](https://github.com/ale-dm/bot-discord/issues/379) | Vender objetos a la tienda | Porcentaje (propuesta: 50 %) |
| [#387](https://github.com/ale-dm/bot-discord/issues/387) | Mejora de negocios por niveles | Coste de cada nivel |
| [#404](https://github.com/ale-dm/bot-discord/issues/404) | Lista de deseos con avisos por DM | — |
| [#409](https://github.com/ale-dm/bot-discord/issues/409) | Códigos canjeables | — |
| [#411](https://github.com/ale-dm/bot-discord/issues/411) | Exportar movimientos a CSV | — |
| [#412](https://github.com/ale-dm/bot-discord/issues/412) | Precio dinámico en la tienda | Tope y ritmo de vuelta |
| [#413](https://github.com/ale-dm/bot-discord/issues/413) | Ofertas temporales | — |
| [#415](https://github.com/ale-dm/bot-discord/issues/415) | Meta comunitaria financiada con el bote | — |
| [#416](https://github.com/ale-dm/bot-discord/issues/416) | Sueldo diario por rol de Discord | Impuesto aplicable |
| [#487](https://github.com/ale-dm/bot-discord/issues/487) | El panel de economía recalcula todo en cada clic | Medir por partes (#481) |

## Fase 8: Impuestos y robos

Requiere: la fase 2 completa, y lo que indique cada grupo.

Condición de salida: cada issue de la fase probada en Discord y cerrada, con `npm run check` en verde.

### Impuestos y robos (2)

*Requiere: #473, #476, y #484 (el resumen del casino, de la fase 2).*

| # | Título | Decisión pendiente |
|---|---|---|
| [#392](https://github.com/ale-dm/bot-discord/issues/392) | Impuesto de ingresos por tramos | Tramos y porcentajes |
| [#414](https://github.com/ale-dm/bot-discord/issues/414) | Aviso opcional a la víctima de un robo | Decidir con #432 |

## Fase 9: Perfil, clasificación y patrimonio

Requiere: la fase 2 completa, y lo que indique cada grupo.

Condición de salida: cada issue de la fase probada en Discord y cerrada, con `npm run check` en verde.

### Perfil, clasificación y patrimonio (12)

*Requiere: #472, #473.*

| # | Título | Decisión pendiente |
|---|---|---|
| [#347](https://github.com/ale-dm/bot-discord/issues/347) | Próximo cobro del impuesto de patrimonio | — |
| [#350](https://github.com/ale-dm/bot-discord/issues/350) | Total pagado en intereses e impuestos | — |
| [#355](https://github.com/ale-dm/bot-discord/issues/355) | Contador de premios semanales en el perfil | — |
| [#360](https://github.com/ale-dm/bot-discord/issues/360) | Histórico de ganadores semanales | Cuántas semanas (propuesta: 8) |
| [#368](https://github.com/ale-dm/bot-discord/issues/368) | Clasificación de la semana en curso | — |
| [#372](https://github.com/ale-dm/bot-discord/issues/372) | Premio distinto por categoría | Valores de cada premio |
| [#377](https://github.com/ale-dm/bot-discord/issues/377) | Ocultar la economía en el perfil ajeno | — |
| [#388](https://github.com/ale-dm/bot-discord/issues/388) | Evolución del dinero de 30 días | — |
| [#391](https://github.com/ale-dm/bot-discord/issues/391) | Categoría «El más constante» | — |
| [#394](https://github.com/ale-dm/bot-discord/issues/394) | Aviso del domingo a quien va primero | — |
| [#397](https://github.com/ale-dm/bot-discord/issues/397) | Exención del impuesto de patrimonio por rol | Interés aún por decidir |
| [#401](https://github.com/ale-dm/bot-discord/issues/401) | Ranking de patrimonio neto | — |

## Fase 10: Criptomonedas

Requiere: la fase 2 completa, y lo que indique cada grupo.

Condición de salida: cada issue de la fase probada en Discord y cerrada, con `npm run check` en verde.

### Criptomonedas (13)

*Requiere: #473.*

| # | Título | Decisión pendiente |
|---|---|---|
| [#298](https://github.com/ale-dm/bot-discord/issues/298) | Alertas de precio de TTCL por DM | — |
| [#341](https://github.com/ale-dm/bot-discord/issues/341) | Stop-loss de TTCL | — |
| [#351](https://github.com/ale-dm/bot-discord/issues/351) | Compra recurrente de TTCL | — |
| [#365](https://github.com/ale-dm/bot-discord/issues/365) | Vender por cantidad de monedas | — |
| [#441](https://github.com/ale-dm/bot-discord/issues/441) | Comisión visible en el historial | — |
| [#443](https://github.com/ale-dm/bot-discord/issues/443) | Ganancia realizada en la cartera | — |
| [#445](https://github.com/ale-dm/bot-discord/issues/445) | Ranking de ganancias | — |
| [#447](https://github.com/ale-dm/bot-discord/issues/447) | Estadísticas del periodo en Mercado | — |
| [#449](https://github.com/ale-dm/bot-discord/issues/449) | Historial de eventos de TTCL | — |
| [#451](https://github.com/ale-dm/bot-discord/issues/451) | Anuncio de eventos en canal | — |
| [#453](https://github.com/ale-dm/bot-discord/issues/453) | Pausa para admins | — |
| [#454](https://github.com/ale-dm/bot-discord/issues/454) | Tope de impacto en el precio | Valor del tope |
| [#455](https://github.com/ale-dm/bot-discord/issues/455) | Cooldown visible en el panel | — |

## Fase 11: Retos entre jugadores

Requiere: la fase 2 completa, y lo que indique cada grupo.

Condición de salida: cada issue de la fase probada en Discord y cerrada, con `npm run check` en verde.

### Retos entre jugadores (12)

*Requiere: #472, #474.*

| # | Título | Decisión pendiente |
|---|---|---|
| [#318](https://github.com/ale-dm/bot-discord/issues/318) | Revancha tras un duelo | — |
| [#436](https://github.com/ale-dm/bot-discord/issues/436) | Duelo al mejor de tres | — |
| [#437](https://github.com/ale-dm/bot-discord/issues/437) | Historial cara a cara | — |
| [#438](https://github.com/ale-dm/bot-discord/issues/438) | Reto abierto que cualquiera puede aceptar | Plazo de caducidad |
| [#439](https://github.com/ale-dm/bot-discord/issues/439) | Recordatorio de reto pendiente | — |
| [#440](https://github.com/ale-dm/bot-discord/issues/440) | Mensaje de provocación | — |
| [#442](https://github.com/ale-dm/bot-discord/issues/442) | Contraoferta de cantidad | — |
| [#444](https://github.com/ale-dm/bot-discord/issues/444) | Doblar en el blackjack de un duelo | — |
| [#446](https://github.com/ale-dm/bot-discord/issues/446) | Rendirse en un duelo | — |
| [#448](https://github.com/ale-dm/bot-discord/issues/448) | Cierre automático de porras | — |
| [#450](https://github.com/ale-dm/bot-discord/issues/450) | Bloquear retos de una persona | — |
| [#452](https://github.com/ale-dm/bot-discord/issues/452) | Aviso por DM cuando te toca jugar | — |

## Fase 12: El Duende e IA

Requiere: la fase 2 completa, y lo que indique cada grupo.

Condición de salida: cada issue de la fase probada en Discord y cerrada, con `npm run check` en verde.

### El Duende e IA (13)

*Requiere: #472, #475, #486 (el historial, antes de añadir más memoria).*

| # | Título | Decisión pendiente |
|---|---|---|
| [#357](https://github.com/ale-dm/bot-discord/issues/357) | Historial de imágenes generadas | — |
| [#363](https://github.com/ale-dm/bot-discord/issues/363) | Botón «Otra versión» de una imagen | — |
| [#367](https://github.com/ale-dm/bot-discord/issues/367) | El Duende genera imágenes desde el chat | — |
| [#371](https://github.com/ale-dm/bot-discord/issues/371) | Cuota diaria de respuestas por persona | Valor (propuesta: 15) |
| [#376](https://github.com/ale-dm/bot-discord/issues/376) | Transcribir notas de voz del chat | — |
| [#382](https://github.com/ale-dm/bot-discord/issues/382) | `/resumen` del canal | — |
| [#386](https://github.com/ale-dm/bot-discord/issues/386) | Editar un recuerdo propuesto | — |
| [#390](https://github.com/ale-dm/bot-discord/issues/390) | Caducar recuerdos sin decidir | Plazo (propuesta: 7 días) |
| [#395](https://github.com/ale-dm/bot-discord/issues/395) | Resumen al cerrar `/conversación` | — |
| [#396](https://github.com/ale-dm/bot-discord/issues/396) | Voz del Duende según la personalidad | — |
| [#400](https://github.com/ale-dm/bot-discord/issues/400) | Mensajes espontáneos sin repetir | Espera configurable |
| [#405](https://github.com/ale-dm/bot-discord/issues/405) | Olvidar una sola nota de un perfil | — |
| [#408](https://github.com/ale-dm/bot-discord/issues/408) | Cuota diaria de imágenes por persona | Valor (propuesta: 10) |

## Fase 13: Plex y Seerr

Requiere: la fase 2 completa, y lo que indique cada grupo.

Condición de salida: cada issue de la fase probada en Discord y cerrada, con `npm run check` en verde.

### Plex y Seerr (13)

*Requiere: #478.*

| # | Título | Decisión pendiente |
|---|---|---|
| [#299](https://github.com/ale-dm/bot-discord/issues/299) | Estrenos de la semana en `/plex` | — |
| [#381](https://github.com/ale-dm/bot-discord/issues/381) | Plex Wrapped anual | — |
| [#385](https://github.com/ale-dm/bot-discord/issues/385) | Qué se reproduce ahora desde `/plex` | — |
| [#389](https://github.com/ale-dm/bot-discord/issues/389) | Historial de campeones del ranking semanal | — |
| [#393](https://github.com/ale-dm/bot-discord/issues/393) | Votar la película de la sesión de cine | — |
| [#399](https://github.com/ale-dm/bot-discord/issues/399) | Sugerir películas según los apuntados | — |
| [#403](https://github.com/ale-dm/bot-discord/issues/403) | Sesión de cine semanal fija | — |
| [#406](https://github.com/ale-dm/bot-discord/issues/406) | Avisar cuando se rechaza una petición de Seerr | — |
| [#410](https://github.com/ale-dm/bot-discord/issues/410) | Cancelar mis peticiones de Seerr | — |
| [#464](https://github.com/ale-dm/bot-discord/issues/464) | Cupo diario a los 📥 de «Para ti» | — |
| [#465](https://github.com/ale-dm/bot-discord/issues/465) | Seguir una serie y avisar de episodios | — |
| [#466](https://github.com/ale-dm/bot-discord/issues/466) | Lista de «quiero ver» con aviso | — |
| [#467](https://github.com/ale-dm/bot-discord/issues/467) | Trofeo por ver días seguidos | Días (propuesta: 7 y 30) |

## Fase 14: Administración y tareas automáticas

Requiere: la fase 2 completa, y lo que indique cada grupo.

Condición de salida: cada issue de la fase probada en Discord y cerrada, con `npm run check` en verde.

### Administración y tareas automáticas (12)

*Requiere: #471, #473.*

| # | Título | Decisión pendiente |
|---|---|---|
| [#398](https://github.com/ale-dm/bot-discord/issues/398) | Auditoría: filtrar por familia de acción | — |
| [#402](https://github.com/ale-dm/bot-discord/issues/402) | Auditar consultas de datos sensibles | — |
| [#407](https://github.com/ale-dm/bot-discord/issues/407) | Auditar cambios de ajustes con valor anterior y nuevo | — |
| [#417](https://github.com/ale-dm/bot-discord/issues/417) | Copias de seguridad desde el panel | — |
| [#418](https://github.com/ale-dm/bot-discord/issues/418) | Comprobar la integridad de cada copia | — |
| [#419](https://github.com/ale-dm/bot-discord/issues/419) | Copia al arrancar si falta la de hoy | — |
| [#420](https://github.com/ale-dm/bot-discord/issues/420) | Panel de tareas con su última ejecución | — |
| [#421](https://github.com/ale-dm/bot-discord/issues/421) | Lanzar una tarea a mano | — |
| [#422](https://github.com/ale-dm/bot-discord/issues/422) | Elegir qué alertas llegan por DM | Relación con #431 |
| [#423](https://github.com/ale-dm/bot-discord/issues/423) | Canal de respaldo si el DM no llega | — |
| [#424](https://github.com/ale-dm/bot-discord/issues/424) | `/mensaje` programado | — |
| [#425](https://github.com/ale-dm/bot-discord/issues/425) | Modo mantenimiento | — |

## Fase 15: Utilidades y comandos generales

Requiere: la fase 2 completa, y lo que indique cada grupo.

Condición de salida: cada issue de la fase probada en Discord y cerrada, con `npm run check` en verde.

### Utilidades y comandos generales (11)

*Requiere: #477, #471 (para `/recordar`, que usa el planificador).*

| # | Título | Decisión pendiente |
|---|---|---|
| [#320](https://github.com/ale-dm/bot-discord/issues/320) | `/recordar`: avisos personales por DM | Máximo de recordatorios (propuesta: 10) |
| [#426](https://github.com/ale-dm/bot-discord/issues/426) | `/encuesta` en el canal | — |
| [#427](https://github.com/ale-dm/bot-discord/issues/427) | Felicitación automática de cumpleaños | — |
| [#428](https://github.com/ale-dm/bot-discord/issues/428) | Buzón de sugerencias con votos | — |
| [#429](https://github.com/ale-dm/bot-discord/issues/429) | Buscar en `/ayuda` por palabra | — |
| [#430](https://github.com/ale-dm/bot-discord/issues/430) | Presentación personal en el perfil | — |
| [#431](https://github.com/ale-dm/bot-discord/issues/431) | Preferencias de avisos por DM con `/avisos` | Relación con #422 |
| [#432](https://github.com/ale-dm/bot-discord/issues/432) | Avisar a la víctima de `/robar` por DM | Decidir con #414 (siempre o por opción) |
| [#433](https://github.com/ale-dm/bot-discord/issues/433) | Publicar en un canal desde `/mensaje` | — |
| [#434](https://github.com/ale-dm/bot-discord/issues/434) | Aviso cuando vuelve `/trabajar` o `/robar` | — |
| [#435](https://github.com/ale-dm/bot-discord/issues/435) | Mensaje de bienvenida | — |

## Cómo se cierra una issue

1. Código en una rama, con `npm run check` en verde y los criterios de la issue cumplidos.
2. PR a `developer` (squash), con «Closes #N» en la descripción solo si la prueba en Discord ya se ha hecho.
3. Prueba en Discord de lo que cambia, anotada en [TAREAS](TAREAS.md) si es un paso manual.
4. Entrada en el [CHANGELOG](../CHANGELOG.md).

## Comprobación del plan

Cada issue aparece una vez en una fase. Para comprobarlo tras un cambio:

```bash
python3 -c "import re,collections;s=open('docs/planificacion/PLAN_ISSUES.md').read();c=collections.Counter(int(x) for x in re.findall(r'^\| \[#(\d+)\]',s,flags=re.M));print(len(c),'unicas;',sorted(n for n,v in c.items() if v>1),'duplicadas')"
```

El total es 185 y ninguna duplicada (las menciones en «Decisiones» y en «Requiere» no cuentan, porque no empiezan por fila
de tabla). Con el plan terminado, ya no queda ninguna abierta.
