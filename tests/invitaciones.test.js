// 📨 Recompensa por invitar (#522): saber qué invitación se usó (la que sube de usos o una nueva, sin la vanity), apuntar la
// entrada con el anti-abuso (una vez por persona, autoinvitación, cuenta nueva, cruzada, ráfaga), madurar a los 7 días con
// nivel 5 (pago único, hitos), no pagar si se fue antes, y el enganche con Discord (foto de invitaciones, entrada, cron con DM).
const db = require("../src/core/db");
const dinero = require("../src/systems/dinero");
const impuestos = require("../src/systems/impuestos");
const avisosDm = require("../src/systems/avisosDm");
const invitaciones = require("../src/systems/invitaciones");
const envios = require("../src/discord/envios/invitaciones");
const { pantallaInvitaciones } = require("../src/paneles/invitaciones");

const G = "g-invit";
const AHORA = 1_800_000_000_000;
const DIA = 24 * 3600 * 1000;
const VIEJA = AHORA - 400 * DIA;

const efectivo = (u) => dinero.cuenta(u).efectivo;
const neto = (premio) => premio - (impuestos.calcularImpuesto(G, "premio", premio)?.impuesto || 0);
const entra = (invitadoId, invitadorId = "inv-ana", ahora = AHORA, cuentaCreada = VIEJA) =>
    invitaciones.registrar({ guildId: G, invitadoId, invitadorId, codigo: "abc", cuentaCreada }, ahora);

beforeEach(() => {
    db.prepare("DELETE FROM invitaciones").run();
    db.prepare("DELETE FROM banco WHERE userId LIKE 'inv-%'").run();
    db.prepare("DELETE FROM historial WHERE userId LIKE 'inv-%'").run();
});

describe("qué invitación se usó", () => {
    const antes = new Map([
        ["a", 3],
        ["b", 1],
    ]);
    test("la que ha subido de usos o una nueva con un uso, nunca la vanity ni una sin dueño", () => {
        expect(
            invitaciones.invitacionUsada(antes, [
                { code: "a", uses: 4, inviterId: "x" },
                { code: "b", uses: 1, inviterId: "y" },
            ]),
        ).toEqual({
            code: "a",
            inviterId: "x",
        });
        expect(invitaciones.invitacionUsada(antes, [{ code: "nueva", uses: 1, inviterId: "z" }])).toEqual({
            code: "nueva",
            inviterId: "z",
        });
        expect(invitaciones.invitacionUsada(new Map(), [{ code: "vanity", uses: 1, inviterId: "z" }], "vanity")).toBeNull();
        expect(invitaciones.invitacionUsada(new Map(), [{ code: "c", uses: 1, inviterId: null }])).toBeNull();
    });

    test("si no se puede saber cuál fue (dos a la vez), no se atribuye", () => {
        expect(
            invitaciones.invitacionUsada(antes, [
                { code: "a", uses: 4, inviterId: "x" },
                { code: "b", uses: 2, inviterId: "y" },
            ]),
        ).toBeNull();
    });
});

describe("anti-abuso", () => {
    test("cada persona cuenta una sola vez por servidor, aunque salga y vuelva", () => {
        expect(entra("inv-luis")).toMatchObject({ ok: true, estado: "pendiente" });
        expect(entra("inv-luis", "inv-eva").ok).toBe(false);
    });

    test("no cuentan la autoinvitación, las cuentas de menos de 7 días ni las cruzadas", () => {
        expect(entra("inv-ana", "inv-ana").motivo).toBe("autoinvitación");
        expect(entra("inv-nuevo", "inv-ana", AHORA, AHORA - DIA).motivo).toBe("cuenta nueva");
        entra("inv-luis", "inv-eva");
        expect(entra("inv-eva", "inv-luis").motivo).toBe("invitación cruzada");
    });

    test("más de 10 en 24 horas: las que pasan de ahí no cuentan", () => {
        for (let i = 0; i < invitaciones.RAFAGA_MAX; i++) expect(entra(`inv-r${i}`).estado).toBe("pendiente");
        expect(entra("inv-r-extra").motivo).toBe("ráfaga");
        expect(entra("inv-otro-dia", "inv-ana", AHORA + 2 * DIA).estado).toBe("pendiente");
    });
});

describe("madurar", () => {
    const madurar = (invitadoId, { esMiembro = true, nivel = 5, ahora = AHORA + 7 * DIA } = {}) =>
        invitaciones.madurar({ guildId: G, invitadoId, esMiembro, nivel }, ahora);

    test("a los 7 días con nivel 5 se paga 500 a quien invitó, una sola vez", () => {
        entra("inv-luis");
        expect(madurar("inv-luis", { ahora: AHORA + 6 * DIA })).toBeNull();
        expect(madurar("inv-luis", { nivel: 4 })).toBeNull();
        expect(madurar("inv-luis")).toMatchObject({ estado: "madurada", pagado: 500, hito: null });
        expect(efectivo("inv-ana")).toBe(1000 + neto(500));
        expect(madurar("inv-luis")).toBeNull();
    });

    test("si el invitado se fue antes de madurar, no se paga", () => {
        entra("inv-luis");
        expect(madurar("inv-luis", { esMiembro: false })).toMatchObject({ estado: "salio", pagado: 0 });
        expect(efectivo("inv-ana")).toBe(1000);
    });

    test("al quinto invitado madurado se suma el hito de 2.500", () => {
        for (let i = 0; i < 5; i++) entra(`inv-m${i}`, "inv-ana", AHORA + i * 3 * DIA);
        const pagos = [0, 1, 2, 3, 4].map((i) => madurar(`inv-m${i}`, { ahora: AHORA + 30 * DIA }).pagado);
        expect(pagos).toEqual([500, 500, 500, 500, 3000]);
        expect(invitaciones.resumen(G, "inv-ana")).toMatchObject({ maduradas: 5, cobrado: 5000, proximoHito: { invitados: 10 } });
        expect(invitaciones.ranking(G)).toEqual([{ userId: "inv-ana", invitados: 5 }]);
    });
});

describe("Discord", () => {
    function servidor(invites) {
        const miembros = new Map([["inv-luis", { id: "inv-luis" }]]);
        return {
            id: G,
            name: "Servidor",
            vanityURLCode: null,
            invites: {
                fetch: jest.fn(
                    async () => new Map(invites().map((i) => [i.code, { code: i.code, uses: i.uses, inviter: { id: i.inviter } }])),
                ),
            },
            members: { fetch: jest.fn(async (id) => miembros.get(id) || Promise.reject(new Error("Unknown Member"))) },
        };
    }

    test("al entrar alguien, compara con la foto y apunta a quien invitó", async () => {
        let usos = 2;
        const guild = servidor(() => [{ code: "ana1", uses: usos, inviter: "inv-ana" }]);
        await envios.cargar({ guilds: { cache: new Map([[G, guild]]) } });
        usos = 3;
        const r = await envios.alEntrar({ id: "inv-luis", guild, user: { bot: false, createdTimestamp: VIEJA } }, AHORA);
        expect(r).toMatchObject({ ok: true, estado: "pendiente" });
        expect(invitaciones.resumen(G, "inv-ana").pendientes).toBe(1);
    });

    test("sin permiso para ver las invitaciones no apunta nada ni rompe", async () => {
        const guild = { id: `${G}-sin`, invites: { fetch: jest.fn(async () => Promise.reject(new Error("Missing Permissions"))) } };
        expect(await envios.alEntrar({ id: "inv-x", guild, user: { bot: false } })).toBeNull();
    });

    test("el cron madura, paga y avisa por DM a quien invitó", async () => {
        entra("inv-luis");
        db.prepare("INSERT OR REPLACE INTO xp_users (guildId, userId, nivel) VALUES (?, 'inv-luis', 6)").run(G);
        const guild = servidor(() => []);
        const dm = jest.spyOn(avisosDm, "enviarAviso").mockResolvedValue(true);
        expect(await envios.revisar({ guilds: { cache: new Map([[G, guild]]) } }, AHORA + 8 * DIA)).toBe(1);
        expect(dm).toHaveBeenCalledWith(
            expect.anything(),
            "inv-ana",
            "invitaciones",
            expect.objectContaining({ content: expect.stringMatching(/cobras \*\*500\*\*/) }),
        );
        dm.mockRestore();
    });

    test("la pantalla resume los invitados y el ranking", () => {
        entra("inv-luis");
        entra("inv-x", "inv-ana", AHORA, AHORA);
        const e = pantallaInvitaciones(G, "inv-ana").embeds[0].toJSON();
        expect(e.fields[0].value).toMatch(/⏳ 1 pendientes .* 🚫 1 no cuentan/);
        expect(e.fields[1].value).toContain("🚫 <@inv-x> (cuenta nueva)");
    });
});
