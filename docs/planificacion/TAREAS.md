# Tareas

Cosas que hay que **hacer a mano** (no son cambios de código): desplegar y comprobar en Discord. Los errores pendientes están en [ERRORES.md](ERRORES.md), la deuda técnica en [DEUDA_TECNICA.md](DEUDA_TECNICA.md) y
las ideas en [FEATURES.md](FEATURES.md).

La reorganización de paneles y las fases 1 a 12 del [plan de issues](PLAN_ISSUES.md) ya están hechas y probadas;
lo que queda aquí son el despliegue y los repasos de la lista de casillas (T-02, T-04 y T-05).

| ID | Tarea | Prioridad |
|---|---|---|
| [T-02](#t-02-desplegar-y-probar-en-discord) | Desplegar y probar en Discord | 🔴 Alta |
| [T-03](#t-03-comprobar-en-discord-los-refactors-de-la-auditoría) | Comprobar en Discord los refactors de la auditoría (#243, #244). ✅ Confirmada por el usuario y liberada a `main` | ✅ Hecha |
| [T-04](#t-04-comprobar-en-discord-los-refactors-de-tamaño-y-el-resumen-del-ranking) | Comprobar en Discord los refactors de tamaño (#278 a #281, #286), la eliminación de `/ia` y el ranking con resumen (#285) | 🔴 Alta |
| [T-06](#t-06-probar-en-discord-las-fases-1-a-12-del-plan-restante) | Probar en Discord lo hecho en las fases 1 a 12 del plan restante. ✅ Probado por el usuario y liberado a `main` (fases 1-12, #496/#497 y voz #499/#500); issues cerradas | ✅ Hecha |
| [T-05](#t-05-revisar-modelos-de-gemini-y-dependencias) | Revisar modelos de Gemini (retiradas y `/imagen`) y dependencias desactualizadas (revisión del 2026-10-10) | 🟡 Media |
| [T-07](#t-07-probar-en-discord-los-equipos-favoritos) | Probar en Discord los equipos favoritos y su aviso por DM (#530) | 🟡 Media |
| [T-12](#t-12-probar-en-discord-la-guardia-del-duende) | Probar en Discord la guardia del Duende en un canal de voz (#553) | 🟡 Media |
| [T-14](#t-14-probar-en-discord-mi-cine) | Probar en Discord 📊 Mi cine en `/plex` → ⭐ Reseñas (#574) | 🟡 Media |
| [T-15](#t-15-probar-en-discord-la-ruleta-de-películas) | Probar en Discord la 🎲 Ruleta de películas en `/plex` → ⭐ Reseñas (#576) | 🟡 Media |
| [T-16](#t-16-probar-en-discord-los-tickets-de-soporte) | Probar en Discord los tickets de soporte (#537) | 🟡 Media |

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
      ✓; si sale ⚠ o ✗, mirar la línea (y la tabla de [SIGUIENTES_PASOS](../SIGUIENTES_PASOS.md)).
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

---

## T-03 Comprobar en Discord los refactors de la auditoría

Los cambios de #243 (Duende y voz en directo) y #244 (perfil, ajustes, quiniela y liquidación) son traslados de código sin
cambio de comportamiento, pero los tests no cubren la voz ni los botones de la quiniela tal como se ven en Discord. Están en
`developer` y **no se liberan a `main` hasta que esta lista esté marcada.**

**Voz en directo (#243)**
- [x] `/conversación` une al bot al canal, responde por voz y sale tras el corte por inactividad.
- [x] Tertulia: con varias personas hablando, el Duende recibe turnos y contesta.
- [x] Tope de duración: la conexión se cierra al llegar al máximo (`DUENDE_LIVE_MAX_DURATION_MS`, 30 min por defecto).
- [x] `/duende` → 💬 Hablar responde en el canal, con GIF y propuestas de reto cuando toca.

**Quiniela, perfil, rankings y ajustes (#244)**
- [x] `/juegos` → ⚽ Apuestas → quiniela: crear, pronosticar, 🔄 Refrescar (vuelve a mostrar la jornada), cancelar y confirmar.
- [x] `/perfil` → 🏅 Logros: páginas, filtro y reclamar.
- [x] `/perfil` → 🏆 Rankings: cambiar de tipo y de página.
- [x] `/paneladmin` → configuración: cambiar un ajuste, guardarlo y comprobar que se aplica.

Confirmada por el usuario el 2026-10-10. La liberación a `main` se hizo con el release de #284.

---

## T-04 Comprobar en Discord los refactors de tamaño y el resumen del ranking

Son cambios sin cambio de comportamiento previsto (#278, #279, #280 y #286), la eliminación de `/ia` y el ranking con
resumen (#285). Los tests cubren la lógica, no lo que se ve en Discord. Conviene probar esto tras el release a `main`.

**Voz y Duende**
- [ ] `/escuchar` y `/conversación` siguen uniendo al bot al canal, respondiendo y saliendo.
- [ ] `/tts` reproduce en el canal.
- [ ] `/imagen` genera la imagen. Si la API tarda, el aviso dice el plazo.
- [ ] `/duende` → 💬 Hablar responde, con GIF cuando toca. Su panel abre sus pantallas (acciones, modales y recuerdos).
- [ ] `/ia` ya no aparece en la lista de comandos.

**Casino y apuestas**
- [ ] Ruleta, tragaperras, adivinar, ppt y blackjack: cada juego arranca, cobra y paga igual que antes.
- [ ] `/juegos` → apuestas: apostar a un partido, ver el listado, la ficha y la confirmación.
- [ ] La liquidación (`/pagarapuestas`) reparte premios y, después, `/perfil` → 🏆 Rankings → ⚽ Apostadores muestra el resultado nuevo.

**Perfil, pase, tienda, retos y Plex**
- [ ] `/perfil`: logros, rankings y ficha se ven igual.
- [ ] `/pase`: cada vista (resumen, niveles, misiones y top) y reclamar.
- [ ] `/tienda`: catálogo, inventario (con Usar) y compras.
- [ ] Retos: crear, aceptar y ver el mensaje público.
- [ ] `/plex`: pantallas de cine, para ti, Wrapped y perfil.

**Paneles de admin** (`/paneladmin`)
- [ ] Apuestas, niveles (usuarios y recompensas), Plex, Seerr, ajustes y sistema abren y guardan.

---

## T-05 Revisar modelos de Gemini y dependencias

Revisión del 2026-10-10, completada el 2026-10-18. Fuentes: [página de retiradas de Gemini](https://ai.google.dev/gemini-api/docs/deprecations),
[página de modelos](https://ai.google.dev/gemini-api/docs/models), `npm outdated` y `npm audit --omit=dev`.

**Modelos**
- [ ] `gemini-2.5-flash` y `gemini-2.5-pro` (valores por defecto del Duende y sus respaldos): **no están retirados** y se
  sirven «until further notice», pero Google limita el acceso a quien ya los usaba; para proyectos nuevos recomienda
  `gemini-3.5-flash-lite` o `gemini-3.8-flash`. No es urgente; vigilar y plantear el salto a 3.8 si aparece aviso.
- [x] `gemini-2.5-flash-preview-tts`: se retira el 17 de noviembre de 2026. Quitado de `GEMINI_TTS_FALLBACK_MODELS`
  (`src/services/geminiTts.js` y `.env.example`); quedan `gemini-3.8-flash-tts` (por defecto) y `gemini-3.8-flash-lite-tts`.
- [x] `/imagen`: el valor por defecto, `gemini-2.0-flash-exp-image-generation`, **se apagó el 14 de noviembre de 2025**, así
  que `/imagen` estaba roto. Cambiado a `gemini-nano-banana-2.1` (el sustituto que recomienda Google) en
  `src/services/duende/imagenGemini.js`. Falta probar `/imagen` en Discord tras desplegar; si fallara, fijar
  `IMAGE_GEN_MODEL` con `gemini-3.1-flash-lite-image`.
- [x] Voz en directo: `gemini-3.8-live`, el modelo que usa el código. El 2.5 native-audio se retira el 17 de noviembre de 2026
  y el código no lo usa.

**Dependencias**
- [x] Sin vulnerabilidades en producción (`npm audit --omit=dev`). Las 32 que salen en `npm audit` son de desarrollo.
- [x] Actualizado dentro del rango ya fijado: `@google/genai` (2.24 → 2.30), `libsodium-wrappers` (0.8.2 → 0.8.4),
  `dotenv` (16.4.5 → 16.6.1), `globals` (17.12 → 17.13), `jest` (30.1.3 → 30.5.2) y `prettier` (3.9.9 → 3.9.10).
  `npm run check` en verde (2858 tests). Probar la voz y el Duende en Discord tras desplegar.
- [!] `better-sqlite3` **no** se sube de 12.2.0: las 12.x nuevas (probado 12.11.1) cambian el manejo de claves foráneas
  al `DROP TABLE` y hacen fallar la migración 007 (`tests/migrations.test.js` → `FOREIGN KEY constraint failed`). Como no
  se puede editar una migración ya aplicada, se queda en 12.2.0; revisar al decidir el salto a la 13 (quizá arreglando el
  orden de borrado o desactivando las FK en el motor de migraciones).
- [ ] Decidir los saltos de versión mayor: `better-sqlite3` 13 (empaquetado N-API), `dotenv` 18, `eslint` 10 y `opusscript` 0.1.
  Ninguno es urgente.
- [ ] `discord.js` 14 sigue; la 15 está en prerelease según [su guía](https://discordjs.guide/v15). Cambios que afectan
  al bot: `webhookUpdate` pasa a `webhooksUpdate`, `ClientEvents` pasa a `ClientEventTypes`, y `ActionRow.from()` pasa a
  `ActionRowBuilder.from()`. Revisar cuando salga la versión estable.

---

## T-06 Probar en Discord las fases 1 a 12 del plan restante

✅ **Hecha**: probado en Discord y en `main` desde las releases #497 y #502. La lista de abajo se conserva como registro.

Lo que cambia en cada fase, para probarlo a mano antes de cerrar sus issues. Orden y contenido: [PLAN_ISSUES](PLAN_ISSUES.md).

**Fase 2: sonidos (#297, #301, #323 a #330)**
- [x] `/sonidos` con sonidos con categoría: el menú filtra; 🔍 Buscar «gol» deja solo los que lo contienen y ❌ quita la búsqueda.
- [x] 🎲 Aleatorio toca uno; con el servidor sin sonidos avisa. Dos sonidos seguidos tuyos en menos de 10 s: el segundo avisa de cuánto falta (un admin no tiene cooldown).
- [x] Pulsar un sonido con otro sonando: «en cola, puesto N»; suenan en orden y, con 5 esperando, el sexto se rechaza.
- [x] `/paneladmin` → 🔊 Sonidos → ✏️ Editar: 🔉 volumen (un sonido a 200 % suena más fuerte), 🏷️ categoría y 👥 roles (el botón sale con 🔒 y quien no tiene el rol recibe el aviso).
- [x] 🌙 Horario: con un tramo que incluya la hora actual no suena nada y avisa; con 📴 apagado también. Fuera del tramo vuelve a sonar.
- [x] 🔔 Eventos: con `/conectar` puesto, desbloquear un logro hace sonar su sonido; una segunda vez dentro del intervalo, no.
- [x] `/conectar sonido:` autocompleta los nombres y lo toca una vez al entrar.
- [x] 📊 Más usados (en `/sonidos` y en el panel admin) lista los sonidos por veces sonadas.

**Fase 3: juego responsable, blackjack, tragaperras y revancha (#318, #319, #333, #337, #343, #354)**
- [x] `/perfil` → 💰 Economía → 🛡️ Límite de pérdidas: poner 100 por día; tras perder 100 en el casino, `/juegos` no deja apostar y lo explica; las apuestas deportivas tampoco. Bajarlo vale ya; subirlo dice que tarda 24 h.
- [x] Blackjack con un as visible: sale «¿Seguro?»; con seguro y blackjack del crupier no pierdes nada; sin blackjack pierdes el seguro y sigues. Se paga la mitad de la apuesta.
- [x] Blackjack: 🏳️ Rendirse recupera la mitad en la primera decisión y desaparece después de pedir carta; 💡 Consejo responde solo a ti.
- [x] Tragaperras: el desplegable 🔁 Auto x10 hace 10 tiradas y un solo resumen; ⏹️ Parar la corta; con cooldown global puesto, se corta y lo dice.
- [x] Duelo resuelto: 🔁 Revancha propone el mismo duelo al otro jugador y el botón desaparece del original.

**Fase 4: apuestas y quinielas (#296, #340, #345, #349, #356, #361, #366, #370, #375, #380, #384)**
- [x] Ficha de un partido y partido destacado: porcentaje junto a cada cuota y «Margen de la casa».
- [x] 📋 Mis jugadas → ⏳ En juego: «apostado a X · ahora Y ↑/↓/=»; el menú ↩️ cancela también una combinada (devuelta entera) y una 🔔 alerta.
- [x] 🔁 Repetir última: elegir partido → confirmar → se cobra solo al confirmar. 📤 CSV: llega el fichero en privado y se abre en Excel con las tildes bien.
- [x] Quiniela: 🎯 Rellenar favoritos no toca lo ya elegido; reiniciar el bot y volver a pulsar Apostar recupera los pronósticos («📝 borrador recuperado»).
- [x] 🏅 Liga: el menú de competición cambia la clasificación; la general sigue igual.
- [x] `/paneladmin` → ⚽ Apuestas → ⏰ Recordatorio: con horas > 0, quien suele jugar y no ha enviado la quiniela recibe el DM antes del cierre (una sola vez).
- [x] Lunes tras las 10:00: DM del resumen semanal de apuestas, una sola vez por semana. 🔔 en la ficha de un partido: crear una alerta y comprobar que llega el DM al cruzar la cuota.

**Fase 5: pase de batalla (#300, #331, #332, #334, #335, #338, #344, #348, #353, #359, #364)**
- [x] `/pase` → 📊 Topes: lo usado hoy por categoría; 🏆 Top: tu puesto y lo que falta si no estás entre los 10; 🕰️ Historial tras cambiar de temporada.
- [x] Completar las tres misiones del día: +100 XP una vez; tres días seguidos: +100 XP más (racha). Las misiones de tienda y de logro aparecen algún día.
- [x] `/paneladmin` → 🛡️ Pase: cambiar un tope y comprobar que el siguiente mensaje ya lo respeta; elegir canal de anuncios y subir de nivel; poner un objeto en un nivel y reclamarlo; desactivar el pase.
- [x] Último día de la temporada: DM con las recompensas sin cobrar (una sola vez). Ganar un reto: +15 XP de pase.

**Fase 6: niveles, XP y logros (#336, #339, #342, #346, #352, #358, #362, #369, #373, #378, #383)**
- [x] Subir la racha a 3 días: sale el logro «Constante». `/perfil` → 🏆 Rankings → 🔥 Rachas: top con mejor y actual, y tu puesto.
- [x] Un día sin XP con una racha de 3 o más: a las 00:30 llega el DM «Has perdido tu racha» (una sola vez). Con `/paneladmin` → Niveles → ⚙️ Config → 🔥 Racha → 1 día de gracia, faltar un día mantiene la racha.
- [x] 🧢 Tope diario: poner uno bajo, llegar a él y comprobar que no sube más hasta mañana. Ganar 1.000 XP en un día: logro «Tarde intensa».
- [x] Reaccionar al mensaje de otra persona: su XP sube (3 por defecto, una vez por minuto). Comprobar que el bot recibe reacciones en mensajes viejos.
- [x] 🚫 Ignorados: poner un rol sin XP y un canal ×2; comprobar mensajes, reacciones y voz.
- [x] `/perfil` → 👤 Perfil → 📢 Anunciar mis niveles: «no» y subir de nivel: no se anuncia pero se da el rol.
- [x] Domingo 18:00: DM de logros sin reclamar, una vez por semana. `/avisos` tiene los tipos «Racha perdida» y «Logros sin reclamar».

**Fase 7: economía, tienda e impuestos (#302, #374, #379, #387, #392, #404, #409, #411, #412, #413, #415, #416)**
- [x] `/tienda` → 🎒 Inventario → 🎁 Gestionar: regalar un objeto (comprobar que sale en Movimientos de los dos y que un candado no se puede), vender a la tienda y poner en el mercado; comprar desde 🏷️ Mercado con otra cuenta.
- [x] ⭐ Seguir un objeto agotado; `/paneladmin` → Catálogo → A la venta con stock: llega el DM. Lo mismo bajando el precio o con 🏷️ Oferta.
- [x] 🏷️ Oferta temporal: el catálogo enseña el precio rebajado y la fecha de fin, la compra cobra ese precio, y al pasar el fin vuelve el normal. 💱 Precios: subida 10 % y comprobar que sube con cada compra.
- [x] 🎟️ Crear un código de 1 uso y canjearlo con dos cuentas (la segunda dice «agotado»).
- [x] 📜 Movimientos → 📤 Exportar: abrir el CSV en Excel y ver las tildes y las columnas.
- [x] 🏪 Negocios: mejorar un negocio, ver el nuevo blanqueo/ingreso y vender (50 % de todo lo pagado).
- [x] Impuestos: 📊 un tramo en una regla de ingreso; 🎯 una meta pequeña del bote; 💼 sueldo a un rol y comprobar el pago (una sola vez al día).

**Fase 8: perfil, clasificación y patrimonio (#347, #350, #355, #360, #368, #372, #377, #388, #391, #394, #397, #401)**
- [x] 💰 Economía: «Próximo cobro de patrimonio» con su estimación, resumen 🏦 Patrimonio y barras de los últimos 30 días (al día siguiente de arrancar con la migración ya hay una fila). 🙈 Ocultar mi economía y mirarlo con otra cuenta (perfil, economía y movimientos).
- [x] Clasificación: 🏆 Rankings → 📅 Esta semana (con y sin canal configurado) y 🗓️ Semanas tras la primera publicación; el lunes, premios distintos por categoría (🪙 Por categoría) y la nueva categoría 📆 El más constante.
- [x] 👤 Perfil: «Premios semanales» tras ganar uno y 🔔 Aviso del domingo (activarlo con otra cuenta que vaya primera y comprobar el DM el domingo a las 20:00).
- [x] Impuestos → 🏦 Patrimonio → 🎭 Roles exentos con un rol de prueba; 🏆 Rankings → 🏦 Patrimonio neto (comprobar que cuenta cripto y negocios).

**Fase 9: cripto y recordatorios (#298, #341, #351, #365, #320)**
- [x] `/cripto` → 💸 Vender → ✏️ Otra cantidad: pedir unas monedas y comprobar que recibes eso (o un poco menos); pedir más de lo que vale tu cartera y ver que no vende.
- [x] 📈 Mercado → 🔔 Alertas y órdenes: una alerta por encima y otra por debajo; mover el precio con compras/ventas y comprobar el DM (una sola vez). Un stop-loss justo por debajo y vender de otra cuenta para bajarlo.
- [x] 🛒 Comprar → 🔁 Compra recurrente (cada 1 h): ver la compra en 🧾 Historial; vaciar el efectivo y ver el DM de ciclo saltado.
- [x] `/recordar nuevo` («en 2 min») y `/recordar lista`: llega el DM; con los DMs cerrados no pasa nada.

**Fase 10: Plex (#299, #381, #385, #389, #393, #399, #403, #406, #410)**
- [x] `/plex` → 🗓️ Estrenos (con el Seerr real: comprobar que `discover/…/upcoming` responde en tu versión) y pedir uno con 📥; 📡 Ahora con y sin nadie viendo algo; 🏆 Campeones tras la próxima publicación del ranking.
- [x] 🎬 Sesión de cine con varias películas (`Dune | Alien`), votar con dos cuentas, 🎯 Sugerir, y ver que el recordatorio nombra la ganadora. Repetir cada semana: comprobar que al empezar la sesión aparece la siguiente.
- [x] 📥 Mis pedidos: pedir algo, cancelarlo desde `/plex`; rechazar una petición en Seerr y ver el aviso (en el canal de novedades o por DM).
- [x] 🎞️ Wrapped → «Ver el del año pasado»; el 1 de enero llegan dos DM (mes y año).

**Fase 11: Duende e IA (#357, #363, #367, #371, #376, #382, #386, #390, #395, #396, #400, #405, #408)**
- [x] `/imagen` y 🔁 Otra versión (con otra cuenta no deja); `/imagenes`; pedirle al Duende «dibújame un gato» en el chat y comprobar el cooldown compartido y la cuota (`IMAGE_GEN_DAILY_LIMIT` bajo).
- [x] Gastar el tope de respuestas por persona (`DUENDE_DAILY_LIMIT_USER` bajo): el resto sigue; reiniciar el bot y ver que el contador se mantiene.
- [x] Mandar una nota de voz de Discord en el canal del Duende (el reconocedor local de `/escuchar` tiene que estar arrancado); `/resumen` con 30 mensajes.
- [x] Recuerdo propuesto por DM: ✏️ Editar (texto corto y texto bueno); con `DUENDE_RECUERDOS_CADUCA_DIAS=0` ver cómo caduca y pierde los botones a las 04:00.
- [x] `/conversación` hablando un rato y terminando: resumen en el canal. `/duende` → Personalidad → voz, y una respuesta por voz; 🧠 Recuerdos → olvidar una nota.

**Fase 12: administración (#398, #402, #407, #417-#425)**
- [x] 🧾 Auditoría: elegir una familia en el menú, pasar de página y refrescar (el filtro se mantiene); «Todas las acciones» lo quita.
- [x] Abrir el historial global del banco, buscar un usuario y abrir una ficha de 🧠 Perfiles: tres filas `consulta.*` en la auditoría; pasar de página no añade filas.
- [x] Cambiar un formulario de Config Global (RTP, tienda, una regla de comandos) y ver en la auditoría el antes y el después; reenviarlo igual → «sin cambios».
- [x] 🩺 Sistema → 💾 Copias: ver la lista, hacer copia ahora (con la de hoy existente pide confirmación) y comprobar `backup.manual`; arrancar el bot pasadas las 04:30 sin la copia de hoy → la crea.
- [x] 🩺 Sistema → 🕒 Tareas: ver «sin ejecutar»/última ejecución, reiniciar y comprobar que se conserva; lanzar una tarea a mano, comprobar `tarea.manual` y 📄 Exportar.
- [x] 🔔 Alertas: apagar una categoría y probar; poner un canal de respaldo, cerrar los DMs al bot y provocar una alerta.
- [x] `/mensaje usuario cuando:` con una hora a 10 minutos: llega con margen de 5 min; cancelar otro desde ✉️ Mensajes; apagar el bot pasada la hora y arrancarlo → llega con el aviso.
- [x] ⚙️ Config Global → 🛠️ Modo mantenimiento: con otra cuenta no admin, comandos y botones dan el mensaje; con admin todo sigue; apagarlo.

---

## T-07 Probar en Discord los equipos favoritos

Issue #530. Se prueba con los partidos que ya haya sincronizados el bot; no hace falta esperar a que salga uno nuevo.

- [ ] `/favoritos seguir equipo:Betis` confirma el equipo y, si tiene un partido próximo, lo menciona. Repetirlo dice que ya lo sigues.
- [ ] `/favoritos lista` enseña el equipo y sus próximos partidos con la hora y las cuotas 1X2.
- [ ] En el siguiente refresco de cuotas (`[APUESTAS]`/log de la Odds API, o `/juegos` → ⚽ Apuestas para forzarlo), llega **un DM** con los partidos nuevos del equipo (o varios si hay muchos), sin repetirse en el siguiente refresco.
- [ ] `/avisos` → ⭐ **Equipos favoritos** → apagarlo. Con otro partido nuevo (o borrando su fila de `equipos_favoritos_avisos` en una BD de pruebas) no llega el DM.
- [ ] `/favoritos dejar equipo:Betis` lo quita y `/favoritos lista` vuelve a explicar cómo empezar.

## T-08 Probar en Discord el seguro antirrobo

Issue #526. Con dos cuentas de prueba en el mismo servidor (una víctima y un ladrón) y el cooldown de `/robar` de 2 h.

- [ ] `/perfil` → 💰 Economía → 🛡️ **Seguro antirrobo** enseña la prima, la duración y los límites; al comprarlo descuenta el importe del dinero gastable y muestra hasta cuándo está activo.
- [ ] Con el seguro activo, `/robar` contra esa persona unas cuantas veces: unas falla (multa normal, sin mencionar el seguro) y otras roba la mitad de lo habitual. El ladrón nunca ve el seguro; la víctima sí lo lee en su DM.
- [ ] Intentar comprarlo dos veces seguidas: la segunda avisa del cooldown. Renovar tras la hora extiende desde el vencimiento, y no deja pasar del tope de días.
- [ ] `/paneladmin` → ⚙️ Config Global → 🛡️ Economía → ✏️ Editar seguro: cambiar prima y duración, guardar, y comprobar que `/perfil` ya enseña los valores nuevos; el cambio queda en Auditoría.
- [ ] Dejar vencer el seguro (`UPDATE seguros_antirrobo SET vencimiento = ... WHERE userId = ...` en una BD de pruebas) y comprobar que `/robar` vuelve a comportarse como siempre.

## T-09 Probar en Discord el depósito a plazo

Issue #518. Con una cuenta con dinero en el banco y otra sin él.

- [ ] `/perfil` → 💰 Economía → 📈 **Depósito** enseña los tres plazos con su interés y el dinero que hay en el banco. Sin banco suficiente, los botones salen desactivados.
- [ ] Abrir un depósito a 7 días: el importe sale del banco (no del efectivo), la pantalla muestra el interés y la fecha de vencimiento, y en Movimientos aparece 🏦 Banco.
- [ ] Intentar abrir otro: avisa de que ya hay uno activo. Cancelar el primero: vuelve el principal al banco, sin interés, y el depósito desaparece.
- [ ] Abrir uno a 7 días y adelantar su vencimiento en una BD de pruebas; antes de 5 minutos (o al abrir 📈 Depósito) vuelve al banco con el interés y llega un DM. No se paga dos veces.
- [ ] `/paneladmin` → ⚙️ Config Global → 🛡️ Economía → ✏️ Editar depósito: cambiar mínimo, máximo e intereses; se ven en `/perfil` y queda en Auditoría.

## T-10 Probar en Discord los autoroles

Issue #539. Con roles de prueba por debajo del rol del bot (y uno por encima, para el caso malo).

- [ ] `/paneladmin` → ⚙️ Config Global → 🎭 Autoroles → ➕ Añadir rol: elegir un rol, poner etiqueta y emoji, y guardar. Aparece en la lista.
- [ ] `/autoroles` muestra el rol con ✅/▫️ según lo tenga quien mira; al pulsarlo se lo pone y al volver a pulsarlo se lo quita (la respuesta se actualiza en el sitio).
- [ ] Con dos roles del mismo grupo (por ejemplo, colores), ponerse uno quita el otro.
- [ ] Intentar añadir un rol por encima del bot o gestionado por una integración: lo rechaza con el motivo.
- [ ] Activar el modo mantenimiento: `/autoroles` avisa y no cambia roles.
- [ ] Cada cambio queda en `/paneladmin` → 🩺 Sistema → Auditoría (acción `autoroles.toggle`).

## T-11 Probar en Discord los sorteos programados

Issue #541. Con un canal de pruebas y, si se quiere, un rol y un nivel concretos.

- [ ] `/paneladmin` → ⚙️ Config Global → 🎁 Sorteos → ➕ Nuevo sorteo: elegir canal, premio en dinero y duración; publicar sin requisitos. El mensaje aparece en el canal con el botón 🎟️.
- [ ] Con otra cuenta, pulsar el botón: responde en privado que está dentro y el contador del mensaje sube; volver a pulsarlo lo saca.
- [ ] Crear otro con requisito de rol y nivel: quien no los cumple recibe el motivo y no entra.
- [ ] Esperar al vencimiento (o adelantar `fin` en una BD de pruebas): el bot elige ganadores entre los que siguen cumpliendo, reparte el premio, edita el mensaje con 🏆 y avisa por DM. No se paga dos veces si se reinicia.
- [ ] Probar un premio de objeto del catálogo (único y normal): el único entrega una sola unidad; el normal, una por ganador.
- [ ] Cancelar un sorteo desde el panel: se marca como cancelado, el mensaje se actualiza y queda en Auditoría.

## T-12 Probar en Discord la guardia del Duende

Issue #553. Con un canal de voz de pruebas y dos cuentas (una sin permisos de admin).

- [ ] Desde un canal de voz, `/duende` → 🛡️ Guardia: el bot entra a tu canal y el panel enseña «De guardia» con el canal, quién la puso y desde cuándo.
- [ ] Sin estar en voz, pulsar 🛡️ Guardia: se abre el formulario con solo canales de voz; cerrarlo sin elegir no conecta; elegir uno conecta ahí.
- [ ] En un canal sin permiso de Hablar para el bot: el panel avisa de que faltan permisos y no entra.
- [ ] Con la guardia puesta, `/sonidos` y `/tts` suenan en ese canal; `/conectar` (con y sin canal o minutos) avisa de que está de guardia y no la toca; `/conversación` responde que está de guardia y la guardia sigue.
- [ ] Con la otra cuenta, `/duende`: los botones 🛡️ Guardia y 🚪 Dejar la guardia salen deshabilitados.
- [ ] Esperar más de 2 horas: el bot sigue en el canal.
- [ ] Reiniciar el contenedor: el bot vuelve al mismo canal (y en el log, `Guardias al arrancar: 1 recuperadas`).
- [ ] Borrar el canal (o quitar el permiso de Conectar) y reiniciar: no entra y el log avisa de que descarta la guardia.
- [ ] Desconectar al bot a mano desde Discord: la guardia se acaba y al reiniciar no vuelve.
- [ ] 🚪 Dejar la guardia (quien la puso o un admin): se sale al momento y al reiniciar no vuelve.

## T-13 Probar en Discord el feed de reseñas

Issue #573. Con un canal de texto de pruebas y dos cuentas vinculadas a Plex que hayan terminado alguna película.

- [ ] `/paneladmin` → 🎬 Plex → ⭐ Reseñas: sin canal, la pantalla dice «sin canal» y 🚫 Quitar canal del feed sale deshabilitado. Elegir el canal en el selector: la pantalla lo enseña y queda en Auditoría (`plex.resenas.canal`).
- [ ] Reseñar una película (desde el DM o desde la ficha de `/plex` → ⭐ Reseñas): en el canal sale el título, las estrellas, el extracto y la mención del autor, sin que le llegue aviso.
- [ ] Cambiar esa misma reseña: no sale otro mensaje.
- [ ] Reseñar con «Contiene spoilers» marcado: sale «⚠️ contiene spoilers» y nada del texto.
- [ ] Con la otra cuenta, ocultar sus reseñas en `/plex` → ⭐ Reseñas y reseñar algo: no sale nada en el canal.
- [ ] 🚫 Quitar canal del feed y reseñar otra: no se publica; queda en Auditoría.
- [ ] Borrar el canal del feed (o quitar al bot el permiso de enviar) y reseñar: la reseña se guarda y el log avisa.

## T-14 Probar en Discord Mi cine

Issue #574. Con una cuenta vinculada a Plex que tenga reseñas e historial, y otra sin vincular.

- [ ] `/plex` → ⭐ Reseñas: la primera fila tiene 5 botones, el último 📊 Mi cine.
- [ ] Pulsar 📊 Mi cine: la pantalla (solo la ves tú) enseña tus reseñas (cuántas, la media que das y la del servidor), tu película mejor y peor valorada, el género y la década que más ves, tu racha actual y la mejor frente a la media del servidor, y «Tu 2026 hasta hoy».
- [ ] Comprobar a mano un par de cifras con la BD o con lo que recuerdas (número de reseñas, mejor película, horas del año).
- [ ] Con otra cuenta, ocultar sus reseñas (🙈 Ocultar) y volver a Mi cine: la media del servidor cambia y ya no cuenta las suyas.
- [ ] 🖼️ Imagen del año: llega aparte, solo para ti, la imagen del Wrapped con tus series del año. Sin series este año, el botón no sale.
- [ ] Con la cuenta sin vincular: Mi cine solo enseña las reseñas y explica que falta vincular Plex.
- [ ] ⬅️ Reseñas vuelve a la lista de tus reseñas.

## T-15 Probar en Discord la ruleta de películas

Issue #576. Con una cuenta vinculada a Plex que haya visto algunas películas, y otra sin vincular.

- [ ] `/plex` → ⭐ Reseñas: la primera fila sigue con 5 botones y 🎲 Ruleta sale en la última fila, junto a ⬅️ Plex.
- [ ] Pulsar 🎲 Ruleta: sale la ficha de una película que **no has visto** (comprobar con tu historial de Plex), con géneros, director, biblioteca y, si tiene reseñas, la media del servidor.
- [ ] ⭐ Puntuar al verla sale desactivado y el pie explica que se puntúa al verla.
- [ ] 🎬 Otra varias veces: nunca repite la que había en pantalla y nunca propone algo ya visto.
- [ ] Elegir un género en el menú: la película es de ese género. Elegir una década: es de esa década. «Cualquier género» / «Cualquier década» quitan el filtro.
- [ ] Tras desplegar (migración 078), cuando se hayan pedido o refrescado fichas de películas (las nuevas, o las de más de 30 días; en el log de Plex): sale el menú ⏱️ Duración máxima; elegir «Hasta 2 h»: la película dura 2 h o menos (comprobarlo en Plex).
- [ ] Combinar filtros hasta que no quede nada: dice «No queda ninguna…» y 🧹 Quitar filtros vuelve a tirar sin filtros.
- [ ] Con un género que solo tenga una película sin ver: 🎬 Otra sale desactivado y dice que es la única.
- [ ] 📝 Quiero ver: la ficha dice «apuntada» y el botón pasa a ✅ En tu lista; en `/plex` → 📝 Quiero ver sale con «ya está en Plex» y no llega ningún DM de aviso.
- [ ] Con la cuenta sin vincular: 🎲 Ruleta explica que falta vincular Plex y solo ofrece ⬅️ Reseñas.
- [ ] ⬅️ Reseñas vuelve a la lista de tus reseñas.

## T-16 Probar en Discord los tickets de soporte

Issue #537. Con un canal de texto para los tickets, otro para las transcripciones, un rol de staff y dos cuentas (una sin
el rol ni permisos de admin).

- [ ] `/paneladmin` → ⚙️ Config Global → 📣 Comunidad → 🎫 Tickets: sin configurar dice lo que falta y 📤 Publicar panel sale deshabilitado. Elegir canal, rol y canal de transcripciones: «✅ Guardado» y queda en Auditoría (`tickets.config`, familia 🎫 Tickets).
- [ ] Quitar al bot «Crear hilos privados» en el canal de tickets y guardar otra vez: avisa de lo que le falta; 📤 Publicar panel no publica y dice por qué. Devolver el permiso.
- [ ] 🏷️ Categorías: poner «Duda», «Reporte» y «Apelación» (una por línea) y guardar; vaciarlo deja solo «General».
- [ ] 📤 Publicar panel: el panel 🎫 Soporte aparece en el canal de tickets con el botón 🎫 Abrir ticket (enlace en el aviso y fila `tickets.publicar` en Auditoría).
- [ ] Con la cuenta sin rol: 🎫 Abrir ticket → formulario con las categorías → enviar. Se crea un hilo privado con su nombre, la cuenta está dentro, el rol de staff recibe la mención y el resto del servidor no ve el hilo.
- [ ] El staff entra en el hilo (por la mención) y contesta; el autor ve la respuesta.
- [ ] Con el ticket abierto, volver a pulsar 🎫 Abrir ticket: responde que ya tienes uno y enlaza el hilo.
- [ ] Otra cuenta sin rol que no es el autor pulsa 🔒 Cerrar ticket en ese hilo (si consigue verlo): «Solo quien abrió el ticket o el staff».
- [ ] El autor pulsa 🔒 Cerrar ticket → Cancelar: sigue abierto. Otra vez → ✅ Sí, cerrar: el hilo recibe el aviso con mención al staff, el botón queda desactivado y el hilo bloqueado y archivado.
- [ ] En el canal de transcripciones sale el registro (abierto por, cerrado por, fechas, duración, mensajes) con `ticket-N.txt`, y el .txt tiene toda la conversación en orden con la hora de Madrid.
- [ ] Justo después, el autor pulsa 🎫 Abrir ticket: le dice que espere (unos 60 minutos). Pasada la hora, puede abrir otro.
- [ ] Abrir otro y cerrarlo desde la cuenta del staff: el aviso de cierre no menciona al rol.
- [ ] Borrar a mano el hilo de un ticket abierto y volver a pulsar 🎫 Abrir ticket: deja abrir uno nuevo.
- [ ] Quitar al bot «Adjuntar archivos» en el canal de transcripciones y cerrar un ticket: se cierra igual y avisa de que no pudo guardar la transcripción.

## T-17 Probar en Discord ambos marcan y doble oportunidad

Issue #532. Con `ODDS_MERCADOS_EXTRA=btts,double_chance` en `.env` y créditos de la Odds API.

- [ ] Tras actualizar las cuotas, en el log aparece «Mercados adicionales de …: N partidos».
- [ ] La ficha de un partido con esas cuotas muestra una fila con ⚽ Ambos marcan: Sí/No y 🔀 Doble oportunidad 1X/12/X2, y la leyenda.
- [ ] Un partido sin esas cuotas se ve como antes.
- [ ] Apostar a «Doble oportunidad: X2»: se cobra una vez y sale en 🧾 Mis jugadas con su nombre completo.
- [ ] Sumar «Ambos marcan: Sí» a una combinada con otro partido.
- [ ] Con un partido ya empezado (y `ODDS_DIRECTO=1`), los botones nuevos no salen y no se puede apostar.
- [ ] Al liquidar, comprobar el pago con un empate (1X y X2 cobran, 12 no).

## T-18 Probar en Discord los roles temporales

Issue #543. Con un rol de pruebas por debajo del bot y otra cuenta.

- [ ] `/paneladmin` → ⚙️ Config Global → ⏳ Roles temporales → ➕ Dar rol temporal: elegir persona, rol, 1 día y aviso «Sí». El rol aparece al momento y llega el DM.
- [ ] La lista muestra persona, rol, quién lo dio y cuándo vence.
- [ ] Elegirlo → 🔁 Renovar 2 días: el vencimiento pasa a 3 días desde el principio.
- [ ] ➖ Quitar ya → ✅ Sí: el rol desaparece, llega el DM y la lista queda vacía.
- [ ] Intentar dar un rol de una integración o por encima del bot: explica el motivo y no lo da.
- [ ] Dar uno de 1 día, apagar el bot, adelantar `vence` en una BD de pruebas y arrancar: el rol se quita al arrancar.
- [ ] Borrar el rol en Discord: su asignación desaparece de la lista.
- [ ] 🧾 Auditoría → filtro ⏳ Roles temporales: están todos los cambios.

## T-19 Probar en Discord los avisos y strikes

Issue #542. Con una cuenta de staff (sin ser admin) y otra normal.

- [ ] `/paneladmin` → ⚙️ Config Global → ⚠️ Moderación → 🛡️ Staff y canal: elegir el rol de staff y un canal de log.
- [ ] Con la cuenta de staff, `/avisar usuario motivo`: el avisado recibe el DM con el motivo y en el canal de log sale la línea (sin notificar a nadie).
- [ ] Con una cuenta sin permisos, `/avisar` responde que solo el staff puede.
- [ ] Avisar tres veces a la misma persona: a los admins les llega «Medida sugerida: ⚠️ Aviso serio» y el bot no hace nada más.
- [ ] 🔎 Consultar a esa persona: salen los tres avisos con motivo, quién y cuándo; retirar uno y limpiar el resto con confirmación.
- [ ] 📏 Umbrales y caducidad: poner umbrales desordenados da error; unos válidos se guardan.
- [ ] 🧾 Auditoría → filtro ⚠️ Moderación: están todos los cambios.
