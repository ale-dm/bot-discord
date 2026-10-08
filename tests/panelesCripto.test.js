// Pestañas de /cripto (#121): la pantalla de cada pestaña, la vista previa antes de comprar o vender, los avisos y
// el repintado tras "💵 Sacar del banco". No toca internet: el precio sale de las reservas del pool.
const { ButtonStyle } = require("discord.js");
const db = require("../src/core/db");
const dinero = require("../src/systems/dinero");
const paneles = require("../src/paneles/cripto");
const cripto = require("../src/commands/economia/cripto");

const G = "guild-paneles-cripto";
let n = 0;
function nuevo(efectivo = 0) {
    const id = `panel-cripto-${++n}`;
    if (efectivo) dinero.pagar(id, efectivo);
    return id;
}
const botones = (p) => p.components.flatMap((fila) => fila.components.map((b) => b.data));
const ids = (p) => botones(p).map((b) => b.custom_id);
const pool = () => db.prepare("SELECT monedas, ttcl FROM cripto_pool WHERE id = 1").get();
const tener = (userId, cantidad) =>
    db
        .prepare(
            "INSERT INTO cripto_carteras (userId, cripto, cantidad) VALUES (?, 'TTCL', ?) ON CONFLICT(userId, cripto) DO UPDATE SET cantidad = excluded.cantidad",
        )
        .run(userId, cantidad);
/** Un clic en un botón de /cripto; devuelve la pantalla que se pintaría. */
async function clic(customId, userId) {
    let payload = null;
    await cripto.handleInteraction(null, {
        customId,
        user: { id: userId },
        guildId: G,
        update: async (p) => {
            payload = p;
        },
    });
    return payload;
}

beforeEach(() => {
    db.prepare("UPDATE cripto_pool SET monedas = 1000000, ttcl = 10000 WHERE id = 1").run();
    db.prepare("DELETE FROM cripto_carteras WHERE cripto = 'TTCL'").run();
    db.prepare("DELETE FROM cripto_historial WHERE cripto = 'TTCL'").run();
    db.prepare("DELETE FROM action_limits WHERE guildId = ?").run(G);
});

test("cada pantalla lleva la fila de pestañas y marca solo la pestaña actual", () => {
    const u = nuevo(100000);
    const casos = [
        [paneles.pantallaComprar(u, G), "cripto_tab_comprar"],
        [paneles.pantallaConfirmarCompra(u, G, 1000), "cripto_tab_comprar"],
        [paneles.pantallaVender(u, G), "cripto_tab_vender"],
    ];
    for (const [p, actual] of casos) {
        const tabs = p.components.at(-1).components;
        expect(tabs.map((b) => b.data.custom_id)).toEqual([
            "cripto_tab_mercado",
            "cripto_tab_comprar",
            "cripto_tab_vender",
            "cripto_tab_cartera",
            "cripto_tab_historial",
        ]);
        expect(tabs.filter((b) => b.data.style === ButtonStyle.Primary).map((b) => b.data.custom_id)).toEqual([actual]);
    }
});

test("ninguna pantalla tiene botones de criptos retiradas ni botones con el mismo nombre", async () => {
    const u = nuevo(100000);
    tener(u, 50);
    const pantallas = [
        paneles.pantallaComprar(u, G),
        paneles.pantallaConfirmarCompra(u, G, 5000),
        paneles.pantallaVender(u, G),
        paneles.pantallaConfirmarVenta(u, G, 50),
        await paneles.pantallaCartera(u),
        await paneles.pantallaHistorial(u, 0),
    ];
    for (const p of pantallas) {
        const labels = botones(p).map((b) => b.label);
        expect(labels.join(" ")).not.toMatch(/BTC|ETH|SOL|BNB|XRP|DOGE/);
        expect(new Set(labels).size).toBe(labels.length);
        expect(new Set(ids(p)).size).toBe(ids(p).length);
    }
});

test("comprar ofrece importes fijos y una cantidad libre", () => {
    const u = nuevo(100000);
    const ver = paneles.pantallaComprar(u, G).components[0].components.map((b) => b.data.custom_id);
    expect(ver).toEqual(paneles.IMPORTES_COMPRA.map((m) => `cripto_comprar_ver_${m}`));
    expect(ids(paneles.pantallaComprar(u, G))).toContain("cripto_comprar_modal");
});

test("la vista previa de una compra no mueve dinero ni pool, y muestra lo que pagas y recibes", () => {
    const u = nuevo(100000);
    const efectivo = dinero.efectivo(u);
    const antes = pool();

    const p = paneles.pantallaConfirmarCompra(u, G, 10000);

    expect(pool()).toEqual(antes);
    expect(dinero.efectivo(u)).toBe(efectivo);
    expect(p.embeds[0].data.description).toMatch(/Pagas:\*\* .*10.?100 monedas/);
    expect(p.embeds[0].data.description).toMatch(/Recibes:\*\* \S+ TTCL/);
    const confirmar = botones(p).find((b) => b.custom_id === "cripto_comprar_ok_10000");
    expect(confirmar.disabled).toBeFalsy();
});

test("sin efectivo, la compra no se puede confirmar y se ofrece sacar del banco si hay dinero ahí", () => {
    const u = nuevo(500);
    const sinBanco = paneles.pantallaConfirmarCompra(u, G, 10000);
    expect(botones(sinBanco).find((b) => b.custom_id === "cripto_comprar_ok_10000").disabled).toBe(true);
    expect(sinBanco.embeds[0].data.description).toMatch(/No te llega el efectivo/);
    expect(ids(sinBanco).some((id) => id.startsWith("dinero_sacar_"))).toBe(false);

    dinero.pagarBanco(u, 20000);
    const conBanco = paneles.pantallaConfirmarCompra(u, G, 10000);
    expect(ids(conBanco)).toContain("dinero_sacar_cripto_comprar_ver_10000");
});

test("confirmar una compra la ejecuta y vuelve a la pestaña Comprar con el aviso", async () => {
    const u = nuevo(100000);
    const p = await clic("cripto_comprar_ok_1000", u);
    expect(db.prepare("SELECT cantidad FROM cripto_carteras WHERE userId = ? AND cripto = 'TTCL'").get(u).cantidad).toBeGreaterThan(0);
    expect(p.embeds[0].data.description).toMatch(/✅ Compraste/);
    expect(p.components.at(-1).components[1].data.custom_id).toBe("cripto_tab_comprar");
});

test("vender sin TTCL no ofrece porcentajes", () => {
    const u = nuevo();
    const p = paneles.pantallaVender(u, G);
    expect(ids(p).some((id) => id.startsWith("cripto_vender_ver_"))).toBe(false);
    expect(p.embeds[0].data.description).toMatch(/No tienes \$TTCL/);
});

test("vender ofrece 25, 50 y 100 % y la vista previa dice que no hay impuestos", () => {
    const u = nuevo();
    tener(u, 100);
    const p = paneles.pantallaVender(u, G);
    expect(ids(p)).toEqual(expect.arrayContaining(["cripto_vender_ver_25", "cripto_vender_ver_50", "cripto_vender_ver_100"]));

    const previa = paneles.pantallaConfirmarVenta(u, G, 50);
    expect(previa.embeds[0].data.description).toMatch(/Impuestos:\*\* ninguno/);
    expect(botones(previa).find((b) => b.custom_id === "cripto_vender_ok_50").disabled).toBeFalsy();
});

test("una venta por debajo del mínimo no se puede confirmar", () => {
    const u = nuevo();
    tener(u, 0.5);
    const previa = paneles.pantallaConfirmarVenta(u, G, 100);
    expect(botones(previa).find((b) => b.custom_id === "cripto_vender_ok_100").disabled).toBe(true);
    expect(previa.embeds[0].data.description).toMatch(/La venta debe estar entre/);
});

test("confirmar una venta la ejecuta, cobra sin impuesto y vuelve a Vender con el aviso", async () => {
    const u = nuevo();
    tener(u, 100);
    const antes = dinero.efectivo(u);
    const p = await clic("cripto_vender_ok_100", u);
    expect(dinero.efectivo(u)).toBeGreaterThan(antes);
    expect(db.prepare("SELECT cantidad FROM cripto_carteras WHERE userId = ? AND cripto = 'TTCL'").get(u).cantidad).toBe(0);
    expect(p.embeds[0].data.description).toMatch(/✅ Vendiste/);
    expect(p.components.at(-1).components[2].data.custom_id).toBe("cripto_tab_vender");
});

test("la cartera muestra lo que tienes, el coste medio y la ganancia", async () => {
    const u = nuevo(100000);
    await clic("cripto_comprar_ok_1000", u);
    const p = await paneles.pantallaCartera(u);
    expect(p.embeds[0].data.description).toMatch(/Tienes:\*\*/);
    expect(p.embeds[0].data.description).toMatch(/Coste medio:/);
    expect(p.embeds[0].data.description).toMatch(/Ganancia sin vender/);
});

test("la cartera vacía lo dice", async () => {
    const p = await paneles.pantallaCartera(nuevo());
    expect(p.embeds[0].data.description).toMatch(/No tienes \$TTCL/);
});

test("el historial lista compras y ventas y pagina", async () => {
    const u = nuevo(100000);
    expect(paneles.pantallaHistorial(u, 0)).toBeDefined();
    expect((await paneles.pantallaHistorial(u, 0)).embeds[0].data.description).toMatch(/Todavía no has comprado/);

    await clic("cripto_comprar_ok_1000", u);
    await clic("cripto_comprar_ok_5000", u);
    const p = await paneles.pantallaHistorial(u, 0);
    expect(p.embeds[0].data.description).toMatch(/🟢 Compra/);
    expect(p.embeds[0].data.footer.text).toMatch(/Página 1 de 1 · 2 operaciones/);
});

test("el importe escrito en el modal pasa por la vista previa; lo que no es un número se rechaza", async () => {
    const u = nuevo(100000);
    const enviar = async (texto) => {
        let payload = null;
        await cripto.handleModal(null, {
            customId: "cripto_modal_comprar",
            user: { id: u },
            guildId: G,
            fields: { getTextInputValue: () => texto },
            update: async (p) => {
                payload = p;
            },
        });
        return payload;
    };
    expect((await enviar("2.500")).embeds[0].data.description).toMatch(/Vas a invertir \*\*2.?500 monedas/);
    expect((await enviar("abc")).embeds[0].data.description).toMatch(/Escribe un número entero/);
});

test("el repintado tras sacar del banco vuelve a la pantalla de origen", () => {
    const u = nuevo(100000);
    expect(paneles.repintar("cripto_comprar_ver_1000", u, G).embeds[0].data.title).toBe("🛒 Confirmar compra");
    expect(paneles.repintar("cripto_tab_comprar", u, G).embeds[0].data.title).toMatch(/Comprar/);
});
