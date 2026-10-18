// 🔌 /conectar (presencia del bot en un canal de voz, 30 minutos): entra y se queda, se sale sola al caducar, sustituye a la
// anterior, no se corta una conversación con el Duende, un sonido ni un /tts en marcha, y pide permisos. Discord y la voz no
// se llaman.
const { EventEmitter } = require("events");
const presencia = require("../src/systems/presencia");
const ocupacion = require("../src/systems/ocupacion");

const G = "g-presencia";
// Lo que dirían los consumidores de audio: se pone a `true` para simular que están ocupados (#499).
const ocupado = {};
ocupacion.registrar("conversacion", () => !!ocupado.conversacion, ocupacion.REINTENTO_LARGO_MS);
ocupacion.registrar("sonidos", () => !!ocupado.sonidos, ocupacion.REINTENTO_CORTO_MS);
ocupacion.registrar("tts", () => !!ocupado.tts, ocupacion.REINTENTO_CORTO_MS);

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
    for (const nombre of Object.keys(ocupado)) delete ocupado[nombre];
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
    ocupado.conversacion = true;
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
    ocupado.conversacion = true;
    jest.advanceTimersByTime(30 * 60 * 1000);
    expect(c.destroy).not.toHaveBeenCalled();
    ocupado.conversacion = false;
    jest.advanceTimersByTime(5 * 60 * 1000);
    expect(c.destroy).toHaveBeenCalled();
});

describe("no se corta un sonido a mitad", () => {
    test("al caducar, si suena un sonido, se espera a que acabe", async () => {
        jest.useFakeTimers();
        const c = conexion();
        await presencia.conectar(canal("c1"), { deps: deps(c) });
        ocupado.sonidos = true;
        jest.advanceTimersByTime(30 * 60 * 1000);
        expect(c.destroy).not.toHaveBeenCalled();
        ocupado.sonidos = false;
        jest.advanceTimersByTime(10 * 1000);
        expect(c.destroy).toHaveBeenCalled();
    });

    test("/conectar no sustituye la presencia mientras suena un sonido", async () => {
        const c = conexion();
        ocupado.sonidos = true;
        const r = await presencia.conectar(canal("c2"), { deps: deps(c) });
        expect(r.ok).toBe(false);
        expect(r.motivo).toMatch(/suena un sonido/);
        expect(presencia.actual(G)).toBeNull();
    });
});

test("las duraciones que se pueden elegir son 15, 30, 60 y 120 minutos", () => {
    expect(presencia.DURACIONES).toEqual([15, 30, 60, 120]);
});

test("con minutos: 120 se queda dos horas", async () => {
    jest.useFakeTimers();
    const c = conexion();
    const r = await presencia.conectar(canal("c1"), { minutos: 120, deps: deps(c) });
    expect(r.expira - Date.now()).toBeGreaterThan(119 * 60 * 1000);
    jest.advanceTimersByTime(119 * 60 * 1000);
    expect(c.destroy).not.toHaveBeenCalled();
    jest.advanceTimersByTime(2 * 60 * 1000);
    expect(c.destroy).toHaveBeenCalled();
});

test("renovar cuenta el tiempo desde ahora, sin sumar al que quedaba", async () => {
    jest.useFakeTimers();
    const c = conexion();
    await presencia.conectar(canal("c1"), { minutos: 15, deps: deps(c) });
    jest.advanceTimersByTime(10 * 60 * 1000);
    const r = presencia.renovar(G, 60);
    expect(r.ok).toBe(true);
    expect(r.expira - Date.now()).toBeGreaterThan(59 * 60 * 1000);
    expect(r.expira - Date.now()).toBeLessThanOrEqual(60 * 60 * 1000);
    jest.advanceTimersByTime(20 * 60 * 1000); // ya han pasado los 15 minutos originales
    expect(c.destroy).not.toHaveBeenCalled();
});

test("renovar sin presencia lo dice", () => {
    expect(presencia.renovar(G, 60).ok).toBe(false);
});

test("esDePresencia solo reconoce la conexión que puso /conectar", async () => {
    const c = conexion();
    await presencia.conectar(canal("c1"), { deps: deps(c) });
    expect(presencia.esDePresencia(G, c)).toBe(true);
    expect(presencia.esDePresencia(G, conexion())).toBe(false);
    expect(presencia.esDePresencia(G, null)).toBe(false);
});

test("al caducar espera mientras un /tts está hablando", async () => {
    jest.useFakeTimers();
    ocupado.tts = true;
    const c = conexion();
    await presencia.conectar(canal("c1"), { minutos: 15, deps: deps(c) });
    jest.advanceTimersByTime(15 * 60 * 1000);
    expect(c.destroy).not.toHaveBeenCalled();
    ocupado.tts = false;
    jest.advanceTimersByTime(10 * 1000 + 1);
    expect(c.destroy).toHaveBeenCalled();
});
