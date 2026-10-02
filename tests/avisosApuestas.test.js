// Resultados de las apuestas en un canal (después de liquidar) y recordatorio por DM antes del partido.
process.env.ODDS_API_KEY = "clave-de-prueba";

const db = require("../src/core/db");
const guildSettings = require("../src/systems/guildSettings");
const liquidacion = require("../src/systems/apuestas/liquidacion");
const { enviarRecordatorios } = require("../src/systems/apuestas/recordatorios");
const paneladmin = require("../src/commands/admin/paneladmin");

const G = "guild-avisos";
const hace = (horas) => new Date(Date.now() - horas * 3600 * 1000).toISOString();

let resultadosApi = {};
beforeEach(() => {
    global.fetch = jest.fn(async (url) => {
        const deporte = /sports\/([^/]+)\/scores/.exec(url)[1];
        return { ok: true, headers: new Map([["x-requests-remaining", "400"]]), json: async () => resultadosApi[deporte] || [] };
    });
});

function partido(match_id, horasDesdeInicio, home = "Elche", away = "Oviedo") {
    db.prepare(`INSERT INTO apuestas_partidos (match_id, home_team, away_team, start_time, deporte) VALUES (?, ?, ?, ?, 'laliga')`).run(
        match_id,
        home,
        away,
        hace(horasDesdeInicio),
    );
}
function apuesta(userId, match_id, eleccion, cantidad, cuota = 2) {
    db.prepare("INSERT OR IGNORE INTO banco (userId, saldo, enMano) VALUES (?, 0, 0)").run(userId);
    return db
        .prepare("INSERT INTO apuestas_usuario (user_id, match_id, eleccion, cantidad, cuota) VALUES (?, ?, ?, ?, ?)")
        .run(userId, match_id, eleccion, cantidad, cuota).lastInsertRowid;
}
const score = (id, home, away) => ({
    id,
    completed: true,
    scores: [
        { name: "L", score: String(home) },
        { name: "V", score: String(away) },
    ],
});

function clienteFalso({ canales = {}, guilds = [G] } = {}) {
    const dms = [];
    const guildsMap = new Map(
        guilds.map((id) => [
            id,
            {
                id,
                name: id,
                channels: { cache: new Map(Object.entries(canales)), fetch: async () => null },
            },
        ]),
    );
    return {
        dms,
        guilds: { cache: guildsMap },
        users: { fetch: async (id) => ({ id, send: async (payload) => dms.push({ id, payload }) }) },
    };
}
const canalFalso = () => ({ name: "resultados", isTextBased: () => true, send: jest.fn(async () => {}) });

describe("resultados en el canal", () => {
    test("la liquidación cuenta qué pasó en cada partido y el resumen sale en el canal configurado, sin pings", async () => {
        partido("r1", 5);
        apuesta("gana", "r1", "home", 100, 2.5);
        apuesta("pierde", "r1", "away", 100);
        resultadosApi = { soccer_spain_la_liga: [score("r1", 2, 1)] };

        const resumen = await liquidacion.liquidarApuestas({ minHorasDesdeInicio: 2 });
        expect(resumen.partidos).toEqual([
            expect.objectContaining({ home: "Elche", away: "Oviedo", marcador: "2-1", apostantes: 2, ganadores: ["gana"], repartido: 250 }),
        ]);

        const canal = canalFalso();
        guildSettings.setSetting(G, "apuestas.canal_resultados", "canal-1");
        const client = clienteFalso({ canales: { "canal-1": canal }, guilds: [G, "guild-sin-canal"] });
        expect(await liquidacion.anunciarResultados(client, resumen)).toBe(1);
        const enviado = canal.send.mock.calls[0][0];
        expect(enviado.allowedMentions).toEqual({ parse: [] });
        const texto = enviado.embeds[0].data.description;
        expect(texto).toMatch(/Elche 2-1 Oviedo/);
        expect(texto).toMatch(/1 de 2 acertaron · \*\*250\*\* 🪙 en premios · 🏆 <@gana>/);
    });

    test("una quiniela en la que nadie llega al mínimo sale como devuelta", () => {
        const embed = liquidacion.resultadosEmbed({
            partidos: [{ deporte: "laliga", home: "A", away: "B", marcador: "0-0", apostantes: 3, ganadores: [], repartido: 0 }],
            quinielas: [
                {
                    deporte: "laliga",
                    jornada: "J7",
                    jugadores: 4,
                    partidos: 10,
                    minimo: 5,
                    maxAciertos: 3,
                    ganadores: [],
                    premioUnitario: 0,
                },
            ],
        });
        const texto = embed.data.description;
        expect(texto).toMatch(/Nadie acertó \(3 apuestas\)/);
        expect(texto).toMatch(/Quiniela J7.*\n↩️ Nadie llegó a 5 aciertos \(máximo 3\).*4 jugadores/);
    });

    test("sin nada cerrado o sin canal no se publica nada", async () => {
        const canal = canalFalso();
        expect(await liquidacion.anunciarResultados(clienteFalso({ canales: { "canal-1": canal } }), { partidos: [], quinielas: [] })).toBe(
            0,
        );
        guildSettings.setSetting(G, "apuestas.canal_resultados", "no-existe");
        const resumen = {
            partidos: [{ deporte: "laliga", home: "A", away: "B", marcador: "1-0", apostantes: 1, ganadores: ["x"], repartido: 20 }],
        };
        expect(await liquidacion.anunciarResultados(clienteFalso({ canales: { "canal-1": canal } }), resumen)).toBe(0);
        expect(canal.send).not.toHaveBeenCalled();
        guildSettings.setSetting(G, "apuestas.canal_resultados", "");
    });
});

describe("recordatorio antes del partido", () => {
    test("un DM por persona con sus partidos que empiezan pronto, y una sola vez", async () => {
        partido("pronto", -20 / 60, "Betis", "Sevilla"); // dentro de 20 minutos
        partido("luego", -3, "Barça", "Madrid"); // dentro de 3 horas
        apuesta("recordado", "pronto", "draw", 50, 3.1);
        apuesta("recordado", "luego", "home", 50);
        apuesta("otro", "pronto", "away", 10);

        const client = clienteFalso();
        expect(await enviarRecordatorios(client)).toBe(2);
        const dm = client.dms.find((d) => d.id === "recordado").payload.content;
        expect(dm).toMatch(/Betis vs Sevilla/);
        expect(dm).toMatch(/X \(empate\).*cuota 3,10.*\*\*155\*\*/);
        expect(dm).not.toMatch(/Barça/);

        expect(await enviarRecordatorios(client)).toBe(0);
        expect(client.dms).toHaveLength(2);
    });

    test("desactivado en el panel no se manda nada", async () => {
        partido("pronto-off", -10 / 60);
        apuesta("callado", "pronto-off", "home", 10);
        guildSettings.setSetting(G, "apuestas.recordatorio", false);
        const client = clienteFalso();
        expect(await enviarRecordatorios(client)).toBe(0);
        guildSettings.setSetting(G, "apuestas.recordatorio", true);
        expect(await enviarRecordatorios(client)).toBe(1);
    });
});

describe("/paneladmin → ⚽ Apuestas", () => {
    const interaccion = (extra) => ({
        guildId: G,
        guild: { id: G },
        user: { id: "admin", tag: "admin", username: "admin" },
        member: { permissions: { has: () => true } },
        isFromMessage: () => true,
        reply: jest.fn(async () => {}),
        update: jest.fn(async () => {}),
        showModal: jest.fn(async () => {}),
        ...extra,
    });

    test("elegir y quitar el canal de resultados", async () => {
        const select = interaccion({ customId: "paneladmin_apu_canal_select", values: ["123456789012345678"] });
        await paneladmin.handleChannelSelect(null, select);
        expect(guildSettings.getSettings(G).apuestas.canal_resultados).toBe("123456789012345678");

        const home = interaccion({ customId: "paneladmin_apu_home" });
        await paneladmin.handleButton(null, home);
        const avisos = home.update.mock.calls[0][0].embeds[0].data.fields.find((f) => f.name === "📢 Avisos").value;
        expect(avisos).toMatch(/<#123456789012345678>/);

        await paneladmin.handleButton(null, interaccion({ customId: "paneladmin_apu_canal_quitar" }));
        expect(guildSettings.getSettings(G).apuestas.canal_resultados).toBe("");
    });

    test("el recordatorio se configura con minutos válidos", async () => {
        const formulario = (campos) =>
            interaccion({ customId: "paneladmin_apu_recordatorio_modal", fields: { getTextInputValue: (k) => campos[k] ?? "" } });
        const mal = formulario({ activo: "1", minutos: "2" });
        await paneladmin.handleModal(null, mal);
        expect(mal.reply.mock.calls[0][0].content).toMatch(/entre 5 y 1440/);

        await paneladmin.handleModal(null, formulario({ activo: "1", minutos: "45" }));
        expect(guildSettings.getSettings(G).apuestas).toMatchObject({ recordatorio: true, recordatorio_min: 45 });
        guildSettings.setSetting(G, "apuestas.recordatorio_min", 30);
    });
});
