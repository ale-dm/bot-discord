// 📈 Depósito a plazo (#518): abrir, interés por plazo, saldo del banco, cancelación sin intereses,
// vencimiento automático, aviso por DM, pantalla de /perfil y ajustes del panel admin.
const db = require("../src/core/db");
const dinero = require("../src/systems/dinero");
const depositos = require("../src/systems/depositos");
const guildSettings = require("../src/systems/guildSettings");
const panel = require("../src/paneles/deposito");
const envios = require("../src/discord/envios/depositos");
const { handleModal } = require("../src/perfil/dinero");
const { handleSettingsModal } = require("../src/adminPanel/settings/modales");

const G = "g-deposito";
const AHORA = Date.UTC(2026, 0, 1);
const DIA = 24 * 60 * 60 * 1000;

beforeEach(() => {
    db.prepare("DELETE FROM depositos_plazo").run();
    db.prepare("DELETE FROM banco").run();
    db.prepare("DELETE FROM historial").run();
    db.prepare("DELETE FROM guild_settings WHERE guildId = ?").run(G);
    db.prepare("DELETE FROM admin_audit WHERE guildId = ?").run(G);
    guildSettings.invalidarAjustes(G);
});

/** Deja a alguien con exactamente `n` en el banco (la cuenta empieza con 1000 de efectivo y 0 en el banco). */
function conBanco(userId, n) {
    const actual = dinero.banco(userId);
    if (actual > 0) dinero.cobrarBanco(userId, actual);
    dinero.pagarBanco(userId, n);
}

function configurar(extra = {}) {
    guildSettings.setManySettings(G, {
        "economia.deposito_min": 1000,
        "economia.deposito_max": 100000,
        "economia.deposito_pct_7": 1,
        "economia.deposito_pct_30": 3,
        "economia.deposito_pct_90": 6,
        ...extra,
    });
}

function camposModal(valores) {
    return { getTextInputValue: (id) => valores[id] };
}

describe("abrir un depósito", () => {
    test("saca el dinero del banco y calcula el interés del plazo", () => {
        conBanco("u-abre", 10000);
        const r = depositos.crear("u-abre", G, 10000, 7, AHORA);
        expect(r.ok).toBe(true);
        expect(r.deposito.interes).toBe(100);
        expect(r.deposito.vencimiento).toBe(AHORA + 7 * DIA);
        expect(dinero.banco("u-abre")).toBe(0);
        expect(dinero.efectivo("u-abre")).toBe(1000);
        expect(depositos.estado("u-abre", AHORA)).toMatchObject({ importe: 10000, interes: 100, total: 10100 });
        expect(db.prepare("SELECT tipo, cantidad FROM historial WHERE userId = ? ORDER BY id DESC").get("u-abre")).toMatchObject({
            tipo: "banco",
            cantidad: -10000,
        });
    });

    test("no se puede abrir con el efectivo: sale del banco", () => {
        conBanco("u-efectivo", 0);
        const r = depositos.crear("u-efectivo", G, 1000, 7, AHORA);
        expect(r).toMatchObject({ ok: false, motivo: "saldo" });
        expect(depositos.estado("u-efectivo", AHORA)).toBeNull();
    });

    test("respeta el mínimo, el máximo y los plazos", () => {
        conBanco("u-limites", 500000);
        expect(depositos.crear("u-limites", G, 500, 7, AHORA)).toMatchObject({ ok: false, motivo: "importe" });
        expect(depositos.crear("u-limites", G, 200000, 7, AHORA)).toMatchObject({ ok: false, motivo: "importe" });
        expect(depositos.crear("u-limites", G, 1000, 15, AHORA)).toMatchObject({ ok: false, motivo: "plazo" });
    });

    test("solo deja un depósito activo por persona", () => {
        conBanco("u-doble", 20000);
        expect(depositos.crear("u-doble", G, 1000, 7, AHORA).ok).toBe(true);
        expect(depositos.crear("u-doble", G, 1000, 30, AHORA)).toMatchObject({ ok: false, motivo: "activo" });
        expect(dinero.banco("u-doble")).toBe(19000);
    });

    test("usa los importes e intereses configurados en el servidor", () => {
        configurar({ "economia.deposito_min": 500, "economia.deposito_max": 2000, "economia.deposito_pct_90": 10 });
        conBanco("u-config", 1000);
        const r = depositos.crear("u-config", G, 1000, 90, AHORA);
        expect(r.ok).toBe(true);
        expect(r.deposito.interes).toBe(100);
    });
});

describe("cancelar y vencer", () => {
    test("cancelar antes devuelve el principal y pierde el interés", () => {
        conBanco("u-cancela", 10000);
        depositos.crear("u-cancela", G, 10000, 30, AHORA);
        const r = depositos.cancelar("u-cancela", AHORA + DIA);
        expect(r.ok).toBe(true);
        expect(dinero.banco("u-cancela")).toBe(10000);
        expect(depositos.estado("u-cancela", AHORA)).toBeNull();
        expect(db.prepare("SELECT cantidad FROM historial WHERE userId = ? ORDER BY id DESC").get("u-cancela").cantidad).toBe(10000);
    });

    test("sin depósito activo no hay nada que cancelar; vencido tampoco se cancela", () => {
        expect(depositos.cancelar("u-nada", AHORA)).toMatchObject({ ok: false, motivo: "sin" });
        conBanco("u-vencido", 10000);
        depositos.crear("u-vencido", G, 10000, 7, AHORA);
        expect(depositos.cancelar("u-vencido", AHORA + 8 * DIA)).toMatchObject({ ok: false, motivo: "vencido" });
    });

    test("al vencer vuelve principal + interés, una sola vez", () => {
        conBanco("u-vence", 10000);
        depositos.crear("u-vence", G, 10000, 30, AHORA);
        expect(depositos.procesarVencidos(AHORA + 29 * DIA)).toEqual([]);
        const pagados = depositos.procesarVencidos(AHORA + 30 * DIA);
        expect(pagados).toHaveLength(1);
        expect(pagados[0]).toMatchObject({ importe: 10000, interes: 300, total: 10300, dias: 30 });
        expect(dinero.banco("u-vence")).toBe(10300);
        expect(depositos.procesarVencidos(AHORA + 31 * DIA)).toEqual([]);
        expect(dinero.banco("u-vence")).toBe(10300);
    });
});

describe("pantalla de /perfil", () => {
    test("sin depósito enseña los tres plazos y sus intereses", () => {
        conBanco("u-panel", 5000);
        const payload = panel.buildDeposito("u-panel", G);
        const ids = payload.components[0].toJSON().components.map((c) => c.custom_id);
        expect(ids).toEqual(["dinero_deposito_abrir_7", "dinero_deposito_abrir_30", "dinero_deposito_abrir_90", "dinero_panel"]);
        const labels = payload.components[0].toJSON().components.map((c) => c.label);
        expect(labels[0]).toBe("7 días · 1 %");
        expect(payload.embeds[0].toJSON().description).toContain("banco");
    });

    test("con depósito activo enseña el importe, el interés y el botón de cancelar", () => {
        conBanco("u-panel-activo", 10000);
        depositos.crear("u-panel-activo", G, 10000, 7);
        const embed = panel.buildDeposito("u-panel-activo", G).embeds[0].toJSON();
        expect(embed.fields.find((f) => f.name === "Importe").value).toContain("10.000");
        expect(embed.fields.find((f) => f.name === "Interés").value).toContain("100");
        expect(embed.fields.find((f) => f.name === "Al vencer").value).toContain("10.100");
        const ids = panel
            .buildDeposito("u-panel-activo", G)
            .components[0].toJSON()
            .components.map((c) => c.custom_id);
        expect(ids).toContain("dinero_deposito_cancelar");
    });

    test("la confirmación de cancelar avisa de lo que se pierde", () => {
        conBanco("u-confirma", 10000);
        depositos.crear("u-confirma", G, 10000, 7);
        const embed = panel.buildConfirmar("u-confirma", G).embeds[0].toJSON();
        expect(embed.title).toContain("Cancelar");
        expect(embed.description).toContain("pierdes **100**");
    });
});

describe("aviso por DM al vencer", () => {
    function clienteFalso(envia = true) {
        return {
            users: {
                fetch: jest.fn(async () => ({
                    send: jest.fn(async () => {
                        if (!envia) throw Object.assign(new Error("DMs cerrados"), { code: 50007 });
                    }),
                })),
            },
        };
    }

    test("paga los vencidos y manda un DM con lo que vuelve al banco", async () => {
        conBanco("u-dm", 10000);
        depositos.crear("u-dm", G, 10000, 7, AHORA);
        const client = clienteFalso();
        const pagados = await envios.procesarYAvisar(client, AHORA + 7 * DIA);
        expect(pagados).toHaveLength(1);
        expect(dinero.banco("u-dm")).toBe(10100);
        expect(client.users.fetch).toHaveBeenCalledWith("u-dm");
        expect(client.users.fetch.mock.results[0].value).toBeDefined();
    });

    test("con los DM cerrados el dinero vuelve igual", async () => {
        conBanco("u-dm-cerrado", 10000);
        depositos.crear("u-dm-cerrado", G, 10000, 7, AHORA);
        await expect(envios.procesarYAvisar(clienteFalso(false), AHORA + 7 * DIA)).resolves.toHaveLength(1);
        expect(dinero.banco("u-dm-cerrado")).toBe(10100);
    });
});

describe("formulario y panel admin", () => {
    test("el formulario de importe abre el depósito y repinta la pantalla", async () => {
        conBanco("u-modal", 10000);
        const i = {
            customId: "dinero_deposito_modal_7",
            guildId: G,
            user: { id: "u-modal", tag: "u-modal#0001" },
            fields: { getStringSelectValues: () => [], getTextInputValue: () => "5000" },
            update: jest.fn(async () => {}),
        };
        expect(await handleModal({}, i)).toBeUndefined();
        expect(depositos.estado("u-modal").importe).toBe(5000);
        expect(i.update.mock.calls[0][0].embeds[0].toJSON().title).toBe("📈 Depósito a plazo");
    });

    test("guarda los ajustes del depósito y los audita", async () => {
        const i = {
            customId: "paneladmin_cfg_economia_deposito_modal",
            guildId: G,
            user: { id: "admin" },
            fields: camposModal({ min: "500", max: "5000", pct7: "2", pct30: "4", pct90: "8" }),
            reply: jest.fn(async () => {}),
        };
        expect(await handleSettingsModal(i)).toBe(true);
        const cfg = guildSettings.getSettings(G).economia;
        expect(cfg.deposito_min).toBe(500);
        expect(cfg.deposito_max).toBe(5000);
        expect(cfg.deposito_pct_7).toBe(2);
        expect(cfg.deposito_pct_90).toBe(8);
        expect(db.prepare("SELECT action FROM admin_audit WHERE guildId = ? ORDER BY id DESC").get(G).action).toBe(
            "settings.economia.deposito.update",
        );
    });

    test("rechaza un máximo menor que el mínimo", async () => {
        const i = {
            customId: "paneladmin_cfg_economia_deposito_modal",
            guildId: G,
            user: { id: "admin" },
            fields: camposModal({ min: "5000", max: "500", pct7: "2", pct30: "4", pct90: "8" }),
            reply: jest.fn(async () => {}),
        };
        expect(await handleSettingsModal(i)).toBe(true);
        expect(i.reply.mock.calls[0][0].content).toContain("❌");
        expect(guildSettings.getSettings(G).economia.deposito_min).toBe(1000);
    });
});
