// Los sí/no de los formularios de ajustes (#305, grupo G1) son grupos de radio, no texto «1/0» ni «si/no»: así el admin
// elige en vez de escribir, y el valor que se guarda es el mismo de siempre.
const { ComponentType } = require("discord.js");
const { handleSettingsButton } = require("../src/adminPanel/settings/botones");
const { handleSettingsModal } = require("../src/adminPanel/settings/modales");
const guildSettings = require("../src/systems/guildSettings");

const G = "g-modales-si-no";

function interaccion(customId) {
    return {
        customId,
        guildId: G,
        guild: { id: G },
        user: { id: "admin-sn", username: "admin", tag: "admin#0004" },
        update: jest.fn(async () => {}),
        showModal: jest.fn(async () => {}),
        reply: jest.fn(async () => {}),
    };
}

// Los botones que abren un formulario de sí/no en la pantalla de ajustes.
const BOTONES = [
    "paneladmin_cfg_eventos_xp",
    "paneladmin_cfg_eventos_casino",
    "paneladmin_cfg_duende_tono",
    "paneladmin_cfg_duende_espontaneo",
    "paneladmin_cfg_tienda_edit",
    "paneladmin_cfg_acl_edit",
    "paneladmin_cfg_logros_edit",
];

describe("formularios de ajustes con sí/no", () => {
    test.each(BOTONES)("%s no pide sí/no como texto", async (customId) => {
        const i = interaccion(customId);
        await handleSettingsButton(i);
        const modal = i.showModal.mock.calls.at(-1)[0].toJSON();
        const textos = modal.components.filter((f) => f.type === ComponentType.ActionRow).flatMap((f) => f.components);
        const sinSiNo = textos.filter((c) => /1\/0|si\/no|sí\/no/i.test(c.label ?? ""));
        expect(sinSiNo).toEqual([]);
        const radios = modal.components.filter((f) => f.type === ComponentType.Label && f.component.type === ComponentType.RadioGroup);
        expect(radios.length).toBeGreaterThanOrEqual(1);
    });

    test("el formulario de la tienda marca la opción actual", async () => {
        guildSettings.setSetting(G, "tienda.enabled", false);
        const i = interaccion("paneladmin_cfg_tienda_edit");
        await handleSettingsButton(i);
        const radio = i.showModal.mock.calls.at(-1)[0].toJSON().components[0].component;
        expect(radio.type).toBe(ComponentType.RadioGroup);
        expect(radio.options.find((o) => o.default).value).toBe("0");
    });

    test("guardar la tienda con «Sí» escribe 1, como antes", async () => {
        const i = {
            ...interaccion("paneladmin_cfg_tienda_modal"),
            fields: {
                getRadioGroup: (id) => (id === "enabled" ? "1" : null),
                getTextInputValue: (id) => ({ buyCd: "0", daily: "0", channel: "" })[id] ?? "",
                getSelectedChannels: () => null,
            },
        };
        await handleSettingsModal(i);
        expect(guildSettings.getSettings(G).tienda.enabled).toBe(true);
    });
});
