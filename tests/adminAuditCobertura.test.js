// Registro de acciones de admin (systems/adminAudit.js): qué se guarda en admin_audit, cuándo se rechaza una acción sin
// datos, cómo se ocultan los secretos en el log de fichero y cómo se lee la lista reciente. Usa la BD en memoria real.
// Solo se simula el logger del módulo de auditoría, para poder leer lo que se escribe en el log.
const mockInfo = jest.fn();
jest.mock("../src/core/logger", () => {
    const real = jest.requireActual("../src/core/logger");
    return {
        ...real,
        createLogger: (ambito) => {
            const log = real.createLogger(ambito);
            return ambito === "Auditoría" ? { ...log, info: (...args) => mockInfo(...args) } : log;
        },
    };
});

const db = require("../src/core/db");
const adminAudit = require("../src/systems/adminAudit");

let n = 0;
const nuevoServidor = () => `g-audit-${++n}`;

const filas = (guildId) => db.prepare("SELECT COUNT(*) AS n FROM admin_audit WHERE guildId = ?").get(guildId).n;

afterEach(() => jest.restoreAllMocks());

describe("logAdminAction: guardar una acción", () => {
    test("sin servidor, sin admin o sin acción no guarda nada y lo devuelve como false", () => {
        const g = nuevoServidor();

        expect(adminAudit.logAdminAction({ guildId: null, actorId: "a1", action: "x" })).toBe(false);
        expect(adminAudit.logAdminAction({ guildId: g, actorId: "", action: "x" })).toBe(false);
        expect(adminAudit.logAdminAction({ guildId: g, actorId: "a1" })).toBe(false);
        expect(filas(g)).toBe(0);
    });

    test("guarda la acción con sus detalles en JSON y la fecha", () => {
        const g = nuevoServidor();
        const antes = Date.now();

        expect(adminAudit.logAdminAction({ guildId: g, actorId: "a1", action: "bank.balance.modify", details: { cantidad: 50 } })).toBe(
            true,
        );

        const fila = db.prepare("SELECT * FROM admin_audit WHERE guildId = ?").get(g);
        expect(fila).toMatchObject({ actorId: "a1", action: "bank.balance.modify", details: '{"cantidad":50}' });
        expect(fila.createdAt).toBeGreaterThanOrEqual(antes);
    });

    test("sin detalles guarda null", () => {
        const g = nuevoServidor();

        adminAudit.logAdminAction({ guildId: g, actorId: "a1", action: "seerr.channels.clear" });

        expect(db.prepare("SELECT details FROM admin_audit WHERE guildId = ?").get(g).details).toBeNull();
    });

    test("si la base de datos falla, avisa con false y no lanza", () => {
        const g = nuevoServidor();
        jest.spyOn(db, "prepare").mockImplementationOnce(() => {
            throw new Error("disco lleno");
        });

        expect(adminAudit.logAdminAction({ guildId: g, actorId: "a1", action: "x" })).toBe(false);
        expect(filas(g)).toBe(0);
    });

    test("en admin_audit los secretos se guardan como ***", () => {
        const g = nuevoServidor();

        adminAudit.logAdminAction({ guildId: g, actorId: "a1", action: "settings.update", details: { apiKey: "clave-789", ok: 2 } });

        const fila = db.prepare("SELECT details FROM admin_audit WHERE guildId = ?").get(g);
        expect(JSON.parse(fila.details)).toEqual({ apiKey: "***", ok: 2 });
    });

    test("en el log de fichero los secretos salen como ***, pero lo demás no cambia", () => {
        const g = nuevoServidor();
        mockInfo.mockClear();

        adminAudit.logAdminAction({
            guildId: g,
            actorId: "a1",
            action: "settings.update",
            details: { apiKey: "clave-123", nested: { access_token: "t-456", ok: 1 }, password: "" },
        });

        const linea = mockInfo.mock.calls.at(-1)[0];
        expect(linea).toContain(`settings.update por a1 en ${g}`);
        expect(linea).toContain('"apiKey":"***"');
        expect(linea).toContain('"access_token":"***"');
        expect(linea).toContain('"ok":1');
        expect(linea).toContain('"password":""');
        expect(linea).not.toContain("clave-123");
        expect(linea).not.toContain("t-456");
    });
});

describe("listRecent: la lista reciente", () => {
    test("sin servidor no devuelve nada", () => {
        expect(adminAudit.listRecent(null)).toEqual([]);
    });

    test("devuelve lo más reciente primero, con los detalles ya leídos", () => {
        const g = nuevoServidor();
        adminAudit.logAdminAction({ guildId: g, actorId: "a1", action: "primera", details: { n: 1 } });
        adminAudit.logAdminAction({ guildId: g, actorId: "a2", action: "segunda" });

        const lista = adminAudit.listRecent(g);

        expect(lista.map((r) => r.action)).toEqual(["segunda", "primera"]);
        expect(lista[0].details).toBeNull();
        expect(lista[1].details).toEqual({ n: 1 });
    });

    test("un detalle que no es JSON válido se devuelve como null", () => {
        const g = nuevoServidor();
        db.prepare("INSERT INTO admin_audit (guildId, actorId, action, details, createdAt) VALUES (?, ?, ?, ?, ?)").run(
            g,
            "a1",
            "roto",
            "no es json{",
            Date.now(),
        );

        expect(adminAudit.listRecent(g)[0]).toMatchObject({ action: "roto", details: null });
    });

    test("el límite por defecto es 20, y no pasa de 100 ni baja de 1", () => {
        const g = nuevoServidor();
        for (let i = 0; i < 120; i++) {
            adminAudit.logAdminAction({ guildId: g, actorId: "a1", action: `acc-${i}` });
        }

        expect(adminAudit.listRecent(g)).toHaveLength(20);
        expect(adminAudit.listRecent(g, 0)).toHaveLength(20);
        expect(adminAudit.listRecent(g, "abc")).toHaveLength(20);
        expect(adminAudit.listRecent(g, 500)).toHaveLength(100);
        expect(adminAudit.listRecent(g, 3)).toHaveLength(3);
        expect(adminAudit.listRecent(g, -5)).toHaveLength(1);
    });

    test("solo muestra las acciones de ese servidor", () => {
        const g = nuevoServidor();
        const otro = nuevoServidor();
        adminAudit.logAdminAction({ guildId: otro, actorId: "a1", action: "ajena" });
        adminAudit.logAdminAction({ guildId: g, actorId: "a1", action: "propia" });

        expect(adminAudit.listRecent(g).map((r) => r.action)).toEqual(["propia"]);
    });
});
