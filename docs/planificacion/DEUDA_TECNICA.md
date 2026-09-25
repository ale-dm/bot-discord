# Deuda técnica

Cosas del código o de los datos que **funcionan pero están mal resueltas**, o que pueden dar problemas
más adelante. No son funcionalidad nueva (eso está en [FEATURES.md](FEATURES.md)), ni fallos concretos
(eso está en [ERRORES.md](ERRORES.md)), ni tareas manuales (eso está en [TAREAS.md](TAREAS.md)).

Cuando se resuelva una, borrarla de aquí y apuntarla en [CHANGELOG.md](../CHANGELOG.md). Los IDs no se
reutilizan: los que faltan (DT-02, DT-04, DT-05, DT-06, DT-09...) ya están resueltos o descartados.

**Prioridad:** 🔴 alta (riesgo real de perder datos o de comportamiento incorrecto) · 🟠 media (molesta o
complica el mantenimiento) · 🟢 baja (limpieza). **Esfuerzo:** S (una tarde) · M (un par de días) · L (más).

Ahora mismo no queda ninguna.

| ID | Qué | Área | Prioridad | Esfuerzo |
|---|---|---|---|---|

Además: [decisiones tomadas](#decisiones-tomadas) que no son deuda pero conviene recordar.

---

## Decisiones tomadas

- **Economía global.** Banco, inventario, cripto e historial no distinguen servidor (el XP y los logros sí).
  Se deja así mientras el bot esté en un único servidor; cambiarlo implica migrar todos los datos
  económicos.
- **Resultados de fútbol y configuración de servidores de prueba** (antes DT-10 y DT-11): descartados de
  esta lista; se gestionan a mano.
- **Copias de seguridad en el mismo disco y límite diario del Duende global y en memoria** (antes DT-01 y
  DT-03): descartados el 2026-09-25, no hacen falta.
