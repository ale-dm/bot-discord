// Panel admin → Niveles, repartido por pantallas (adminPanel/niveles): cada botón y formulario
// sigue llegando a la suya.
const xp = require("../src/systems/xpSystem");
const niveles = require("../src/adminPanel/levels");

const G = "guild-panel-niveles";
function interaccion(customId, extra = {}) {
    const i = {
        customId,
        guildId: G,
        user: { id: "admin" },
        guild: { id: G, roles: { cache: new Map() }, channels: { cache: new Map() } },
        respuestas: [],
        update: jest.fn(async (p) => i.respuestas.push(p)),
        reply: jest.fn(async (p) => i.respuestas.push(p)),
        showModal: jest.fn(async (m) => i.respuestas.push(m)),
        ...extra,
    };
    return i;
}
const titulo = (i) => i.respuestas[0].embeds?.[0]?.data.title;

test.each([
    ["paneladmin_levels_home", /Niveles|XP/],
    ["paneladmin_levels_config", /Configuración XP/],
    ["paneladmin_levels_rewards", /Recompensas/],
    ["paneladmin_levels_users", /usuarios/],
    ["paneladmin_levels_ignored", /ignorados/],
])("el botón %s abre su pantalla", async (id, esperado) => {
    xp.ensureGuildDefaults(G);
    const i = interaccion(id);
    expect(await niveles.handleLevelsButton(i)).toBe(true);
    expect(titulo(i)).toMatch(esperado);
});

test("un botón que no es de niveles no lo atiende nadie", async () => {
    expect(await niveles.handleLevelsButton(interaccion("paneladmin_otro"))).toBe(false);
    expect(await niveles.handleLevelsModal(interaccion("paneladmin_otro_modal"))).toBe(false);
});

test("los formularios y selectores llegan a su pantalla", async () => {
    const voz = interaccion("paneladmin_levels_cfg_voice_modal", { fields: { getTextInputValue: () => "7" } });
    expect(await niveles.handleLevelsModal(voz)).toBe(true);
    expect(xp.getAllConfig(G).xp_voice_per_min).toBe("7");

    const ignorar = interaccion("paneladmin_levels_ignored_add_select", { values: ["123456789012345678"] });
    expect(await niveles.handleChannelSelect(ignorar)).toBe(true);
    expect(xp.getIgnoredChannels(G).map((c) => c.channelId)).toEqual(["123456789012345678"]);

    const rol = interaccion("paneladmin_levels_reward_role_5", { values: ["999"] });
    expect(await niveles.handleRoleSelect(rol)).toBe(true);
    expect(xp.getRewards(G)).toEqual([expect.objectContaining({ nivel: 5, roleId: "999" })]);
});
