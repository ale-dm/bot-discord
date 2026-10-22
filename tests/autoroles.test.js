// 🎭 Autoroles (#539): configuración, panel (botones y desplegable), ponerse y quitarse, grupo exclusivo,
// jerarquía, permisos, mantenimiento, auditoría y panel admin.
const db = require("../src/core/db");
const guildSettings = require("../src/systems/guildSettings");
const autoroles = require("../src/systems/autoroles");
const comando = require("../src/commands/general/autoroles");
const panel = require("../src/paneles/autoroles");
const { handleSettingsButton } = require("../src/adminPanel/settings/botones");
const { handleSettingsModal } = require("../src/adminPanel/settings/modales");

const G = "g-autoroles";

beforeEach(() => {
    db.prepare("DELETE FROM guild_settings WHERE guildId = ?").run(G);
    db.prepare("DELETE FROM admin_audit WHERE guildId = ?").run(G);
    guildSettings.invalidarAjustes(G);
    guildSettings.setManySettings(G, { "mantenimiento.activo": false });
});

function estructura({ tiene = [], posicionBot = 100, permiso = true, roles = [] } = {}) {
    const cacheRoles = new Map();
    for (const r of roles) {
        cacheRoles.set(r.id, { id: r.id, name: r.name, position: r.position ?? 10, managed: !!r.managed });
    }
    const member = {
        id: "u-rol",
        roles: {
            cache: new Map(tiene.map((id) => [id, {}])),
            add: jest.fn(async (id) => member.roles.cache.set(id, {})),
            remove: jest.fn(async (id) => member.roles.cache.delete(id)),
        },
    };
    const guild = {
        id: G,
        roles: { cache: cacheRoles },
        members: {
            me: { id: "bot", permissions: { has: () => permiso }, roles: { highest: { position: posicionBot } } },
            cache: new Map([[member.id, member]]),
        },
    };
    return { guild, member };
}

function interaccion({ guild, member, customId = "autorol_btn_r1", values = [] } = {}) {
    return {
        guildId: G,
        guild,
        member,
        user: { id: member?.id || "u-rol", tag: "u-rol#0001" },
        customId,
        values,
        update: jest.fn(async () => {}),
        reply: jest.fn(async () => {}),
    };
}

const guardados = () => autoroles.lista(G);

describe("lista de roles", () => {
    test("añade, evita duplicados, quita y respeta el máximo", () => {
        expect(autoroles.anadir(G, { roleId: "r1", etiqueta: "Rojo", emoji: "🔴", grupo: "colores" }).ok).toBe(true);
        expect(guardados()).toEqual([{ roleId: "r1", etiqueta: "Rojo", emoji: "🔴", grupo: "colores" }]);
        expect(autoroles.anadir(G, { roleId: "r1", etiqueta: "Otra" })).toMatchObject({ ok: false });
        expect(autoroles.anadir(G, { roleId: "r2", etiqueta: "" })).toMatchObject({ ok: false });
        for (let i = 2; i <= autoroles.MAX; i++) autoroles.anadir(G, { roleId: `r${i}`, etiqueta: `Rol ${i}` });
        expect(autoroles.anadir(G, { roleId: "r-mas", etiqueta: "Más" })).toMatchObject({ ok: false });
        expect(autoroles.quitar(G, "r1").ok).toBe(true);
        expect(guardados().some((r) => r.roleId === "r1")).toBe(false);
        expect(autoroles.quitar(G, "r1")).toMatchObject({ ok: false });
        expect(autoroles.grupoDe(G, "r2")).toBe("");
    });

    test("un JSON roto se trata como una lista vacía", () => {
        guildSettings.setSetting(G, "autoroles.lista", "{no es json");
        expect(guardados()).toEqual([]);
    });
});

describe("panel de /autoroles", () => {
    test("con hasta 10 roles usa botones y marca los que ya tiene", () => {
        autoroles.guardar(G, [
            { roleId: "r1", etiqueta: "Rojo", emoji: "🔴", grupo: "colores" },
            { roleId: "r2", etiqueta: "Azul", emoji: "🔵", grupo: "colores" },
        ]);
        const { guild, member } = estructura({
            tiene: ["r1"],
            roles: [
                { id: "r1", name: "Rojo" },
                { id: "r2", name: "Azul" },
            ],
        });
        const payload = panel.buildAutoroles(guardados(), { guild, memberId: member.id });
        const botones = payload.components[0].toJSON().components;
        expect(botones.map((b) => b.custom_id)).toEqual(["autorol_btn_r1", "autorol_btn_r2"]);
        expect(botones[0].style).toBe(3); // Success: ya lo tiene
        expect(botones[1].style).toBe(2); // Secondary
        expect(payload.embeds[0].toJSON().description).toContain("solo puedes tener uno");
    });

    test("con más de 10 roles usa un desplegable", () => {
        const roles = Array.from({ length: 11 }, (_, i) => ({ roleId: `r${i}`, etiqueta: `Rol ${i}` }));
        autoroles.guardar(G, roles);
        const { guild, member } = estructura();
        const payload = panel.buildAutoroles(guardados(), { guild, memberId: member.id });
        expect(payload.components[0].toJSON().components[0].custom_id).toBe("autorol_sel");
        expect(payload.components[0].toJSON().components[0].options).toHaveLength(11);
    });

    test("sin roles configurados lo dice y no pone componentes", () => {
        const { guild, member } = estructura();
        const payload = panel.buildAutoroles([], { guild, memberId: member.id });
        expect(payload.components).toEqual([]);
        expect(payload.embeds[0].toJSON().description).toContain("todavía no ha configurado");
    });
});

describe("ponerse y quitarse roles", () => {
    test("un botón pone el rol, lo audita y repinta", async () => {
        autoroles.guardar(G, [{ roleId: "r1", etiqueta: "Rojo" }]);
        const { guild, member } = estructura({ roles: [{ id: "r1", name: "Rojo" }] });
        const i = interaccion({ guild, member });
        await comando.handleButton({}, i);
        expect(member.roles.add).toHaveBeenCalledWith("r1");
        expect(i.update.mock.calls[0][0].embeds[0].toJSON().description).toContain("Te has puesto");
        expect(db.prepare("SELECT action FROM admin_audit WHERE guildId = ?").get(G).action).toBe("autoroles.toggle");
    });

    test("si ya lo tiene, el botón se lo quita", async () => {
        autoroles.guardar(G, [{ roleId: "r1", etiqueta: "Rojo" }]);
        const { guild, member } = estructura({ tiene: ["r1"], roles: [{ id: "r1", name: "Rojo" }] });
        const i = interaccion({ guild, member });
        await comando.handleButton({}, i);
        expect(member.roles.remove).toHaveBeenCalledWith("r1");
        expect(i.update.mock.calls[0][0].embeds[0].toJSON().description).toContain("Te has quitado");
    });

    test("en un grupo exclusivo, poner uno quita el otro", async () => {
        autoroles.guardar(G, [
            { roleId: "r1", etiqueta: "Rojo", grupo: "colores" },
            { roleId: "r2", etiqueta: "Azul", grupo: "colores" },
        ]);
        const { guild, member } = estructura({
            tiene: ["r1"],
            roles: [
                { id: "r1", name: "Rojo" },
                { id: "r2", name: "Azul" },
            ],
        });
        const i = interaccion({ guild, member, customId: "autorol_btn_r2" });
        await comando.handleButton({}, i);
        expect(member.roles.remove).toHaveBeenCalledWith("r1");
        expect(member.roles.add).toHaveBeenCalledWith("r2");
    });

    test("el desplegable también alterna el rol elegido", async () => {
        autoroles.guardar(G, [{ roleId: "r1", etiqueta: "Rojo" }]);
        const { guild, member } = estructura({ roles: [{ id: "r1", name: "Rojo" }] });
        const i = interaccion({ guild, member, customId: "autorol_sel", values: ["r1"] });
        await comando.handleSelect({}, i);
        expect(member.roles.add).toHaveBeenCalledWith("r1");
    });

    test("en mantenimiento no cambia nada", async () => {
        autoroles.guardar(G, [{ roleId: "r1", etiqueta: "Rojo" }]);
        guildSettings.setSetting(G, "mantenimiento.activo", true);
        const { guild, member } = estructura({ roles: [{ id: "r1", name: "Rojo" }] });
        const i = interaccion({ guild, member });
        await comando.handleButton({}, i);
        expect(member.roles.add).not.toHaveBeenCalled();
        expect(i.update.mock.calls[0][0].embeds[0].toJSON().description).toContain("mantenimiento");
    });

    test("no deja asignar un rol por encima del bot, gestionado o sin permiso", async () => {
        autoroles.guardar(G, [
            { roleId: "r1", etiqueta: "Rojo" },
            { roleId: "r2", etiqueta: "Azul" },
            { roleId: "r3", etiqueta: "Verde" },
        ]);
        const alto = estructura({ posicionBot: 5, roles: [{ id: "r1", name: "Rojo", position: 10 }] });
        const i1 = interaccion({ guild: alto.guild, member: alto.member });
        await comando.handleButton({}, i1);
        expect(alto.member.roles.add).not.toHaveBeenCalled();
        expect(i1.update.mock.calls[0][0].embeds[0].toJSON().description).toContain("por encima del bot");

        const gestionado = estructura({ roles: [{ id: "r1", name: "Rojo", managed: true }] });
        const i2 = interaccion({ guild: gestionado.guild, member: gestionado.member });
        await comando.handleButton({}, i2);
        expect(gestionado.member.roles.add).not.toHaveBeenCalled();
        expect(i2.update.mock.calls[0][0].embeds[0].toJSON().description).toContain("integración");

        const sinPermiso = estructura({ permiso: false, roles: [{ id: "r1", name: "Rojo" }] });
        const i3 = interaccion({ guild: sinPermiso.guild, member: sinPermiso.member });
        await comando.handleButton({}, i3);
        expect(sinPermiso.member.roles.add).not.toHaveBeenCalled();
        expect(i3.update.mock.calls[0][0].embeds[0].toJSON().description).toContain("Gestionar roles");
    });

    test("un rol que ya no está en el menú no se toca", async () => {
        autoroles.guardar(G, []);
        const { guild, member } = estructura({ roles: [{ id: "r1", name: "Rojo" }] });
        const i = interaccion({ guild, member });
        await comando.handleButton({}, i);
        expect(member.roles.add).not.toHaveBeenCalled();
        expect(i.update.mock.calls[0][0].embeds[0].toJSON().description).toContain("ya no está en el menú");
    });
});

describe("panel admin", () => {
    test("Config Global abre el panel y los botones abren sus formularios", async () => {
        const panelAdmin = { customId: "paneladmin_cfg_autoroles", guildId: G, update: jest.fn(async () => {}) };
        expect(await handleSettingsButton(panelAdmin)).toBe(true);
        expect(panelAdmin.update.mock.calls[0][0].embeds[0].toJSON().title).toBe("🎭 Autoroles");

        const add = { customId: "paneladmin_cfg_autoroles_add", guildId: G, showModal: jest.fn(async () => {}) };
        expect(await handleSettingsButton(add)).toBe(true);
        expect(add.showModal.mock.calls[0][0].toJSON().custom_id).toBe("paneladmin_cfg_autoroles_add_modal");
    });

    test("añade un rol con etiqueta por defecto y lo audita", async () => {
        const { guild } = estructura({ roles: [{ id: "r1", name: "Rojo" }] });
        const i = {
            customId: "paneladmin_cfg_autoroles_add_modal",
            guildId: G,
            guild,
            user: { id: "admin" },
            fields: {
                getSelectedRoles: () => new Map([["r1", {}]]),
                getTextInputValue: (id) => ({ etiqueta: "", emoji: "🔴", grupo: "colores" })[id] ?? "",
            },
            reply: jest.fn(async () => {}),
        };
        expect(await handleSettingsModal(i)).toBe(true);
        expect(guardados()).toEqual([{ roleId: "r1", etiqueta: "Rojo", emoji: "🔴", grupo: "colores" }]);
        expect(db.prepare("SELECT action FROM admin_audit WHERE guildId = ?").get(G).action).toBe("settings.autoroles.update");
    });

    test("no añade un rol por encima del bot y quita los que sí están", async () => {
        autoroles.guardar(G, [{ roleId: "r1", etiqueta: "Rojo" }]);
        const { guild } = estructura({ posicionBot: 5, roles: [{ id: "r2", name: "Alto", position: 10 }] });
        const i = {
            customId: "paneladmin_cfg_autoroles_add_modal",
            guildId: G,
            guild,
            user: { id: "admin" },
            fields: { getSelectedRoles: () => new Map([["r2", {}]]), getTextInputValue: () => "" },
            reply: jest.fn(async () => {}),
        };
        expect(await handleSettingsModal(i)).toBe(true);
        expect(guardados()).toHaveLength(1);
        expect(i.reply.mock.calls[0][0].content).toContain("por encima del bot");

        const quitar = {
            customId: "paneladmin_cfg_autoroles_remove_modal",
            guildId: G,
            user: { id: "admin" },
            fields: { getSelectedRoles: () => new Map([["r1", {}]]) },
            reply: jest.fn(async () => {}),
        };
        expect(await handleSettingsModal(quitar)).toBe(true);
        expect(guardados()).toEqual([]);
    });
});
