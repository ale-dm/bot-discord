// #483: la XP por mensaje hace pocas consultas. Un mensaje dentro de cooldown hace como mucho una; uno que cuenta, solo las
// necesarias y las escrituras en una transacción; la configuración se guarda hasta el siguiente setConfig; y los valores
// de XP no cambian. Se cuentan las consultas envolviendo las sentencias que prepara la base de datos.
const { performance } = require("node:perf_hooks");

const G = "g-xp-rend";
let db;
let config;
let handleMessageXp;
let addXp;
let consultas;

beforeAll(() => {
    jest.isolateModules(() => {
        db = require("../src/core/db");
        const original = db.prepare.bind(db);
        consultas = [];
        jest.spyOn(db, "prepare").mockImplementation((sql) => {
            const st = original(sql);
            for (const metodo of ["get", "run", "all"]) {
                const f = st[metodo].bind(st);
                st[metodo] = (...args) => {
                    // «[tx]» marca lo que se ejecuta dentro de una transacción abierta.
                    consultas.push(`${db.inTransaction ? "[tx] " : ""}${sql.replace(/\s+/g, " ").trim()}`);
                    return f(...args);
                };
            }
            return st;
        });
        jest.doMock("../src/systems/xp/progreso", () => ({ addXp: jest.fn(async () => {}) }));
        jest.doMock("../src/systems/achievementsSystem", () => ({ applyEvent: jest.fn(async () => []) }));
        jest.doMock("../src/systems/pase/pase", () => ({ registrarSeguro: jest.fn() }));
        config = require("../src/systems/xp/config");
        ({ handleMessageXp } = require("../src/systems/xp/actividad"));
        ({ addXp } = require("../src/systems/xp/progreso"));
    });
});

beforeEach(() => {
    addXp.mockClear();
    config.ensureGuildDefaults(G);
});

let n = 0;
function mensaje({ userId = `rend-${++n}`, channelId = "canal", contenido = "hola" } = {}) {
    return {
        content: contenido,
        channelId,
        author: { id: userId, bot: false },
        member: { id: userId },
        guild: { id: G, members: { fetch: async () => null } },
    };
}
const desde = async (fn) => {
    const antes = consultas.length;
    await fn();
    return consultas.slice(antes);
};

describe("consultas por mensaje", () => {
    test("un mensaje dentro del cooldown hace como mucho una consulta", async () => {
        const u = `cd-${++n}`;
        await handleMessageXp(mensaje({ userId: u })); // este cuenta y arranca el cooldown
        await handleMessageXp(mensaje({ userId: u })); // calienta la configuración guardada
        const hechas = await desde(() => handleMessageXp(mensaje({ userId: u })));
        expect(hechas).toHaveLength(1);
        expect(hechas[0]).toMatch(/^SELECT ultimo_msg FROM xp_users/); // una sola lectura, sin transacción
        expect(addXp).toHaveBeenCalledTimes(1);
    });

    test("un mensaje que cuenta lee lo mínimo y escribe en una transacción, antes de dar la XP", async () => {
        const u = `cuenta-${++n}`;
        await handleMessageXp(mensaje({ userId: u })); // calienta la configuración
        const v = `cuenta-${++n}`;
        const hechas = await desde(() => handleMessageXp(mensaje({ userId: v })));
        expect(hechas.map((s) => s.split(" ").slice(0, 4).join(" "))).toEqual([
            "SELECT ultimo_msg FROM xp_users",
            "SELECT 1 FROM xp_ignored_channels",
            "[tx] INSERT OR IGNORE",
            "[tx] UPDATE xp_users SET",
        ]);
        expect(addXp).toHaveBeenCalledTimes(2);
    });

    test("un canal ignorado, o quien está en cooldown, no escribe nada", async () => {
        db.prepare("INSERT OR IGNORE INTO xp_ignored_channels (guildId, channelId) VALUES (?, 'ignorado')").run(G);
        const hechas = await desde(() => handleMessageXp(mensaje({ channelId: "ignorado" })));
        expect(hechas.some((s) => /^(INSERT|UPDATE)/.test(s))).toBe(false);
        expect(addXp).not.toHaveBeenCalled();
        // Y quien escribe en un canal ignorado no se queda con fila de XP.
        const u = `ign-${++n}`;
        await handleMessageXp(mensaje({ userId: u, channelId: "ignorado" }));
        expect(db.prepare("SELECT COUNT(*) AS n FROM xp_users WHERE guildId = ? AND userId = ?").get(G, u).n).toBe(0);
    });

    test("no se prepara ninguna sentencia nueva por mensaje", async () => {
        await handleMessageXp(mensaje());
        const preparar = db.prepare.mock.calls.length;
        for (let i = 0; i < 20; i++) await handleMessageXp(mensaje());
        expect(db.prepare.mock.calls.length).toBe(preparar);
    });
});

describe("configuración guardada", () => {
    test("se lee una vez y cambia en cuanto se guarda un valor con setConfig", async () => {
        const base = Number(config.getConfig(G, "xp_message_base"));
        await handleMessageXp(mensaje());
        expect(addXp.mock.calls.at(-1)[2]).toBe(
            Math.max(1, base + Math.floor((4 / 200) * Number(config.getConfig(G, "xp_message_len_bonus_max")))),
        );

        const antes = consultas.length;
        await handleMessageXp(mensaje());
        expect(consultas.slice(antes).some((s) => /FROM xp_config/.test(s))).toBe(false); // sin leer la configuración

        config.setConfig(G, "xp_message_base", base + 30);
        await handleMessageXp(mensaje());
        expect(addXp.mock.calls.at(-1)[2]).toBeGreaterThanOrEqual(base + 30);
        config.setConfig(G, "xp_message_base", base);
    });

    test("el cooldown configurado se aplica enseguida tras cambiarlo", async () => {
        const u = `cdcfg-${++n}`;
        config.setConfig(G, "xp_message_cooldown_sec", 3600);
        await handleMessageXp(mensaje({ userId: u }));
        await handleMessageXp(mensaje({ userId: u }));
        expect(addXp).toHaveBeenCalledTimes(1);
        config.setConfig(G, "xp_message_cooldown_sec", 0);
        await handleMessageXp(mensaje({ userId: u }));
        expect(addXp).toHaveBeenCalledTimes(2);
        config.setConfig(G, "xp_message_cooldown_sec", 15);
    });
});

describe("coste", () => {
    test("un mensaje dentro del cooldown cuesta menos de 20 µs, y uno que cuenta, menos de 100 µs (sin Discord)", async () => {
        const u = `bench-${++n}`;
        await handleMessageXp(mensaje({ userId: u }));
        const veces = 3000;
        let t0 = performance.now();
        for (let i = 0; i < veces; i++) await handleMessageXp(mensaje({ userId: u }));
        const enCooldown = ((performance.now() - t0) * 1000) / veces;
        expect(enCooldown).toBeLessThan(20);

        config.setConfig(G, "xp_message_cooldown_sec", 0);
        t0 = performance.now();
        for (let i = 0; i < veces; i++) await handleMessageXp(mensaje({ userId: `b-${i % 50}` }));
        const cuenta = ((performance.now() - t0) * 1000) / veces;
        config.setConfig(G, "xp_message_cooldown_sec", 15);
        expect(cuenta).toBeLessThan(100);
    });
});
