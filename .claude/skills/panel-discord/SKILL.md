---
name: panel-discord
description: Mensajes, embeds, botones, menús y modales de El Duende (src/paneles/ y componentHandlers). Cárgala siempre que la tarea cree o cambie lo que el usuario ve en Discord, añada un botón, select o modal, o revise customId y límites de Discord.
---

Lo que ve el usuario se construye en `src/paneles/`; los comandos y los sistemas no montan embeds ni filas. Ejemplo de referencia: `src/paneles/sugerencia.js` (embed, estado, botones de voto y repintado).

## Reglas no negociables

1. **Un panel devuelve el payload** (`{ embeds, components, allowedMentions }`) y no responde a la interacción: eso lo hace quien lo llama.
2. **Límites de Discord**: 5 botones por fila, 5 filas por mensaje, 25 opciones por select, 45 caracteres en la etiqueta de un campo de modal, 80 en la de un botón, 4096 en la descripción de un embed, 25 campos por embed. Para repartir botones usa `trozos` de `src/paneles/filas.js`; para listas largas, `src/paneles/menuPaginado.js`.
3. **`customId` único en el mensaje** y con el prefijo del módulo que lo atiende (`sugerencia_voto_<id>_<voto>`). Los datos que viajan en el id deben caber en 100 caracteres; si no, guárdalos en BD y lleva solo la clave.
4. **Menciones**: `allowedMentions: { parse: [] }` salvo que el aviso deba sonar.
5. **Repintar es best-effort**: si el mensaje ya no existe o faltan permisos, se registra con el logger y se sigue.
6. **Botones de acciones resueltas o caducadas, deshabilitados** (`setDisabled`), y el handler comprueba de nuevo el estado: no te fíes del botón.
7. **Propiedad**: si el botón es de un usuario concreto, el handler comprueba que quien pulsa es él y contesta efímero si no.
8. **Textos en español**, con el mismo tono y emojis del panel vecino. Colores como constantes al principio del fichero.
9. Si un panel supera 400 líneas o una función 60, pártelo (ver los `*Extras.js`, `*Comun.js`) y conserva la fachada.

## Ciclo de una interacción de componente

- Botón que cambia el mismo mensaje: `interaction.update(payload)` o `deferUpdate` + `editReply`.
- Botón que abre un modal: `showModal` como primera respuesta (no se puede tras un `defer`).
- Envío de modal: lee con `interaction.fields.getTextInputValue(id)` y valida siempre; el usuario puede escribir cualquier cosa.

## Tests

Carga `estandar-tests` y lee `references/discord-falso.md`: comprueba el payload (filas, número de botones, ids únicos) y el efecto en BD, no solo que se llamó a `reply`.

## Diseño y documentación

- Reorganizaciones de paneles: lee antes `docs/planificacion/diseno/reorganizacion-paneles.md` y `docs/planificacion/MODALES.md`.
- Cambios visibles: `docs/FUNCIONALIDADES.md` y prueba manual en `docs/planificacion/TAREAS.md`.
