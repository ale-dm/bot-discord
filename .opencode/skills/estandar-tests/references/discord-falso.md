# Discord falso — El Duende

Interacciones planas para probar comandos, botones, menús y modales sin `discord.js` real.

## Discord falso

No uses objetos reales de `discord.js`. Crea interacciones planas con las propiedades que el handler necesita:

```js
const interaccion = (extra = {}) => ({
    guildId: G,
    guild: { id: G },
    user: { id: "u-admin", username: "admin", tag: "admin" },
    member: { permissions: { has: () => true } },
    client: {
        slashCommands: new Map(),
        guilds: { cache: new Map() },
        user: { displayAvatarURL: () => null },
        users: { fetch: async () => null },
    },
    reply: jest.fn(async () => {}),
    update: jest.fn(async () => {}),
    deferReply: jest.fn(async () => {}),
    editReply: jest.fn(async () => {}),
    showModal: jest.fn(async () => {}),
    ...extra,
});
```

Para botones y modales, añade `customId` y `fields.getTextInputValue` / `getStringSelectValues`. Después inspecciona `mock.calls`:

```js
const ids = (payload) => payload.components.flatMap((r) => r.components.map((b) => b.data.custom_id));
const ultimo = (mock) => mock.mock.calls.at(-1)[0];

expect(ids(ultimo(i.reply))).toEqual(expect.arrayContaining(["paneladmin_cat_home"]));
expect(ultimo(i.update).embeds[0].data.description).toMatch(/creado/);
```

Comprueba también los límites de Discord: 5 botones por fila, 5 filas por mensaje, 45 caracteres de etiqueta en modales y `customId` único en el mensaje.
