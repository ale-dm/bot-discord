// Paneles de /cripto que no necesitan precios de internet: selectores y resultado de compra/venta.
const paneles = require("../src/paneles/cripto");

test("están todos los paneles", () => {
    for (const f of [
        "buildMainPanel",
        "buildPreciosPanel",
        "buildCarteraPanel",
        "buildComprarSelect",
        "buildVenderSelect",
        "buildGraficoChart",
        "buildTopHolders",
        "buildHistorialPanel",
        "buildInfoPanel",
    ]) {
        expect(typeof paneles[f]).toBe("function");
    }
});

test("resultado de una compra y de una venta fallida", () => {
    const ok = paneles.buildResultadoCompra("TTCL", 1000, { ok: true, cantidad: 12.5, precio: 80, fee: 10 });
    expect(ok.embeds[0].data.title).toBe("✅ Compra realizada");
    expect(ok.embeds[0].data.description).toMatch(/Comisión: \*\*10 🪙\*\*/);
    expect(ok.components[0].components.map((b) => b.data.custom_id)).toEqual(["cripto_panel", "cripto_comprar"]);

    const mal = paneles.buildResultadoVenta("TTCL", { ok: false, msg: "No tienes TTCL" });
    expect(mal.embeds[0].data).toMatchObject({ title: "❌ Error", description: "No tienes TTCL" });
});

test("el selector de compra ofrece $TTCL", () => {
    const { components } = paneles.buildComprarSelect();
    expect(JSON.stringify(components[0].toJSON())).toMatch(/"value":"TTCL"/);
});
