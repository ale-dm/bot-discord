// 🛡️ Seguro antirrobo (#526): compra, cobro del dinero gastable, cooldown, renovación, tope, caducidad,
// protección en /robar, DM de la víctima, pantalla de /perfil y ajustes del panel admin.
process.env.ROBAR_COOLDOWN_SEC = "7200";
process.env.ROBAR_MIN_VICTIMA = "150";
process.env.ROBAR_PROB_EXITO = "0.65";
process.env.ROBAR_BASE_MIN = "50";
process.env.ROBAR_BASE_MAX = "150";
process.env.ROBAR_BONUS_NIVEL = "2";
process.env.ROBAR_MULTA_MIN = "30";
process.env.ROBAR_MULTA_MAX = "80";

const db = require("../src/core/db");
const dinero = require("../src/systems/dinero");
const seguro = require("../src/systems/seguroAntirrobo");
const guildSettings = require("../src/systems/guildSettings");
const { robar, textoAvisoVictima } = require("../src/systems/robar");
const panel = require("../src/paneles/seguroAntirrobo");
const { handleSettingsButton } = require("../src/adminPanel/settings/botones");
const { handleSettingsModal } = require("../src/adminPanel/settings/modales");

const G = "g-seguro";
const AHORA = Date.UTC(2026, 0, 1);
const HORA = 60 * 60 * 1000;

beforeEach(() => {
    db.prepare("DELETE FROM seguros_antirrobo").run();
    db.prepare("DELETE FROM banco").run();
    db.prepare("DELETE FROM historial").run();
    db.prepare("DELETE FROM robos_cooldown").run();
    db.prepare("DELETE FROM xp_users WHERE guildId = ?").run(G);
    db.prepare("DELETE FROM guild_settings WHERE guildId = ?").run(G);
    db.prepare("DELETE FROM admin_audit WHERE guildId = ?").run(G);
    guildSettings.invalidarAjustes(G);
});

afterEach(() => jest.restoreAllMocks());

/** Deja a alguien con exactamente `n` de efectivo (la cuenta empieza con 1000). */
function conEfectivo(userId, n) {
    const actual = dinero.efectivo(userId);
    if (actual > 0) dinero.cobrar(userId, actual);
    dinero.pagar(userId, n);
}

function configurar(extra = {}) {
    guildSettings.setManySettings(G, {
        "economia.seguro_precio": 2000,
        "economia.seguro_horas": 24,
        "economia.seguro_cooldown_h": 1,
        "economia.seguro_tope_dias": 7,
        ...extra,
    });
}

function camposModal(valores) {
    return { getTextInputValue: (id) => valores[id] };
}

describe("comprar el seguro", () => {
    test("cobra la prima y deja el seguro activo con su vencimiento", () => {
        conEfectivo("u-compra", 5000);
        const r = seguro.comprar("u-compra", G, AHORA);
        expect(r.ok).toBe(true);
        expect(r.precio).toBe(2000);
        expect(r.extendido).toBe(false);
        expect(dinero.efectivo("u-compra")).toBe(3000);
        const e = seguro.estado("u-compra", AHORA);
        expect(e.activo).toBe(true);
        expect(e.vencimiento).toBe(AHORA + 24 * HORA);
        expect(db.prepare("SELECT tipo, cantidad FROM historial WHERE userId = ? ORDER BY id DESC").get("u-compra")).toMatchObject({
            tipo: "seguro",
            cantidad: -2000,
        });
    });

    test("tira primero del dinero negro, como la tienda", () => {
        conEfectivo("u-negro", 1000);
        dinero.pagarNegro("u-negro", 1500);
        expect(seguro.comprar("u-negro", G, AHORA).ok).toBe(true);
        expect(dinero.negro("u-negro")).toBe(0);
        expect(dinero.efectivo("u-negro")).toBe(500);
    });

    test("sin dinero gastable no compra ni apunta nada", () => {
        conEfectivo("u-pobre", 100);
        const r = seguro.comprar("u-pobre", G, AHORA);
        expect(r).toMatchObject({ ok: false, motivo: "saldo" });
        expect(seguro.estado("u-pobre", AHORA).activo).toBe(false);
        expect(db.prepare("SELECT COUNT(*) AS n FROM historial WHERE userId = ?").get("u-pobre").n).toBe(0);
    });

    test("no deja comprar dos veces seguidas: cooldown de una hora", () => {
        conEfectivo("u-cd", 5000);
        expect(seguro.comprar("u-cd", G, AHORA).ok).toBe(true);
        const r = seguro.comprar("u-cd", G, AHORA + 30 * 60 * 1000);
        expect(r).toMatchObject({ ok: false, motivo: "cooldown" });
        expect(r.retrySeconds).toBe(1800);
        expect(dinero.efectivo("u-cd")).toBe(3000);
    });

    test("renovar extiende desde el vencimiento, no desde ahora", () => {
        configurar({ "economia.seguro_cooldown_h": 0 });
        conEfectivo("u-renueva", 5000);
        seguro.comprar("u-renueva", G, AHORA);
        const r = seguro.comprar("u-renueva", G, AHORA + 2 * HORA);
        expect(r.ok).toBe(true);
        expect(r.extendido).toBe(true);
        expect(seguro.estado("u-renueva", AHORA).vencimiento).toBe(AHORA + 48 * HORA);
    });

    test("no pasa del tope de días por delante", () => {
        configurar({ "economia.seguro_cooldown_h": 0, "economia.seguro_tope_dias": 1 });
        conEfectivo("u-tope", 9000);
        expect(seguro.comprar("u-tope", G, AHORA).ok).toBe(true);
        const r = seguro.comprar("u-tope", G, AHORA + 2 * HORA);
        expect(r).toMatchObject({ ok: false, motivo: "tope" });
        expect(dinero.efectivo("u-tope")).toBe(7000);
    });

    test("caduca solo y deja de estar activo", () => {
        conEfectivo("u-caduca", 2000);
        seguro.comprar("u-caduca", G, AHORA);
        expect(seguro.estado("u-caduca", AHORA + 24 * HORA).activo).toBe(false);
    });

    test("acepta precio y duración configurados en el servidor", () => {
        configurar({ "economia.seguro_precio": 500, "economia.seguro_horas": 2 });
        conEfectivo("u-config", 2000);
        const r = seguro.comprar("u-config", G, AHORA);
        expect(r.ok).toBe(true);
        expect(r.precio).toBe(500);
        expect(seguro.estado("u-config", AHORA).vencimiento).toBe(AHORA + 2 * HORA);
        expect(dinero.efectivo("u-config")).toBe(1500);
    });
});

describe("protección en /robar", () => {
    function victimaProtegida(userId = "victima-seguro") {
        configurar({ "economia.seguro_precio": 500 });
        conEfectivo(userId, 1000);
        seguro.comprar(userId, G); // con el reloj real, que es el que usa /robar
        return userId;
    }

    test("con el seguro activo, el golpe puede fallar del todo y se queda sin botín", () => {
        const victima = victimaProtegida();
        conEfectivo("ladron-fallo", 1000);
        jest.spyOn(Math, "random").mockReturnValueOnce(0).mockReturnValueOnce(0.1).mockReturnValueOnce(0);
        const r = robar(G, "ladron-fallo", victima);
        expect(r).toMatchObject({ ok: true, exito: false, multa: 30, seguro: "fallo" });
        expect(dinero.efectivo(victima)).toBe(500);
        expect(dinero.negro("ladron-fallo")).toBe(0);
    });

    test("si el seguro no frena el golpe, el botín se queda en la mitad", () => {
        const victima = victimaProtegida();
        conEfectivo("ladron-mitad", 0);
        jest.spyOn(Math, "random").mockReturnValueOnce(0).mockReturnValueOnce(0.9).mockReturnValueOnce(0);
        const r = robar(G, "ladron-mitad", victima);
        expect(r).toMatchObject({ ok: true, exito: true, cantidad: 25, seguro: "reducido" });
        expect(dinero.efectivo(victima)).toBe(475);
        expect(dinero.negro("ladron-mitad")).toBe(25);
    });

    test("sin seguro el robo sigue igual", () => {
        conEfectivo("victima-sin", 1000);
        conEfectivo("ladron-sin", 0);
        jest.spyOn(Math, "random").mockReturnValueOnce(0).mockReturnValueOnce(0);
        const r = robar(G, "ladron-sin", "victima-sin");
        expect(r).toMatchObject({ ok: true, exito: true, cantidad: 50, seguro: null });
    });

    test("el aviso a la víctima le cuenta lo que ha hecho el seguro, sin decir quién ha sido", () => {
        expect(textoAvisoVictima({ ok: true, exito: true, cantidad: 25, seguro: "reducido" })).toBe(
            "🥷 Alguien te ha robado **25** 🪙 en efectivo. Tu 🛡️ seguro antirrobo ha reducido el golpe a la mitad.",
        );
        expect(textoAvisoVictima({ ok: true, exito: false, multa: 30, seguro: "fallo" })).toBe(
            "🛡️ Alguien ha intentado robarte y le ha salido mal. Tu 🛡️ seguro antirrobo ha hecho que el golpe fallara.",
        );
    });
});

describe("pantalla del seguro en /perfil", () => {
    test("sin seguro enseña el precio, la duración y el botón de comprar", () => {
        conEfectivo("u-panel", 5000);
        const payload = panel.buildSeguro("u-panel", G);
        const embed = payload.embeds[0].toJSON();
        expect(embed.title).toBe("🛡️ Seguro antirrobo");
        expect(embed.fields.find((f) => f.name === "Estado").value).toBe("Sin seguro");
        const boton = payload.components[0].toJSON().components.find((c) => c.custom_id === "dinero_seguro_comprar");
        expect(boton.label).toBe("🛡️ Comprar seguro");
        expect(boton.disabled).toBe(false);
    });

    test("con el seguro activo enseña hasta cuándo y deja renovar", () => {
        conEfectivo("u-panel-activo", 5000);
        seguro.comprar("u-panel-activo", G);
        const payload = panel.buildSeguro("u-panel-activo", G, "✅ Seguro activo.");
        const embed = payload.embeds[0].toJSON();
        expect(embed.description).toContain("✅ Seguro activo.");
        expect(embed.fields.find((f) => f.name === "Estado").value).toContain("Activo hasta");
        const boton = payload.components[0].toJSON().components.find((c) => c.custom_id === "dinero_seguro_comprar");
        expect(boton.label).toBe("🔁 Renovar seguro");
    });

    test("sin dinero gastable el botón de comprar sale desactivado", () => {
        conEfectivo("u-panel-pobre", 0);
        const boton = panel
            .buildSeguro("u-panel-pobre", G)
            .components[0].toJSON()
            .components.find((c) => c.custom_id === "dinero_seguro_comprar");
        expect(boton.disabled).toBe(true);
    });
});

describe("ajustes en el panel admin", () => {
    test("Config Global abre el panel de economía del seguro", async () => {
        const i = { customId: "paneladmin_cfg_economia", guildId: G, update: jest.fn(async () => {}) };
        expect(await handleSettingsButton(i)).toBe(true);
        expect(i.update.mock.calls[0][0].embeds[0].toJSON().title).toBe("🛡️ Economía");
    });

    test("el botón de editar abre el formulario con los valores actuales", async () => {
        configurar({ "economia.seguro_precio": 750 });
        const i = { customId: "paneladmin_cfg_economia_seguro_edit", guildId: G, showModal: jest.fn(async () => {}) };
        expect(await handleSettingsButton(i)).toBe(true);
        const modal = i.showModal.mock.calls[0][0].toJSON();
        expect(modal.custom_id).toBe("paneladmin_cfg_economia_seguro_modal");
        expect(JSON.stringify(modal.components)).toContain("750");
    });

    test("guarda los cuatro ajustes y los audita", async () => {
        const i = {
            customId: "paneladmin_cfg_economia_seguro_modal",
            guildId: G,
            user: { id: "admin" },
            fields: camposModal({ precio: "1500", horas: "12", cooldown: "2", tope: "3" }),
            reply: jest.fn(async () => {}),
        };
        expect(await handleSettingsModal(i)).toBe(true);
        const cfg = guildSettings.getSettings(G).economia;
        expect(cfg.seguro_precio).toBe(1500);
        expect(cfg.seguro_horas).toBe(12);
        expect(cfg.seguro_cooldown_h).toBe(2);
        expect(cfg.seguro_tope_dias).toBe(3);
        expect(db.prepare("SELECT action FROM admin_audit WHERE guildId = ? ORDER BY id DESC").get(G).action).toBe(
            "settings.economia.update",
        );
    });

    test("rechaza valores fuera de rango sin guardar", async () => {
        const i = {
            customId: "paneladmin_cfg_economia_seguro_modal",
            guildId: G,
            user: { id: "admin" },
            fields: camposModal({ precio: "0", horas: "12", cooldown: "2", tope: "3" }),
            reply: jest.fn(async () => {}),
        };
        expect(await handleSettingsModal(i)).toBe(true);
        expect(i.reply.mock.calls[0][0].content).toContain("❌");
        expect(guildSettings.getSettings(G).economia.seguro_precio).toBe(2000);
    });
});
