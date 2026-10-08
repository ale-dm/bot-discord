// 🔌 /conectar (presencia del bot en un canal de voz, 30 minutos): entra y se queda, se sale sola al caducar, sustituye a la
// anterior, no se corta una conversación con el Duende en marcha, y pide permisos. Discord y la voz no se llaman.
const { EventEmitter } = require("events");
const presencia = require("../src/systems/presencia");
const liveVoz = require("../src/services/duende/liveVoz");

const G = "g-presencia";
const canal = (id = "c1", permisos = true) => ({
    id,
    name: `Canal ${id}`,
    guild: { id: G, voiceAdapterCreator: () => {}, members: { me: {} } },
    permissionsFor: () => (permisos ? { has: () => true } : null),
});
function conexion() {
    const c = new EventEmitter();
    c.subscribe = jest.fn();
    c.destroy = jest.fn(() => c.emit("destroyed"));
    return c;
}
const deps = (c = conexion()) => ({ unirse: jest.fn(() => c), esperarListo: async () => {} });

beforeEach(() => {
    presencia.desconectar(G);
    jest.spyOn(liveVoz, "hayConversacionActiva").mockReturnValue(false);
});
afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
});

test("entra al canal y queda activa 30 minutos", async () => {
    jest.useFakeTimers();
    const c = conexion();
    const d = deps(c);
    const r = await presencia.conectar(canal("c1"), { deps: d });
    expect(r).toMatchObject({ ok: true, canal: "Canal c1" });
    expect(d.unirse).toHaveBeenCalledWith(expect.objectContaining({ channelId: "c1", guildId: G, selfDeaf: true }));
    expect(presencia.actual(G)).not.toBeNull();
    expect(r.expira - Date.now()).toBeGreaterThan(29 * 60 * 1000);
});

test("pasados los 30 minutos se sale sola", async () => {
    jest.useFakeTimers();
    const c = conexion();
    await presencia.conectar(canal("c1"), { deps: deps(c) });
    jest.advanceTimersByTime(29 * 60 * 1000);
    expect(c.destroy).not.toHaveBeenCalled();
    jest.advanceTimersByTime(60 * 1000);
    expect(c.destroy).toHaveBeenCalled();
    expect(presencia.actual(G)).toBeNull();
});

test("si ya está en otro canal, lo cambia (sale del anterior)", async () => {
    const primera = conexion();
    const segunda = conexion();
    await presencia.conectar(canal("c1"), { deps: deps(primera) });
    await presencia.conectar(canal("c2"), { deps: deps(segunda) });
    expect(primera.destroy).toHaveBeenCalled();
    expect(presencia.actual(G).canalId).toBe("c2");
});

test("si Discord me echa, la presencia se olvida", async () => {
    const c = conexion();
    await presencia.conectar(canal("c1"), { deps: deps(c) });
    c.emit("destroyed");
    expect(presencia.actual(G)).toBeNull();
});

test("con una conversación con el Duende en marcha, no entra", async () => {
    liveVoz.hayConversacionActiva.mockReturnValue(true);
    const d = deps();
    const r = await presencia.conectar(canal("c1"), { deps: d });
    expect(r.ok).toBe(false);
    expect(r.motivo).toMatch(/conversación de voz/);
    expect(d.unirse).not.toHaveBeenCalled();
});

test("sin permisos en el canal, no entra", async () => {
    const d = deps();
    const r = await presencia.conectar(canal("c1", false), { deps: d });
    expect(r.ok).toBe(false);
    expect(d.unirse).not.toHaveBeenCalled();
});

test("al caducar, si hay una conversación con el Duende, no se corta: se mira más tarde", async () => {
    jest.useFakeTimers();
    const c = conexion();
    await presencia.conectar(canal("c1"), { deps: deps(c) });
    liveVoz.hayConversacionActiva.mockReturnValue(true);
    jest.advanceTimersByTime(30 * 60 * 1000);
    expect(c.destroy).not.toHaveBeenCalled();
    liveVoz.hayConversacionActiva.mockReturnValue(false);
    jest.advanceTimersByTime(5 * 60 * 1000);
    expect(c.destroy).toHaveBeenCalled();
});

describe("no se corta un sonido a mitad", () => {
    const sonidos = require("../src/systems/sonidos");

    test("al caducar, si suena un sonido, se espera a que acabe", async () => {
        jest.useFakeTimers();
        const c = conexion();
        await presencia.conectar(canal("c1"), { deps: deps(c) });
        const suena = jest.spyOn(sonidos, "sonando").mockReturnValue(true);
        jest.advanceTimersByTime(30 * 60 * 1000);
        expect(c.destroy).not.toHaveBeenCalled();
        suena.mockReturnValue(false);
        jest.advanceTimersByTime(10 * 1000);
        expect(c.destroy).toHaveBeenCalled();
    });

    test("/conectar no sustituye la presencia mientras suena un sonido", async () => {
        const c = conexion();
        jest.spyOn(sonidos, "sonando").mockReturnValue(true);
        const r = await presencia.conectar(canal("c2"), { deps: deps(c) });
        expect(r.ok).toBe(false);
        expect(r.motivo).toMatch(/suena un sonido/);
        expect(presencia.actual(G)).toBeNull();
    });
});
