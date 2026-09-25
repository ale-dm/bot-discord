# Reorganización de comandos y paneles

Análisis de cómo se llega hoy a cada cosa (comandos, subcomandos, paneles y botones) y propuesta para
juntarlo: que desde cualquier panel se pueda llegar a todo lo relacionado sin volver a escribir comandos.
Los fallos encontrados por el camino están en [ERRORES.md](../ERRORES.md) (E-05 y E-07 a E-15; E-06 se descartó con D3) y los restos sin uso en
[DEUDA_TECNICA.md](../DEUDA_TECNICA.md) (DT-13). El plan para ir resolviéndolo todo por partes está en la
[sección 4](#4-plan-de-ejecución).

---

## 1) Cómo está hoy

**32 comandos** para jugadores y admins. Los que usa un jugador normal, agrupados por tema:

| Tema | Comandos | Tipo | Enlaza con… |
|---|---|---|---|
| Progreso | `/nivel`, `/perfil`, `/logros ver/reclamar/reclamar_todo/top` | Paneles con botones | `/nivel` ↔ su top, logros, economía, recompensas. `/perfil` ↔ lo mismo **menos economía**, **más casino** |
| Dinero | `/banco saldo/depositar/retirar/transferir/top/historial` | Solo subcomandos, sin botones | Nada |
| Tienda | `/tienda ver/historial`, `/inventario`, `/usar` | Paneles | Tienda ↔ su historial. Inventario → usar. Tienda **no** enlaza con inventario |
| Cripto | `/cripto` | Un panel completo | Todo dentro del panel, nada fuera |
| Casino | `/blackjack`, `/ruleta`, `/tragaperras`, `/adivinar`, `/ppt` | Un comando por juego | Ruleta y tragaperras tienen "Repetir" al acabar. Blackjack, adivinar y ppt acaban **sin salida** |
| Casino (panel) | `/perfil` → 🎰 Casino | Panel | Todos los juegos menos `/ppt`; stats, historial, ranking |
| Apuestas | `/apuestas`, `/quiniela`, `/misapuestas` | Tres comandos | `/apuestas` → "Mis apuestas". `/quiniela` y `/misapuestas` no enlazan con nada |

### Qué pasa en la práctica

- **Hay dos perfiles casi iguales.** `/nivel` y `/perfil` muestran la misma ficha y los mismos botones.
  Solo cambia uno: `/nivel` tiene 💰 Economía (saldo, cartera cripto) y `/perfil` tiene 🎰 Casino. Si
  quieres las dos cosas, necesitas los dos comandos.
- **Los logros se ven en tres sitios distintos, y en ninguno se hace todo.** Desde el perfil se ven pero no
  se reclaman ("Usa `/logros`"). En `/logros ver` se reclaman todos a la vez, pero `/logros reclamar id`
  pide un ID que no aparece en ninguna parte.
- **Hay cinco rankings, cada uno en un sitio:**
  | Ranking | Dónde |
  |---|---|
  | Nivel | `/nivel` → Top y `/perfil` → Top |
  | Riqueza | `/banco top`, que además es público y solo muestra 5 |
  | Casino | `/perfil` → Casino → Ranking |
  | Logros | `/logros top` |
  | TTCL | `/cripto` → Top holders |
- **El dinero "en mano" no sirve para casi nada.** Casino, tienda, cripto y apuestas usan el saldo del banco.
  "En mano" solo sirve para `/banco transferir`, así que para pasar dinero a alguien hay que hacer
  `/banco retirar` y después `/banco transferir`: dos comandos con 10 s de espera entre medias. (Con la
  decisión D4, pasa a ser el dinero con el que se juega y se compra.)
- **Hay tres historiales de dinero.** `/banco historial` son los últimos 10 movimientos de todo, sin
  páginas. `/tienda historial` son solo las compras, con páginas. `/perfil` → Casino → Historial son
  partidas del casino. Las apuestas no están en ninguno aparte.
- **Hay estadísticas repetidas.** La tragaperras tiene su propio botón de Stats, aparte de las del panel de
  casino. El historial global está en `/banco historialglobal` y también en `/paneladmin` → Banco.
- **Casino y apuestas están separados, cuando son lo mismo para el jugador:** apostar monedas. El panel de
  casino no enlaza con las apuestas, y `/misapuestas` no incluye la quiniela. Una vez que has apostado en
  la quiniela, no hay ninguna forma de volver a ver tus pronósticos ni cuántos acertaste.
- **Cada juego empieza de una manera distinta:**
  | Juego | Cómo se empieza |
  |---|---|
  | `/blackjack` | Apuesta obligatoria |
  | `/ruleta` | Apuesta obligatoria y un tipo |
  | `/tragaperras` | Apuesta opcional; si no la pones, abre un menú |
  | `/adivinar` | Siempre 500 |
  | `/ppt` | Apuesta y jugada, sin botones |

  Desde el panel todo es con botones, pero `/ppt` no está en el panel.
- **Tienda, inventario y "usar" son tres comandos para una misma cosa.** Después de comprar no hay un botón
  "Ver en inventario", y desde el inventario no se puede volver a la tienda.
- **Admin: hay dos paneles y comandos sueltos.**
  - `/panel` es un panel antiguo de estadísticas del banco que repite lo de `/paneladmin`.
  - Las apuestas no tienen sección en `/paneladmin`: `/pagarapuestas` es un comando aparte, y la quiniela
    se crea con un botón dentro de `/quiniela`.
  - El catálogo se gestiona con `/objeto crear` más `/tienda añadir`, y la configuración de la tienda
    está en el panel.
  - `/diagnostico` y `/ttcl-diagnostico` también son comandos sueltos.
- **Unos mensajes son públicos y otros privados, sin un criterio claro.**
  | Visibilidad | Qué |
  |---|---|
  | Público | `/nivel`, `/perfil`, `/banco top`, `/misapuestas` |
  | Privado | `/banco saldo`, `/tienda`, `/logros` |
  | Público o privado según el juego | Casino |

---

## 2) Propuesta: cuatro puertas de entrada

La idea es que haya **pocos puntos de entrada y que cada uno lleve a todo lo relacionado**. Todo se hace
desde los paneles, y los comandos antiguos que queden cubiertos **se borran** (D2): de 32 comandos quedan
unos 14.

**Comandos que quedan:**
- Paneles: `/perfil`, `/juegos`, `/tienda`, `/cripto`, `/ayuda` y `/paneladmin`.
- Duende e IA: `/duende`, `/ia`, `/imagen` y `/bola8`.
- Voz: `/tts` y `/escuchar`.
- Otros: `/ping` y `/javier`.

**Comandos que se borran** (cada uno en la parte que cubre su función):
- Progreso: `/nivel` y `/logros`.
- Dinero y tienda: `/banco`, `/inventario`, `/usar` y `/objeto`.
- Apuestas: `/apuestas`, `/quiniela`, `/misapuestas` y `/pagarapuestas`.
- Casino: `/blackjack`, `/ruleta`, `/tragaperras`, `/adivinar` y `/ppt`.
- Admin: `/panel`, `/diagnostico` y `/ttcl-diagnostico`.

```
/perfil  [usuario]                 ← todo lo tuyo (o de otra persona, que también se ve entero)
 ├─ 👤 Perfil        nivel, racha, efectivo y banco, próxima recompensa, logros X/Y
 ├─ 💰 Economía      💵 efectivo + 🏦 banco + cartera cripto + inventario (resumen)
 │    └─ botones: 🏦 Ingresar · 💵 Sacar · 💸 Transferir · 📜 Movimientos · 🛒 Tienda · 📈 Cripto
 ├─ 🎲 Juegos        (ver /juegos)
 ├─ 🏅 Logros        lista con páginas + 🎁 Reclamar todo (aquí mismo)
 └─ 🏆 Rankings      menú: Nivel · Riqueza · Casino · Logros · TTCL

/juegos                            ← todo lo que es apostar monedas (se juega con el efectivo)
 ├─ 🎰 Casino        Tragaperras · Blackjack · Ruleta · Adivinar · PPT
 ├─ ⚽ Apuestas      partidos (la vista de /apuestas) · Quiniela
 ├─ 📋 Mis jugadas   apuestas activas + quiniela (tus pronósticos y aciertos) + últimas partidas
 └─ 📊 Stats         casino y apuestas juntos; ganado/perdido real por juego

/tienda                            ← comprar y usar
 ├─ 🛒 Catálogo      (como ahora)
 ├─ 🎒 Inventario    con botón Usar
 └─ 🧾 Mis compras

/cripto                            (como ahora, ya está bien resuelto)
```

### Detalles que acompañan

- **Una sola barra de navegación por panel.** La misma fila de pestañas (Perfil · Economía · Juegos ·
  Logros · Rankings) en todas las pantallas del perfil, con la pestaña actual marcada. Hoy cada pantalla
  inventa su fila, y a veces falta el botón de volver.
- **Todos los juegos terminan igual:** 🔄 Repetir (misma apuesta) · 🎲 Otra apuesta · ◀ Juegos. Hoy solo
  la ruleta (y en parte la tragaperras) lo hacen. El blackjack, adivinar y ppt acaban sin botones.
- **Todos los juegos empiezan igual:** el comando sin apuesta abre el selector de importes (como hace ya
  el panel), y con apuesta juega directamente. `/ppt` entra en el panel.
- **Efectivo y banco (D4).** El banco es el sitio seguro: ahí no se puede gastar. Para comprar, apostar, invertir en
  cripto o transferir hay que sacar el dinero a 💵 efectivo (lo que hoy se llama "en mano"). Los premios y cobros
  llegan al efectivo. Desde Economía: 🏦 Ingresar · 💵 Sacar · 💸 Transferir (con un selector de persona y un
  formulario para la cantidad). En los selectores de apuesta y en la tienda, si no te llega el efectivo, sale un
  botón 💵 Sacar del banco para no tener que volver a Economía. Esto deja preparado lo que vendrá después:
  impuestos, robos y dinero negro (ver F-EC-06 en [FEATURES.md](../FEATURES.md)).
- **Un único historial de movimientos** con páginas y un filtro: Todo · Casino · Apuestas · Tienda · Cripto
  · Transferencias. Sustituye a `/banco historial`, `/tienda historial` y el historial del casino.
- **Logros:** reclamarlos desde el perfil (uno a uno con un menú, o todos). Los secretos se pueden ver con el
  botón que ya existe (D3).
- **Viendo el perfil de otra persona (D1):** se ve todo lo suyo: perfil, economía, movimientos, jugadas, logros e
  inventario. Las acciones (sacar, transferir, reclamar, jugar) solo están en tu propio perfil. Hoy Casino abre
  siempre el tuyo, aunque estés mirando a otro.
- **Público (D5):** de momento todos los paneles son públicos. Solo los avisos de error ("no te llega el
  efectivo", "solo quien abrió el panel...") siguen siendo privados. Los botones de un panel solo los puede usar
  quien lo abrió (como ya pasa).
- **Tras comprar en la tienda**, un botón 🎒 Ver en inventario (y 🔮 Usar ya, si el objeto se puede usar).
- **Tras apostar un partido**, botones 📋 Mis jugadas y ⚽ Más partidos. La quiniela ya aparece en
  Mis jugadas.
- **`/ayuda`**: cada sección con un botón que abre el panel correspondiente, en vez de solo listar comandos.

### Admin

`/paneladmin` como único panel de administración, con secciones nuevas:

| Sección | Qué contiene | Qué sustituye |
|---|---|---|
| ⚽ Apuestas | Liquidar ahora, crear la quiniela de la jornada, partidos abiertos y caducados | `/pagarapuestas` y el botón de admin de `/quiniela` |
| 🛒 Catálogo | Crear, editar y borrar objetos, y ponerlos a la venta con precio y stock | `/objeto` y `/tienda añadir/editar/eliminar/config` |
| 🩺 Sistema | Diagnóstico general, el de TTCL y el log de nivel | `/diagnostico` y `/ttcl-diagnostico` |

Además, borrar `/panel` (sus estadísticas ya están en `/paneladmin`). `/banco historialglobal` desaparece con
`/banco`, y el historial global ya está en Banco.

---

## 3) Cómo quedaría (maquetas)

**`/perfil` → 💰 Economía**
```
💰 Economía · alex
💵 Efectivo: 800 🪙         🏦 Banco: 12.450 🪙 (seguro)
💹 Cripto: ≈ 3.200 🪙 (TTCL 40 · BTC 0,001)    🎒 Inventario: 7 objetos
📊 Este mes: +2.100 casino · −600 tienda · +300 apuestas
[👤 Perfil] [💰 Economía] [🎲 Juegos] [🏅 Logros] [🏆 Rankings]
[🏦 Ingresar] [💵 Sacar] [💸 Transferir] [📜 Movimientos] [🛒 Tienda]
```

**`/juegos` → 📋 Mis jugadas**
```
📋 Mis jugadas
⚽ Pendientes: Betis–Sevilla (1) 200 🪙 @2,1 · Real–Barça (X) 100 🪙 @3,4
🧾 Quiniela J6: 1X21X12X21 · 6 aciertos de 10 (se cierra el lunes)
🎰 Últimas partidas: 🃏 +200 · 🎡 −100 · 🎰 +50
[🎰 Casino] [⚽ Apuestas] [📋 Mis jugadas] [📊 Stats]
```

**Final de cualquier juego**
```
🃏 Blackjack · ¡Ganaste! +200 🪙
[🔄 Repetir (100)] [🎲 Otra apuesta] [◀ Juegos]
```

---

## 4) Plan de ejecución

Nueve partes pequeñas, en este orden. Cada una se puede subir y probar en Discord por separado, y todas
incluyen los fallos de [ERRORES.md](../ERRORES.md) y la deuda de [DEUDA_TECNICA.md](../DEUDA_TECNICA.md)
que les tocan. Así no queda nada apuntado sin sitio.

**Al cerrar cada parte:**
- `npm run check` en verde, con tests de lo nuevo.
- Quitar lo resuelto de ERRORES y DEUDA y apuntarlo en el CHANGELOG.
- Actualizar FUNCIONALIDADES.md y `/ayuda`.
- Añadir las pruebas en Discord a [TAREAS.md](../TAREAS.md).

### Decisiones (tomadas el 2026-09-25)

| # | Pregunta | Decisión |
|---|---|---|
| D1 | Viendo el perfil de otra persona, ¿se ve su saldo exacto? | **Se ve todo.** Las acciones solo en el tuyo |
| D2 | ¿Los comandos antiguos siguen existiendo? | **Se borran** los que queden cubiertos por un panel, en la parte que los cubre |
| D3 | Logros secretos | **Se pueden ver** (E-06 no es un error) |
| D4 | ¿Qué pasa con el dinero "en mano"? | **Se queda, como efectivo.** El banco es seguro y no se gasta; para comprar, apostar, cripto o transferir hay que sacarlo. Más adelante: impuestos, robos, dinero negro |
| D5 | Qué es público y qué privado | **De momento todo público** (menos los avisos de error) |

### Parte 1 · Arreglos rápidos (S) — ✅ hecha el 2026-09-25

Fallos que no dependen de la reorganización:

| Fallo | Arreglo |
|---|---|
| E-05 | "Ganado/perdido" de la Economía calculado desde la tabla `casino` |
| E-07 | `/logros reclamar id`: menú con los logros que se pueden reclamar, en vez de pedir el ID |
| E-09 | En las estadísticas de apuestas, contar solo las finalizadas y enseñar aparte lo que está en juego |
| E-10 | Emoji roto en `/misapuestas` |
| E-12 | Valorar todas las criptos con los precios de `mercado` |
| DT-13 (en parte) | Quitar los prefijos muertos de la quiniela |

**Ficheros:** `nivel.js`, `logros.js`, `misapuestas.js`, `quiniela.js`.
**Se prueba:**
- Tests de la economía: un depósito no cuenta como casino.
- Tests de las estadísticas de apuestas: las pendientes no cuentan como perdidas.
- En Discord: `/nivel` → Economía, `/logros reclamar` y `/misapuestas stats`.

### Parte 2 · Juegos: cómo empiezan y cómo acaban (S) — ✅ hecha el 2026-09-25

- **Final común:** una fila compartida con 🔄 Repetir · 🎲 Otra apuesta · ◀ Juegos, en blackjack, adivinar, ppt,
  tragaperras y ruleta.
- **Inicio común:** todos los juegos empiezan en el selector de importes del panel (los comandos de cada juego
  se borran en la parte 4). `/adivinar` deja de ser siempre 500.
- **`/ppt` en el panel de casino**, con botones de jugada.
- **Stats de la tragaperras:** su botón pasa a abrir las stats del casino filtradas por tragaperras, en vez de ser
  una pantalla aparte.

**Ficheros:** `paneles/casino.js`, los cinco juegos, `perfil.js` (el reparto de botones del casino).
**Se prueba:**
- Test de que cada juego termina con esos tres botones y de que Repetir juega con la misma apuesta.
- En Discord: una partida de cada juego desde el panel.

### Parte 3 · Mis jugadas y la quiniela visible (M) — ✅ hecha el 2026-09-25

- **E-08:** en `/quiniela`, si ya has apostado, se ven tus pronósticos con ✅/❌ en cada partido jugado y los aciertos
  que llevas.
- **Mis jugadas nuevo** (`systems/apuestas/misJugadas.js` + `paneles/misJugadas.js`): partidos pendientes y
  finalizados, quinielas (abiertas y cerradas, con premio) y últimas partidas del casino.
- **E-13:** `/misapuestas` usa ese panel; los botones editan el mensaje en vez de crear otro, y Stats tiene su
  fila de botones.
- **Enlaces:** tras apostar un partido o la quiniela, botones 📋 Mis jugadas y ⚽ Más partidos.

**Ficheros:** `quiniela.js`, `misapuestas.js`, `apuestas.js`, nuevos en `systems/` y `paneles/`.
**Se prueba:**
- Tests de Mis jugadas con apuestas y quinielas en la BD de prueba.
- En Discord: apostar y verlo en Mis jugadas; abrir `/quiniela` después de apostar.

### Parte 4 · `/juegos`: casino y apuestas juntos (M) — ✅ hecha el 2026-09-25

- **Comando nuevo `/juegos`** con pestañas 🎰 Casino · ⚽ Apuestas · 📋 Mis jugadas · 📊 Stats.
  - El panel de casino sale de `/perfil` y pasa aquí.
  - Apuestas enseña los partidos (la vista de `/apuestas`) y un botón a la quiniela.
- **Stats:** casino y apuestas juntos, con ganado/perdido real por juego.
- **Se borran (D2):**
  - Apuestas: `/apuestas`, `/quiniela` y `/misapuestas`.
  - Casino: `/blackjack`, `/ruleta`, `/tragaperras`, `/adivinar` y `/ppt`.
  - Antes de borrarlos, hay que comprobar que todo lo que hacían (también las opciones de `/ruleta`, como
    número y tipo) se puede hacer desde el panel.
- **Todo lo que decía "◀ Casino" pasa a decir "◀ Juegos".**

**Ficheros:** `commands/juegos/juegos.js` (nuevo), `paneles/casino.js`, `perfil.js`. Los comandos que se borran
pasan su lógica a `systems/` o `paneles/` (la liquidación de apuestas y su cron siguen igual).
**Se prueba:**
- Tests de reparto de botones como `panelCasino.test.js`.
- En Discord: navegar por todas las pestañas y jugar desde ellas.

### Parte 5 · Dinero: efectivo y banco (M) — ✅ hecha el 2026-09-25

- **Efectivo (hoy `enMano`) es el dinero que se gasta (D4).** Casino, apuestas, quiniela, tienda, cripto y
  transferencias cobran del efectivo. Los premios, reembolsos, ventas de cripto y recompensas de logros van al
  efectivo. El banco solo guarda: 🏦 Ingresar y 💵 Sacar.
  - Todo pasa por un único módulo, `systems/dinero.js`, con `efectivo`, `banco`, `cobrar`, `pagar`, `ingresar`,
    `sacar` y `transferir`. Hoy cada sistema hace su propio `UPDATE banco SET saldo` (casino, apuestas, tienda,
    cripto, logros, partidas interrumpidas): unos 17 sitios.
- **Sin migración de datos:** el dinero de cada uno sigue donde está (casi todo en el banco). Al estrenarlo, hay que
  sacar efectivo para jugar. Se avisa en el anuncio del cambio.
- **Las 1.000 monedas iniciales** van al efectivo, para poder jugar nada más empezar.
- **Panel de Economía** (en `/perfil`, parte 6; hasta entonces en `/banco`): efectivo, banco, 🏦 Ingresar, 💵 Sacar,
  💸 Transferir (selector de persona y formulario) y 📜 Movimientos. La espera de 10 s entre operaciones se revisa
  (probablemente sobra al ser con botones).
- **💵 Sacar del banco** directamente desde los selectores de apuesta, la tienda y la compra de cripto, cuando no
  llega el efectivo.
- **Movimientos:** historial único con páginas y filtro (Todo · Casino · Apuestas · Tienda · Cripto · Banco ·
  Transferencias). Sustituye a `/banco historial`, `/tienda historial` y el historial del casino.
- **Rankings de riqueza:** efectivo + banco.
- **El Duende** (herramienta de saldo) dice efectivo y banco.

**Ficheros:** `systems/dinero.js` (nuevo), `casinoTransactions.js`, `activeGames.js`, `tienda.js`,
`cripto/mercado.js`, `achievementsSystem.js`, `apuestas.js`, `quiniela.js`, `pagarapuestas.js`, `ruleta.js`,
`tragaperras.js`, `ppt.js`, `banco.js`, `paneles/economia.js` (nuevo), `services/duende/herramientas.js`,
`adminPanel/bank.js`.
**Se prueba:**
- Tests de `dinero.js`: no se puede gastar del banco, ni sacar ni ingresar más de lo que hay, y transferir es todo
  o nada.
- Los tests de casino, tienda, cripto y apuestas pasan a comprobar el efectivo.
- En Discord: sacar, jugar, ganar (el premio va al efectivo) e ingresar.

### Parte 6 · Un solo perfil (M) — ✅ hecha el 2026-09-25

- **`/perfil`** con pestañas 👤 Perfil · 💰 Economía (la de la parte 5) · 🎲 Juegos (abre `/juegos`) · 🏅 Logros ·
  🏆 Rankings.
- **Logros reclamables desde el perfil**, con páginas, los secretos visibles (D3), un menú para reclamar uno y
  🎁 Reclamar todo.
- **Rankings en una pantalla**, con un menú: Nivel · Riqueza · Casino · Logros · TTCL.
- **Perfil de otra persona (D1):** se ve todo lo suyo; las acciones solo en el tuyo. **E-11:** todos los botones
  llevan el `targetId`.
- **Se borran (D2):** `/nivel`, `/logros` y `/banco`.
- **Barra de pestañas común** con la pestaña actual marcada.

**Ficheros:** `perfil.js`, `nivel.js` (sus pantallas pasan a `paneles/perfil.js`), `logros.js`, `banco.js`.
**Se prueba:**
- Tests de navegación del perfil (propio y de otro) y de reclamar desde el perfil.
- En Discord: `/perfil` y `/perfil usuario:X`.

### Parte 7 · Tienda, inventario y usar en un panel (S) — ✅ hecha el 2026-09-25

- **`/tienda`** con pestañas 🛒 Catálogo · 🎒 Inventario (con Usar) · 🧾 Mis compras (el filtro Tienda de Movimientos).
- **Tras comprar:** 🎒 Ver en inventario y 🔮 Usar ya.
- **Se borran (D2):** `/inventario` y `/usar`.

**Ficheros:** `tienda.js`, `inventario.js`, `usar.js`, `paneles/tienda.js`.
**Se prueba:**
- Test de comprar → usar desde el mismo panel.

### Parte 8 · Administración en un solo panel (M) — ✅ hecha el 2026-09-25

- **Secciones nuevas en `/paneladmin`:**
  - ⚽ Apuestas: liquidar ahora, crear la quiniela, partidos abiertos y caducados.
  - 🛒 Catálogo: objetos y lo que está a la venta.
  - 🩺 Sistema: los dos diagnósticos y el log de nivel.
- **Se borran:** `/panel` (E-14 y E-15 desaparecen con él), `/pagarapuestas`, `/objeto`, `/diagnostico`,
  `/ttcl-diagnostico` y los subcomandos de admin de `/tienda`. Antes de borrar cada uno, se comprueba que su función
  está en el panel. **DT-13 (`/panel`).**

**Ficheros:** `adminPanel/` (secciones nuevas), los comandos que se borran.
**Se prueba:**
- Test de reparto del panel.
- En Discord: cada sección nueva.

### Parte 9 · `/ayuda` con botones y repaso final (S)

- **`/ayuda`:** cada sección con un botón que abre su panel.
- **Todo público (D5):** repaso de todos los paneles (hoy muchos son privados), dejando privados solo los avisos de
  error.
- **Documentación:** FUNCIONALIDADES.md reescrito con la estructura nueva; este documento pasa a histórico.

### Resumen

| Parte | Qué | Resuelve | Tamaño | Depende de |
|---|---|---|---|---|
| 1 ✅ | Arreglos rápidos | E-05, E-07, E-09, E-10, E-12, DT-13 (prefijos) | S | — |
| 2 ✅ | Inicio y final de los juegos | Juegos sin salida, `/ppt` fuera del panel, stats repetidas | S | — |
| 3 ✅ | Mis jugadas y quiniela visible | E-08, E-13 | M | — |
| 4 ✅ | `/juegos` | Casino y apuestas separados; borra 8 comandos | M | 2 y 3 |
| 5 ✅ | Dinero: efectivo y banco | "En mano" sin uso, tres historiales | M | — |
| 6 ✅ | Perfil único | Dos perfiles, logros en tres sitios, cinco rankings, E-11; borra 3 comandos | M | 4 y 5 |
| 7 ✅ | Tienda + inventario | Tienda, inventario y usar sueltos | S | 5 (historial) |
| 8 ✅ | Admin | Dos paneles y comandos sueltos, E-14, E-15, DT-13 (`/panel`) | M | — |
| 9 | Ayuda y repaso | Todo público | S | Todas |

Es buena idea desplegar y probar en Discord cada dos o tres partes (por ejemplo, tras la 3, la 6 y la 9) para no
acumular cambios sin probar. Antes de todo esto sigue pendiente el primer despliegue de
[T-02](../TAREAS.md#t-02-desplegar-y-probar-en-discord).
