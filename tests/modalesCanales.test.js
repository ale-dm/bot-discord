// Los canales de los formularios de ajustes (#306, grupo G2) se eligen con un selector de canal, no escribiendo IDs.
// Los formularios de una sola elección (canal del Duende, notificaciones de la tienda, anuncios de logros) llevan un
// selector de uno; la ACL y los canales formales del Duende, de varios.
const { ComponentType } = require("discord.js");
const { handleSettingsButton } = require("../src/adminPanel/settings/botones");
const guildSettings = require("../src/systems/guildSettings");

const G = "g-modales-canales";

function interaccion(customId) {
    return {
        customId,
        guildId: G,
        guild: { id: G },
        user: { id: "admin-canales", username: "admin", tag: "admin#0005" },
        update: jest.fn(async () => {}),
        showModal: jest.fn(async () => {}),
        reply: jest.fn(async () => {}),
    };
}

async function formularioDe(customId) {
    const i = interaccion(customId);
    await handleSettingsButton(i);
    return i.showModal.mock.calls.at(-1)[0].toJSON();
}

const selectoresDeCanal = (modal) =>
    modal.components
        .filter((f) => f.type === ComponentType.Label && f.component.type === ComponentType.ChannelSelect)
        .map((f) => f.component);

describe("canales de los formularios de ajustes", () => {
    test.each(["paneladmin_cfg_duende_channel", "paneladmin_cfg_tienda_edit", "paneladmin_cfg_logros_edit"])(
        "%s elige un canal con un selector de uno",
        async (customId) => {
            const selectores = selectoresDeCanal(await formularioDe(customId));
            expect(selectores).toHaveLength(1);
            expect(selectores[0].max_values).toBe(1);
            expect(selectores[0].required).toBe(false);
        },
    );

    test("la ACL elige varios canales a la vez, y el vacío significa todos", async () => {
        const selectores = selectoresDeCanal(await formularioDe("paneladmin_cfg_acl_edit"));
        expect(selectores).toHaveLength(1);
        expect(selectores[0].custom_id).toBe("channels");
        expect(selectores[0].max_values).toBe(25);
        expect(selectores[0].required).toBe(false);
    });

    test("los canales formales del Duende salen marcados con los que ya hay guardados", async () => {
        guildSettings.setManySettings(G, { "duende.canales_formales": "111111111111111111,222222222222222222" });
        const selectores = selectoresDeCanal(await formularioDe("paneladmin_cfg_duende_tono"));
        expect(selectores[0].custom_id).toBe("formales");
        expect(selectores[0].default_values.map((d) => d.id)).toEqual(["111111111111111111", "222222222222222222"]);
    });
});
