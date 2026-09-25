// Lógica que mueve dinero o progreso: reglas del blackjack, fórmula y subida de nivel de XP,
// y cobro de la tienda. BD en memoria (tests/setupEnv.js).
const db = require("../src/core/db");
const { crearBaraja, handValue, esBlackjack } = require("../src/systems/blackjack");
const xp = require("../src/systems/xpSystem");
const { cobrarCompra } = require("../src/systems/tienda");

const c = (value) => ({ value, suit: "♠️", display: String(value) });

describe("blackjack", () => {
    test("la baraja tiene 52 cartas por mazo con los valores correctos", () => {
        const b = crearBaraja(4);
        expect(b).toHaveLength(208);
        expect(b.filter((x) => x.value === 11)).toHaveLength(16); // ases
        expect(b.filter((x) => x.value === 10)).toHaveLength(64); // 10, J, Q, K
    });

    test("los ases valen 11 o 1 según convenga", () => {
        expect(handValue([c(11), c(9)])).toBe(20);
        expect(handValue([c(11), c(9), c(5)])).toBe(15);
        expect(handValue([c(11), c(11)])).toBe(12);
        expect(handValue([c(11), c(11), c(11), c(10)])).toBe(13);
        expect(handValue([c(10), c(10), c(5)])).toBe(25); // pasado
    });

    test("blackjack natural solo con dos cartas que suman 21", () => {
        expect(esBlackjack([c(11), c(10)])).toBe(true);
        expect(esBlackjack([c(7), c(7), c(7)])).toBe(false);
        expect(esBlackjack([c(10), c(9)])).toBe(false);
    });
});

describe("XP", () => {
    const G = "guild-xp-dinero";
    // Servidor y miembro mínimos: sin canal de anuncios ni roles, los DM fallan en silencio.
    const guild = {
        id: G,
        name: "Servidor de prueba",
        channels: { cache: new Map(), fetch: async () => null },
        roles: { cache: new Map() },
        client: {
            users: {
                fetch: async () => {
                    throw new Error("sin DMs");
                },
            },
        },
    };
    const member = { id: "u-xp", roles: { add: async () => {} }, toString: () => "<@u-xp>" };

    test("la XP necesaria sigue la fórmula configurada", () => {
        xp.ensureGuildDefaults(G);
        // 100 × (n+1)^1.5 × 1.6 × 10
        expect(xp.xpForNextLevel(0, G)).toBe(1600);
        expect(xp.xpForNextLevel(3, G)).toBe(Math.floor(100 * Math.pow(4, 1.5) * 1.6 * 10));
    });

    test("un multiplicador de coste por usuario encarece sus niveles", () => {
        xp.setUserCostMultiplier(G, "lento", 3);
        expect(xp.xpForNextLevel(0, G, "lento")).toBe(3 * xp.xpForNextLevel(0, G));
        xp.removeUserCostMultiplier(G, "lento");
    });

    test("addXp sube de nivel, arrastra el sobrante y guarda el historial", async () => {
        xp.setConfig(G, "streak_enabled", "0");
        const r = await xp.addXp(guild, member, 1600 + 500);
        expect(r.nivel).toBe(1);
        expect(r.xp).toBe(500);
        expect(xp.getLevelHistory(G, "u-xp", 5).map((h) => h.nivel)).toEqual([1]);
    });

    test("la racha multiplica la XP ganada", async () => {
        xp.setConfig(G, "streak_enabled", "1");
        const r = await xp.addXp(guild, { ...member, id: "u-racha" }, 100);
        // Primer día de racha: +2 %.
        expect(r.gain).toBe(102);
    });
});

describe("tienda: cobro de una compra", () => {
    const item = (over = {}) => ({ id: 1, tiendaId: 1, nombre: "Palote", precio: 300, stock: 1, ...over });
    const saldo = (u) => db.prepare("SELECT enMano AS saldo FROM banco WHERE userId = ?").get(u).saldo;
    const inventario = (u) => db.prepare("SELECT COUNT(*) c FROM inventario WHERE userId = ?").get(u).c;

    beforeAll(() => {
        db.prepare("INSERT INTO objeto (id, nombre, descripcion) VALUES (1, 'Palote', 'un palo')").run();
        db.prepare("INSERT INTO tienda (id, objetoId, precio, stock) VALUES (1, 1, 300, 1)").run();
        db.prepare("INSERT INTO banco (userId, saldo, enMano) VALUES ('rico', 0, 1000), ('pobre', 0, 100), ('tarde', 0, 1000)").run();
    });

    test("sin saldo no se cobra ni se entrega nada", () => {
        expect(cobrarCompra("pobre", item())).toBe(false);
        expect(saldo("pobre")).toBe(100);
        expect(inventario("pobre")).toBe(0);
    });

    test("con saldo se cobra, se entrega, se apunta y baja el stock", () => {
        expect(cobrarCompra("rico", item())).toBe(true);
        expect(saldo("rico")).toBe(700);
        expect(inventario("rico")).toBe(1);
        expect(db.prepare("SELECT stock FROM tienda WHERE id = 1").get().stock).toBe(0);
        expect(db.prepare("SELECT cantidad FROM historial WHERE userId = 'rico'").get().cantidad).toBe(-300);
    });

    test("sin stock se revierte todo (no se cobra aunque el saldo llegue)", () => {
        expect(cobrarCompra("tarde", item())).toBe(false);
        expect(saldo("tarde")).toBe(1000);
        expect(inventario("tarde")).toBe(0);
    });

    test("stock ilimitado (null) no se agota", () => {
        expect(cobrarCompra("tarde", item({ stock: null }))).toBe(true);
        expect(saldo("tarde")).toBe(700);
    });
});
