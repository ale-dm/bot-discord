// 🛡️ Guardia del Duende (#553), sistema: entra al canal y se queda sin temporizador, se guarda en la BD, vuelve a su canal
// al arrancar (o se descarta si el canal ya no está o faltan permisos), /conectar y /conversación no la tocan, y si la
// conexión se destruye se acaba y se borra su registro. BD en memoria; Discord y la voz no se llaman (dobles inyectados).
const { EventEmitter } = require("events");
const db = require("../src/core/db");
const presencia = require("../src/systems/presencia");
const guardia = require("../src/systems/guardia");
const { comprobarInicio } = require("../src/services/duende/liveVoz/sesion");
const conectarCmd = require("../src/commands/voz/conectar");

const G = "g-guardia";
const EFIMERO = 64;

function conexion() {
    const c = new EventEmitter();
    c.subscribe = jest.fn();
    c.destroy = jest.fn(() => c.emit("destroyed"));
    return c;
}
const deps = (c = conexion(), extra = {}) => ({ unirse: jest.fn(() => c), esperarListo: async () => {}, ...extra });
const guild = { id: G, voiceAdapterCreator: () => {}, members: { me: {} } };
const canal = (id = "v1", permisos = true) => ({
    id,
    name: `Voz ${id}`,
    guild,
    isVoiceBased: () => true,
    permissionsFor: () => (permisos ? { has: () => true } : null),
});
const fila = () => db.prepare("SELECT * FROM guardia_voz WHERE guildId = ?").get(G);
const sembrar = (canalId, porUserId = "ana", creada = 1_700_000_000_000) =>
    db.prepare("INSERT INTO guardia_voz (guildId, canalId, porUserId, creada_en) VALUES (?, ?, ?, ?)").run(G, canalId, porUserId, creada);
// Un cliente de Discord con el servidor y sus canales de voz (`canales`: los que existen).
const cliente = (canales) => ({
    guilds: {
        cache: new Map([[G, { ...guild, channels: { cache: new Map(canales.map((c) => [c.id, c])), fetch: async () => null } }]]),
    },
});

beforeEach(() => {
    presencia.desconectar(G);
    db.prepare("DELETE FROM guardia_voz").run();
    guardia.apagando(false);
});
afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
});

describe("poner la guardia", () => {
    test("entra al canal, guarda quién la puso y no programa salida", async () => {
        const d = deps();
        const r = await guardia.poner(canal("v1"), { porUserId: "ana", deps: d });
        expect(r).toMatchObject({ ok: true, canal: "Voz v1" });
        expect(d.unirse).toHaveBeenCalledWith(expect.objectContaining({ channelId: "v1", guildId: G }));
        expect(guardia.actual(G)).toMatchObject({ canalId: "v1", porUserId: "ana" });
        expect(presencia.actual(G).expira).toBeNull();
        expect(fila()).toMatchObject({ canalId: "v1", porUserId: "ana" });
    });

    test("no caduca: tres horas después sigue en el canal", async () => {
        jest.useFakeTimers();
        const c = conexion();
        await guardia.poner(canal("v1"), { porUserId: "ana", deps: deps(c) });
        jest.advanceTimersByTime(3 * 60 * 60 * 1000);
        expect(c.destroy).not.toHaveBeenCalled();
        expect(guardia.actual(G)).not.toBeNull();
        expect(fila()).toBeDefined();
    });

    test("sin permisos para conectar o hablar, no entra ni guarda nada", async () => {
        const d = deps();
        const r = await guardia.poner(canal("v1", false), { porUserId: "ana", deps: d });
        expect(r.ok).toBe(false);
        expect(r.motivo).toMatch(/permisos/);
        expect(d.unirse).not.toHaveBeenCalled();
        expect(fila()).toBeUndefined();
    });

    test("sustituye a la presencia de /conectar", async () => {
        const previa = conexion();
        await presencia.conectar(canal("v1"), { deps: deps(previa) });
        const r = await guardia.poner(canal("v2"), { porUserId: "ana", deps: deps() });
        expect(r.ok).toBe(true);
        expect(previa.destroy).toHaveBeenCalled();
        expect(guardia.actual(G).canalId).toBe("v2");
    });

    test("moverla a otro canal deja un solo registro, el del canal nuevo", async () => {
        const primera = conexion();
        await guardia.poner(canal("v1"), { porUserId: "ana", deps: deps(primera) });
        await guardia.poner(canal("v2"), { porUserId: "admin", deps: deps() });
        expect(primera.destroy).toHaveBeenCalled();
        expect(db.prepare("SELECT COUNT(*) AS n FROM guardia_voz").get().n).toBe(1);
        expect(fila()).toMatchObject({ canalId: "v2", porUserId: "admin" });
    });
});

describe("quién puede dejarla", () => {
    test("quien la puso y los admins pueden; el resto no", async () => {
        await guardia.poner(canal("v1"), { porUserId: "ana", deps: deps() });
        expect(guardia.puedeGestionar(G, "ana", false)).toBe(true);
        expect(guardia.puedeGestionar(G, "luis", true)).toBe(true);
        expect(guardia.puedeGestionar(G, "luis", false)).toBe(false);
    });

    test("dejarla desconecta y borra el registro", async () => {
        const c = conexion();
        await guardia.poner(canal("v1"), { porUserId: "ana", deps: deps(c) });
        expect(guardia.dejar(G, "ana")).toBe(true);
        expect(c.destroy).toHaveBeenCalled();
        expect(guardia.actual(G)).toBeNull();
        expect(fila()).toBeUndefined();
    });
});

describe("si la conexión se cae", () => {
    test("si la conexión se destruye, la guardia se acaba y se borra su registro", async () => {
        const c = conexion();
        await guardia.poner(canal("v1"), { porUserId: "ana", deps: deps(c) });
        c.emit("destroyed");
        expect(guardia.actual(G)).toBeNull();
        expect(fila()).toBeUndefined();
    });

    test("si me echan del canal y no se recupera, cierra la conexión y se acaba", async () => {
        const c = conexion();
        const d = deps(c, { esperarReconexion: async () => Promise.reject(new Error("sin volver")) });
        await guardia.poner(canal("v1"), { porUserId: "ana", deps: d });
        c.emit("disconnected");
        await new Promise((r) => setImmediate(r));
        expect(c.destroy).toHaveBeenCalled();
        expect(guardia.actual(G)).toBeNull();
        expect(fila()).toBeUndefined();
    });

    test("si el corte se recupera solo (me mueven), la guardia sigue", async () => {
        const c = conexion();
        await guardia.poner(canal("v1"), { porUserId: "ana", deps: deps(c, { esperarReconexion: async () => {} }) });
        c.emit("disconnected");
        await new Promise((r) => setImmediate(r));
        expect(c.destroy).not.toHaveBeenCalled();
        expect(guardia.actual(G)).not.toBeNull();
    });

    test("al apagar el bot, cerrar la voz no borra el registro", async () => {
        const c = conexion();
        await guardia.poner(canal("v1"), { porUserId: "ana", deps: deps(c) });
        guardia.apagando();
        c.emit("destroyed");
        expect(fila()).toMatchObject({ canalId: "v1" });
    });
});

describe("al arrancar", () => {
    test("vuelve al mismo canal con quien la puso y la fecha original", async () => {
        sembrar("v1", "ana", 1_700_000_000_000);
        const d = deps();
        const r = await guardia.recuperarAlArrancar(cliente([canal("v1")]), { deps: d });
        expect(r).toEqual({ recuperadas: 1, descartadas: 0 });
        expect(d.unirse).toHaveBeenCalledWith(expect.objectContaining({ channelId: "v1" }));
        expect(guardia.actual(G)).toMatchObject({ canalId: "v1", porUserId: "ana", desde: 1_700_000_000_000 });
        expect(fila()).toMatchObject({ canalId: "v1", creada_en: 1_700_000_000_000 });
    });

    test("si el canal ya no existe, descarta el registro y no se conecta", async () => {
        sembrar("v-borrado");
        const d = deps();
        const r = await guardia.recuperarAlArrancar(cliente([canal("v1")]), { deps: d });
        expect(r).toEqual({ recuperadas: 0, descartadas: 1 });
        expect(d.unirse).not.toHaveBeenCalled();
        expect(fila()).toBeUndefined();
    });

    test("si faltan permisos en el canal, descarta el registro", async () => {
        sembrar("v1");
        const d = deps();
        const r = await guardia.recuperarAlArrancar(cliente([canal("v1", false)]), { deps: d });
        expect(r.descartadas).toBe(1);
        expect(d.unirse).not.toHaveBeenCalled();
        expect(guardia.actual(G)).toBeNull();
        expect(fila()).toBeUndefined();
    });
});

describe("/conectar y /conversación con la guardia puesta", () => {
    const interaccion = (opciones = {}) => ({
        guildId: G,
        member: { voice: { channel: canal("v2") } },
        options: {
            getChannel: () => opciones.canal ?? null,
            getInteger: () => opciones.minutos ?? null,
            getString: () => null,
        },
        reply: jest.fn(async () => {}),
        deferReply: jest.fn(async () => {}),
        editReply: jest.fn(async () => {}),
    });

    test("/conectar sin canal no la cierra: avisa de que está de guardia", async () => {
        const c = conexion();
        await guardia.poner(canal("v1"), { porUserId: "ana", deps: deps(c) });
        const i = interaccion();
        await conectarCmd.run(null, i);
        expect(i.reply.mock.calls[0][0]).toMatchObject({ flags: EFIMERO, content: expect.stringMatching(/de guardia en \*\*Voz v1\*\*/) });
        expect(c.destroy).not.toHaveBeenCalled();
        expect(fila()).toBeDefined();
    });

    test("/conectar con minutos no la renueva ni le pone caducidad", async () => {
        await guardia.poner(canal("v1"), { porUserId: "ana", deps: deps() });
        await conectarCmd.run(null, interaccion({ minutos: 15 }));
        expect(presencia.actual(G).expira).toBeNull();
        expect(presencia.renovar(G, 15)).toMatchObject({ ok: false, motivo: expect.stringMatching(/de guardia/) });
    });

    test("/conectar a otro canal no la sustituye", async () => {
        await guardia.poner(canal("v1"), { porUserId: "ana", deps: deps() });
        const i = interaccion({ canal: canal("v2") });
        await conectarCmd.run(null, i);
        expect(i.deferReply).not.toHaveBeenCalled();
        expect(guardia.actual(G).canalId).toBe("v1");
        // Ni llamando a la presencia directamente.
        const d = deps();
        const r = await presencia.conectar(canal("v2"), { deps: d });
        expect(r.ok).toBe(false);
        expect(d.unirse).not.toHaveBeenCalled();
    });

    test("/conversación no empieza: dice que está de guardia y la guardia sigue", async () => {
        const c = conexion();
        await guardia.poner(canal("v1"), { porUserId: "ana", deps: deps(c) });
        const r = comprobarInicio({ guildId: G, member: { voice: { channel: canal("v1") } }, guild }, {});
        expect(r.error).toMatch(/de guardia.*no puedo hablar/);
        expect(c.destroy).not.toHaveBeenCalled();
        expect(guardia.actual(G)).not.toBeNull();
    });
});
