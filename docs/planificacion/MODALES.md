# Modales: análisis y propuestas

Revisión del 2026-10-10 de todos los modales del bot. Idea de partida: [#303](https://github.com/ale-dm/bot-discord/issues/303)
(radio y casillas en vez de escribir `1/0` o `si/no`).

## Lo que hay

- **55 llamadas a `simpleModal`** (`src/adminPanel/common.js`), casi todas del panel admin, más **13 ficheros** que construyen
  su `ModalBuilder` a mano (jugadores: apuestas, ruleta, cripto, Duende, retos, economía, tienda, Plex, mensaje).
- Casi todo es texto libre: un `TextInput` por campo, con un `placeholder` y, a veces, un `maxLength`.
- Discord permite hoy, dentro de un modal, selectores de canal, rol, usuario y mención, desplegables, grupos de radio y
  casillas. discord.js 14.27 (instalado) los soporta. No hace falta actualizar la librería.

## Qué está tosco

| Patrón | Ejemplo | Propuesta |
|---|---|---|
| Sí/no escrito como `1/0`, `si/no`, `activo` | Happy hour, casino de fin de semana, recompensa diaria, tienda, logros, recordatorio, alertas por DM, tono del Duende | Grupo de radio Sí/No |
| ID de canal escrito a mano | Canal del Duende, canal de mensajes espontáneos, canal de notificaciones de la tienda, canal de anuncios de logros, canal de Seerr y de Plex a quitar, canales ignorados | Selector de canal (solo canales de texto) |
| ID de rol escrito a mano | Recompensas de nivel (añadir, descripción, quitar), ACL de comandos | Selector de rol |
| ID de usuario escrito a mano | Ajustar, resetear y ver XP, multiplicador, saldo del banco, apodos, perfiles del Duende, alertas por DM | Selector de usuario |
| Hora escrita como `0-23` o `HH:MM` | Happy hour, madrugada del Duende, sesión de cine de Plex | Desplegable de horas |
| Opciones cerradas escritas como texto | Base de impuesto (`ingreso`/`compra`), destino (`bote`/`sumidero`/`efectivo`/`banco`/`negro`), tipo de objeto (`rol`/`consumible`/`coleccionable`), campo a editar, comando de la ACL | Desplegable con las opciones |
| Listas separadas por comas | Canales y roles de la ACL, canales formales del Duende, avisos de alertas por DM | Selector múltiple (varios valores) |
| Cantidades y porcentajes sin ayuda | XP, cripto, casino (RTP y límites), impuestos, premios de la liga, importación de Plex | Se mantiene texto, con el rango en la etiqueta y validación clara; presets para los valores habituales |
| Número del 0 al 36 | Ruleta, número exacto | No cabe en un desplegable (37 opciones; Discord admite 25). Se hace en dos pasos: docena o rango, y luego el número |

## Grupos y fichas

Cada grupo es una issue. Las rutas son de la revisión; los números de línea pueden moverse.

### G1 · Sí/no en grupos de radio
Relacionado con #303.
- `src/adminPanel/niveles/config.js`: racha diaria (`enabled`, la racha de XP).
- `src/adminPanel/settings/botones.js`: happy hour (`activo`), fin de semana del casino (`activo`), recompensa diaria
  (`enabled`), tono del Duende (`activa`), mensajes espontáneos del Duende (`enabled`), tienda (`enabled`), logros
  (`enabled`), ACL de comandos (`enabled`).
- `src/adminPanel/apuestas/botones.js`: recordatorio antes del partido (`activo`).
- `src/adminPanel/sistema.js`: alertas por DM (`activas`).
- `src/adminPanel/impuestos.js`: activar o desactivar regla (`activo`).

### G2 · Canales con selector
- `settings/botones.js`: canal del Duende, canal de mensajes espontáneos, canal de notificaciones de la tienda, canal de
  anuncio de logros.
- `seerr.js` y `plex/botones.js`: quitar canal permitido (y `ignorados.js`, canal ignorado).
- `settings/botones.js` (ACL, canales en CSV) y `settings/botones.js` (canales formales del Duende, CSV): selector
  múltiple.

### G3 · Roles y personas con selector
- `niveles/recompensas.js`: rol de las recompensas (añadir, descripción, quitar y añadir por ID). Quitar sigue admitiendo
  «todos en ese nivel» con un valor vacío.
- `settings/botones.js` (ACL, roles en CSV): selector múltiple de roles.
- `niveles/usuarios.js`: ajustar, resetear, ver y multiplicador de XP (ID de usuario).
- `bank.js`: buscar usuario (nombre o ID), modificar saldo.
- `apodos.js` y `perfilesDuende.js`: apodo y Discord ID vinculado.
- `sistema.js` (alertas por DM, IDs en CSV): selector múltiple de personas.
- `plex/selects.js`: vincular cuenta de Plex. Lo natural es elegir persona con selector, y el usuario de Tautulli de una
  lista (ver G4).
- `catalogo.js` (efecto o rol del objeto): mezcla rol y efecto; se separa en dos campos.

### G4 · Opciones cerradas, horas y listas de Tautulli
- `impuestos.js`: base (`ingreso`/`compra`), tipo concreto (general o uno de la lista), destino del patrimonio.
- `bank.js`: destino del saldo (`efectivo`/`banco`/`negro`).
- `catalogo.js`: tipo de objeto y campo a editar (la lista ya existe en `CAMPOS`).
- `settings/botones.js`: horas (`0-23`, Madrid) de la happy hour y de la madrugada del Duende.
- `plex/selects.js`: usuario de Tautulli elegido de una lista (hay que pedir la lista a Tautulli al abrir el modal).

### G5 · Cantidades y porcentajes con ayuda
- Panel admin: XP por mensaje, voz, multiplicador, fórmula y racha; cripto (comisiones y límites); casino (límites y RTP);
  premios de la liga; importación de Plex; límites de apuestas; recompensa diaria; límite diario de Seerr.
- Jugadores: cantidad de apuestas (partido, quiniela, combinada), monedas a invertir en cripto, cantidad de retos, cantidad
  de la economía (ingresar, sacar, transferir). Para estas, presets de los valores habituales (100, 500, 1.000, todo)
  además del campo de texto.
- En todos: el rango va en la etiqueta («Cantidad (10-100.000)»), y el error dice cuál es el rango, no solo que no vale.

### G6 · Modales de jugadores
- Ruleta, número exacto: dos pasos (docena o rango, después el número). Ver la tabla de arriba.
- Plex, sesión de cine: la hora como desplegable de horas y minutos (intervalos de 15 minutos), no como texto `HH:MM`.
- Cripto, comprar: presets además del importe libre.
- Mensaje a una persona, buscar en la tienda, hablar con el Duende, anotar sobre una persona, porras: el texto libre es lo
  adecuado; solo se revisan los límites y las etiquetas.

## Lo que ya está hecho

- **G1 (sí/no en radio), convertido** (#305): los 12 campos de sí/no de ajustes, racha, impuestos, recordatorio de apuestas y alertas por DM son grupos de radio. Cada manejador lee el grupo con `getRadioGroup`; los valores guardados no cambian. Falta probarlo en Discord antes de cerrar #305.
- **G2 (canales con selector), convertido** (#306): el canal del Duende, de mensajes espontáneos, de notificaciones de la tienda y de anuncios de logros son un selector de uno; la ACL y los canales formales del Duende, selector múltiple (marcado con los que ya hay). Quitar canal (ignorados, Seerr y Plex) usa el mismo selector: un canal sin elegir se rechaza con «Elige un canal.». Falta probarlo en Discord antes de cerrar #306.
- **G3 (roles y personas con selector), convertido en parte** (#307): ajustar, resetear, ver perfil y multiplicador de XP; buscar usuario en el banco; vincular un perfil del Duende; quién recibe las alertas (varios); roles de las recompensas (descripción, quitar, añadir por ID; «quitar» sigue significando todos si va vacío); roles de la ACL (varios). Queda: el objeto de la tienda que mezcla efecto y rol (`catalogo.js`), que pide separarse en dos campos, y el usuario de Plex, que es G4. Falta probarlo en Discord antes de cerrar #307.
- **G3, lo que queda, bloqueado**: el objeto de la tienda que mezcla efecto y rol (`catalogo.js`). Separarlo en dos campos (rol y efecto) obliga a un sexto componente en el modal de crear, y Discord admite cinco. Para hacerlo hay que quitar un campo de ese modal (la imagen, por ejemplo), y eso es una decisión de producto.
- **G4 (opciones cerradas y horas), convertido** (#308): base, tipo de movimiento y destino de los impuestos; destino del saldo del banco; tipo y campo del catálogo; horas de la happy hour y de la madrugada del Duende. El usuario de Plex se elige de la lista de Tautulli cuando responde a tiempo (2 s, y como mucho 25); si no, se escribe como antes. La ACL sigue con el comando como texto, porque la lista de comandos no se conoce desde el panel. Falta probarlo en Discord antes de cerrar #308.
- **G5 (cantidades con ayuda), en parte** (#309): partido (incluido el marcador exacto), quiniela, combinada, retos y economía (ingresar, sacar, transferir y depositar en un negocio) tienen un desplegable de importes (100, 500, 1.000, 5.000, «Todo» si aplica y «Otra cantidad») además del texto, que ahora va opcional. Cripto ya tenía botones de importes. Los ajustes numéricos del panel se guardan sin rango en el código, así que solo el bloque de recompensa diaria (base, por día y tope, que sí se validan) lleva el rango en la etiqueta. Queda: decidir los rangos de XP, casino, cripto, tienda, liga, Plex y Seerr antes de ponerlos en las etiquetas. Falta probarlo en Discord antes de cerrar #309.

- `modalConCampos` en `src/adminPanel/common.js`: un campo puede ser texto (como antes) o un selector (Sí/No en radio,
  opciones, canal, rol o usuario). Los modales existentes no cambian. Pruebas en `tests/modalesCampos.test.js`.

## Cómo probarlo

- Cada grupo se comprueba en Discord: abrir el modal, elegir, guardar, y mirar que el valor en el panel es el que se
  eligió. Los tests cubren la estructura del modal y la conversión del valor, no lo que se ve.
- Los valores guardados no cambian de formato: un sí/no sigue guardándose como `1`/`0` si el ajuste ya lo usa así.
