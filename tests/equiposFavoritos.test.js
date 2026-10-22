// ⭐ Equipos favoritos (#530): seguir/dejar equipos, próximos partidos y el DM cuando aparece un partido nuevo.
// BD en memoria; los DM se simulan y no se llama a la Odds API.
const db = require("../src/core/db");
const avisosDm = require("../src/systems/avisosDm");
const favoritos = require("../src/systems/apuestas/favoritos");
const command = require("../src/commands/general/favoritos");
const { buildFavoritos } = require("../src/paneles/favoritos");

const HORA = 3600_000;
let n = 0;

function partido(extra = {}) {
    const p = {
        match_id: `ef-${++n}`,
        home_team: "Betis",
        away_team: "Sevilla",
        start_time: new Date(Date.now() + 24 * HORA).toISOString(),
        estado: "abierto",
        deporte: "laliga",
        cuota_home: 2,
        cuota_draw: 3.1,
        cuota_away: 4,
        ...extra,
    };
    db.prepare(
        `INSERT INTO apuestas_partidos (match_id, home_team, away_team, start_time, estado, deporte, cuota_home, cuota_draw, cuota_away)
         VALUES (@match_id, @home_team, @away_team, @start_time, @estado, @deporte, @cuota_home, @cuota_draw, @cuota_away)`,
    ).run(p);
    return p;
}

function cliente({ falla = false, generico = false } = {}) {
    const enviados = [];
    return {
        enviados,
        users: {
            fetch: async (id) => {
                if (generico) throw new Error("timeout de red");
                if (falla) throw Object.assign(new Error("DMs cerrados"), { code: 50007 });
                return { id, send: async (payload) => enviados.push({ id, payload }) };
            },
        },
    };
}

const interaccion = (sub, { equipo, userId = "u-cmd", focused = "" } = {}) => ({
    user: { id: userId },
    options: {
        getSubcommand: () => sub,
        getString: () => equipo,
        getFocused: () => focused,
    },
    reply: jest.fn(async () => {}),
    respond: jest.fn(async () => {}),
});

beforeEach(() => {
    db.prepare("DELETE FROM equipos_favoritos").run();
    db.prepare("DELETE FROM equipos_favoritos_avisos").run();
    db.prepare("DELETE FROM apuestas_partidos").run();
    db.prepare("DELETE FROM preferencias_dm").run();
});

describe("seguir y dejar equipos", () => {
    test("seguir guarda el nombre de la API y no repite el mismo equipo", () => {
        partido({ home_team: "Atlético Madrid", away_team: "Getafe" });
        expect(favoritos.seguir("u1", "atletico madrid")).toEqual({ ok: true, equipo: "Atlético Madrid" });
        expect(favoritos.seguir("u1", "ATLETICO")).toMatchObject({ ok: false, motivo: expect.stringMatching(/Ya sigues/) });
        expect(favoritos.seguidos("u1")).toEqual([expect.objectContaining({ equipo: "Atlético Madrid", equipo_key: "atletico madrid" })]);
    });

    test("resuelve un texto parcial único y explica si hay varios o ninguno", () => {
        partido({ home_team: "Real Madrid", away_team: "Getafe" });
        partido({ home_team: "Real Sociedad", away_team: "Osasuna" });
        partido({ home_team: "Betis", away_team: "Sevilla" });

        expect(favoritos.seguir("u1", "madrid")).toEqual({ ok: true, equipo: "Real Madrid" });
        const varios = favoritos.seguir("u2", "real");
        expect(varios.ok).toBe(false);
        expect(varios.motivo).toMatch(/varios equipos: Real Madrid, Real Sociedad/);
        expect(varios.candidatos).toEqual(["Real Madrid", "Real Sociedad"]);
        expect(favoritos.seguir("u2", "Barcelona")).toMatchObject({
            ok: false,
            motivo: expect.stringMatching(/No encuentro ningún equipo/),
        });
    });

    test("cada persona puede seguir como mucho 10 equipos", () => {
        for (let i = 0; i < 11; i++) {
            const letra = String.fromCharCode(65 + i);
            partido({ home_team: `Equipo ${letra}`, away_team: `Rival ${letra}` });
        }
        for (let i = 0; i < 10; i++) expect(favoritos.seguir("u1", `Equipo ${String.fromCharCode(65 + i)}`).ok).toBe(true);
        expect(favoritos.seguir("u1", "Equipo K")).toMatchObject({
            ok: false,
            motivo: expect.stringMatching(/máximo/),
        });
        expect(favoritos.seguidos("u1")).toHaveLength(10);
    });

    test("dejar borra el equipo y avisa si ya no lo sigue", () => {
        partido({ home_team: "Betis" });
        favoritos.seguir("u1", "Betis");
        expect(favoritos.dejar("u1", "betis")).toEqual({ ok: true, equipo: "Betis" });
        expect(favoritos.seguidos("u1")).toEqual([]);
        expect(favoritos.dejar("u1", "Betis")).toMatchObject({
            ok: false,
            motivo: expect.stringMatching(/No encuentro ningún equipo/),
        });
    });
});

describe("catálogo y próximos partidos", () => {
    test("equiposDisponibles solo devuelve equipos de partidos abiertos y futuros", () => {
        partido({ home_team: "Betis", away_team: "Sevilla" });
        partido({ home_team: "Oviedo", away_team: "Sporting", start_time: new Date(Date.now() - HORA).toISOString() });
        partido({ home_team: "Elche", away_team: "Eldense", estado: "finalizado" });

        expect(favoritos.equiposDisponibles({ texto: "" })).toEqual(["Betis", "Sevilla"]);
        expect(favoritos.equiposDisponibles({ texto: "bet" })).toEqual(["Betis"]);
        expect(favoritos.equiposDisponibles({ texto: "BETIS" })).toEqual(["Betis"]);
        expect(favoritos.equiposDisponibles({ texto: "", limite: 1 })).toEqual(["Betis"]);
    });

    test("el autocompletado no pasa de 25 equipos", () => {
        for (let i = 0; i < 30; i++) {
            partido({ home_team: `Equipo ${String(i).padStart(2, "0")}`, away_team: `Rival ${i}` });
        }
        expect(favoritos.equiposDisponibles({ texto: "" })).toHaveLength(25);
    });

    test("proximos filtra por los equipos seguidos y ordena por hora", () => {
        const lejos = partido({ home_team: "Betis", start_time: new Date(Date.now() + 3 * HORA).toISOString() });
        const cerca = partido({ home_team: "Sevilla", away_team: "Betis", start_time: new Date(Date.now() + HORA).toISOString() });
        partido({ home_team: "Madrid", away_team: "Barça", start_time: new Date(Date.now() + 2 * HORA).toISOString() });
        partido({
            home_team: "Betis",
            away_team: "Getafe",
            start_time: new Date(Date.now() + 2 * HORA).toISOString(),
            estado: "finalizado",
        });

        favoritos.seguir("u1", "Betis");
        expect(favoritos.proximos("u1").map((p) => p.match_id)).toEqual([cerca.match_id, lejos.match_id]);
        expect(favoritos.proximos("u1", { limite: 1 }).map((p) => p.match_id)).toEqual([cerca.match_id]);
    });

    test("el panel enseña los equipos y los partidos con cuotas; sin equipos explica cómo empezar", () => {
        partido({ home_team: "Betis" });
        favoritos.seguir("u1", "Betis");
        const panel = buildFavoritos("u1");
        expect(panel.embeds[0].data.title).toBe("⭐ Tus equipos favoritos");
        const campos = panel.embeds[0].data.fields;
        expect(campos[0].value).toContain("Betis");
        expect(campos[1].value).toMatch(/Betis vs Sevilla/);
        expect(campos[1].value).toMatch(/1 2\.00 · X 3\.10 · 2 4\.00/);

        const vacio = buildFavoritos("nadie");
        expect(vacio.embeds[0].data.description).toMatch(/Todavía no sigues a ningún equipo/);
        expect(vacio.embeds[0].data.description).toMatch(/\/favoritos seguir equipo:Betis/);
    });
});

describe("aviso por DM de partidos nuevos", () => {
    test("manda un solo DM por persona con todos sus partidos nuevos y no repite en la segunda pasada", async () => {
        partido({ home_team: "Betis", start_time: new Date(Date.now() + HORA).toISOString() });
        partido({ home_team: "Sevilla", away_team: "Betis", start_time: new Date(Date.now() + 2 * HORA).toISOString() });
        partido({ home_team: "Madrid", away_team: "Barça", start_time: new Date(Date.now() + HORA).toISOString() });
        favoritos.seguir("u1", "Betis");

        const c = cliente();
        expect(await favoritos.avisarPartidos(c)).toBe(1);
        expect(c.enviados).toHaveLength(1);
        const texto = c.enviados[0].payload.content;
        expect(texto).toMatch(new RegExp(`Betis vs Sevilla`));
        expect(texto).toMatch(/LaLiga/);
        expect(texto).toMatch(/<t:\d+:f> \(<t:\d+:R>\)/);
        expect(texto).toMatch(/1 2\.00 · X 3\.10 · 2 4\.00/);
        expect(texto).toMatch(/\/juegos → ⚽ Apuestas/);
        expect(texto).toMatch(/\/favoritos/);
        expect(texto).not.toMatch(/Madrid/);

        expect(await favoritos.avisarPartidos(cliente())).toBe(0);
        expect(db.prepare("SELECT COUNT(*) AS n FROM equipos_favoritos_avisos").get().n).toBe(2);
    });

    test("si sigues a los dos equipos del mismo partido, el partido sale una sola vez", async () => {
        partido({ home_team: "Betis", away_team: "Sevilla" });
        favoritos.seguir("u1", "Betis");
        favoritos.seguir("u1", "Sevilla");

        const c = cliente();
        expect(await favoritos.avisarPartidos(c)).toBe(1);
        expect(c.enviados[0].payload.content.match(/Betis vs Sevilla/g)).toHaveLength(1);
    });

    test("con muchos partidos trocea en varios DMs y ninguno pasa de 2000 caracteres", async () => {
        for (let i = 0; i < 20; i++) {
            partido({
                home_team: "Betis",
                away_team: `Rival ${i}`,
                start_time: new Date(Date.now() + (i + 1) * HORA).toISOString(),
            });
        }
        favoritos.seguir("u1", "Betis");

        const c = cliente();
        expect(await favoritos.avisarPartidos(c)).toBeGreaterThan(1);
        expect(c.enviados.every((e) => e.payload.content.length <= 2000)).toBe(true);
        const todo = c.enviados.map((e) => e.payload.content).join("\n");
        for (let i = 0; i < 20; i++) expect(todo).toContain(`Rival ${i}`);
        expect(await favoritos.avisarPartidos(cliente())).toBe(0);
    });

    test("un fallo transitorio desmarca el partido y se reintenta en el siguiente refresco", async () => {
        partido({ home_team: "Betis" });
        favoritos.seguir("u1", "Betis");

        expect(await favoritos.avisarPartidos(cliente({ generico: true }))).toBe(0);
        expect(db.prepare("SELECT COUNT(*) AS n FROM equipos_favoritos_avisos WHERE userId = 'u1'").get().n).toBe(0);

        const bueno = cliente();
        expect(await favoritos.avisarPartidos(bueno)).toBe(1);
        expect(bueno.enviados).toHaveLength(1);
    });

    test("no avisa de partidos ya empezados", async () => {
        partido({ home_team: "Betis", start_time: new Date(Date.now() - HORA).toISOString() });
        favoritos.seguir("u1", "Betis");
        const c = cliente();
        expect(await favoritos.avisarPartidos(c)).toBe(0);
        expect(c.enviados).toEqual([]);
        expect(db.prepare("SELECT COUNT(*) AS n FROM equipos_favoritos_avisos").get().n).toBe(0);
    });

    test("respeta a quien tiene el aviso apagado o «no molestar»", async () => {
        partido({ home_team: "Betis" });
        favoritos.seguir("apagado", "Betis");
        favoritos.seguir("molesto", "Betis");
        avisosDm.fijar("apagado", "equipo_favorito", false);
        avisosDm.fijarNoMolestar("molesto", true);

        const c = cliente();
        expect(await favoritos.avisarPartidos(c)).toBe(0);
        expect(c.enviados).toEqual([]);
        expect(db.prepare("SELECT COUNT(*) AS n FROM equipos_favoritos_avisos").get().n).toBe(2);
    });

    test("si el DM falla se marca antes y no se reintenta", async () => {
        partido({ home_team: "Betis" });
        favoritos.seguir("u1", "Betis");
        expect(await favoritos.avisarPartidos(cliente({ falla: true }))).toBe(0);
        expect(db.prepare("SELECT COUNT(*) AS n FROM equipos_favoritos_avisos WHERE userId = 'u1'").get().n).toBe(1);

        const bueno = cliente();
        expect(await favoritos.avisarPartidos(bueno)).toBe(0);
        expect(bueno.enviados).toEqual([]);
    });

    test("el tipo equipo_favorito sale en /avisos", () => {
        expect(avisosDm.tipoValido("equipo_favorito")).toBe(true);
        const tipo = avisosDm.estado("u1").tipos.find((t) => t.id === "equipo_favorito");
        expect(tipo).toMatchObject({ emoji: "⭐", nombre: "Equipos favoritos" });
        expect(tipo.detalle).toMatch(/equipo que sigues/);
    });
});

describe("/favoritos", () => {
    test("declara seguir, dejar y lista, con equipo obligatorio y autocompletado", () => {
        const json = command.data.toJSON();
        expect(json.name).toBe("favoritos");
        expect(json.options.map((o) => o.name)).toEqual(["seguir", "dejar", "lista"]);
        const seguir = json.options.find((o) => o.name === "seguir");
        expect(seguir.options[0]).toMatchObject({ name: "equipo", type: 3, required: true, autocomplete: true });
    });

    test("el autocompletado de seguir usa el catálogo y el de dejar, los equipos seguidos", async () => {
        partido({ home_team: "Betis", away_team: "Sevilla" });
        const seguir = interaccion("seguir", { focused: "bet" });
        await command.autocomplete(null, seguir);
        expect(seguir.respond.mock.calls[0][0]).toEqual([{ name: "Betis", value: "Betis" }]);

        favoritos.seguir("u-cmd", "Betis");
        const dejar = interaccion("dejar", { focused: "bet" });
        await command.autocomplete(null, dejar);
        expect(dejar.respond.mock.calls[0][0]).toEqual([{ name: "Betis", value: "Betis" }]);
    });

    test("lista pinta el panel y seguir/dejar responden en privado", async () => {
        partido({ home_team: "Betis", start_time: new Date(Date.now() + HORA).toISOString() });
        const lista = interaccion("lista");
        await command.run(null, lista);
        expect(lista.reply.mock.calls[0][0].embeds[0].data.description).toMatch(/Todavía no sigues/);

        const seguir = interaccion("seguir", { equipo: "Betis" });
        await command.run(null, seguir);
        expect(seguir.reply.mock.calls[0][0].content).toMatch(/Sigues a \*\*Betis\*\*/);
        expect(seguir.reply.mock.calls[0][0].content).toMatch(/Su próximo partido/);

        const repetido = interaccion("seguir", { equipo: "Betis" });
        await command.run(null, repetido);
        expect(repetido.reply.mock.calls[0][0].content).toMatch(/Ya sigues/);

        const dejar = interaccion("dejar", { equipo: "Betis" });
        await command.run(null, dejar);
        expect(dejar.reply.mock.calls[0][0].content).toMatch(/Ya no sigues a \*\*Betis\*\*/);
        expect(favoritos.seguidos("u-cmd")).toEqual([]);
    });
});
