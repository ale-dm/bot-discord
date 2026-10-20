# Mapa del panel de administración

## Secciones y prefijos

| Botón de inicio | Prefijo | Fichero(s) |
|---|---|---|
| ✏️ Modificar saldo, 🔄 Resetear, 🗑️ Borrar historial, 📜 Historial global, 🔎 Buscar usuario | `paneladmin_bank_` | `bank.js` |
| 📈 Niveles / XP | `paneladmin_levels_` | `levels.js` (fachada) y `niveles/` (`config`, `ignorados`, `recompensas`, `usuarios`) |
| ⚙️ Config Global | `paneladmin_cfg_` | `settings.js` (fachada) y `settings/` (`botones`, `modales`, `vistas`, `guardar`); de aquí cuelgan `apodos.js` (`paneladmin_apodos_`), `perfilesDuende.js` (`paneladmin_perfiles_`), `impuestos*.js` (`paneladmin_impuestos_`), `clasificacion.js` (`paneladmin_semanal_`) y `comunidad.js` (`paneladmin_com_`) |
| 🧾 Auditoría | `paneladmin_audit_` | `audit.js` (últimas 100 acciones, de 10 en 10, filtro por familia en el `customId`) |
| 🎬 Plex | `paneladmin_plex_` | `plex.js` y `plex/` |
| 🍿 Seerr | `paneladmin_seerr_` | `seerr.js` |
| ⚽ Apuestas | `paneladmin_apu_` | `apuestas.js` y `apuestas/` (💸 Liquidar ahora, canal de resultados, límites, quiniela) |
| 🛒 Catálogo | `paneladmin_cat_` | `catalogo.js`, `catalogoExtras.js` |
| 🩺 Sistema | `paneladmin_sis_` | `sistema.js`, `sistemaExtras.js`, `sistemaAlertas.js` (diagnóstico, 💎 TTCL, nivel de log, alertas a admins, 🔊 Probar voz, probar modelo de Gemini) |
| 🔊 Sonidos | `paneladmin_sonidos_` | `sonidos.js`, `sonidosAjustes.js` |
| 🛡️ Pase | `paneladmin_pase_` | `pase.js` |

Comunes: `paneladmin_home` (volver al inicio), `paneladmin_cancel`. `views.js` monta el embed y las filas del inicio; `common.js`, los formularios y la lectura de selectores (`canalElegido`, `rolesElegidos`, `usuarioElegido`, `opcionElegida`…).

## Enrutado (`src/commands/admin/paneladmin.js`)

- `componentHandlers`: botones y modales con prefijo `paneladmin_`; los selects (string, usuario, rol, canal) con su lista de prefijos concretos.
- `handleButton`, `handleModal`, `handleUserSelect`, `handleRoleSelect`, `handleChannelSelect`, `handleStringSelect`: cada uno es `manejador(nombre, mensajeError, [secciones…], antes)`. Comprueba `isAdmin`, prueba las secciones en orden y captura el error.

## Auditoría (`src/systems/adminAudit.js`)

`logAdminAction({ guildId, actorId, action, details })`. Familias del filtro (`audit.js` → `FAMILIAS`): `bank`, `settings`, `alertas`, `logs`, `mensaje`, `duende`, `xp`, `plex`, `seerr`, `apuestas`, `quiniela`, `impuestos`, `clasificacion`, `objeto`, `consulta`, `backup`, `tarea`, `mantenimiento`. Hasta las consultas sensibles se auditan (`consulta.historial_global`).

## Añadir algo al panel

1. Elegir dónde va (casi siempre dentro de una sección existente) y su prefijo.
2. Vista (embed + filas) en la sección; botón de volver.
3. Manejador que devuelve `true`/`false`; añadirlo a las listas de `paneladmin.js` que toque y, si es un select con prefijo nuevo, a `componentHandlers`.
4. Ajuste en `definicion.js` si hace falta; guardar con `guardarAuditado` o auditar a mano.
5. Tests con admin y sin admin; documentación (`FUNCIONALIDADES.md`, `TAREAS.md`).
