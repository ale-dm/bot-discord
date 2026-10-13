// #429: /ayuda buscar:palabra. Busca en las líneas de la guía sin distinguir tildes ni mayúsculas, con un botón por cada
// sección donde está, y nunca enseña la sección Admin a quien no es admin.
const ayuda = require("../src/commands/general/ayuda");

const { SECCIONES, buscarEnGuia } = ayuda.__test;

const interaccion = ({ admin = false, buscar = null } = {}) => ({
    guildId: "g-ayuda-buscar",
    user: { id: "u", username: "u", tag: "u" },
    member: { permissions: { has: () => admin }, roles: { cache: new Map() } },
    memberPermissions: { has: () => admin },
    options: { getString: (n) => (n === "buscar" ? buscar : null) },
    reply: jest.fn(async () => {}),
});
const ids = (payload) => payload.components.flatMap((r) => r.components.map((b) => b.data.custom_id));
const texto = (payload) => payload.embeds[0].data.description;

describe("buscarEnGuia", () => {
    test("encuentra las líneas que mencionan la palabra, con su sección", () => {
        const r = buscarEnGuia("tienda", interaccion());
        expect(r.length).toBeGreaterThan(0);
        expect(r.every((x) => /tienda/i.test(x.linea))).toBe(true);
        expect(r.some((x) => x.seccion === "economia")).toBe(true);
    });

    test("ignora tildes y mayúsculas", () => {
        const a = buscarEnGuia("ECONOMIA", interaccion()).map((x) => x.linea);
        const b = buscarEnGuia("economía", interaccion()).map((x) => x.linea);
        expect(a.length).toBeGreaterThan(0);
        expect(a).toEqual(b);
    });

    test("una búsqueda demasiado corta no devuelve nada", () => {
        expect(buscarEnGuia("a", interaccion())).toEqual([]);
        expect(buscarEnGuia("  ", interaccion())).toEqual([]);
    });
});

describe("/ayuda buscar:", () => {
    test("muestra las líneas y un botón por cada sección donde está", async () => {
        const i = interaccion({ buscar: "sonidos" });
        await ayuda.run({}, i);
        const payload = i.reply.mock.calls[0][0];
        expect(payload.embeds[0].data.title).toBe("🔎 «sonidos»");
        expect(texto(payload)).toMatch(/sonidos/i);
        expect(ids(payload)).toContain("ayuda_voz");
        expect(ids(payload)).toContain("ayuda_inicio");
        expect(payload.components.length).toBeLessThanOrEqual(5);
    });

    test("sin resultados lo dice y sugiere el inicio, sin fallar", async () => {
        const i = interaccion({ buscar: "zzzxyzzy" });
        await ayuda.run({}, i);
        const payload = i.reply.mock.calls[0][0];
        expect(texto(payload)).toMatch(/No lo encuentro/);
        expect(texto(payload)).toMatch(/Inicio/);
        expect(ids(payload)).toContain("ayuda_inicio");
    });

    test("sin `buscar`, /ayuda sale como siempre", async () => {
        const i = interaccion();
        await ayuda.run({}, i);
        expect(i.reply.mock.calls[0][0].embeds[0].data.title).toBe("🤖 Guía de El Duende");
    });

    test("una palabra de una sola letra pide más letras en vez de buscar", async () => {
        const i = interaccion({ buscar: "a" });
        await ayuda.run({}, i);
        expect(texto(i.reply.mock.calls[0][0])).toMatch(/al menos 2 letras/);
    });

    test("quien no es admin no ve nada de la sección Admin; un admin sí", async () => {
        expect(SECCIONES.admin.texto.some((l) => /auditor/i.test(l))).toBe(true);

        expect(buscarEnGuia("auditoría", interaccion({ admin: false }))).toEqual([]);
        const noAdmin = interaccion({ buscar: "auditoria", admin: false });
        await ayuda.run({}, noAdmin);
        const p = noAdmin.reply.mock.calls[0][0];
        expect(texto(p)).toMatch(/No lo encuentro/);
        expect(ids(p)).not.toContain("ayuda_admin");

        const admin = interaccion({ buscar: "auditoria", admin: true });
        await ayuda.run({}, admin);
        const pa = admin.reply.mock.calls[0][0];
        expect(ids(pa)).toContain("ayuda_admin");
        expect(texto(pa)).toMatch(/auditoría/i);
    });

    test("no se pasa de los límites de Discord con una palabra que sale en muchas líneas", async () => {
        const i = interaccion({ buscar: "de", admin: true });
        await ayuda.run({}, i);
        const payload = i.reply.mock.calls[0][0];
        expect(texto(payload).length).toBeLessThanOrEqual(4096);
        expect(payload.components.length).toBeLessThanOrEqual(5);
    });
});
