---
name: comando-discord
description: Cómo se añade o cambia un slash command de El Duende (src/commands/). Cárgala siempre que la tarea cree un comando nuevo, le añada subcomandos u opciones, lo renombre o lo borre. Para el mensaje, los botones o los modales que enseña, carga también panel-discord.
---

Cada fichero de `src/commands/<tema>/` es un comando: `cargarModulos.js` los recorre todos y `componentRouter.js` registra sus `componentHandlers`. Un comando **solo reparte**: valida, llama a `src/systems/` o `src/services/` y pinta con `src/paneles/`.

## Forma del módulo

```js
module.exports = {
    data: new SlashCommandBuilder().setName("nombre").setDescription("Qué hace, en español."),
    async run(client, interaction) { /* repartir */ },
    componentHandlers: [
        { types: ["button"], prefixes: ["nombre_"], method: "handleButton", acl: "nombre" },
    ],
    async handleButton(client, interaction) { /* … */ },
};
```

- `types`: `button`, `stringSelect`, `userSelect`, `roleSelect`, `channelSelect`, `modal`.
- `prefixes` o `ids`: un id exacto gana a un prefijo y un prefijo largo a uno corto. El prefijo debe ser **propio** del comando; comprueba con una búsqueda que nadie más lo usa.
- `acl`: aplica a los componentes los mismos canales y roles permitidos que al comando.

## Reglas

1. Nombre y descripción en español, minúsculas en el nombre. Los límites de Discord siguen valiendo (descripción ≤ 100 caracteres).
2. Nada de lógica de negocio ni SQL en el comando: va a `systems/` o a `repositorios/`. Dependencias solo `commands` → `systems`/`services`.
3. Nada de dinero directo: todo por `src/systems/dinero.js` (carga `economia-dinero` si mueve dinero).
4. Nada de crear tablas: migración nueva (carga `migracion-sqlite`).
5. Ciclo de la interacción: responde o haz `deferReply` en menos de 3 s; tras un `defer` usa `editReply`; no respondas dos veces; para respuestas privadas usa `MessageFlags.Ephemeral`.
6. Rutas con `core/paths.js`, logs con `createLogger("Módulo")`, permisos con `core/permisos.js`.
7. Límite de ESLint: 60 líneas por función y 400 por fichero. Si no cabe, parte en `systems/` o `paneles/`.

## Lista obligatoria al añadir, renombrar o borrar un comando

- [ ] Añádelo (o quítalo) en `/ayuda` (`src/commands/general/ayuda.js`).
- [ ] Actualiza la lista y el número del test «quedan N comandos» en `tests/parte8Admin.test.js`.
- [ ] Tests del comportamiento nuevo con el Discord falso (carga `estandar-tests`, referencia `discord-falso.md`).
- [ ] `docs/FUNCIONALIDADES.md`: qué hace y cómo se usa.
- [ ] `docs/planificacion/TAREAS.md`: qué hay que probar a mano en Discord.
- [ ] `docs/CHANGELOG.md`.
- [ ] Recuerda en el resumen que hay que volver a registrar los comandos en Discord (`src/discord/registerCommands.js`) al desplegar.
