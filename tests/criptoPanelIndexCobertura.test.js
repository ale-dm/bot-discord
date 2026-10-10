// /cripto: el enrutado de pestañas (paneles/cripto/index): qué pantalla sale para cada pestaña, la pestaña por defecto
// y el repintado tras 💵 Sacar del banco. Las pantallas en sí tienen sus propios tests; aquí se comprueba el enrutado.
const { ButtonStyle } = require("discord.js");
const db = require("../src/core/db");
const dinero = require("../src/systems/dinero");
const graficos = require("../src/systems/cripto/graficos");
// El espía va antes de cargar el panel: el panel de mercado desestructura generateLineChart al cargarse.
jest.spyOn(graficos, "generateLineChart").mockResolvedValue(null);
const paneles = require("../src/paneles/cripto");
const mercadoPanel = require("../src/paneles/cripto/mercado");
const operar = require("../src/paneles/cripto/operar");
const comun = require("../src/paneles/cripto/comun");

const G = "guild-cripto-index";
let n = 0;
const usuario = (efectivo = 100000) => {
    const id = `cripto-index-${++n}`;
    dinero.asegurarCuenta(id);
    db.prepare("UPDATE banco SET enMano = ? WHERE userId = ?").run(efectivo, id);
    return id;
};
/** La pestaña marcada (la de estilo primario) de una pantalla. */
const pestanaActiva = (p) =>
    p.components
        .at(-1)
        .components.map((b) => b.data)
        .filter((b) => b.style === ButtonStyle.Primary)
        .map((b) => b.custom_id);
const titulo = (p) => p.embeds[0].data.title;

beforeEach(() => {
    db.prepare("UPDATE cripto_pool SET monedas = 1000000, ttcl = 10000 WHERE id = 1").run();
});

describe("pestana(): qué pantalla sale para cada pestaña", () => {
    test("mercado muestra la pantalla de mercado", async () => {
        const p = await paneles.pestana("mercado", usuario(), G);
        expect(titulo(p)).toBe("📈 Mercado de $TTCL");
        expect(pestanaActiva(p)).toEqual(["cripto_tab_mercado"]);
    });

    test("comprar muestra la pantalla de compra", async () => {
        const u = usuario();
        const p = await paneles.pestana("comprar", u, G);
        expect(p.components.flat().length).toBeGreaterThan(0);
        expect(p.components.some((f) => f.components.some((b) => b.data.custom_id === "cripto_comprar_modal"))).toBe(true);
        expect(pestanaActiva(p)).toEqual(["cripto_tab_comprar"]);
    });

    test("vender muestra la pantalla de venta", async () => {
        const p = await paneles.pestana("vender", usuario(), G);
        expect(p.embeds[0].data.description).toMatch(/No tienes \$TTCL/);
        expect(pestanaActiva(p)).toEqual(["cripto_tab_vender"]);
    });

    test("cartera muestra la cartera de quien mira", async () => {
        const p = await paneles.pestana("cartera", usuario(), G);
        expect(pestanaActiva(p)).toEqual(["cripto_tab_cartera"]);
    });

    test("historial muestra el historial", async () => {
        const p = await paneles.pestana("historial", usuario(), G);
        expect(pestanaActiva(p)).toEqual(["cripto_tab_historial"]);
    });

    test("una pestaña desconocida cae en mercado", async () => {
        const p = await paneles.pestana("no-existe", usuario(), G);
        expect(titulo(p)).toBe("📈 Mercado de $TTCL");
        expect(pestanaActiva(p)).toEqual(["cripto_tab_mercado"]);
    });
});

describe("repintar(): volver a la pantalla de origen tras 💵 Sacar del banco", () => {
    test("si venía de la confirmación de una compra, vuelve a esa confirmación con el importe", () => {
        const u = usuario();
        const p = paneles.repintar("cripto_comprar_ver_1000", u, G);
        expect(p.embeds[0].data.description).toMatch(/\*\*Pagas:\*\* 1010 monedas/);
        expect(p.components.at(-1).components[1].data.custom_id).toBe("cripto_tab_comprar");
    });

    test("en cualquier otro caso vuelve a la pantalla de comprar", () => {
        const u = usuario();
        const p = paneles.repintar("cripto_tab_comprar", u, G);
        expect(p.components.some((f) => f.components.some((b) => b.data.custom_id === "cripto_comprar_modal"))).toBe(true);
        expect(pestanaActiva(p)).toEqual(["cripto_tab_comprar"]);
    });
});

describe("reexportaciones del índice", () => {
    test("expone el mercado, los rangos, la compra y la venta de sus módulos", () => {
        expect(paneles.pantallaMercado).toBe(mercadoPanel.pantallaMercado);
        expect(paneles.RANGOS).toBe(mercadoPanel.RANGOS);
        expect(paneles.pantallaComprar).toBe(operar.pantallaComprar);
        expect(paneles.pantallaConfirmarCompra).toBe(operar.pantallaConfirmarCompra);
        expect(paneles.modalCompra).toBe(operar.modalCompra);
        expect(paneles.pantallaVender).toBe(operar.pantallaVender);
        expect(paneles.pantallaConfirmarVenta).toBe(operar.pantallaConfirmarVenta);
        expect(paneles.IMPORTES_COMPRA).toBe(operar.IMPORTES_COMPRA);
        expect(paneles.PORCENTAJES_VENTA).toBe(operar.PORCENTAJES_VENTA);
    });

    test("incluye las piezas comunes de formato", () => {
        expect(paneles.PESTANAS).toBe(comun.PESTANAS);
        expect(paneles.fmtMonedas).toBe(comun.fmtMonedas);
        expect(paneles.avisoTexto).toBe(comun.avisoTexto);
        expect(paneles.avisoTexto("")).toBe("");
        expect(paneles.avisoTexto("Listo")).toBe("Listo\n\n");
    });
});
