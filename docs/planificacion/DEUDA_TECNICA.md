# Deuda técnica

Cosas del código o de los datos que **funcionan pero están mal resueltas**, o que pueden dar problemas
más adelante. No son funcionalidad nueva (eso está en [FEATURES.md](FEATURES.md)), ni fallos concretos
(eso está en [ERRORES.md](ERRORES.md)), ni tareas manuales (eso está en [TAREAS.md](TAREAS.md)).

Cuando se resuelva una, borrarla de aquí y apuntarla en [CHANGELOG.md](../CHANGELOG.md). Los IDs no se
reutilizan: los que faltan (DT-02, DT-04, DT-05, DT-06, DT-09...) ya están resueltos o descartados.

**Prioridad:** 🔴 alta (riesgo real de perder datos o de comportamiento incorrecto) · 🟠 media (molesta o
complica el mantenimiento) · 🟢 baja (limpieza). **Esfuerzo:** S (una tarde) · M (un par de días) · L (más).

| ID | Qué | Área | Prioridad | Esfuerzo |
|---|---|---|---|---|
| [DT-01](#dt-01-las-copias-de-seguridad-están-en-el-mismo-disco) | Las copias de seguridad están en el mismo disco | Datos | 🔴 | S |
| [DT-03](#dt-03-el-límite-diario-del-duende-es-global-y-en-memoria) | El límite diario del Duende es global y en memoria | Duende | 🟠 | S |
| [DT-07](#dt-07-ficheros-demasiado-grandes) | Ficheros demasiado grandes (quedan 6) | Arquitectura | 🟠 | M |
| [DT-12](#dt-12-ephemeral-true-está-obsoleto) | `ephemeral: true` está obsoleto en discord.js | Dependencias | 🟢 | S |
| [DT-08](#dt-08-vulnerabilidades-en-dependencias) | Vulnerabilidades en dependencias (solo `tar`, sin arreglo) | Dependencias | 🟢 | — |

Además: [decisiones tomadas](#decisiones-tomadas) que no son deuda pero conviene recordar.

---

## DT-01 Las copias de seguridad están en el mismo disco

**Qué pasa.** El backup diario (`src/systems/backups.js`) se guarda en `data/backups/`, en el mismo disco
que la BD.
**Por qué importa.** Protege de una corrupción o de un borrado por error, pero no de que falle el disco.
**Propuesta.** Copiar `/compose/duende-bot/data/backups/` a otro disco o NAS con una tarea del propio OMV
(rsync programado), o subir la copia del día a Drive/S3 desde el bot.

## DT-03 El límite diario del Duende es global y en memoria

**Qué pasa.** `DUENDE_DAILY_LIMIT` (50 respuestas/día) es un único contador en memoria
(`src/commands/duende/duende.js`), y el día cambia a medianoche **UTC** (el contenedor no tiene zona
horaria), es decir, a las 01:00/02:00 en Madrid.
**Por qué importa.** Una sola persona puede agotarlo para todo el servidor, y se reinicia cada vez que se
reinicia el bot.
**Propuesta.** Usar `guildSettings.checkAndConsumeLimit` (tabla `action_limits`) con un cupo por usuario y
otro global, configurables en el panel, con el día en hora de Madrid.

## DT-07 Ficheros demasiado grandes

**Hecho.** `duende.js`, `cripto.js`, `blackjack.js` y `tienda.js` ya tienen su lógica fuera del comando
(`src/systems/duende/`, `src/systems/cripto/`, `src/systems/blackjack.js`, `src/systems/tienda.js`), y
`apuestas.js` ha perdido la quiniela duplicada que nadie usaba (677 → 426 líneas).

**Qué queda.** `adminPanel/levels.js` (810 líneas), `blackjack.js` (796: el juego en sí, con cada acción
—pedir, plantarse, doblar, separar— mezclada con los mensajes), `xpSystem.js` (753), `tienda.js` (731:
los paneles de admin de la tienda), `cripto.js` (714: solo paneles) y `perfil.js` (642).
**Por qué importa.** Mezclan lógica y construcción de mensajes de Discord, lo que dificulta probarlos.
**Propuesta.** Por orden de utilidad:
1. `blackjack.js`: pasar el estado de la partida y cada acción a `systems/blackjack.js` (funciones puras
   que reciben el estado y devuelven el nuevo), con tests de split y doblar. Es donde más dinero se mueve.
2. `adminPanel/levels.js`: partir por pantalla (configuración, recompensas, títulos, canales ignorados).
3. `xpSystem.js`: separar XP por mensaje/voz, rachas y roles de nivel.

## DT-12 `ephemeral: true` está obsoleto

**Qué pasa.** discord.js 14 avisa de que `ephemeral: true` en las respuestas está obsoleto y hay que usar
`flags: MessageFlags.Ephemeral`. Se usa en unos 300 sitios.
**Por qué importa.** Hoy solo es un aviso, pero en discord.js 15 dejará de funcionar y los mensajes
privados pasarían a ser públicos.
**Propuesta.** Sustitución mecánica en todo `src/` (y en los tests que lo comprueban) antes de actualizar a
discord.js 15.

## DT-08 Vulnerabilidades en dependencias

**Hecho.** `npm audit fix` (sin cambios incompatibles): de 22 avisos (16 altos, 1 crítico) a 5.
**Qué queda.** Los 5 son del mismo paquete, `tar`, que llega por `@discordjs/opus` →
`@discordjs/node-pre-gyp` y **solo se usa al instalar** (para descomprimir el binario de opus), no con el
bot en marcha. No hay versión corregida.
**Propuesta.** Nada por ahora. Revisar con `npm audit` al actualizar dependencias; si molesta, se puede
cambiar `@discordjs/opus` por `opusscript` (JavaScript puro, más lento) y desaparece.

---

## Decisiones tomadas

- **Economía global.** Banco, inventario, cripto e historial no distinguen servidor (el XP y los logros sí).
  Se deja así mientras el bot esté en un único servidor; cambiarlo implica migrar todos los datos
  económicos.
- **Resultados de fútbol y configuración de servidores de prueba** (antes DT-10 y DT-11): descartados de
  esta lista; se gestionan a mano.
