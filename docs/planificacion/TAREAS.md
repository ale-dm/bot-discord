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
- [ ] Copia de seguridad de `/compose/duende-bot/data/banco.db`.
- [ ] Copiar `data/duende-apodos.seed.json.importado` del repo local a `/compose/duende-bot/data/duende-apodos.seed.json`
      (sin `.importado`) para que el servidor importe los apodos.
- [ ] Copia **limpia** del código en el servidor, `docker build`, actualizar el stack.

**Al arrancar, en `docker logs` / `logs/app-log.txt`**
- [ ] Las migraciones pendientes aplicadas (`[Migraciones] Aplicada 00N_...`, hasta la 009) y la 009 diciendo cuántas
      apuestas antiguas ha añadido al historial.
- [ ] `Importados 33 apodos de 12 personas`.
- [ ] `Importadas 6 personalidades y 9 perfiles` y, al conectar, `Perfiles del Duende: N vinculados`.
- [ ] Que exista `data/backups/tablas-antiguas-AAAA-MM-DD.json`.
- [ ] `✓ Conectado como El Duende#...`, sin el aviso de `ready` obsoleto ni "opcode 8 was rate limited".
- [ ] En el registro de comandos (`N comandos: ...`) está `juegos` y ya no están `blackjack`, `ruleta`,
      `tragaperras`, `adivinar`, `ppt`, `apuestas`, `quiniela` ni `misapuestas`; en Discord tampoco aparecen.
- [ ] Si había reglas de canales/roles (ACL) para esos comandos o para `perfil` pensando en el casino,
      ponerlas sobre `juegos` (Panel admin → Config Global → 🔐 Comandos).

**En Discord**
- [ ] Hablar con el Duende y que reconozca apodos ("¿qué ha visto el perro?").
- [ ] `/perfil` → 💰 Economía (ganado/perdido del casino y todas las criptos con valor); `/ayuda` (secciones
      Casino y Apuestas hablan de `/juegos`).
- [ ] Algún mensaje privado (p. ej. un error al sacar del banco) sigue saliendo solo para quien lo pide.

**`/juegos` (partes 2 a 4 de paneles)**
- [ ] `/juegos` sin opciones abre 🎰 Casino; `/juegos seccion:` abre cada pestaña. Las pestañas de abajo
      llevan de una a otra en el mismo mensaje, con la actual resaltada.
- [ ] 🎰 Casino: una partida de cada juego (blackjack normal, doblando y separando; ruleta a color, docena y
      número exacto; tragaperras; adivinar; PPT) y los botones del final (🔄 Repetir, 🎲 Otra apuesta,
      📊 Stats, ◀ Casino). Intentar apostar más de lo que tienes: el aviso sale aparte y el panel sigue.
      Ranking, Historial y Mis stats del casino.
- [ ] `/perfil` → 🎰 Casino abre la pestaña Casino y se puede jugar desde ahí.
- [ ] ⚽ Apuestas: cambiar de competición y de página (la segunda vez sin gastar crédito, ver log); apostar a
      un partido y pulsar 📋 Mis jugadas y ⚽ Más partidos; que la apuesta salga en `/perfil` → 💰 Economía → 📜 Movimientos (filtro Apuestas).
- [ ] 🧾 Quiniela: 🔄 Refrescar; que salga el mínimo de aciertos para cobrar; después de apostar, tus
      pronósticos con ✅/❌ y el botón 📋 Mis jugadas.
- [ ] 📋 Mis jugadas: ⏳ En juego y 📋 Resueltas (cambian en el mismo mensaje), y el botón 🧾 Quiniela.
- [ ] 📊 Stats: casino, apuestas a partidos, quinielas y el total.
- [ ] Que otra persona no pueda usar los botones de tu `/juegos`.

**Dinero (parte 5 de paneles)**
- [ ] Al arrancar, `[Migraciones] Aplicada 010_historial_tipo` con cuántos movimientos ha clasificado.
- [ ] `/perfil` → 💰 Economía: efectivo, banco y total; 🏦 Ingresar y 💵 Sacar; 💸 Transferir a alguien;
      📜 Movimientos con el filtro; 🏆 Rankings → Riqueza.
- [ ] Con todo el dinero en el banco, intentar jugar en el casino: los importes salen desactivados y está
      💵 Sacar del banco; sacar y ver que la pantalla se actualiza. Lo mismo en la tienda y en la compra de cripto.
- [ ] Ganar algo en el casino y comprobar que el premio llega al efectivo.
- [ ] Avisar en el servidor: desde ahora se juega y se compra con el efectivo, y el banco es para guardar.

**Perfil (parte 6 de paneles)**
- [ ] En el registro de comandos ya no están `nivel`, `logros` ni `banco` (21 comandos).
- [ ] `/perfil`: las cinco pestañas; 🎭 Recompensas de nivel; en 🏅 Logros, reclamar uno y todos, y ver secretos;
      en 🏆 Rankings, los cinco del menú y pasar páginas en el de nivel.
- [ ] `/perfil usuario:X`: se ve todo lo suyo (también economía y movimientos) sin botones de acción, y las
      pestañas no llevan a tu perfil.
- [ ] 💰 Economía: ingresar, sacar, transferir y movimientos desde el perfil.

**Tienda (parte 7 de paneles)**
- [ ] En el registro de comandos ya no están `inventario` ni `usar` (19 comandos).
- [ ] `/tienda ver`: comprar un consumible y usar 🔮 Usar ya; 🎒 Ver en inventario; las tres pestañas.
- [ ] `/tienda inventario`: usar un objeto de rol y uno consumible (el resultado sale en el panel).
- [ ] Que otra persona no pueda pulsar los botones de tu tienda.

**Admin (parte 8 de paneles)**
- [ ] En el registro de comandos quedan 14: ayuda, bola8, cripto, duende, escuchar, ia, imagen, javier, juegos,
      paneladmin, perfil, ping, tienda y tts.
- [ ] `/paneladmin` → ⚽ Apuestas: lo pendiente, 💸 Liquidar ahora y crear una quiniela.
- [ ] `/paneladmin` → 🛒 Catálogo: crear un objeto, editarle un campo, ponerlo a la venta, cambiarle el precio,
      quitarlo y eliminarlo.
- [ ] `/paneladmin` → 🩺 Sistema: diagnóstico, 💎 TTCL y cambiar el nivel de log.

**Ayuda y público (parte 9 de paneles)**
- [ ] `/ayuda` → cada sección: los botones verdes abren su panel en un mensaje nuevo, y sus botones funcionan.
- [ ] Con `/juegos` limitado a un canal (ACL), el botón de la ayuda en otro canal avisa y no lo abre.
- [ ] La tienda, los partidos y la quiniela salen públicos; el editor de pronósticos, privado.

**Mejoras del 2026-10-02 (rama `feature/elduendejavier`)**
- [ ] Al arrancar: `[Migraciones] Aplicada 011_diario_avisos_recordatorios` y `Modelo de Gemini ...: funciona y usa
      herramientas` (si no, te llega una alerta por DM).
- [ ] `/perfil` → 💰 Economía: 🎁 Diario cobra, el panel dice cuánto y el botón pasa a "🎁 Mañana"; sale en
      📜 Movimientos con el filtro 🎁 Diario. En el perfil de otro no hay botón. Con racha de varios días, da más.
- [ ] `/paneladmin` → ⚙️ Config Global → 🎁 Diario: cambiar base/tope y ver que la Economía lo refleja.
- [ ] `/paneladmin` → ⚽ Apuestas → 📢 Canal de resultados: elegir un canal, 💸 Liquidar ahora con algún partido
      terminado y ver el resumen en el canal (con nombres, sin pings).
- [ ] Apostar a un partido que empiece en menos de una hora: llega el DM ⏰ unos 30 min antes, una sola vez.
- [ ] Seerr: pedir algo que no esté y, cuando llegue, ver "🍿 @tú, lo que pediste ya está en Plex" en el canal de
      novedades. (Si Seerr ya avisa por su cuenta en Discord, decidir si se deja uno de los dos: 🍿 Seerr →
      🔕 No avisar al llegar.)
- [ ] `/paneladmin` → 🩺 Sistema: se ven los créditos de la Odds API; 🔔 Alertas → 📨 Probar te llega por DM;
      poner los IDs de los admins que deben recibirlas; 🤖 Probar Gemini dice ✅.
- [ ] Config Global → 🤖 Duende → ✏️ Editar IA con un modelo inventado: avisa de que no existe (y volver a dejarlo).
- [ ] Preguntar al Duende "¿qué hay en la tienda?", "¿qué tengo en el inventario?", "¿cómo van mis apuestas?",
      "¿cuánto llevo perdido en el casino?" y "¿puedo cobrar el diario?": que use las herramientas (en el log,
      `Herramienta usada: consultar_...`).

**⚔️ Retos (2026-10-02, rama `feature/elduendejavier`)**
- [ ] Al arrancar: `[Migraciones] Aplicada 012_retos`; en `/juegos` sale la pestaña ⚔️ Retos (cinco pestañas) y
      `/juegos seccion: ⚔️ Retos` la abre.
- [ ] ⚽ Retar a un partido: elegir partido, resultado, rival y cantidad. Sale un mensaje nuevo que menciona al rival;
      otra persona no puede aceptarlo; el rival acepta. Cuando acabe el partido, la liquidación paga al que acertó,
      llega el DM, se edita el mensaje del reto y sale en el canal de resultados.
- [ ] 🎲 Duelo de piedra, papel o tijera: cada uno elige (el mensaje solo dice quién ha elegido), un empate pide otra
      ronda y al final paga al ganador. Duelo de dados (se resuelve al aceptar) y de blackjack (🃏 Mi mano en privado,
      Pedir y Plantarse; el mensaje se actualiza y al final enseña las dos manos).
- [ ] ❌ Rechazar y 🚫 Cancelar devuelven el dinero; un reto sin aceptar en 24 h se devuelve solo (con DM).
- [ ] 🗳️ Porra: crearla con 3 opciones, entrar desde dos cuentas, 🔒 Cerrar apuestas, ⚖️ Resolver (sin ser admin
      no deja; como admin, menú privado) y ver que el bote se reparte. 🚫 Anular devuelve a todos.
- [ ] Movimientos con el filtro ⚔️ Retos; 📊 Stats con la línea de retos; la pestaña ⚔️ Retos con los enlaces a
      cada reto; `/ayuda` → Apuestas con el botón Abrir Retos.

**🍿 Logros de Plex, fase 1 (2026-10-02, rama `feature/elduendejavier`)**
- [ ] Al arrancar: `[Migraciones] Aplicada 013_plex_historial`.
- [ ] Panel admin → Plex: la línea 📼 Historial para los logros y el botón 📼 Sincronizar historial. La primera vez
      importa el historial entero (en el log, `(primera importación)`): comprobar que el número de reproducciones
      cuadra más o menos con Tautulli y cuánto tarda.
- [ ] Los logros de Plex que ya tenía cada vinculado salen en el canal de logros, un solo mensaje por persona.
- [ ] Al arrancar: `[Migraciones] Aplicada 014_canal_logros` y `...: los logros se anuncian en 874776941000020018`.
      Completar un logro cualquiera (p. ej. la primera apuesta en el casino con una cuenta nueva) y ver que en ese
      canal sale "🎉 @persona desbloqueó logros" con la mención.
- [ ] `/perfil` → 🏅 Logros: los de categoría `plex`, con su progreso, y reclamar uno.
- [ ] Ver algo en Plex y, en la siguiente media hora, que se actualice el progreso (y que un logro nuevo sí se anuncie).
- [ ] Mirar que las horas de alguien se parezcan a las de Tautulli (sus estadísticas de usuario, "All Time").

**🍿 Trofeos de Plex, fases 2 y 3 (2026-10-02, rama `feature/elduendejavier`)**
- [ ] Al arrancar: `[Migraciones] Aplicada 015_plex_trofeos`.
- [ ] Panel admin → Plex → 🏆 Trofeos: 🎌 Anime coge las bibliotecas de anime de verdad (si no, 🎌 Bibliotecas de anime).
- [ ] 📼 Sincronizar ahora unas cuantas veces hasta que "pendientes" llegue a 0 (en el log, `Fichas de Plex de ...`):
      mirar cuánto tarda la primera (la lista de películas) y que "Todas las de…" y sagas pase a ✅ activos.
- [ ] En el canal de logros, los trofeos con su nombre de Gemini, de qué son y la rareza; que no salgan cortados raros.
      Si muchos se quedan con el nombre por defecto ("X: completada"), mirar en el log el aviso de Gemini.
- [ ] Comprobar con alguien que ha terminado una serie que la tiene, y que una de anime sale con 🎌 (y cuenta en
      "Sayonara", no en "Créditos finales").
- [ ] ➕ Crear trofeo con `director:Nolan` (o alguno que alguien ya cumpla): sale enseguida a quien lo cumple y en el
      panel pone cuántos lo tienen. Uno con una condición mal escrita avisa. 🗑️ Borrarlo.
- [ ] `/perfil` → 🏅 Logros: la rareza en los de Plex; 🍿 Ocultar mis logros de Plex y, desde otra cuenta,
      `/perfil usuario:` sin los de Plex. Volver a enseñarlos.
- [ ] Mirar que las recompensas de la primera importación no desequilibran la economía (si sí, bajar
      `logros.reward_multiplier` antes de que se reclamen).

**🍿 Logros de Plex por idioma y dificultad (2026-10-03, rama `feature/elduendejavier`)**
- [ ] Al arrancar: `[Migraciones] Aplicada 016_plex_idiomas_dificultad`.
- [ ] Panel admin → Plex → 🏆 Trofeos: la línea 🗣️ Idiomas (revisadas y pendientes) y "Por dificultad". 📼 Sincronizar
      ahora hasta que los idiomas pendientes lleguen a 0.
- [ ] Comprobar con algo que se sepa en qué idioma se vio (una serie en VOSE, un anime en japonés con subtítulos) que
      cuenta en su versión: en `/perfil` → 🏅 Logros, el progreso de "Leyendo abajo", "Itadakimasu"...
- [ ] Si alguien ve en latino: que no cuente como castellano (y, si la pista no dice "Latino", avisarme con lo que pone).
- [ ] `/perfil` → 🏅 Logros: "(plex · 🟢 Fácil)" en cada logro de Plex y el campo 🍿 Plex por dificultad. Un anuncio con
      la dificultad al final de cada línea.
- [ ] ➕ Crear trofeo con dificultad "gordo" y condición `idioma-episodios:vose 10`: sale con 🎰 en el panel.

**📣 Ranking semanal de Plex (2026-10-03, rama `feature/elduendejavier`)**
- [ ] Al arrancar: `[Migraciones] Aplicada 017_ranking_semanal_plex` y `...: el ranking semanal de Plex se publica en
      874776941000020018`.
- [ ] Panel admin → Plex: la línea "📣 Ranking semanal: #canal (los lunes a las 10:00)". 📣 Ranking semanal: que la vista
      previa tenga sentido (las horas de cada uno se parecen a las de Tautulli de esa semana).
- [ ] El lunes a las 10:00: el mensaje en el canal, con el aviso solo al primero. (O antes, con 📣 Publicar ahora, sabiendo
      que entonces el lunes no saldrá otro de esa semana).

**🍿 Lo pendiente de la gamificación de Plex (2026-10-06, rama `feature/elduendejavier`)**
- [ ] Antes de desplegar: `npm run plex:check` (en el servidor, `docker exec -it duende-bot npm run plex:check`). Todo con
      ✓; si sale ⚠ o ✗, mirar la línea (y la tabla de [SIGUIENTES_PASOS](../SIGUIENTES_PASOS.md#3-lo-que-hay-que-comprobar-con-datos-reales)).
- [ ] Al arrancar: `[Migraciones] Aplicada 018_plex_importacion_y_sociales` y, en la primera sincronización, `Importación
      de Plex de …: empieza` por cada vinculado; horas después, `…: terminada`.
- [ ] Panel admin → Plex → 🏆 Trofeos: las líneas 📼 Importación (50 %, N importando) y 🎰 Roles de Gordos, y los
      botones 🪙 % de la importación, 🎰 Roles de Gordos y 🔍 Idiomas. Decidir el % antes de que la gente reclame.
- [ ] 🔍 Idiomas: el reparto tiene sentido (mucho castellano e inglés, algo de japonés) y los "no reconocidos" son pocos.
- [ ] Reclamar un logro de Plex de la importación: el menú dice "+N 🪙 (📼 de la importación)" y cobra ese N.
- [ ] 🎰 Roles de Gordos: elegir un rol para 1 y ver que quien ya tiene un 🎰 lo recibe (y nadie que oculte sus logros).
- [ ] `/perfil` → 🏅 Logros: el menú "Qué logros ver" (una categoría, 🏆 solo trofeos, 🟢/🟡/🎰); pasar página y reclamar
      sin perder el filtro. Con una cuenta sin Plex vinculado: no salen los logros de Plex y el total de logros baja.
- [ ] `/perfil` → 👤 Perfil → 🍿 Plex (y `/perfil seccion:🍿 Plex`): horas, idiomas y "Te falta poco" con sentido; en el de
      otro se ve, salvo si lo oculta.
- [ ] `/perfil` → 🏆 Rankings → 🍿 Plex: los cinco rankings; las horas de siempre se parecen a las de Tautulli.
- [ ] Preguntar al Duende (en un canal de Plex) "¿qué trofeos de Plex tiene X?" y "¿quién ha terminado <una serie>?":
      en el log, `Herramienta usada: consultar_trofeos_plex`.
- [ ] ➕ Crear trofeo con fechas (`genero:Terror 5 desde:2026-10-01 hasta:2026-10-31`): la descripción dice las fechas y
      solo cuenta lo de esos días.
- [ ] Los trofeos de series en un idioma que ya había ("Breaking Bad en inglés") van cogiendo nombre de Gemini en las
      siguientes sincronizaciones (en el log, `Trofeos de Plex renombrados con Gemini`).
- [ ] Unos días después: alguien con "Sin spoilers" o "Primero del servidor" (hace falta que las fichas tengan ya la fecha
      de llegada; las de antes se vuelven a pedir cada 3 días si la serie se ve) y con "Cine compartido".

**⭐ Partido destacado del día (F-AP-07, #5)**
- [ ] Con canal de resultados puesto, un día con partidos: a las 10:00 (o al arrancar si es más tarde) sale el ⭐ en el
      canal, con un partido de hoy (`Partido destacado del … en …` en el log). Pulsar un resultado abre el formulario.
- [ ] `/paneladmin` → ⚽ Apuestas → ⭐ Quitar el destacado: al día siguiente no sale.

**Voz del Duende (2026-10-02, después del arreglo de DAVE)**
- [ ] Quitar `GEMINI_TTS_MODEL` de las variables del stack si vale `gemini-2.5-flash-preview-tts`.
- [ ] `/paneladmin` → 🩺 Sistema → 🔊 Probar voz: que diga "✅ Voz generada con **gemini-3.8-flash-tts**" y que el
      audio adjunto se oiga bien. Si sale ❌, pasarme el mensaje entero (dice qué le pasó a cada modelo).
- [ ] `/tts hola` en un canal de voz: se oye.
- [ ] `/escuchar`, decir algo y que el Duende conteste por voz (y, si no puede, por texto con "🗣️").
- [ ] Con el nivel de log en `debug`, el paso a paso: `[TTS] Audio sintetizado con …` y `[Duende:Voz] Reproducción
      iniciada`.

**Arreglos tras desplegar (2026-10-02)**
- [ ] Reconstruir la imagen (pasa a Node 22) y, en un canal de voz, `/tts hola`, `/escuchar` y que el Duende conteste
      por voz: ya no debe salir "Error al unirse al canal de voz: AbortError".
- [ ] `/perfil` → 🏅 Logros: ▶ a la página 2, ◀ de vuelta, 👁️ Ver secretos y 🙈 Ocultar secretos. 🏆 Rankings →
      ⏭️ y ⏮️ en el de nivel. `/tienda inventario` con más de 5 objetos: ➡️ y ⬅️. Ninguno debe dar error.
- [ ] Añadir el apodo "coneyo" (y los que falten) en `/paneladmin` → Duende → Apodos, o importar el fichero de apodos
      (ver T-02 "Antes"): el Duende no supo quién era "el coneyo" porque ese apodo no está en la BD de producción.

**Resto**
- [ ] `/cripto`: comprar y vender algo y ver un gráfico (el comando se ha partido en paneles); vender el 100 %
      con doble clic rápido: solo debe venderse una vez.
- [ ] `/tienda historial` (🧾 Mis compras): solo compras de la tienda.
- [ ] `/escuchar` y `/tts` en un canal de voz: que transcriba (el audio ahora se decodifica con `opusscript`).
- [ ] `/paneladmin`: Duende → Apodos, Duende → 🧠 Perfiles (ver la ficha de alguien, cambiar nombre, descripción
      y notas con "Editar todo", y que el Duende lo use; vincular un perfil sin vincular poniéndole el Discord ID),
      Niveles → las cuatro pantallas, buscar un rol en Recompensas (pasar de página) y Recompensas → Descripción.
- [ ] `/duende recuerda` sobre otro sin ser admin (debe negarse) y sobre uno mismo; `/duende personas` sin
      ser admin (solo lo tuyo, en privado) y como admin (todos).
- [ ] Al día siguiente, que exista `data/backups/banco-AAAA-MM-DD.db`.
