// Eventos diarios de TTCL (F-EC-12d, #120): uno al día, ±5 %, a la hora elegida (Madrid), movimiento de la reserva del
// pool y aviso por DM solo a quien tiene TTCL.
const db = require("../src/core/db");
const dinero = require("../src/systems/dinero");
const mercado = require("../src/systems/cripto/mercado");
const eventos = require("../src/systems/cripto/eventos");

// 2026-10-07 11:00 y 12:00 en Madrid (UTC+2 en octubre).
const ONCE = Date.parse("2026-10-07T09:00:00Z");
const DOCE = Date.parse("2026-10-07T10:00:00Z");
const siempre = () => 0.5; // minuto 720 (12:00), dirección "bajada"

beforeEach(() => {
    db.prepare("UPDATE cripto_pool SET monedas = 1000000, ttcl = 10000 WHERE id = 1").run();
    db.prepare("DELETE FROM cripto_eventos").run();
    db.prepare("DELETE FROM cripto_carteras WHERE cripto = 'TTCL'").run();
});

test("el minuto de Madrid se calcula bien", () => {
    expect(eventos.minutoMadrid(new Date(DOCE))).toBe(720);
    expect(eventos.minutoMadrid(new Date(ONCE))).toBe(660);
});

test("el evento no se aplica antes de su hora, y sí cuando llega", () => {
    expect(eventos.revisar(ONCE, siempre)).toBeNull();
    expect(mercado.getTtclPrecio()).toBe(100);
    const r = eventos.revisar(DOCE, siempre);
    expect(r).toMatchObject({ direccion: "bajada", porcentaje: 5 });
});

test("una bajada del 5 % baja el precio exactamente un 5 %, y una subida lo sube", () => {
    const bajada = eventos.revisar(DOCE, siempre);
    expect(bajada.precio_despues).toBeCloseTo(bajada.precio_antes * 0.95, 6);
    expect(mercado.getTtclPrecio()).toBeCloseTo(95, 6);

    // Día siguiente, minuto 144 (02:24) y dirección "subida" (0,1 < 0,5).
    const subeMinuto = () => 0.1;
    const manana = Date.parse("2026-10-09T00:30:00Z"); // 02:30 en Madrid
    const subida = eventos.revisar(manana, subeMinuto);
    expect(subida.direccion).toBe("subida");
    expect(subida.precio_despues).toBeCloseTo(subida.precio_antes * 1.05, 6);
});

test("solo se aplica un evento por día", () => {
    expect(eventos.revisar(DOCE, siempre)).not.toBeNull();
    expect(eventos.revisar(DOCE + 3600_000, siempre)).toBeNull();
    expect(db.prepare("SELECT COUNT(*) AS n FROM cripto_eventos").get().n).toBe(1);
});

test("el aviso por DM llega solo a quien tiene TTCL", async () => {
    const con = "ev-con-ttcl";
    const sin = "ev-sin-ttcl";
    dinero.asegurarCuenta(con);
    dinero.asegurarCuenta(sin);
    db.prepare("INSERT INTO cripto_carteras (userId, cripto, cantidad) VALUES (?, 'TTCL', 3)").run(con);
    db.prepare("INSERT INTO cripto_carteras (userId, cripto, cantidad) VALUES (?, 'TTCL', 0)").run(sin);

    const enviados = [];
    const client = {
        users: {
            fetch: async (id) => ({ send: async (texto) => enviados.push({ id, texto }) }),
        },
    };
    const r = await eventos.revisarYAvisar(client, DOCE, siempre);

    expect(r.avisados).toBe(1);
    expect(enviados.map((e) => e.id)).toEqual([con]);
    expect(enviados[0].texto).toMatch(/Evento de mercado/);
    expect(enviados[0].texto).toMatch(/baja un \*\*5 %\*\*/);
});

test("un aviso que falla no para a los demás", async () => {
    const a = "ev-a";
    const b = "ev-b";
    db.prepare("INSERT INTO cripto_carteras (userId, cripto, cantidad) VALUES (?, 'TTCL', 1), (?, 'TTCL', 1)").run(a, b);
    const enviados = [];
    const client = {
        users: {
            fetch: async (id) => {
                if (id === a) throw new Error("DMs cerrados");
                return { send: async (t) => enviados.push(id) };
            },
        },
    };
    const r = await eventos.revisarYAvisar(client, DOCE, siempre);
    expect(r.avisados).toBe(1);
    expect(enviados).toEqual([b]);
});

describe("anuncio del evento en un canal (#451)", () => {
    const guildSettings = require("../src/systems/guildSettings");
    const G = "g-eventos-canal";

    /** Un cliente con un servidor cuyo canal `canalId` guarda lo que se publica (o falla si `falla`). */
    function clienteConCanal(canalId, { falla = false, dms = [] } = {}) {
        const publicado = [];
        const canal = {
            send: async (payload) => {
                if (falla) throw new Error("Missing Permissions");
                publicado.push(payload);
            },
        };
        const guild = {
            id: G,
            name: "Servidor",
            channels: { cache: new Map(canalId ? [[canalId, canal]] : []), fetch: async () => canal },
        };
        const enviados = [];
        return {
            publicado,
            enviados,
            client: {
                guilds: { cache: new Map([[G, guild]]) },
                users: { fetch: async (id) => ({ send: async (t) => enviados.push({ id, t }) }) },
            },
            dms,
        };
    }
    const conTtcl = (id) => db.prepare("INSERT INTO cripto_carteras (userId, cripto, cantidad) VALUES (?, 'TTCL', 2)").run(id);

    afterEach(() => guildSettings.setSetting(G, "cripto.eventos_canal", ""));

    test("con el canal configurado se publica una sola vez, con su variación, y los DM salen igual", async () => {
        guildSettings.setSetting(G, "cripto.eventos_canal", "canal-eventos");
        conTtcl("ev-canal-a");
        const c = clienteConCanal("canal-eventos");
        const r = await eventos.revisarYAvisar(c.client, DOCE, siempre);
        expect(c.publicado).toHaveLength(1);
        expect(c.publicado[0].content).toMatch(/Evento de mercado.*baja un \*\*5 %\*\*/);
        expect(c.publicado[0].allowedMentions).toEqual({ parse: [] });
        expect(c.enviados.map((e) => e.id)).toEqual(["ev-canal-a"]);
        expect(r.avisados).toBe(1);

        // El cron vuelve a pasar el mismo día: no hay otro evento, así que no hay otro anuncio.
        await eventos.revisarYAvisar(c.client, DOCE + 600_000, siempre);
        expect(c.publicado).toHaveLength(1);
    });

    test("sin canal configurado, solo DM", async () => {
        conTtcl("ev-canal-b");
        const c = clienteConCanal("canal-eventos");
        await eventos.revisarYAvisar(c.client, DOCE, siempre);
        expect(c.publicado).toHaveLength(0);
        expect(c.enviados).toHaveLength(1);
    });

    test("si el bot no puede escribir en el canal, el fallo no para los DM", async () => {
        guildSettings.setSetting(G, "cripto.eventos_canal", "canal-eventos");
        conTtcl("ev-canal-c");
        const c = clienteConCanal("canal-eventos", { falla: true });
        const r = await eventos.revisarYAvisar(c.client, DOCE, siempre);
        expect(c.publicado).toHaveLength(0);
        expect(r.avisados).toBe(1);
    });

    test("si el canal ya no existe, tampoco para nada", async () => {
        guildSettings.setSetting(G, "cripto.eventos_canal", "canal-borrado");
        conTtcl("ev-canal-d");
        const c = clienteConCanal(null);
        c.client.guilds.cache.get(G).channels.fetch = async () => {
            throw new Error("Unknown Channel");
        };
        const r = await eventos.revisarYAvisar(c.client, DOCE, siempre);
        expect(r.avisados).toBe(1);
    });
});
