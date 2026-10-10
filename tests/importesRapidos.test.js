// Formularios de cantidad de los jugadores (#309, grupo G5): el desplegable de importes manda si se elige uno; si se
// elige «Otra cantidad» o no se elige nada, manda el texto. Sin nada, NaN, y cada manejador ya rechaza eso.
const { ComponentType } = require("discord.js");
const { filasImporte, importeElegido, IMPORTES_RAPIDOS } = require("../src/paneles/importes");

const campos = (seleccion, texto = "") => ({
    getStringSelectValues: (id) => (id === "importe" && seleccion ? [seleccion] : null),
    getTextInputValue: (id) => (id === "cantidad" ? texto : ""),
});

describe("importeElegido", () => {
    test("un importe del desplegable manda sobre el texto", () => {
        expect(importeElegido(campos("500", "9999"))).toBe(500);
    });

    test("«Otra cantidad» o nada elegido: manda el texto, con puntos y espacios quitados", () => {
        expect(importeElegido(campos("otra", "1.250"))).toBe(1250);
        expect(importeElegido(campos(null, " 300 "))).toBe(300);
    });

    test("sin importe ni texto: NaN, para que el manejador lo rechace con su mensaje", () => {
        expect(importeElegido(campos(null, ""))).toBeNaN();
        expect(importeElegido(campos("otra", "   "))).toBeNaN();
    });

    test("un texto que no es número llega como NaN", () => {
        expect(importeElegido(campos(null, "abc"))).toBeNaN();
    });
});

describe("filasImporte", () => {
    test("un desplegable de importes habituales y un texto opcional debajo", () => {
        const [desplegable, texto] = filasImporte({ textoEtiqueta: "Otra cantidad (10-1000)", placeholder: "Ejemplo: 100" }).map((f) =>
            f.toJSON(),
        );
        expect(desplegable.type).toBe(ComponentType.Label);
        expect(desplegable.component.custom_id).toBe("importe");
        expect(desplegable.component.required).toBe(false);
        expect(desplegable.component.options.map((o) => o.value)).toEqual([...IMPORTES_RAPIDOS.map(String), "otra"]);
        expect(texto.components[0].custom_id).toBe("cantidad");
        expect(texto.components[0].required).toBe(false);
        expect(texto.components[0].label).toBe("Otra cantidad (10-1000)");
    });

    test("«Todo» aparece solo si hay algo y no es ya un importe habitual", () => {
        const valores = (todo) =>
            filasImporte({ textoEtiqueta: "x", todo })[0]
                .toJSON()
                .component.options.map((o) => o.value);
        expect(valores(1234)).toContain("1234");
        expect(valores(500).filter((v) => v === "500")).toHaveLength(1);
        expect(valores(0)).not.toContain("0");
    });
});
