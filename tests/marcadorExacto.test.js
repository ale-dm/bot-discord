// Apuesta al marcador exacto (F-AP-10, issue #7): premio fijo ×8 sin cuota de la API. Se apuesta con el botón y el
// formulario de verdad, y se liquida con la Odds API simulada (ninguna petición real).
process.env.ODDS_API_KEY = "clave-de-prueba";

const db = require("../src/core/db");
const dinero = require("../src/systems/dinero");
const marcador = require("../src/systems/apuestas/marcador");
const apuestas = require("../src/juegos/apuestas/apuestas");
const { liquidarApuestas } = require("../src/systems/apuestas/liquidacion");
const { buildMisJugadas } = require("../src/paneles/misJugadas");

const futuro = (h) => new Date(Date.now() + h * 3600 * 1000).toISOString();
const pasado = (h) => new Date(Date.now() - h * 3600 * 1000).toISOString();

// La API de resultados (y la de escudos, que el detalle del partido pide al abrirlo) simuladas.
let resultadosApi = [];
beforeEach(() => {
    global.fetch = jest.fn(async (url) => {
        if (/thesportsdb/.test(url)) return { json: async () => ({ teams: null }) };
        return { ok: true, headers: new Map([["x-requests-remaining", "400"]]), json: async () => resultadosApi };
    });
});

db.prepare(
    "INSERT INTO apuestas_partidos (match_id, home_team, away_team, start_time, estado, deporte, cuota_home, cuota_draw, cuota_away) VALUES ('mx-1', 'Celta', 'Alavés', ?, 'abierto', 'laliga', 2, 3, 4)",
).run(futuro(5));
db.prepare("INSERT INTO banco (userId, saldo, enMano) VALUES ('ana', 0, 1000), ('luis', 0, 1000)").run();

const interaccion = (extra = {}) => ({
    user: { id: "ana", tag: "ana", username: "ana" },
    guildId: "g",
    reply: jest.fn(async () => {}),
    update: jest.fn(async () => {}),
    showModal: jest.fn(async () => {}),
    ...extra,
});
const respuesta = (i) => {
    const e = i.reply.mock.calls[0][0].embeds[0].data;
    return `${e.title} ${e.description}`;
};
async function apostarMarcador(user, local, visitante, cantidad) {
    const campos = { goles_local: String(local), goles_visitante: String(visitante), cantidad: String(cantidad) };
    const i = interaccion({
        user: { id: user, tag: user },
        customId: "apuestas_modal_exacto_mx-1",
        fields: { getTextInputValue: (k) => campos[k] },
    });
    await apuestas.handleModal(null, i);
    return respuesta(i);
}

test("la elección se guarda como exacto_L-V y solo acierta con ese marcador", () => {
    expect(marcador.eleccion(2, 1)).toBe("exacto_2-1");
    expect(marcador.marcadorDe("exacto_2-1")).toBe("2-1");
    expect(marcador.marcadorDe("home")).toBeNull();
    expect(marcador.acierta("exacto_2-1", "home", "2-1")).toBe(true);
    expect(marcador.acierta("exacto_2-1", "home", "3-1")).toBe(false);
    expect(marcador.acierta("exacto_1-2", "away", "2-1")).toBe(false);
    // Las normales siguen yendo por el resultado.
    expect(marcador.acierta("home", "home", "3-0")).toBe(true);
    expect(marcador.acierta("draw", "home", "3-0")).toBe(false);
    expect([0, 7, 20].map((n) => marcador.golesValidos(String(n)))).toEqual([0, 7, 20]);
    expect(["", "-1", "21", "1.5", "dos", " 3 "].map(marcador.golesValidos)).toEqual([null, null, null, null, null, 3]);
});

test("el detalle del partido tiene el botón y abre un formulario con los goles de cada equipo", async () => {
    const detalle = interaccion({ customId: "apuestas_select_partido", values: ["mx-1"] });
    await apuestas.handleSelectMenu(null, detalle);
    const payload = detalle.reply.mock.calls[0][0];
    expect(payload.embeds[0].data.description).toMatch(/Marcador exacto\*\*: premio fijo de `×8`/);
    const botones = payload.components[0].toJSON().components;
    expect(botones.map((b) => b.custom_id)).toEqual(["apuesta_home_mx-1", "apuesta_draw_mx-1", "apuesta_away_mx-1", "apuesta_exacto_mx-1"]);

    const boton = interaccion({ customId: "apuesta_exacto_mx-1" });
    await apuestas.handleButton(null, boton);
    const modal = boton.showModal.mock.calls[0][0].toJSON();
    expect(modal.custom_id).toBe("apuestas_modal_exacto_mx-1");
    expect(modal.title).toBe("🎯 Marcador exacto (×8)");
    expect(modal.components.map((r) => [r.components[0].custom_id, r.components[0].label])).toEqual([
        ["goles_local", "Goles de Celta"],
        ["goles_visitante", "Goles de Alavés"],
        ["cantidad", "Cantidad a apostar (10-1000)"],
    ]);
});

test("apostar: goles válidos, un marcador una sola vez y varios marcadores distintos", async () => {
    expect(await apostarMarcador("ana", "x", 1, 100)).toMatch(/Los goles tienen que ser números enteros de 0 a 20/);
    expect(dinero.efectivo("ana")).toBe(1000);

    expect(await apostarMarcador("ana", 2, 1, 100)).toMatch(/Marcador exacto Celta 2-1 Alavés[\s\S]*`100` monedas[\s\S]*Cuota:\*\* `8`/);
    expect(await apostarMarcador("ana", 2, 1, 50)).toMatch(/Ya tienes una apuesta a ese marcador en este partido/);
    expect(await apostarMarcador("ana", 1, 1, 50)).toMatch(/Apuesta registrada/);
    expect(await apostarMarcador("luis", 2, 1, 20)).toMatch(/Apuesta registrada/);
    expect(dinero.efectivo("ana")).toBe(850);
    expect(db.prepare("SELECT eleccion, cantidad, cuota FROM apuestas_usuario WHERE user_id = 'ana' ORDER BY id").all()).toEqual([
        { eleccion: "exacto_2-1", cantidad: 100, cuota: 8 },
        { eleccion: "exacto_1-1", cantidad: 50, cuota: 8 },
    ]);
    // En Mis jugadas sale como marcador, con lo que ganaría.
    const enJuego = JSON.stringify(buildMisJugadas("ana", "activas").embeds[0].data);
    expect(enJuego).toMatch(/🎯 Marcador exacto 2-1 · 100 🪙 @8 → 800 🪙/);
});

test("la liquidación paga ×8 a quien acierta el marcador (aunque la API dé los equipos al revés) y nada a quien no", async () => {
    db.prepare("UPDATE apuestas_partidos SET start_time = ? WHERE match_id = 'mx-1'").run(pasado(5));
    // Una apuesta normal al mismo partido, para ver que sigue funcionando igual.
    db.prepare("INSERT INTO apuestas_usuario (user_id, match_id, eleccion, cantidad, cuota) VALUES ('luis', 'mx-1', 'home', 100, 2)").run();
    resultadosApi = [
        {
            id: "mx-1",
            completed: true,
            home_team: "Celta",
            away_team: "Alavés",
            scores: [
                { name: "Alavés", score: "1" },
                { name: "Celta", score: "2" },
            ],
        },
    ];
    const r = await liquidarApuestas({ minHorasDesdeInicio: 2 });
    expect(r.pagadas).toBe(3);
    expect(r.fallidas).toBe(1);
    const premios = db
        .prepare("SELECT user_id, eleccion, premio FROM apuestas_usuario WHERE match_id = 'mx-1' ORDER BY user_id, id")
        .all()
        .map((a) => `${a.user_id} ${a.eleccion} ${a.premio}`);
    expect(premios).toEqual(["ana exacto_2-1 800", "ana exacto_1-1 0", "luis exacto_2-1 160", "luis home 200"]);
    expect(dinero.efectivo("ana")).toBe(850 + 800);
    expect(dinero.efectivo("luis")).toBe(1000 - 20 + 160 + 200);
    const resueltas = JSON.stringify(buildMisJugadas("ana", "historial").embeds[0].data);
    expect(resueltas).toMatch(/🏆 Ganada \(\+800\)\\n🎯 Marcador exacto 2-1/);
    expect(resueltas).toMatch(/❌ Perdida\\n🎯 Marcador exacto 1-1/);
});
