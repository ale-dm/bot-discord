// Competiciones de apuestas (#11): cada botón cabe en su fila (máximo 5 por fila de Discord), y las cuatro nuevas
// están en DEPORTES con su clave de The Odds API. Las claves se comprueban con scripts/competicionesOdds.js.
const { DEPORTES } = require("../src/services/oddsApi");
const { trozos, MAX_FILA } = require("../src/paneles/filas");
const { buildApuestasHome } = require("../src/adminPanel/apuestas");

test("trozos reparte en filas de 5 en orden", () => {
    expect(trozos([1, 2, 3, 4, 5, 6, 7])).toEqual([
        [1, 2, 3, 4, 5],
        [6, 7],
    ]);
    expect(trozos([1, 2, 3, 4, 5])).toEqual([[1, 2, 3, 4, 5]]);
    expect(trozos([])).toEqual([]);
    expect(MAX_FILA).toBe(5);
});

test("las competiciones tienen nombre, emoji y clave de la API", () => {
    expect(Object.keys(DEPORTES)).toEqual(["laliga", "premier", "champions", "mundial", "eurocopa", "copa_rey", "europa"]);
    for (const d of Object.values(DEPORTES)) {
        expect(d.name).toBeTruthy();
        expect(d.emoji).toBeTruthy();
        expect(d.apiKey).toMatch(/^soccer_/);
    }
});

test("el panel de paneladmin pone cada botón de crear quiniela en una fila de hasta 5", () => {
    const { components } = buildApuestasHome("g-comp");
    const filasCrear = components.slice(1, -1); // [acciones, ...crear, avisos]
    for (const fila of components) expect(fila.components.length).toBeLessThanOrEqual(5);
    const botones = filasCrear.flatMap((f) => f.components.map((b) => b.data.custom_id));
    expect(botones).toEqual(Object.keys(DEPORTES).map((k) => `paneladmin_apu_quiniela_${k}`));
});
