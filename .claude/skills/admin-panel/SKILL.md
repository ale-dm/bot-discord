---
name: admin-panel
description: El panel de administración de El Duende (/paneladmin y src/adminPanel/): secciones, enrutado de botones, selects y modales paneladmin_*, permisos de admin, auditoría y Config Global (guildSettings). Cárgala siempre que la tarea añada o cambie una sección, un botón, un formulario o un ajuste del panel admin, o revise un cambio en src/adminPanel/ o src/commands/admin/paneladmin.js. Carga también panel-discord para los límites de Discord y la skill del dominio que toque (plex-seerr, apuestas-liquidacion, voz-sonidos…). No la cargues para paneles de usuarios normales.
---

Entrada: `src/commands/admin/paneladmin.js` (`/paneladmin`, efímero). Cada sección vive en `src/adminPanel/<seccion>.js` (o una carpeta con `botones`, `modales`, `selects`, `vistas` y una fachada) y exporta `handle<Seccion>Button`, `…Modal`, `…ChannelSelect`, etc. Mapa de secciones y prefijos en `references/mapa.md`.

## Reglas no negociables

1. **Solo admins, comprobado en el servidor**: `/paneladmin` lleva `setDefaultMemberPermissions(Administrator)` y además cada manejador pasa por `isAdmin` (`src/core/permisos.js`, permiso `Administrator` de la interacción). No te fíes de que el botón solo lo vea un admin.
2. **Prefijo propio por sección** (`paneladmin_<seccion>_…`) y cada `customId` único en el mensaje. Si el prefijo es nuevo para un tipo de select, añádelo a `componentHandlers` de `paneladmin.js`.
3. **Contrato del manejador**: recibe la interacción y devuelve `true` si la reconoce y la atiende, `false` si no es suya. `manejador()` prueba las secciones en orden y la primera que devuelve `true` gana; el error se avisa en privado. Una sección nueva se añade a la lista de cada tipo de componente que use. El último de cada selector es el de respaldo.
4. **Todo cambio se audita** con `adminAudit.logAdminAction({ guildId, actorId, action: "<familia>.<accion>", details })`. Los ajustes de Config Global se guardan con `guardarAuditado` (`settings/guardar.js`), que apunta el diff `{ antes, despues }`. Una familia nueva va en `FAMILIAS` de `audit.js`. Los campos con nombre de secreto se enmascaran solos.
5. **Ajustes**: clave en `src/systems/guildSettings/definicion.js` (`DEFAULT_FLAT` y `KEY_TYPES`), control en el panel y lectura con `guildSettings.getSettings(guildId)`. Nunca un ajuste por servidor en `.env`.
6. **Dinero**: `adminPanel/bank.js` es una de las dos excepciones documentadas de `dinero.js` (usa `repositorios/dinero` y apunta con `dinero.apuntar(…, "admin", …)`). No amplíes esa excepción a otras secciones: lo demás pasa por `dinero.js`.
7. **Acciones destructivas con confirmación** (✅ Sí / cancelar, como resetear o borrar historial en `bank.js`) y el id de la confirmación lleva el objetivo.
8. **Formularios**: `simpleModal` / `modalConCampos` de `common.js`; para canal, rol, usuario, sí/no u opciones cerradas usa `campoSelector` (selectores de Discord, no IDs escritos). Etiquetas de 45 caracteres como mucho. Valida siempre lo que llega.
9. **Límites**: el menú principal (`views.buildMainRows`) ya usa 4 filas; una sección nueva suele ir dentro de otra (⚙️ Config Global, 🩺 Sistema) antes que como botón de inicio. Ficheros de más de 400 líneas o funciones de más de 60 se parten conservando la fachada.
10. **Cada pantalla tiene vuelta** (`paneladmin_home` o el inicio de su sección).

## Tests

Carga `estandar-tests`. Interacciones falsas con `memberPermissions` de admin y sin él (debe contestar «No tienes permisos»), comprobando payload, ajuste guardado y fila de auditoría. Referencias: `tests/parte8Admin.test.js`, `adminAjustesBotones`, `adminAuditCobertura`, `adminBancoPanel`, `adminSonidos`.

## Diseño y documentación

Antes de mover secciones: `docs/planificacion/diseno/reorganizacion-paneles.md` y `docs/planificacion/MODALES.md`. Cambios visibles en `docs/FUNCIONALIDADES.md` y prueba manual en `docs/planificacion/TAREAS.md`.
