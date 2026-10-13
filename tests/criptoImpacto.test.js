// #454: tope de impacto en el precio por operación (cripto.max_impacto_pct). Se mide sobre el precio del mercado antes y
// después. Una operación que lo supera no se ejecuta ni gasta cooldown, y la vista previa lo dice; una que cabe se ejecuta
// igual que siempre, con su comisión; con el tope sin configurar (0) todo sigue como antes.
const db = require("../src/core/db");
const dinero = require("../src/systems/dinero");
const guildSettings = require("../src/systems/guildSettings");
const mercado = require("../src/systems/cripto/mercado");
const operar = require("../src/paneles/cripto/operar");

const G = "guild-cripto-impacto";
let n = 0;
function cliente(efectivo) {
    const id = `impacto-${++n}`;
    dinero.pagar(id, efectivo);
    return id;
}
const ttclDe = (id) => db.prepare("SELECT cantidad FROM cripto_carteras WHERE userId = ? AND cripto = 'TTCL'").get(id)?.cantidad || 0;
const textoPantalla = (p) => p.embeds[0].toJSON().description;
const botonOk = (p) => p.components.flatMap((f) => f.toJSON().components).find((c) => /_ok_/.test(c.custom_id ?? ""));

beforeEach(() => {
    // Pool de 1.000.000 monedas y 10.000 TTCL (precio 100): 100.000 monedas lo suben ≈ 21 %, 10.000 ≈ 2 %.
    db.prepare("UPDATE cripto_pool SET monedas = 1000000, ttcl = 10000 WHERE id = 1").run();
    db.prepare("DELETE FROM cripto_carteras WHERE cripto = 'TTCL'").run();
    db.prepare("DELETE FROM action_limits WHERE guildId = ?").run(G);
    guildSettings.setSetting(G, "cripto.max_impacto_pct", 0);
    guildSettings.setSetting(G, "cripto.cooldown_buy_sec", 0);
    guildSettings.setSetting(G, "cripto.cooldown_sell_sec", 0);
});

describe("impactoDe", () => {
    test("es el % que se mueve el precio del mercado, y excede solo por encima del tope", () => {
        const cot = mercado.cotizarCompra(100000, 1);
        guildSettings.setSetting(G, "cripto.max_impacto_pct", 25);
        const dentro = mercado.impactoDe(G, cot);
        expect(dentro.impacto).toBeCloseTo(((cot.precioDespues - 100) / 100) * 100, 6);
        expect(dentro.excede).toBe(false);
        guildSettings.setSetting(G, "cripto.max_impacto_pct", 20);
        expect(mercado.impactoDe(G, cot).excede).toBe(true);
    });

    test("sin tope configurado nunca excede", () => {
        expect(mercado.impactoDe(G, mercado.cotizarCompra(500000, 1)).excede).toBe(false);
    });
});

describe("compra", () => {
    test("por encima del tope no se ejecuta: ni cobra, ni compra, ni gasta el cooldown, y el mensaje dice los porcentajes", async () => {
        guildSettings.setSetting(G, "cripto.max_impacto_pct", 5);
        guildSettings.setSetting(G, "cripto.cooldown_buy_sec", 600);
        const u = cliente(1_000_000);
        const antes = dinero.efectivo(u);
        const r = await mercado.ejecutarCompra(G, u, "TTCL", 100000);
        expect(r.ok).toBe(false);
        expect(r.msg).toMatch(/movería el precio un 21,\d\d % y el máximo por operación es 5,00 %/);
        expect(dinero.efectivo(u)).toBe(antes);
        expect(ttclDe(u)).toBe(0);
        expect(mercado.leerPool().monedas).toBe(1000000);

        // Bajando el importe sí entra, y el cooldown no se había gastado.
        const ok = await mercado.ejecutarCompra(G, u, "TTCL", 10000);
        expect(ok.ok).toBe(true);
    });

    test("dentro del tope se ejecuta igual que sin tope, con la misma comisión", async () => {
        const a = cliente(1_000_000);
        const sinTope = await mercado.ejecutarCompra(G, a, "TTCL", 10000);
        db.prepare("UPDATE cripto_pool SET monedas = 1000000, ttcl = 10000 WHERE id = 1").run();

        guildSettings.setSetting(G, "cripto.max_impacto_pct", 5);
        const b = cliente(1_000_000);
        const conTope = await mercado.ejecutarCompra(G, b, "TTCL", 10000);
        expect(conTope).toEqual(sinTope);
        expect(conTope.fee).toBe(100);
    });

    test("con el tope sin configurar, una compra enorme se ejecuta como hoy", async () => {
        const u = cliente(1_000_000);
        const r = await mercado.ejecutarCompra(G, u, "TTCL", 400000);
        expect(r.ok).toBe(true);
    });
});

describe("venta", () => {
    async function conCartera() {
        const u = cliente(1_000_000);
        guildSettings.setSetting(G, "cripto.max_impacto_pct", 0);
        await mercado.ejecutarCompra(G, u, "TTCL", 400000); // ≈ 2.857 TTCL, el pool queda en 1.404.000 y 7.143 TTCL
        return u;
    }

    test("vender de golpe lo que movería el precio por encima del tope se rechaza, y un porcentaje menor entra", async () => {
        const u = await conCartera();
        guildSettings.setSetting(G, "cripto.max_impacto_pct", 20);
        const tenencia = ttclDe(u);
        const rechazada = await mercado.ejecutarVenta(G, u, "TTCL", 100);
        expect(rechazada.ok).toBe(false);
        expect(rechazada.msg).toMatch(/Esta venta movería el precio/);
        expect(rechazada.msg).toContain("el porcentaje");
        expect(ttclDe(u)).toBe(tenencia);

        const permitida = await mercado.ejecutarVenta(G, u, "TTCL", 25);
        expect(permitida.ok).toBe(true);
        expect(ttclDe(u)).toBeCloseTo(tenencia * 0.75, 6);
    });

    test("con el tope sin configurar, vender todo funciona como hoy", async () => {
        const u = await conCartera();
        const r = await mercado.ejecutarVenta(G, u, "TTCL", 100);
        expect(r.ok).toBe(true);
    });
});

describe("la vista previa", () => {
    test("compra: avisa del tope, deshabilita Confirmar y muestra el precio de antes y después", () => {
        guildSettings.setSetting(G, "cripto.max_impacto_pct", 5);
        const u = cliente(1_000_000);
        const p = operar.pantallaConfirmarCompra(u, G, 100000);
        expect(textoPantalla(p)).toMatch(/❌ Esta compra movería el precio un 21,\d\d % y el máximo por operación es 5,00 %/);
        expect(textoPantalla(p)).toContain("Precio del mercado");
        expect(botonOk(p).disabled).toBe(true);

        const dentro = operar.pantallaConfirmarCompra(u, G, 10000);
        expect(textoPantalla(dentro)).not.toContain("❌");
        expect(botonOk(dentro).disabled).toBeFalsy();
    });

    test("venta: igual, con la sugerencia de bajar el porcentaje", async () => {
        const u = cliente(1_000_000);
        await mercado.ejecutarCompra(G, u, "TTCL", 400000);
        guildSettings.setSetting(G, "cripto.max_impacto_pct", 20);
        const p = operar.pantallaConfirmarVenta(u, G, 100);
        expect(textoPantalla(p)).toMatch(/❌ Esta venta movería el precio/);
        expect(botonOk(p).disabled).toBe(true);
        expect(botonOk(operar.pantallaConfirmarVenta(u, G, 25)).disabled).toBeFalsy();
    });

    test("sin tope, la vista previa es la de siempre", () => {
        const u = cliente(1_000_000);
        const p = operar.pantallaConfirmarCompra(u, G, 400000);
        expect(textoPantalla(p)).not.toContain("❌");
        expect(botonOk(p).disabled).toBeFalsy();
    });
});

describe("el panel admin del mercado (#454, #451)", () => {
    const { handleSettingsButton } = require("../src/adminPanel/settings/botones");
    const { handleSettingsModal } = require("../src/adminPanel/settings/modales");
    const { buildCriptoPanel } = require("../src/adminPanel/settings/vistas");
    const base = { guildId: G, guild: { id: G }, user: { id: "admin-imp", username: "admin", tag: "admin#0005" } };

    test("el formulario trae el impacto y el canal guardados, y al enviarlo se guardan (0 y vacío = sin tope y solo DM)", async () => {
        guildSettings.setSetting(G, "cripto.max_impacto_pct", 12);
        guildSettings.setSetting(G, "cripto.eventos_canal", "123456789012345678");
        const abre = { ...base, customId: "paneladmin_cfg_cripto_market", showModal: jest.fn(async () => {}) };
        expect(await handleSettingsButton(abre)).toBe(true);
        const json = abre.showModal.mock.calls[0][0].toJSON();
        const texto = json.components.flatMap((f) => f.components ?? []).find((c) => c.custom_id === "impacto");
        expect(texto.value).toBe("12");
        const canal = json.components.find((f) => f.component?.custom_id === "canal").component;
        expect(canal.default_values.map((d) => d.id)).toEqual(["123456789012345678"]);

        const envia = (impacto, canalId) => ({
            ...base,
            customId: "paneladmin_cfg_cripto_market_modal",
            fields: {
                getTextInputValue: (id) => ({ feeBuy: "1", feeSell: "1", impacto })[id],
                getSelectedChannels: () => (canalId ? new Map([[canalId, {}]]) : null),
            },
            reply: jest.fn(async () => {}),
        });
        expect(await handleSettingsModal(envia("7,5".replace(",", "."), "987654321098765432"))).toBe(true);
        let c = guildSettings.getSettings(G).cripto;
        expect([c.max_impacto_pct, c.eventos_canal]).toEqual([7.5, "987654321098765432"]);

        await handleSettingsModal(envia("", null));
        c = guildSettings.getSettings(G).cripto;
        expect([c.max_impacto_pct, c.eventos_canal]).toEqual([0, ""]);
    });

    test("el panel lo enseña", () => {
        guildSettings.setSetting(G, "cripto.max_impacto_pct", 9);
        guildSettings.setSetting(G, "cripto.eventos_canal", "555");
        const campo = buildCriptoPanel(G)
            .embeds[0].toJSON()
            .fields.find((f) => f.name === "Impacto y anuncios");
        expect(campo.value).toContain("**9 %**");
        expect(campo.value).toContain("<#555>");
    });
});
