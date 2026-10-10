// Panel admin → Config Global (#238): cada botón de ajustes lleva a su vista o abre su formulario, y los formularios
// muestran el valor que ya tiene el servidor (si no, el admin guardaría algo distinto sin querer).
const guildSettings = require("../src/systems/guildSettings");
const { handleSettingsButton, ACCIONES_BOTON } = require("../src/adminPanel/settings/botones");

const G = "g-admin-ajustes-botones";
guildSettings.setSetting(G, "casino.min_bet", 25);
guildSettings.setSetting(G, "casino.max_bet", 4000);

function interaccion(customId) {
    return {
        customId,
        guildId: G,
        guild: { id: G },
        user: { id: "admin-aj", username: "admin", tag: "admin#0003" },
        update: jest.fn(async () => {}),
        showModal: jest.fn(async () => {}),
        reply: jest.fn(async () => {}),
    };
}

// Los valores que ya tiene cada campo del formulario, por su id.
function valoresDe(modal) {
    const campos = {};
    // Se lee el JSON del modal, que es lo que recibe Discord: los selectores van en su etiqueta.
    for (const fila of modal.toJSON().components) {
        if (fila.component) campos[fila.component.custom_id] = fila.component.options.find((o) => o.default)?.value;
        else for (const c of fila.components) campos[c.custom_id] = c.value;
    }
    return campos;
}

test("cada botón de ajustes responde: o cambia la vista o abre un formulario", async () => {
    for (const id of ACCIONES_BOTON.keys()) {
        const i = interaccion(id);
        expect(await handleSettingsButton(i)).toBe(true);
        expect(i.update.mock.calls.length + i.showModal.mock.calls.length).toBe(1);
    }
});

test("un botón que no es de ajustes no lo atiende", async () => {
    expect(await handleSettingsButton(interaccion("paneladmin_otra_cosa"))).toBe(false);
});

test("el formulario de límites del casino muestra los valores guardados", async () => {
    const i = interaccion("paneladmin_cfg_casino_limits");
    await handleSettingsButton(i);
    const campos = valoresDe(i.showModal.mock.calls[0][0]);
    expect(campos.min).toBe("25");
    expect(campos.max).toBe("4000");
});

test("el formulario de la tienda muestra si está activa", async () => {
    guildSettings.setSetting(G, "tienda.enabled", false);
    const i = interaccion("paneladmin_cfg_tienda_edit");
    await handleSettingsButton(i);
    expect(valoresDe(i.showModal.mock.calls[0][0]).enabled).toBe("0");
});
