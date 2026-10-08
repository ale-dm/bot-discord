# Tareas

Cosas que hay que **hacer a mano** (no son cambios de código): desplegar y comprobar en Discord. Los errores pendientes están en [ERRORES.md](ERRORES.md), la deuda técnica en [DEUDA_TECNICA.md](DEUDA_TECNICA.md) y
las ideas en [FEATURES.md](FEATURES.md).
La reorganización de paneles, con los errores E-05 a E-15, va por partes según el
[plan de ejecución](diseno/reorganizacion-paneles.md#4-plan-de-ejecución).

| ID | Tarea | Prioridad |
|---|---|---|
| [T-02](#t-02-desplegar-y-probar-en-discord) | Desplegar y probar en Discord | 🔴 Alta |

---

## T-02 Desplegar y probar en Discord

Desde el último despliegue ha cambiado casi todo (estructura, logger, migraciones, Gemini, casino,
apuestas...). Solo se ha probado con tests y arranques sin conexión a Discord. Pasos detallados en
[DEPLOY.md](../DEPLOY.md).

**Antes**
- [x] Copia de seguridad de `/compose/duende-bot/data/banco.db`.
- [x] Copiar `data/duende-apodos.seed.json.importado` del repo local a `/compose/duende-bot/data/duende-apodos.seed.json`
      (sin `.importado`) para que el servidor importe los apodos.
- [x] Copia **limpia** del código en el servidor, `docker build`, actualizar el stack.

**Al arrancar, en `docker logs` / `logs/app-log.txt`**
- [x] Las migraciones pendientes aplicadas (`[Migraciones] Aplicada 00N_...`, hasta la 009) y la 009 diciendo cuántas
      apuestas antiguas ha añadido al historial.
- [x] `Importados 33 apodos de 12 personas`.
- [x] `Importadas 6 personalidades y 9 perfiles` y, al conectar, `Perfiles del Duende: N vinculados`.
- [x] Que exista `data/backups/tablas-antiguas-AAAA-MM-DD.json`.
- [x] `✓ Conectado como El Duende#...`, sin el aviso de `ready` obsoleto ni "opcode 8 was rate limited".
- [x] En el registro de comandos (`N comandos: ...`) está `juegos` y ya no están `blackjack`, `ruleta`,
      `tragaperras`, `adivinar`, `ppt`, `apuestas`, `quiniela` ni `misapuestas`; en Discord tampoco aparecen.
- [x] Si había reglas de canales/roles (ACL) para esos comandos o para `perfil` pensando en el casino,
      ponerlas sobre `juegos` (Panel admin → Config Global → 🔐 Comandos).

**En Discord**
- [x] Hablar con el Duende y que reconozca apodos ("¿qué ha visto el perro?").
- [x] `/perfil` → 💰 Economía (ganado/perdido del casino y todas las criptos con valor); `/ayuda` (secciones
      Casino y Apuestas hablan de `/juegos`).
- [x] Algún mensaje privado (p. ej. un error al sacar del banco) sigue saliendo solo para quien lo pide.

**`/juegos` (partes 2 a 4 de paneles)**
- [x] `/juegos` sin opciones abre 🎰 Casino; `/juegos seccion:` abre cada pestaña. Las pestañas de abajo
      llevan de una a otra en el mismo mensaje, con la actual resaltada.
- [x] 🎰 Casino: una partida de cada juego (blackjack normal, doblando y separando; ruleta a color, docena y
      número exacto; tragaperras; adivinar; PPT) y los botones del final (🔄 Repetir, 🎲 Otra apuesta,
      📊 Stats, ◀ Casino). Intentar apostar más de lo que tienes: el aviso sale aparte y el panel sigue.
      Ranking, Historial y Mis stats del casino.
- [x] `/perfil` → 🎰 Casino abre la pestaña Casino y se puede jugar desde ahí.
- [x] ⚽ Apuestas: cambiar de competición y de página (la segunda vez sin gastar crédito, ver log); apostar a
      un partido y pulsar 📋 Mis jugadas y ⚽ Más partidos; que la apuesta salga en `/perfil` → 💰 Economía → 📜 Movimientos (filtro Apuestas).
- [x] 🧾 Quiniela: 🔄 Refrescar; que salga el mínimo de aciertos para cobrar; después de apostar, tus
      pronósticos con ✅/❌ y el botón 📋 Mis jugadas.
- [x] 📋 Mis jugadas: ⏳ En juego y 📋 Resueltas (cambian en el mismo mensaje), y el botón 🧾 Quiniela.
- [x] 📊 Stats: casino, apuestas a partidos, quinielas y el total.
- [x] Que otra persona no pueda usar los botones de tu `/juegos`.

**Dinero (parte 5 de paneles)**
- [x] Al arrancar, `[Migraciones] Aplicada 010_historial_tipo` con cuántos movimientos ha clasificado.
- [x] `/perfil` → 💰 Economía: efectivo, banco y total; 🏦 Ingresar y 💵 Sacar; 💸 Transferir a alguien;
      📜 Movimientos con el filtro; 🏆 Rankings → Riqueza.
- [x] Con todo el dinero en el banco, intentar jugar en el casino: los importes salen desactivados y está
      💵 Sacar del banco; sacar y ver que la pantalla se actualiza. Lo mismo en la tienda y en la compra de cripto.
- [x] Ganar algo en el casino y comprobar que el premio llega al efectivo.
- [x] Avisar en el servidor: desde ahora se juega y se compra con el efectivo, y el banco es para guardar.

**Perfil (parte 6 de paneles)**
- [x] En el registro de comandos ya no están `nivel`, `logros` ni `banco` (21 comandos).
- [x] `/perfil`: las cinco pestañas; 🎭 Recompensas de nivel; en 🏅 Logros, reclamar uno y todos, y ver secretos;
      en 🏆 Rankings, los cinco del menú y pasar páginas en el de nivel.
- [x] `/perfil usuario:X`: se ve todo lo suyo (también economía y movimientos) sin botones de acción, y las
      pestañas no llevan a tu perfil.
- [x] 💰 Economía: ingresar, sacar, transferir y movimientos desde el perfil.

**Tienda (parte 7 de paneles)**
- [x] En el registro de comandos ya no están `inventario` ni `usar` (19 comandos).
- [x] `/tienda ver`: comprar un consumible y usar 🔮 Usar ya; 🎒 Ver en inventario; las tres pestañas.
- [x] `/tienda inventario`: usar un objeto de rol y uno consumible (el resultado sale en el panel).
- [x] Que otra persona no pueda pulsar los botones de tu tienda.

**Admin (parte 8 de paneles)**
- [x] En el registro de comandos quedan 14: ayuda, bola8, cripto, duende, escuchar, ia, imagen, javier, juegos,
      paneladmin, perfil, ping, tienda y tts.
- [x] `/paneladmin` → ⚽ Apuestas: lo pendiente, 💸 Liquidar ahora y crear una quiniela.
- [x] `/paneladmin` → 🛒 Catálogo: crear un objeto, editarle un campo, ponerlo a la venta, cambiarle el precio,
      quitarlo y eliminarlo.
- [x] `/paneladmin` → 🩺 Sistema: diagnóstico, 💎 TTCL y cambiar el nivel de log.

**Ayuda y público (parte 9 de paneles)**
- [x] `/ayuda` → cada sección: los botones verdes abren su panel en un mensaje nuevo, y sus botones funcionan.
- [x] Con `/juegos` limitado a un canal (ACL), el botón de la ayuda en otro canal avisa y no lo abre.
- [x] La tienda, los partidos y la quiniela salen públicos; el editor de pronósticos, privado.

**Mejoras del 2026-10-02 (rama `feature/elduendejavier`)**
- [x] Al arrancar: `[Migraciones] Aplicada 011_diario_avisos_recordatorios` y `Modelo de Gemini ...: funciona y usa
      herramientas` (si no, te llega una alerta por DM).
- [x] `/perfil` → 💰 Economía: 🎁 Diario cobra, el panel dice cuánto y el botón pasa a "🎁 Mañana"; sale en
      📜 Movimientos con el filtro 🎁 Diario. En el perfil de otro no hay botón. Con racha de varios días, da más.
- [x] `/paneladmin` → ⚙️ Config Global → 🎁 Diario: cambiar base/tope y ver que la Economía lo refleja.
- [x] `/paneladmin` → ⚽ Apuestas → 📢 Canal de resultados: elegir un canal, 💸 Liquidar ahora con algún partido
      terminado y ver el resumen en el canal (con nombres, sin pings).
- [x] Apostar a un partido que empiece en menos de una hora: llega el DM ⏰ unos 30 min antes, una sola vez.
- [x] Seerr: pedir algo que no esté y, cuando llegue, ver "🍿 @tú, lo que pediste ya está en Plex" en el canal de
      novedades. (Si Seerr ya avisa por su cuenta en Discord, decidir si se deja uno de los dos: 🍿 Seerr →
      🔕 No avisar al llegar.)
- [x] `/paneladmin` → 🩺 Sistema: se ven los créditos de la Odds API; 🔔 Alertas → 📨 Probar te llega por DM;
      poner los IDs de los admins que deben recibirlas; 🤖 Probar Gemini dice ✅.
- [x] Config Global → 🤖 Duende → ✏️ Editar IA con un modelo inventado: avisa de que no existe (y volver a dejarlo).
- [x] Preguntar al Duende "¿qué hay en la tienda?", "¿qué tengo en el inventario?", "¿cómo van mis apuestas?",
      "¿cuánto llevo perdido en el casino?" y "¿puedo cobrar el diario?": que use las herramientas (en el log,
      `Herramienta usada: consultar_...`).

**⚔️ Retos (2026-10-02, rama `feature/elduendejavier`)**
- [x] Al arrancar: `[Migraciones] Aplicada 012_retos`; en `/juegos` sale la pestaña ⚔️ Retos (cinco pestañas) y
      `/juegos seccion: ⚔️ Retos` la abre.
- [x] ⚽ Retar a un partido: elegir partido, resultado, rival y cantidad. Sale un mensaje nuevo que menciona al rival;
      otra persona no puede aceptarlo; el rival acepta. Cuando acabe el partido, la liquidación paga al que acertó,
      llega el DM, se edita el mensaje del reto y sale en el canal de resultados.
- [x] 🎲 Duelo de piedra, papel o tijera: cada uno elige (el mensaje solo dice quién ha elegido), un empate pide otra
      ronda y al final paga al ganador. Duelo de dados (se resuelve al aceptar) y de blackjack (🃏 Mi mano en privado,
      Pedir y Plantarse; el mensaje se actualiza y al final enseña las dos manos).
- [x] ❌ Rechazar y 🚫 Cancelar devuelven el dinero; un reto sin aceptar en 24 h se devuelve solo (con DM).
- [x] 🗳️ Porra: crearla con 3 opciones, entrar desde dos cuentas, 🔒 Cerrar apuestas, ⚖️ Resolver (sin ser admin
      no deja; como admin, menú privado) y ver que el bote se reparte. 🚫 Anular devuelve a todos.
- [x] Movimientos con el filtro ⚔️ Retos; 📊 Stats con la línea de retos; la pestaña ⚔️ Retos con los enlaces a
      cada reto; `/ayuda` → Apuestas con el botón Abrir Retos.

**🍿 Logros de Plex, fase 1 (2026-10-02, rama `feature/elduendejavier`)**
- [x] Al arrancar: `[Migraciones] Aplicada 013_plex_historial`.
- [x] Panel admin → Plex: la línea 📼 Historial para los logros y el botón 📼 Sincronizar historial. La primera vez
      importa el historial entero (en el log, `(primera importación)`): comprobar que el número de reproducciones
      cuadra más o menos con Tautulli y cuánto tarda.
- [x] Los logros de Plex que ya tenía cada vinculado salen en el canal de logros, un solo mensaje por persona.
- [x] Al arrancar: `[Migraciones] Aplicada 014_canal_logros` y `...: los logros se anuncian en 874776941000020018`.
      Completar un logro cualquiera (p. ej. la primera apuesta en el casino con una cuenta nueva) y ver que en ese
      canal sale "🎉 @persona desbloqueó logros" con la mención.
- [x] `/perfil` → 🏅 Logros: los de categoría `plex`, con su progreso, y reclamar uno.
- [x] Ver algo en Plex y, en la siguiente media hora, que se actualice el progreso (y que un logro nuevo sí se anuncie).
- [x] Mirar que las horas de alguien se parezcan a las de Tautulli (sus estadísticas de usuario, "All Time").

**🍿 Trofeos de Plex, fases 2 y 3 (2026-10-02, rama `feature/elduendejavier`)**
- [x] Al arrancar: `[Migraciones] Aplicada 015_plex_trofeos`.
- [x] Panel admin → Plex → 🏆 Trofeos: 🎌 Anime coge las bibliotecas de anime de verdad (si no, 🎌 Bibliotecas de anime).
- [x] 📼 Sincronizar ahora unas cuantas veces hasta que "pendientes" llegue a 0 (en el log, `Fichas de Plex de ...`):
      mirar cuánto tarda la primera (la lista de películas) y que "Todas las de…" y sagas pase a ✅ activos.
- [x] En el canal de logros, los trofeos con su nombre de Gemini, de qué son y la rareza; que no salgan cortados raros.
      Si muchos se quedan con el nombre por defecto ("X: completada"), mirar en el log el aviso de Gemini.
- [x] Comprobar con alguien que ha terminado una serie que la tiene, y que una de anime sale con 🎌 (y cuenta en
      "Sayonara", no en "Créditos finales").
- [x] ➕ Crear trofeo con `director:Nolan` (o alguno que alguien ya cumpla): sale enseguida a quien lo cumple y en el
      panel pone cuántos lo tienen. Uno con una condición mal escrita avisa. 🗑️ Borrarlo.
- [x] `/perfil` → 🏅 Logros: la rareza en los de Plex; 🍿 Ocultar mis logros de Plex y, desde otra cuenta,
      `/perfil usuario:` sin los de Plex. Volver a enseñarlos.
- [x] Mirar que las recompensas de la primera importación no desequilibran la economía (si sí, bajar
      `logros.reward_multiplier` antes de que se reclamen).

**🍿 Logros de Plex por idioma y dificultad (2026-10-03, rama `feature/elduendejavier`)**
- [x] Al arrancar: `[Migraciones] Aplicada 016_plex_idiomas_dificultad`.
- [x] Panel admin → Plex → 🏆 Trofeos: la línea 🗣️ Idiomas (revisadas y pendientes) y "Por dificultad". 📼 Sincronizar
      ahora hasta que los idiomas pendientes lleguen a 0.
- [x] Comprobar con algo que se sepa en qué idioma se vio (una serie en VOSE, un anime en japonés con subtítulos) que
      cuenta en su versión: en `/perfil` → 🏅 Logros, el progreso de "Leyendo abajo", "Itadakimasu"...
- [x] Si alguien ve en latino: que no cuente como castellano (y, si la pista no dice "Latino", avisarme con lo que pone).
- [x] `/perfil` → 🏅 Logros: "(plex · 🟢 Fácil)" en cada logro de Plex y el campo 🍿 Plex por dificultad. Un anuncio con
      la dificultad al final de cada línea.
- [x] ➕ Crear trofeo con dificultad "gordo" y condición `idioma-episodios:vose 10`: sale con 🎰 en el panel.

**📣 Ranking semanal de Plex (2026-10-03, rama `feature/elduendejavier`)**
- [x] Al arrancar: `[Migraciones] Aplicada 017_ranking_semanal_plex` y `...: el ranking semanal de Plex se publica en
      874776941000020018`.
- [x] Panel admin → Plex: la línea "📣 Ranking semanal: #canal (los lunes a las 10:00)". 📣 Ranking semanal: que la vista
      previa tenga sentido (las horas de cada uno se parecen a las de Tautulli de esa semana).
- [x] El lunes a las 10:00: el mensaje en el canal, con el aviso solo al primero. (O antes, con 📣 Publicar ahora, sabiendo
      que entonces el lunes no saldrá otro de esa semana).

**🍿 Lo pendiente de la gamificación de Plex (2026-10-06, rama `feature/elduendejavier`)**
- [x] Antes de desplegar: `npm run plex:check` (en el servidor, `docker exec -it duende-bot npm run plex:check`). Todo con
      ✓; si sale ⚠ o ✗, mirar la línea (y la tabla de [SIGUIENTES_PASOS](../SIGUIENTES_PASOS.md#3-lo-que-hay-que-comprobar-con-datos-reales)).
- [x] Al arrancar: `[Migraciones] Aplicada 018_plex_importacion_y_sociales` y, en la primera sincronización, `Importación
      de Plex de …: empieza` por cada vinculado; horas después, `…: terminada`.
- [x] Panel admin → Plex → 🏆 Trofeos: las líneas 📼 Importación (50 %, N importando) y 🎰 Roles de Gordos, y los
      botones 🪙 % de la importación, 🎰 Roles de Gordos y 🔍 Idiomas. Decidir el % antes de que la gente reclame.
- [x] 🔍 Idiomas: el reparto tiene sentido (mucho castellano e inglés, algo de japonés) y los "no reconocidos" son pocos.
- [x] Reclamar un logro de Plex de la importación: el menú dice "+N 🪙 (📼 de la importación)" y cobra ese N.
- [x] 🎰 Roles de Gordos: elegir un rol para 1 y ver que quien ya tiene un 🎰 lo recibe (y nadie que oculte sus logros).
- [x] `/perfil` → 🏅 Logros: el menú "Qué logros ver" (una categoría, 🏆 solo trofeos, 🟢/🟡/🎰); pasar página y reclamar
      sin perder el filtro. Con una cuenta sin Plex vinculado: no salen los logros de Plex y el total de logros baja.
- [x] `/perfil` → 👤 Perfil → 🍿 Plex (y `/perfil seccion:🍿 Plex`): horas, idiomas y "Te falta poco" con sentido; en el de
      otro se ve, salvo si lo oculta.
- [x] `/perfil` → 🏆 Rankings → 🍿 Plex: los cinco rankings; las horas de siempre se parecen a las de Tautulli.
- [x] Preguntar al Duende (en un canal de Plex) "¿qué trofeos de Plex tiene X?" y "¿quién ha terminado <una serie>?":
      en el log, `Herramienta usada: consultar_trofeos_plex`.
- [x] ➕ Crear trofeo con fechas (`genero:Terror 5 desde:2026-10-01 hasta:2026-10-31`): la descripción dice las fechas y
      solo cuenta lo de esos días.
- [x] Los trofeos de series en un idioma que ya había ("Breaking Bad en inglés") van cogiendo nombre de Gemini en las
      siguientes sincronizaciones (en el log, `Trofeos de Plex renombrados con Gemini`).
- [x] Unos días después: alguien con "Sin spoilers" o "Primero del servidor" (hace falta que las fichas tengan ya la fecha
      de llegada; las de antes se vuelven a pedir cada 3 días si la serie se ve) y con "Cine compartido".

**🧙 El Duende en la economía (F-DU-03, #14)**
- [x] Al arrancar: `[Migraciones] Aplicada 024_prestamos_duende`.
- [x] En el chat del Duende, "te reto a piedra, papel o tijera por 100": sale su respuesta y debajo la propuesta con
      ✅ Acepto / ❌ No. Que otra persona no la pueda aceptar, que ❌ la cierre sin mover nada y que con ✅ se convierta en
      el duelo y se resuelva al elegir (en Movimientos, "contra el Duende" y el impuesto si ganas).
- [x] "Te apuesto 100 a que gana …" con un partido de los próximos de ⚽ Apuestas: la propuesta dice bien el partido y
      el resultado; al aceptar sale el reto, y al acabar el partido se paga (o no) y sale en el canal de resultados con
      "🧙 el Duende".
- [x] "Préstame 200": al aceptar llegan las 200 y en `/perfil` → 💰 Economía sale lo que se debe (220) con 🧙 Devolver.
      Devolverlo; y otro, dejarlo vencer (o adelantar `vence_en` en la BD) y ver el cobro, el DM y, si no llega, la deuda.
- [x] Por voz (`/escuchar` o `/conversación`) el Duende no ofrece retos ni préstamos.
- [x] Si `/juegos` tiene canales restringidos (ACL), los botones del duelo no funcionan fuera de ellos: comprobar que el
      canal del Duende está permitido para `/juegos`.

**🤖 /duende como panel único (F-DU-06, #113)**
- [x] `/duende` abre un panel privado con 💬 Hablar, 🧠 Recuerdos y 🎭 Personalidad (y, si eres admin, añadir y quitar).
- [x] 💬 Hablar: escribir algo y que el Duende conteste en el canal con la personalidad del canal.
- [x] 🧠 Recuerdos: anotar algo sobre ti y verlo; 🧹 Olvidar lo borra y no toca el perfil base.
- [x] Como no admin, no puedes anotar ni olvidar lo de otra persona (sale el aviso).
- [x] Como admin, eliges a otra persona con el selector y ves o cambias sus recuerdos.
- [x] 🎭 Personalidad: como admin, eliges la del canal y se nota en la siguiente respuesta. Añadir y quitar funcionan.
- [x] Los mensajes de texto al Duende y `/escuchar` siguen respondiendo como antes.

**🗂️ /cripto con pestañas (F-EC-12e, #121)**
- [x] `/cripto` abre 📈 Mercado con la gráfica; los botones 24 h / 7 días / 30 días / Todo cambian el rango.
- [x] 🛒 Comprar: elegir 1.000 monedas → sale la vista previa (pagas, recibes, precio) y no se ha cobrado nada. Confirmar → aviso ✅ y el efectivo baja.
- [x] 🛒 Comprar sin efectivo: el botón de confirmar sale apagado; con dinero en el banco aparece 💵 Sacar del banco y vuelve a la vista previa.
- [x] 🛒 ✏️ Otra cantidad: escribir un número abre la vista previa; escribir texto muestra el aviso.
- [x] 💸 Vender: 25 / 50 / 100 % → vista previa sin impuestos; confirmar → aviso ✅ y el efectivo sube.
- [x] 💸 Vender sin TTCL: sale el aviso, sin porcentajes.
- [x] 💼 Cartera: cantidad, valor, coste medio y ganancia; sin TTCL, lo dice.
- [x] 🧾 Historial: compras y ventas, más recientes primero; los botones de página funcionan.
- [x] 🏆 `/perfil` → Rankings → 💎 TTCL sigue saliendo.

**📰 Eventos diarios de TTCL (F-EC-12d, #120)**
- [x] Al arrancar: `[Migraciones] Aplicada 029_eventos_ttcl`.
- [x] Durante el día, a la hora del evento: el precio de TTCL en `/cripto` sube o baja un 5 % y aparece en el historial del gráfico.
- [x] Quien tiene TTCL recibe un DM con el evento; quien no tiene TTCL no recibe nada.
- [x] Al día siguiente hay otro evento, a otra hora (aleatoria).

**💸 Ventas de cripto sin impuesto (F-EC-12c, #119)**
- [x] Con el impuesto de ingresos activo, vender TTCL: el efectivo sube lo que sale en la previsión, sin línea de 🏛️ Impuesto.
- [x] Con un préstamo del Duende vencido o en deuda, vender TTCL: la deuda se descuenta de lo que entra.

**📊 Gráficas de /cripto (F-EC-12f, #122)**
- [x] `/cripto` → 📈 gráfico de TTCL: se ve la gráfica nítida, con la fuente Outfit, precio y % en el título.
- [x] 💼 Cartera: el donut sale con la leyenda y el total en monedas.
- [x] El bot arranca sin errores de `canvas` (la dependencia se ha quitado) y la imagen de Docker se construye.

**🧹 Solo TTCL (F-EC-12b, #118)**
- [x] Al arrancar: `[Migraciones] Aplicada 028_liquidar_criptos_reales`.
- [x] En `/cripto` no sale BTC, ETH, SOL, BNB, XRP ni DOGE (ni en compra, venta, gráficos ni precios).
- [x] Quien tenía de esas criptos ve el saldo en su efectivo y una línea de tipo cripto en Movimientos, sin 🏛️ Impuesto.

**💧 TTCL como pool de liquidez (F-EC-12a, #117)**
- [x] Al arrancar: `[Migraciones] Aplicada 027_ttcl_pool`. El precio de TTCL en `/cripto` ha vuelto a 100.
- [x] Comprar 500.000 monedas de TTCL: sale una cantidad de TTCL y se cobra la comisión (1 %). El precio sube.
- [x] Vender esas unidades en varios trozos: no sale más de lo que se pagó (la comisión queda en el pool).
- [x] 🩺 Sistema → 💎 TTCL muestra el pool (monedas y TTCL) y las unidades en carteras.
- [x] Config Global → 📈 Cripto ya no tiene precio base ni volatilidad, solo comisiones.

**🛒 /tienda como panel único (F-EC-11, #110)**
- [x] `/tienda` sin opciones abre el 🛒 Catálogo con los menús de categoría y rareza y el botón 🔍 Buscar.
- [x] Elegir una categoría deja solo sus objetos; elegir "todas" los vuelve a mostrar.
- [x] 🔍 Buscar "espada": solo los que tienen ese nombre; ✖ Quitar búsqueda los devuelve.
- [x] Un filtro sin resultados muestra el aviso y los menús siguen ahí.
- [x] 🎒 Inventario con los mismos filtros; 🧾 Mis compras sigue como pestaña.
- [x] En 📚 /ayuda → 💰 Economía, el botón "Abrir Tienda" abre el panel.

**🏦 Patrimonio (F-EC-10, #81)**
- [x] Al arrancar: `[Migraciones] Aplicada 026_patrimonio`.
- [x] En Config Global → 🏛️ Impuestos → 🏦 Patrimonio se ve la configuración (50.000, 1 %, 0,5 %, cada 7 días, bote). Editarla con un valor inválido (p. ej. 150 % de impuesto) sale el aviso y no cambia nada.
- [x] Al cumplirse el primer ciclo de alguien con más de 50.000 en el banco: sale 🏦 Patrimonio (interés) y 🏛️ Impuesto en Movimientos, y el saldo del banco baja lo justo.
- [x] La subida del bote aparece en Config Global → 🏛️ Impuestos.

**🏪 Negocios y blanqueo (F-EC-06d, #80)**
- [x] Al arrancar: `[Migraciones] Aplicada 025_negocios_blanqueo`.
- [x] Ingresar al banco y comprar 🧺 Lavandería en /perfil → 💰 Economía → 🏪 Negocios: se resta del banco, no del efectivo.
- [x] Intentar comprarla sin dinero en el banco: sale el aviso y no se cobra nada.
- [x] 🧼 Depositar más de lo que queda de capacidad hoy: sale el aviso con lo que queda.
- [x] Depositar dinero negro: baja el 🥷 negro, no cambia el efectivo, aparece 🧼 En limpieza.
- [x] Al cabo de unas horas (cron cada 5 min): sube el efectivo poco a poco, con 🧼 Blanqueo y 🏛️ Impuesto en Movimientos.
- [x] Al día siguiente (00:00, hora de Madrid): vuelve la capacidad y llega el ingreso diario (🏪 Negocios).
- [x] Vender el negocio: vuelve el 50 % del precio al banco.

**🛡️ Objetos antirrobo (F-EC-06c, #79)**
- [x] Al arrancar: `[Migraciones] Aplicada 023_objetos_antirrobo`; en la tienda salen el Candado y la Trampa para ladrones.
      Decidir si los precios (150 y 100) valen o cambiarlos en 🛒 Catálogo.
- [x] Con dos cuentas: una compra el candado y la trampa y la otra le hace `/robar` — el mensaje lo dice y se le gastan
      del inventario como toca.

**🤖 Cambio automático de modelo de Gemini (F-AD-03, #39)**
- [x] Revisar `GEMINI_FALLBACK_MODELS` en el stack (por defecto `gemini-2.5-flash,gemini-2.5-pro`): que sean modelos que existan.
- [x] Poner en Config Global → 🤖 Duende un modelo que no exista y reiniciar: en el log `Modelo de Gemini cambiado solo de …
      a …`, llega la alerta "🤖 He cambiado el modelo de Gemini" y el panel ya enseña el nuevo.

**📊 Resumen semanal para admins (F-AD-02, #38)**
- [x] `/paneladmin` → 🩺 Sistema → 🔔 Alertas → 📊 Resumen semanal: los errores y comandos cuadran con los logs.
- [x] El lunes a las 09:00 llega por DM a quien recibe las alertas (en el log, `Resumen semanal enviado a N/N admins`).

**🎉 Eventos temporales (F-EC-02, #34)**
- [x] `/paneladmin` → ⚙️ Config Global → 🎉 Eventos: activar la happy hour con las horas de ahora mismo; en `/perfil` sale
      "⚡ Happy hour" y un mensaje da el doble de XP (mirarlo en el log de XP o en la barra).
- [x] Activar el fin de semana del casino un sábado o domingo: 🎰 Casino lo dice arriba y una victoria paga más.

**🕐 Tono del Duende (F-DU-02, #13)**
- [x] Config Global → 🤖 Duende → 🕐 Tono: poner un canal formal y hablarle allí: contesta sin tacos.
- [x] Activar la madrugada con una franja que incluya la hora actual (p. ej. de la hora de ahora a una más) y hablarle:
      más borde. Dejarlo después como se quiera (00 a 07 por defecto).

**⭐ Partido destacado del día (F-AP-07, #5)**
- [x] Con canal de resultados puesto, un día con partidos: a las 10:00 (o al arrancar si es más tarde) sale el ⭐ en el
      canal, con un partido de hoy (`Partido destacado del … en …` en el log). Pulsar un resultado abre el formulario.
- [x] `/paneladmin` → ⚽ Apuestas → ⭐ Quitar el destacado: al día siguiente no sale.

**🎯 Marcador exacto (F-AP-10, #7)**
- [x] `/juegos` → ⚽ Apuestas → un partido → 🎯 Marcador exacto: el formulario pide los goles de cada equipo y la cantidad.
- [x] Apostar a un marcador y verlo en 📋 Mis jugadas ("Marcador exacto 2-1 · … @8"); cuando se liquide, que pague ×8 si
      se acertó (y que el resto de apuestas a ese partido se paguen como siempre).

**🚦 Límites de apuestas (F-AP-09, #6)**
- [x] `/paneladmin` → ⚽ Apuestas → 🚦 Límites: poner un tope diario y un máximo por partido; salen en la línea 🚦 del panel.
- [x] Apostar a un partido más del máximo (en una o en dos apuestas a distintos resultados): no deja y dice cuánto queda.
- [x] Apostar en partidos y en la quiniela hasta el tope diario: la siguiente no deja hasta el día siguiente.

**↩️ Cancelar una apuesta (F-AP-05, #4)**
- [x] Apostar 100 a un partido que aún no ha empezado; en 📋 Mis jugadas → ↩️ Cancelar una apuesta, elegirla: dice que
      devuelve 90. Confirmar: llegan 90 al efectivo y en 📜 Movimientos sale "Apuesta cancelada: … (comisión de 10)".
- [x] Con un mensaje de Mis jugadas abierto desde antes de que empiece un partido, intentar cancelarla ya empezado: no deja.

**💼 Cartera de apuestas (F-AP-04, #3)**
- [x] `/juegos` → 📋 Mis jugadas: arriba, lo que tienes en juego, el posible premio y el beneficio del mes, y que cuadren
      con las apuestas de debajo y con 📋 Resueltas.

**⚽ Ranking de apostadores (F-AP-03, #2)**
- [x] `/perfil` → 🏆 Rankings → ⚽ Apostadores: salen quienes tienen al menos 5 apuestas resueltas, y el beneficio de
      cada uno cuadra con el "Apuestas" de su `/juegos` → 📊 Stats.

**🏆 Clasificación semanal (F-EC-03, #35)**
- [x] Al arrancar: `[Migraciones] Aplicada 022_clasificacion_semanal`.
- [x] `/paneladmin` → ⚙️ Config Global → 🏆 Semanal: elegir el canal y el premio; "Si fuera ahora" tiene sentido.
- [x] El lunes a las 10:00: el mensaje en el canal, con aviso solo a los premiados, y en sus 📜 Movimientos el premio
      (🏆 Premios) y su impuesto.

**Voz del Duende (2026-10-02, después del arreglo de DAVE)**
- [x] Quitar `GEMINI_TTS_MODEL` de las variables del stack si vale `gemini-2.5-flash-preview-tts`.
- [x] `/paneladmin` → 🩺 Sistema → 🔊 Probar voz: que diga "✅ Voz generada con **gemini-3.8-flash-tts**" y que el
      audio adjunto se oiga bien. Si sale ❌, pasarme el mensaje entero (dice qué le pasó a cada modelo).
- [x] `/tts hola` en un canal de voz: se oye.
- [x] `/escuchar`, decir algo y que el Duende conteste por voz (y, si no puede, por texto con "🗣️").
- [x] Con el nivel de log en `debug`, el paso a paso: `[TTS] Audio sintetizado con …` y `[Duende:Voz] Reproducción
      iniciada`.

**Arreglos tras desplegar (2026-10-02)**
- [x] Reconstruir la imagen (pasa a Node 22) y, en un canal de voz, `/tts hola`, `/escuchar` y que el Duende conteste
      por voz: ya no debe salir "Error al unirse al canal de voz: AbortError".
- [x] `/perfil` → 🏅 Logros: ▶ a la página 2, ◀ de vuelta, 👁️ Ver secretos y 🙈 Ocultar secretos. 🏆 Rankings →
      ⏭️ y ⏮️ en el de nivel. `/tienda inventario` con más de 5 objetos: ➡️ y ⬅️. Ninguno debe dar error.
- [x] Añadir el apodo "coneyo" (y los que falten) en `/paneladmin` → Duende → Apodos, o importar el fichero de apodos
      (ver T-02 "Antes"): el Duende no supo quién era "el coneyo" porque ese apodo no está en la BD de producción.

**Resto**
- [x] `/cripto`: comprar y vender algo y ver un gráfico (el comando se ha partido en paneles); vender el 100 %
      con doble clic rápido: solo debe venderse una vez.
- [x] `/tienda historial` (🧾 Mis compras): solo compras de la tienda.
- [x] `/escuchar` y `/tts` en un canal de voz: que transcriba (el audio ahora se decodifica con `opusscript`).
- [x] `/paneladmin`: Duende → Apodos, Duende → 🧠 Perfiles (ver la ficha de alguien, cambiar nombre, descripción
      y notas con "Editar todo", y que el Duende lo use; vincular un perfil sin vincular poniéndole el Discord ID),
      Niveles → las cuatro pantallas, buscar un rol en Recompensas (pasar de página) y Recompensas → Descripción.
- [x] `/duende recuerda` sobre otro sin ser admin (debe negarse) y sobre uno mismo; `/duende personas` sin
      ser admin (solo lo tuyo, en privado) y como admin (todos).
- [x] Al día siguiente, que exista `data/backups/banco-AAAA-MM-DD.db`.
