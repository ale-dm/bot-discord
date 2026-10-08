// Mercados de goles (#9, más/menos 2,5) y de hándicap (#10, ±1,5): cómo se leen de la API, quién acierta cada apuesta,
// el mejor escenario de un boleto y una apuesta de punta a punta (botón, modal y la línea guardada en la apuesta).
const db = require("../src/core/db");
const dinero = require("../src/systems/dinero");
const mercados = require("../src/systems/apuestas/mercados");
const { cuotasMercados } = require("../src/services/oddsApi");
const apuestas = require("../src/juegos/apuestas/apuestas");

const G = "g-mercados";
const PARTIDO = "m-goles-hcap";
let n = 0;

const apuestaCon = (eleccion, linea, cuota) => ({ eleccion, linea, cantidad: 100, cuota });

beforeEach(() => {
    db.prepare("DELETE FROM apuestas_usuario WHERE match_id = ?").run(PARTIDO);
    db.prepare("DELETE FROM apuestas_partidos WHERE match_id = ?").run(PARTIDO);
    db.prepare("DELETE FROM action_limits WHERE guildId = ?").run(G);
    db.prepare(
        `INSERT INTO apuestas_partidos (match_id, deporte, home_team, away_team, start_time, estado, cuota_home, cuota_draw, cuota_away,
            cuota_mas, cuota_menos, total_linea, cuota_casa, cuota_fuera, hcap_linea)
         VALUES (?, 'laliga', 'Barça', 'Real', '2099-01-01T20:00:00.000Z', 'abierto', 1.8, 3.6, 4.2, 1.9, 1.95, 2.5, 2.3, 1.6, -1.5)`,
    ).run(PARTIDO);
});

describe("cómo gana cada apuesta de mercado", () => {
    test("más y menos de 2,5 goles", () => {
        expect(mercados.acierta("mas", "home", "2-1", 2.5)).toBe(true); // 3 goles
        expect(mercados.acierta("menos", "home", "2-1", 2.5)).toBe(false);
        expect(mercados.acierta("menos", "draw", "1-1", 2.5)).toBe(true); // 2 goles
        expect(mercados.acierta("mas", "draw", "1-1", 2.5)).toBe(false);
    });

    test("hándicap −1,5 para el local: gana por 2 o más; +1,5 para el visitante: pierde por 1 o menos", () => {
        expect(mercados.acierta("casa", "home", "3-1", -1.5)).toBe(true); // diferencia +2
        expect(mercados.acierta("casa", "home", "2-1", -1.5)).toBe(false); // diferencia +1
        expect(mercados.acierta("fuera", "home", "2-1", -1.5)).toBe(true); // visitante +1,5: pierde por 1
        expect(mercados.acierta("fuera", "home", "3-1", -1.5)).toBe(false);
        expect(mercados.acierta("fuera", "draw", "1-1", -1.5)).toBe(true);
    });

    test("sin línea no hay forma de saber si acierta", () => {
        expect(mercados.acierta("mas", "home", "3-1", null)).toBe(false);
        expect(mercados.acierta("casa", "home", "3-1", undefined)).toBe(false);
    });

    test("1X2 y marcador exacto siguen igual", () => {
        expect(mercados.acierta("home", "home", "2-1", null)).toBe(true);
        expect(mercados.acierta("exacto_2-1", "home", "2-1", null)).toBe(true);
        expect(mercados.acierta("exacto_2-0", "home", "2-1", null)).toBe(false);
    });
});

test("la API da la línea de 2,5 y de ±1,5 con sus cuotas, y si no hay esa línea no se ofrece", () => {
    const match = {
        home_team: "Barça",
        away_team: "Real",
        bookmakers: [
            {
                markets: [
                    {
                        key: "totals",
                        outcomes: [
                            { name: "Over", point: 2.5, price: 1.9 },
                            { name: "Under", point: 2.5, price: 1.95 },
                        ],
                    },
                    {
                        key: "spreads",
                        outcomes: [
                            { name: "Barça", point: -1.5, price: 2.3 },
                            { name: "Real", point: 1.5, price: 1.6 },
                        ],
                    },
                ],
            },
        ],
    };
    expect(cuotasMercados(match)).toEqual({
        cuota_mas: 1.9,
        cuota_menos: 1.95,
        total_linea: 2.5,
        cuota_casa: 2.3,
        cuota_fuera: 1.6,
        hcap_linea: -1.5,
    });
    // Solo hay línea de 3,5 de goles y de hándicap −2,5: no se ofrece ninguna de esas.
    const otra = {
        home_team: "Barça",
        away_team: "Real",
        bookmakers: [
            {
                markets: [
                    { key: "totals", outcomes: [{ name: "Over", point: 3.5, price: 2.5 }] },
                    { key: "spreads", outcomes: [{ name: "Barça", point: -2.5, price: 2.9 }] },
                ],
            },
        ],
    };
    expect(cuotasMercados(otra)).toMatchObject({ cuota_mas: null, cuota_menos: null, cuota_casa: null, cuota_fuera: null });
});

test("el mejor escenario de un boleto cuenta a la vez el 1X2, los goles y el hándicap", () => {
    // Con 3-1 cobran las tres: local (×2), más de 2,5 (×1,9) y −1,5 (×2,2).
    const boleto = [
        { eleccion: "home", cantidad: 100, cuota: 2 },
        { eleccion: "mas", cantidad: 100, cuota: 1.9, linea: 2.5 },
        { eleccion: "casa", cantidad: 100, cuota: 2.2, linea: -1.5 },
    ];
    expect(mercados.maximoPorMarcador(boleto)).toBe(200 + 190 + 220);
    expect(mercados.maximoPorMarcador([])).toBe(0);
});

test("las pantallas nombran cada apuesta", () => {
    const a = { home_team: "Barça", away_team: "Real" };
    expect(mercados.textoEleccion({ ...a, eleccion: "mas", linea: 2.5 })).toBe("Más de 2,5 goles");
    expect(mercados.textoEleccion({ ...a, eleccion: "menos", linea: 2.5 })).toBe("Menos de 2,5 goles");
    expect(mercados.textoEleccion({ ...a, eleccion: "casa", linea: -1.5 })).toBe("Barça −1,5");
    expect(mercados.textoEleccion({ ...a, eleccion: "fuera", linea: -1.5 })).toBe("Real +1,5");
    expect(mercados.textoEleccion({ ...a, eleccion: "exacto_2-1" })).toBe("Marcador exacto 2-1");
    expect(mercados.textoEleccion({ ...a, eleccion: "draw" })).toBe("Empate");
});

test("un partido solo ofrece los mercados que tienen cuota", () => {
    const todos = mercados.botonesDisponibles({
        home_team: "Barça",
        away_team: "Real",
        cuota_mas: 1.9,
        cuota_menos: 1.95,
        total_linea: 2.5,
        cuota_casa: 2.3,
        cuota_fuera: 1.6,
        hcap_linea: -1.5,
    });
    expect(todos.map((b) => b.eleccion)).toEqual(["mas", "menos", "casa", "fuera"]);
    expect(mercados.botonesDisponibles({ home_team: "A", away_team: "B" })).toEqual([]);
});

async function botonYModal(customId, userId) {
    const i = { customId, user: { id: userId, tag: userId }, guildId: G, showModal: jest.fn(), reply: jest.fn(), fields: null };
    await apuestas.handleButton(null, i);
    return i;
}

test("apostar a más de 2,5 goles guarda la cuota y la línea de esa apuesta", async () => {
    const u = `mercado-${++n}`;
    dinero.pagar(u, 1000);
    const botón = await botonYModal(`apuesta_mercado_mas_${PARTIDO}`, u);
    expect(botón.showModal).toHaveBeenCalledTimes(1);

    const modal = {
        customId: `apuestas_modal_mas_${PARTIDO}`,
        user: { id: u, tag: u },
        guildId: G,
        fields: { getTextInputValue: (id) => (id === "cantidad" ? "100" : "") },
        reply: jest.fn(),
    };
    await apuestas.handleModal(null, modal);
    expect(modal.reply.mock.calls[0][0].embeds[0].data.title).toBe("✅ ¡Apuesta registrada!");
    const fila = db
        .prepare("SELECT eleccion, cantidad, cuota, linea FROM apuestas_usuario WHERE user_id = ? AND match_id = ?")
        .get(u, PARTIDO);
    expect(fila).toEqual({ eleccion: "mas", cantidad: 100, cuota: 1.9, linea: 2.5 });
});

test("una apuesta a hándicap guarda la línea del local con la que se apostó", async () => {
    const u = `mercado-${++n}`;
    dinero.pagar(u, 1000);
    await botonYModal(`apuesta_mercado_casa_${PARTIDO}`, u);
    await apuestas.handleModal(null, {
        customId: `apuestas_modal_casa_${PARTIDO}`,
        user: { id: u, tag: u },
        guildId: G,
        fields: { getTextInputValue: () => "50" },
        reply: jest.fn(),
    });
    const fila = db.prepare("SELECT eleccion, cuota, linea FROM apuestas_usuario WHERE user_id = ? AND match_id = ?").get(u, PARTIDO);
    expect(fila).toEqual({ eleccion: "casa", cuota: 2.3, linea: -1.5 });
});

test("un mercado sin cuota no se puede apostar", async () => {
    db.prepare("UPDATE apuestas_partidos SET cuota_mas = NULL WHERE match_id = ?").run(PARTIDO);
    const u = `mercado-${++n}`;
    dinero.pagar(u, 1000);
    const i = await botonYModal(`apuesta_mercado_mas_${PARTIDO}`, u);
    expect(i.showModal).not.toHaveBeenCalled();
    expect(i.reply).toHaveBeenCalledTimes(1);
});
