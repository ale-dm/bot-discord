# Tareas

Cosas que hay que **hacer a mano** (no son cambios de código): desplegar y comprobar en Discord. Los errores pendientes están en [ERRORES.md](ERRORES.md), la deuda técnica en [DEUDA_TECNICA.md](DEUDA_TECNICA.md) y
las ideas en [FEATURES.md](FEATURES.md).

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
- [ ] Las migraciones pendientes aplicadas (`[Migraciones] Aplicada 00N_...`, hasta la 008).
- [ ] `Importados 33 apodos de 12 personas`.
- [ ] `Importadas 6 personalidades y 9 perfiles` y, al conectar, `Perfiles del Duende: N vinculados`.
- [ ] Que exista `data/backups/tablas-antiguas-AAAA-MM-DD.json`.
- [ ] `✓ Conectado como El Duende#...`.

**En Discord**
- [ ] Hablar con el Duende y que reconozca apodos ("¿qué ha visto el perro?").
- [ ] `/nivel` (recompensas con descripción), `/perfil`, `/ayuda`.
- [ ] Una partida de blackjack y otra de ruleta; una compra en la tienda.
- [ ] `/apuestas`: cambiar de página (antes fallaba siempre) dos veces, la segunda sin gastar crédito (ver log);
      apostar y ver la apuesta en `/banco historial`; `/misapuestas`.
- [ ] `/quiniela` → 🔄 Refrescar (antes fallaba siempre).
- [ ] `/cripto`: vender el 100 % con doble clic rápido: solo debe venderse una vez.
- [ ] `/tienda` → historial: solo compras de la tienda (antes salían también casino, cripto...).
- [ ] `/ttcl-diagnostico` como admin (antes fallaba siempre).
- [ ] `/escuchar` y `/tts` en un canal de voz.
- [ ] `/paneladmin`: Duende → Apodos, Duende → 🧠 Perfiles (ver la ficha de alguien, cambiar nombre, descripción
      y notas con "Editar todo", y que el Duende lo use; vincular un perfil sin vincular poniéndole el Discord ID), Niveles → Recompensas → Descripción.
- [ ] `/duende recuerda` sobre alguien y `/duende personas`.
- [ ] `/diagnostico` y, al día siguiente, que exista `data/backups/banco-AAAA-MM-DD.db`.
