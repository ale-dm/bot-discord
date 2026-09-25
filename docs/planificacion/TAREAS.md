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
- [ ] `/juegos` sin opciones abre 🎰 Casino; `/juegos seccion:` abre cada pestaña. Las cuatro pestañas de abajo
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

**Resto**
- [ ] `/cripto`: comprar y vender algo y ver un gráfico (el comando se ha partido en paneles); vender el 100 %
      con doble clic rápido: solo debe venderse una vez.
- [ ] `/tienda`: una compra; historial con solo compras de la tienda.
- [ ] `/ttcl-diagnostico` como admin (antes fallaba siempre).
- [ ] `/escuchar` y `/tts` en un canal de voz: que transcriba (el audio ahora se decodifica con `opusscript`).
- [ ] `/paneladmin`: Duende → Apodos, Duende → 🧠 Perfiles (ver la ficha de alguien, cambiar nombre, descripción
      y notas con "Editar todo", y que el Duende lo use; vincular un perfil sin vincular poniéndole el Discord ID),
      Niveles → las cuatro pantallas, buscar un rol en Recompensas (pasar de página) y Recompensas → Descripción.
- [ ] `/duende recuerda` sobre otro sin ser admin (debe negarse) y sobre uno mismo; `/duende personas` sin
      ser admin (solo lo tuyo, en privado) y como admin (todos).
- [ ] `/diagnostico` y, al día siguiente, que exista `data/backups/banco-AAAA-MM-DD.db`.
