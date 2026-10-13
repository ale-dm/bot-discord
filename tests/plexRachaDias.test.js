// #467: trofeos de Plex por ver algo varios días seguidos. La racha va por días de Madrid, un día sin nada la corta y
// cuenta la mejor de siempre (lo ganado no se pierde). También la condición `dias-seguidos N` de los trofeos de admin.
const db = require("../src/core/db");
const { rachaMasLarga, mejorRacha } = require("../src/systems/plexTrofeos/datosVistos");
const { parsearCondicion, evaluarCondicion, describirCondicion } = require("../src/systems/plexTrofeos/condiciones");
const { CATALOG } = require("../src/systems/logros/catalogo");

const G = "g-racha-dias";
const U = "racha-1";
let id = 900000;

/** Una reproducción a las `hora`:`minuto` (UTC) de un día de octubre de 2026. */
function ver(dia, hora = 18, minuto = 0) {
    db.prepare(
        `INSERT INTO plex_reproducciones (guildId, id, tautulliUserId, tipo, rating_key, titulo, inicio, segundos, visto)
         VALUES (?, ?, ?, 'movie', ?, 't', ?, 3600, 1)`,
    ).run(G, id++, U, `k${id}`, Date.UTC(2026, 9, dia, hora, minuto) / 1000);
}

beforeEach(() => db.prepare("DELETE FROM plex_reproducciones WHERE guildId = ?").run(G));

describe("rachaMasLarga", () => {
    test("cuenta días consecutivos, sin importar el orden ni los repetidos", () => {
        expect(rachaMasLarga(["2026-10-03", "2026-10-01", "2026-10-02", "2026-10-02"])).toBe(3);
        expect(rachaMasLarga([])).toBe(0);
    });

    test("un día sin nada corta la racha, pero se queda la mejor", () => {
        expect(rachaMasLarga(["2026-10-01", "2026-10-02", "2026-10-03", "2026-10-05"])).toBe(3);
    });

    test("cruza el cambio de mes", () => {
        expect(rachaMasLarga(["2026-09-30", "2026-10-01"])).toBe(2);
    });
});

describe("mejorRacha con el historial", () => {
    test("6 días seguidos no llegan a 7; con el séptimo sí", () => {
        for (let d = 1; d <= 6; d++) ver(d);
        expect(mejorRacha(G, U)).toBe(6);
        ver(7);
        expect(mejorRacha(G, U)).toBe(7);
    });

    test("una racha cortada no hace perder la de antes", () => {
        for (let d = 1; d <= 7; d++) ver(d);
        ver(10);
        ver(11);
        expect(mejorRacha(G, U)).toBe(7);
    });

    test("va por el calendario de Madrid: las 23:30 UTC ya son el día siguiente", () => {
        ver(1, 21); // 23:00 en Madrid (UTC+2): día 1
        ver(1, 22, 30); // 00:xx del día 2 en Madrid
        expect(mejorRacha(G, U)).toBe(2);
    });
});

describe("condición dias-seguidos de los trofeos de admin", () => {
    test("se escribe, se describe y se evalúa con la racha", () => {
        const p = parsearCondicion("dias-seguidos 7");
        expect(p.ok).toBe(true);
        expect(describirCondicion(p.cond)).toBe("Ve algo en Plex 7 días seguidos");
        expect(evaluarCondicion(p.cond, { diasSeguidos: 6 }, {})).toEqual({ progreso: 6, objetivo: 7 });
        expect(parsearCondicion("dias-seguidos").ok).toBe(false);
    });
});

test("el catálogo tiene los trofeos de 7 y 30 días con el contador de racha", () => {
    const racha = CATALOG.filter((a) => a.event === "plex_dias_seguidos");
    expect(racha.map((a) => [a.target, a.metric, a.category])).toEqual([
        [7, "max", "plex"],
        [30, "max", "plex"],
    ]);
});
