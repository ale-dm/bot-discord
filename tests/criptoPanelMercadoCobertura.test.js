// Pestaña 📈 Mercado de /cripto (paneles/cripto/mercado): precio, pool, circulación, último evento, quién tiene más
// TTCL, la gráfica con su rango y el aviso cuando aún no hay historial. La gráfica (ECharts) se sustituye por un espía
// que devuelve un PNG falso o nada; así no se renderiza nada y se puede fijar qué rango pide cada botón.
const { ButtonStyle, AttachmentBuilder } = require("discord.js");
const db = require("../src/core/db");
const graficos = require("../src/systems/cripto/graficos");
// El espía va antes de cargar el panel: mercado.js desestructura generateLineChart al cargarse.
const grafico = jest.spyOn(graficos, "generateLineChart");
const { pantallaMercado, RANGOS } = require("../src/paneles/cripto/mercado");

const G = "guild-mercado-panel";
let n = 0;
const campo = (p, nombre) => p.embeds[0].data.fields.find((f) => f.name === nombre)?.value;

function fijarPool(monedas, ttcl) {
    db.prepare("UPDATE cripto_pool SET monedas = ?, ttcl = ? WHERE id = 1").run(monedas, ttcl);
}
function tener(userId, cantidad) {
    db.prepare("INSERT INTO cripto_carteras (userId, cripto, cantidad) VALUES (?, 'TTCL', ?)").run(userId, cantidad);
}
function evento({ direccion, porcentaje, aplicado_en }) {
    const dia = `2099-01-${String(++n).padStart(2, "0")}`;
    db.prepare("INSERT INTO cripto_eventos (dia, minuto, direccion, porcentaje, aplicado_en) VALUES (?, 600, ?, ?, ?)").run(
        dia,
        direccion,
        porcentaje,
        aplicado_en,
    );
}

beforeEach(() => {
    grafico.mockReset();
    grafico.mockResolvedValue(null);
    fijarPool(1000000, 10000);
    db.prepare("DELETE FROM cripto_carteras WHERE cripto = 'TTCL'").run();
    db.prepare("DELETE FROM cripto_eventos").run();
});

describe("cifras de la pestaña", () => {
    test("muestra el precio (monedas por TTCL), el TTCL en carteras y el pool", async () => {
        fijarPool(200000, 1000);
        tener("ttcl-a", 300);
        tener("ttcl-b", 100);
        const p = await pantallaMercado(G);
        expect(p.embeds[0].data.description).toMatch(/Precio:\*\* 200\.00 monedas · \*\*En carteras:\*\* 400\.00 TTCL/);
        expect(campo(p, "💧 Pool")).toMatch(/200\D?000 monedas · 1000\.00 TTCL/);
    });

    test("el pie recuerda que la comisión se queda en el pool", async () => {
        const p = await pantallaMercado(G);
        expect(p.embeds[0].data.footer.text).toMatch(/Comisión de compra y venta: se queda en el pool/);
    });
});

describe("último evento del mercado", () => {
    test("sin eventos, lo dice", async () => {
        const p = await pantallaMercado(G);
        expect(campo(p, "📰 Último evento")).toBe("Todavía no ha habido ninguno.");
    });

    test("una subida muestra el porcentaje con flecha hacia arriba", async () => {
        evento({ direccion: "subida", porcentaje: 5, aplicado_en: Date.now() });
        const p = await pantallaMercado(G);
        expect(campo(p, "📰 Último evento")).toMatch(/^📈 Sube un \*\*5 %\*\* · /);
    });

    test("cuenta el evento más reciente (por fecha de aplicación), no el último insertado", async () => {
        evento({ direccion: "bajada", porcentaje: 3, aplicado_en: 2000 });
        evento({ direccion: "subida", porcentaje: 4, aplicado_en: 1000 });
        const p = await pantallaMercado(G);
        expect(campo(p, "📰 Último evento")).toMatch(/^📉 Baja un \*\*3 %\*\*/);
    });
});

describe("quién tiene más TTCL", () => {
    test("sin nadie con TTCL, lo dice", async () => {
        const p = await pantallaMercado(G);
        expect(campo(p, "👥 Quién tiene más")).toBe("Nadie todavía.");
    });

    test("ordena de mayor a menor, sin contar a quien tiene 0", async () => {
        tener("tenedor-pequeno", 100);
        tener("tenedor-grande", 500);
        tener("tenedor-medio", 300);
        tener("tenedor-cero", 0);
        const p = await pantallaMercado(G);
        expect(campo(p, "👥 Quién tiene más")).toBe(
            "1. <@tenedor-grande> · 500.00 TTCL\n2. <@tenedor-medio> · 300.00 TTCL\n3. <@tenedor-pequeno> · 100.00 TTCL",
        );
    });

    test("muestra como mucho los cinco primeros", async () => {
        for (let i = 1; i <= 6; i++) tener(`muchos-${i}`, i * 10);
        const p = await pantallaMercado(G);
        const lineas = campo(p, "👥 Quién tiene más").split("\n");
        expect(lineas).toHaveLength(5);
        expect(lineas[0]).toBe("1. <@muchos-6> · 60.00 TTCL");
    });
});

describe("gráfica y rangos", () => {
    test("por defecto pide la gráfica de 7 días y marca ese botón", async () => {
        const p = await pantallaMercado(G);
        expect(grafico).toHaveBeenCalledWith("TTCL", 7, "$TTCL — 7 días", "#9b59b6");
        const rangos = p.components[0].components.map((b) => b.data);
        expect(rangos.map((b) => b.custom_id)).toEqual(RANGOS.map((r) => `cripto_rango_${r.dias}`));
        expect(rangos.filter((b) => b.style === ButtonStyle.Primary).map((b) => b.custom_id)).toEqual(["cripto_rango_7"]);
    });

    test("el rango 30 días pide su gráfica y marca su botón", async () => {
        const p = await pantallaMercado(G, 30);
        expect(grafico).toHaveBeenCalledWith("TTCL", 30, "$TTCL — 30 días", "#9b59b6");
        const marcado = p.components[0].components.map((b) => b.data).filter((b) => b.style === ButtonStyle.Primary);
        expect(marcado.map((b) => b.custom_id)).toEqual(["cripto_rango_30"]);
    });

    test("un rango que no existe vuelve a 7 días", async () => {
        const p = await pantallaMercado(G, 3);
        expect(grafico).toHaveBeenCalledWith("TTCL", 7, "$TTCL — 7 días", "#9b59b6");
        const rangos = p.components[0].components.map((b) => b.data);
        expect(rangos.filter((b) => b.style === ButtonStyle.Primary).map((b) => b.custom_id)).toEqual(["cripto_rango_7"]);
    });

    test("con gráfica, la adjunta como mercado.png y la muestra en el embed", async () => {
        grafico.mockResolvedValueOnce(Buffer.from("png-falso"));
        const p = await pantallaMercado(G, 365);
        expect(p.files).toHaveLength(1);
        expect(p.files[0]).toBeInstanceOf(AttachmentBuilder);
        expect(p.files[0].name).toBe("mercado.png");
        expect(p.embeds[0].data.image.url).toBe("attachment://mercado.png");
        expect(p.embeds[0].data.fields.map((f) => f.name)).not.toContain("📊 Gráfica");
        expect(grafico).toHaveBeenCalledWith("TTCL", 365, "$TTCL — Todo", "#9b59b6");
    });

    test("sin historial suficiente, no hay imagen y avisa en su lugar", async () => {
        const p = await pantallaMercado(G);
        expect(p.files).toEqual([]);
        expect(p.embeds[0].data.image).toBeUndefined();
        expect(campo(p, "📊 Gráfica")).toBe("Todavía no hay suficiente historial para dibujarla.");
    });

    test("el color del embed es el de TTCL", async () => {
        const p = await pantallaMercado(G);
        expect(p.embeds[0].data.color).toBe(0x9b59b6);
    });
});

test("la pestaña Mercado va marcada en la fila de pestañas", async () => {
    const p = await pantallaMercado(G);
    const pestanas = p.components.at(-1).components.map((b) => b.data);
    expect(pestanas.filter((b) => b.style === ButtonStyle.Primary).map((b) => b.custom_id)).toEqual(["cripto_tab_mercado"]);
});
