// 🔊 Sonidos avanzados, la parte de reglas (#297, #323, #324, #325, #326, #327, #328, #329, #330): horario de silencio,
// cooldown con reloj simulado, cola, volumen, contador y ranking, categorías, búsqueda, roles y eventos. Sin Discord ni audio real.
const { EventEmitter } = require("events");
const { AudioPlayerStatus } = require("@discordjs/voice");
const db = require("../src/core/db");
const guildSettings = require("../src/systems/guildSettings");
const sonidos = require("../src/systems/sonidos");
const ajustes = require("../src/systems/sonidos/ajustes");
const cooldown = require("../src/systems/sonidos/cooldown");
const cola = require("../src/systems/sonidos/cola");
const silencio = require("../src/systems/sonidos/silencio");
const eventos = require("../src/systems/sonidos/eventos");
const achievements = require("../src/systems/achievementsSystem");
const anuncios = require("../src/systems/apuestas/liquidacion/anuncios");

const G = "g-sonidos-avanzados";

function nuevo(nombre, extra = {}) {
    const id = db
        .prepare("INSERT INTO sonidos (guildId, nombre, archivo, creado_por, creado_en) VALUES (?, ?, ?, 'a', 0)")
        .run(G, nombre, `${nombre}.mp3`).lastInsertRowid;
    if (extra.categoria) ajustes.fijarCategoria(G, id, extra.categoria);
    return sonidos.obtener(G, id);
}

beforeEach(() => {
    db.prepare("DELETE FROM sonido_roles WHERE sonidoId IN (SELECT id FROM sonidos WHERE guildId = ?)").run(G);
    db.prepare("DELETE FROM sonidos_eventos WHERE guildId = ?").run(G);
    db.prepare("DELETE FROM sonidos WHERE guildId = ?").run(G);
    guildSettings.setManySettings(G, {
        "sonidos.apagado": false,
        "sonidos.silencio_desde": "",
        "sonidos.silencio_hasta": "",
        "sonidos.eventos_minutos": 5,
    });
});

// Un reproductor que se controla a mano: suena hasta que el test emite Idle.
function reproductorManual() {
    const r = new EventEmitter();
    r.play = jest.fn();
    r.stop = jest.fn();
    return r;
}
const conexion = () => ({ subscribe: jest.fn(), destroy: jest.fn() });
const esperar = () => new Promise((r) => setImmediate(r));

describe("horario de silencio (#330)", () => {
    // Enero: Madrid va una hora por delante de UTC.
    const a = (horaMadrid, minuto = 0) => Date.UTC(2026, 0, 15, horaMadrid - 1, minuto);

    test("las horas deben ser HH:MM, distintas, o las dos vacías para quitar el horario", () => {
        expect(silencio.validarHorario("0:00", "08:00")).toEqual({ ok: true, desde: "00:00", hasta: "08:00" });
        expect(silencio.validarHorario("", "")).toEqual({ ok: true, desde: "", hasta: "" });
        expect(silencio.validarHorario("25:00", "08:00").ok).toBe(false);
        expect(silencio.validarHorario("00:00", "").ok).toBe(false);
        expect(silencio.validarHorario("08:00", "08:00").ok).toBe(false);
    });

    test("un horario dentro del día: en silencio solo dentro del tramo", () => {
        const cfg = { apagado: false, desde: "09:00", hasta: "17:30" };
        expect(silencio.silencioAhora(cfg, a(8, 59))).toEqual({ silencio: false });
        expect(silencio.silencioAhora(cfg, a(9))).toEqual({ silencio: true, hasta: "17:30" });
        expect(silencio.silencioAhora(cfg, a(17, 29)).silencio).toBe(true);
        expect(silencio.silencioAhora(cfg, a(17, 30)).silencio).toBe(false);
    });

    test("un horario que cruza la medianoche (22:00 a 08:00)", () => {
        const cfg = { apagado: false, desde: "22:00", hasta: "08:00" };
        expect(silencio.silencioAhora(cfg, a(23)).silencio).toBe(true);
        expect(silencio.silencioAhora(cfg, a(3)).silencio).toBe(true);
        expect(silencio.silencioAhora(cfg, a(8)).silencio).toBe(false);
        expect(silencio.silencioAhora(cfg, a(12)).silencio).toBe(false);
    });

    test("el interruptor de apagado silencia a cualquier hora, sin tocar el horario", () => {
        expect(silencio.silencioAhora({ apagado: true, desde: "", hasta: "" }, a(12))).toEqual({ silencio: true });
        expect(silencio.avisoSilencio({ silencio: true })).toMatch(/apagados/);
        expect(silencio.avisoSilencio({ silencio: true, hasta: "08:00" })).toBe("🌙 Los sonidos están en silencio hasta las 08:00.");
    });

    test("sin horario válido no hay silencio", () => {
        expect(silencio.silencioAhora({ apagado: false, desde: "", hasta: "" }, a(3)).silencio).toBe(false);
    });

    test("reproducir en silencio responde con el aviso y no entra a ningún canal", async () => {
        const unirse = jest.fn();
        const r = await sonidos.reproducir(G, { id: "c" }, nuevo("Risa"), {
            silencio: { apagado: false, desde: "22:00", hasta: "08:00" },
            ahora: a(23),
            unirse,
        });
        expect(r).toEqual({ ok: false, motivo: "🌙 Los sonidos están en silencio hasta las 08:00." });
        expect(unirse).not.toHaveBeenCalled();
    });

    test("reproducir lee el horario de los ajustes del servidor, y fuera del tramo sigue sonando", async () => {
        guildSettings.setManySettings(G, { "sonidos.silencio_desde": "22:00", "sonidos.silencio_hasta": "08:00" });
        const sonido = nuevo("Gol");
        const d = { presencia: { conexion: conexion() }, crearReproductor: () => new sonidos.ReproductorFalso(), crearRecurso: () => ({}) };
        expect((await sonidos.reproducir(G, null, sonido, { ...d, ahora: a(2) })).motivo).toMatch(/silencio hasta las 08:00/);
        expect(await sonidos.reproducir(G, null, sonido, { ...d, ahora: a(12) })).toEqual({ ok: true });
        guildSettings.setSetting(G, "sonidos.apagado", true);
        expect((await sonidos.reproducir(G, null, sonido, { ...d, ahora: a(12) })).motivo).toMatch(/apagados/);
    });
});

describe("cooldown por persona (#324)", () => {
    test("dos sonidos seguidos en menos de 10 s: el segundo espera lo que falta", () => {
        const t = 1_000_000;
        expect(cooldown.segundosRestantes(G, "ana", t)).toBe(0);
        cooldown.marcar(G, "ana", t);
        expect(cooldown.segundosRestantes(G, "ana", t + 3_000)).toBe(7);
        expect(cooldown.segundosRestantes(G, "ana", t + 9_001)).toBe(1);
        expect(cooldown.segundosRestantes(G, "ana", t + 10_000)).toBe(0);
        expect(cooldown.avisoCooldown(7)).toMatch(/7 s/);
    });

    test("es por persona y por servidor", () => {
        cooldown.marcar(G, "bea", 5_000);
        expect(cooldown.segundosRestantes(G, "carlos", 5_001)).toBe(0);
        expect(cooldown.segundosRestantes("otro-servidor", "bea", 5_001)).toBe(0);
    });

    test("el mapa tira lo caducado cuando crece", () => {
        for (let i = 0; i < 501; i++) cooldown.marcar(G, `p${i}`, 0);
        cooldown.marcar(G, "reciente", 60_000);
        expect(cooldown.segundosRestantes(G, "p3", 60_001)).toBe(0);
        expect(cooldown.segundosRestantes(G, "reciente", 60_001)).toBeGreaterThan(0);
    });
});

describe("cola de sonidos (#327)", () => {
    const d = (reproductor) => ({ presencia: { conexion: conexion() }, crearReproductor: () => reproductor, crearRecurso: () => ({}) });

    test("lo pulsado con otro sonando espera su turno, con su puesto, y suena en orden", async () => {
        const [r1, r2, r3] = [reproductorManual(), reproductorManual(), reproductorManual()];
        const [s1, s2, s3] = [nuevo("Uno"), nuevo("Dos"), nuevo("Tres")];
        const puestos = [];
        const p1 = sonidos.reproducir(G, null, s1, d(r1));
        const p2 = sonidos.reproducir(G, null, s2, { ...d(r2), alEncolar: (p) => puestos.push(p) });
        const p3 = sonidos.reproducir(G, null, s3, { ...d(r3), alEncolar: (p) => puestos.push(p) });
        await esperar();
        expect(puestos).toEqual([1, 2]);
        expect(cola.longitud(G)).toBe(2);
        expect(r2.play).not.toHaveBeenCalled();

        r1.emit(AudioPlayerStatus.Idle);
        await p1;
        expect(sonidos.sonando(G)).toBe(true); // entre dos sonidos /conectar no corta
        expect(r2.play).toHaveBeenCalled();
        expect(r3.play).not.toHaveBeenCalled();
        r2.emit(AudioPlayerStatus.Idle);
        expect(await p2).toEqual({ ok: true });
        expect(r3.play).toHaveBeenCalled();
        r3.emit(AudioPlayerStatus.Idle);
        expect(await p3).toEqual({ ok: true });
        expect(sonidos.sonando(G)).toBe(false);
        expect(cola.longitud(G)).toBe(0);
    });

    test("con la cola llena (5) el siguiente se rechaza con un motivo claro, y la cola se vacía sola", async () => {
        const reproductores = Array.from({ length: cola.MAX_COLA + 1 }, reproductorManual); // uno suena y cinco esperan
        const s = nuevo("Largo");
        const pendientes = reproductores.map((r) => sonidos.reproducir(G, null, s, d(r)));
        await esperar();
        expect(cola.longitud(G)).toBe(cola.MAX_COLA);

        const rechazado = await sonidos.reproducir(G, null, s, d(reproductorManual()));
        expect(rechazado.ok).toBe(false);
        expect(rechazado.motivo).toMatch(/5 sonidos esperando/);

        for (const r of reproductores) {
            r.emit(AudioPlayerStatus.Idle);
            await esperar();
        }
        expect(await Promise.all(pendientes)).toEqual(reproductores.map(() => ({ ok: true })));
        expect(cola.longitud(G)).toBe(0);
        expect(sonidos.sonando(G)).toBe(false);
    });

    test("sin cola (sinCola) se rechaza como antes, y un sonido que no se puede tocar no se encola", async () => {
        const r1 = reproductorManual();
        const s = nuevo("Ocupa");
        const p1 = sonidos.reproducir(G, null, s, d(r1));
        expect((await sonidos.reproducir(G, null, s, { ...d(reproductorManual()), sinCola: true })).motivo).toMatch(/Ya está sonando/);
        // Sin presencia ni canal no hay dónde sonar: se dice ya, no se espera un turno para fallar.
        expect((await sonidos.reproducir(G, null, s, { presencia: null, crearReproductor: () => reproductorManual() })).motivo).toMatch(
            /\/conectar/,
        );
        expect(cola.longitud(G)).toBe(0);
        r1.emit(AudioPlayerStatus.Idle);
        await p1;
    });
});

describe("volumen (#328)", () => {
    test("el recurso se crea con inlineVolume y el volumen guardado", async () => {
        const sonido = nuevo("Flojo");
        expect(ajustes.fijarVolumen(G, sonido.id, "150 %")).toEqual({ ok: true, volumen: 150 });
        const setVolume = jest.fn();
        const crearRecurso = jest.fn(() => ({ volume: { setVolume } }));
        await sonidos.reproducir(G, null, sonidos.obtener(G, sonido.id), {
            presencia: { conexion: conexion() },
            crearReproductor: () => new sonidos.ReproductorFalso(),
            crearRecurso,
        });
        expect(crearRecurso).toHaveBeenCalledWith(expect.stringContaining("Flojo.mp3"), { inlineVolume: true });
        expect(setVolume).toHaveBeenCalledWith(1.5);
    });

    test("los sonidos que ya existían quedan a 100 y suenan igual que antes", async () => {
        const sonido = nuevo("Antiguo");
        expect(sonido).toMatchObject({ volumen: 100, categoria: null, reproducciones: 0 });
        const setVolume = jest.fn();
        await sonidos.reproducir(G, null, sonido, {
            presencia: { conexion: conexion() },
            crearReproductor: () => new sonidos.ReproductorFalso(),
            crearRecurso: () => ({ volume: { setVolume } }),
        });
        expect(setVolume).toHaveBeenCalledWith(1);
    });

    test("solo vale un entero entre 25 y 200", () => {
        const s = nuevo("Rango");
        for (const malo of ["", "abc", "24", "201", "50.5"]) expect(ajustes.fijarVolumen(G, s.id, malo).ok).toBe(false);
        expect(ajustes.fijarVolumen(G, s.id, "25").ok).toBe(true);
        expect(ajustes.fijarVolumen(G, s.id, "200").ok).toBe(true);
        expect(ajustes.fijarVolumen(G, 999999, "100").motivo).toMatch(/ya no existe/);
        expect(sonidos.obtener(G, s.id).volumen).toBe(200);
    });
});

describe("estadísticas de uso (#297)", () => {
    const tocar = (sonido, extra = {}) =>
        sonidos.reproducir(G, null, sonido, {
            presencia: { conexion: conexion() },
            crearReproductor: () => new sonidos.ReproductorFalso(),
            crearRecurso: () => ({}),
            ...extra,
        });

    test("cada reproducción suma uno, y las que fallan no cuentan", async () => {
        const [a, b] = [nuevo("Alfa"), nuevo("Beta")];
        await tocar(a);
        await tocar(a);
        await tocar(b);
        await tocar(b, { silencio: { apagado: true } });
        expect(sonidos.obtener(G, a.id).reproducciones).toBe(2);
        expect(sonidos.obtener(G, b.id).reproducciones).toBe(1);
    });

    test("el ranking ordena de más a menos, deja fuera los que no han sonado y empata por nombre", async () => {
        const [a, b, c] = [nuevo("Zeta"), nuevo("Beta"), nuevo("Nunca")];
        for (const [s, veces] of [
            [a, 3],
            [b, 3],
        ]) {
            for (let i = 0; i < veces; i++) ajustes.contar(s.id);
        }
        expect(ajustes.masUsados(G).map((s) => s.nombre)).toEqual(["Beta", "Zeta"]);
        expect(ajustes.masUsados(G)).not.toContainEqual(expect.objectContaining({ id: c.id }));
        expect(ajustes.textoRanking(G)).toBe("**1.** Beta — 3 veces\n**2.** Zeta — 3 veces");
        db.prepare("DELETE FROM sonidos WHERE guildId = ?").run(G);
        expect(ajustes.textoRanking(G)).toMatch(/Todavía no ha sonado/);
    });

    test("con muchos sonidos el ranking se queda en el límite pedido", () => {
        for (let i = 0; i < 30; i++) ajustes.contar(nuevo(`S${String(i).padStart(2, "0")}`).id);
        expect(ajustes.masUsados(G, 10)).toHaveLength(10);
    });
});

describe("categorías y búsqueda (#325, #323)", () => {
    test("la categoría se limpia, se pone y se quita; los sonidos nuevos quedan sin categoría", () => {
        const s = nuevo("Memez");
        expect(s.categoria).toBeNull();
        expect(ajustes.fijarCategoria(G, s.id, "  memes  |  de   gatos ")).toEqual({ ok: true, categoria: "memes de gatos" });
        expect(ajustes.fijarCategoria(G, s.id, "   ")).toEqual({ ok: true, categoria: null });
        expect(ajustes.fijarCategoria(G, 999999, "x").ok).toBe(false);
        expect(ajustes.normalizarCategoria("x".repeat(40))).toHaveLength(ajustes.CATEGORIA_MAX);
    });

    test("listar filtra por categoría, por «sin categoría» y por nombre sin distinguir mayúsculas ni acentos de mayúscula", () => {
        nuevo("Gol de Messi", { categoria: "fútbol" });
        nuevo("GOLazo", { categoria: "fútbol" });
        nuevo("Risa");
        nuevo("Ñu");
        expect(ajustes.categorias(G)).toEqual(["fútbol"]);
        expect(sonidos.listar(G, { categoria: "fútbol" }).map((s) => s.nombre)).toEqual(["Gol de Messi", "GOLazo"]);
        expect(sonidos.listar(G, { categoria: ajustes.SIN_CATEGORIA }).map((s) => s.nombre)).toEqual(["Risa", "Ñu"]);
        expect(sonidos.listar(G, { texto: "gol" }).map((s) => s.nombre)).toEqual(["Gol de Messi", "GOLazo"]);
        expect(sonidos.listar(G, { texto: "ñU" }).map((s) => s.nombre)).toEqual(["Ñu"]);
        expect(sonidos.listar(G, { categoria: "fútbol", texto: "messi" })).toHaveLength(1);
        expect(sonidos.listar(G, { texto: "no existe" })).toEqual([]);
        expect(sonidos.listar(G)).toHaveLength(4);
    });
});

describe("roles por sonido (#329)", () => {
    const miembro = (...roles) => ({ roles: { cache: new Set(roles) } });

    test("sin roles asignados es de todos; con roles, basta con tener uno", () => {
        const s = nuevo("Interno");
        expect(ajustes.puedeUsar(s.id, miembro())).toEqual({ ok: true, roles: [] });
        ajustes.fijarRoles(s.id, ["r1", "r2", "r1"]);
        expect(ajustes.rolesDe(s.id)).toEqual(["r1", "r2"]);
        expect(ajustes.puedeUsar(s.id, miembro("r2"))).toEqual({ ok: true, roles: ["r1", "r2"] });
        expect(ajustes.puedeUsar(s.id, miembro("otro")).ok).toBe(false);
        expect(ajustes.puedeUsar(s.id, undefined).ok).toBe(false);
        expect(ajustes.conRestriccion(G).has(s.id)).toBe(true);
    });

    test("quitar los roles vuelve a dejarlo para todos, y borrar el sonido borra sus roles", () => {
        const s = nuevo("Temporal");
        ajustes.fijarRoles(s.id, ["r1"]);
        ajustes.fijarRoles(s.id, []);
        expect(ajustes.puedeUsar(s.id, miembro()).ok).toBe(true);
        ajustes.fijarRoles(s.id, ["r1"]);
        sonidos.borrar(G, s.id);
        expect(ajustes.rolesDe(s.id)).toEqual([]);
    });
});

describe("sonidos de eventos (#326)", () => {
    const tocables = (extra = {}) => ({
        presencia: { conexion: conexion() },
        crearReproductor: () => new sonidos.ReproductorFalso(),
        crearRecurso: () => ({}),
        ...extra,
    });
    beforeAll(() => eventos.conectar({ sonidos, presencia: require("../src/systems/presencia") }));

    test("se asocia un sonido a un evento, se sustituye y se quita; un evento desconocido no vale", () => {
        const [a, b] = [nuevo("Fanfarria"), nuevo("Moneda")];
        expect(eventos.asociar(G, "logro", a.id)).toBe(true);
        expect(eventos.asociar(G, "apuesta_grande", b.id)).toBe(true);
        expect(eventos.asociar(G, "inventado", a.id)).toBe(false);
        expect(eventos.asociar(G, "logro", b.id)).toBe(true);
        expect(eventos.asociados(G)).toEqual([
            { evento: "apuesta_grande", sonidoId: b.id, nombre: "Moneda" },
            { evento: "logro", sonidoId: b.id, nombre: "Moneda" },
        ]);
        expect(eventos.quitar(G, "logro")).toBe(true);
        expect(eventos.quitar(G, "logro")).toBe(false);
    });

    test("suena si el bot está en voz, y no más de una vez cada N minutos", async () => {
        const s = nuevo("Fanfarria");
        eventos.asociar(G, "logro", s.id);
        const t = 10_000_000;
        expect(await eventos.disparar(G, "logro", tocables({ ahora: t }))).toBe(true);
        expect(sonidos.obtener(G, s.id).reproducciones).toBe(1);
        expect(await eventos.disparar(G, "logro", tocables({ ahora: t + 4 * 60_000 }))).toBe(false);
        expect(await eventos.disparar(G, "logro", tocables({ ahora: t + 5 * 60_000 }))).toBe(true);
        guildSettings.setSetting(G, "sonidos.eventos_minutos", 0);
        expect(await eventos.disparar(G, "logro", tocables({ ahora: t + 5 * 60_000 + 1 }))).toBe(true);
    });

    test("sin sonido asociado, sin el bot en voz o con otro sonido sonando, no pasa nada", async () => {
        const s = nuevo("Callado");
        expect(await eventos.disparar(G, "logro", tocables())).toBe(false);
        eventos.asociar(G, "logro", s.id);
        expect(await eventos.disparar(G, "logro", tocables({ presencia: null }))).toBe(false);

        const manual = reproductorManual();
        const ocupando = sonidos.reproducir(G, null, s, tocables({ crearReproductor: () => manual }));
        await esperar();
        expect(await eventos.disparar(G, "logro", tocables())).toBe(false);
        manual.emit(AudioPlayerStatus.Idle);
        await ocupando;
        expect(await eventos.disparar(G, "logro", tocables())).toBe(true);
    });

    test("un fallo al sonar no lanza: queda en el log", async () => {
        const s = nuevo("Roto");
        eventos.asociar(G, "logro", s.id);
        const d = tocables({ crearReproductor: () => ({ play() {}, once() {}, on() {}, stop() {} }) });
        d.crearRecurso = () => {
            throw new Error("boom");
        };
        expect(await eventos.disparar(G, "logro", d)).toBe(false);
    });

    test("desbloquear un logro dispara el evento «logro»", async () => {
        const spy = jest.spyOn(eventos, "disparar").mockResolvedValue(false);
        await achievements.applyEvent(G, "jugador-sonido", "casino_bet", 50, { anunciar: false });
        expect(spy).toHaveBeenCalledWith(G, "logro");
        spy.mockClear();
        await achievements.applyEvent(G, "jugador-sonido", "casino_bet", 1, { anunciar: false }); // nada nuevo
        expect(spy).not.toHaveBeenCalled();
        spy.mockRestore();
    });

    test("una apuesta ganada grande dispara el evento en los servidores donde está quien cobra", async () => {
        const spy = jest.spyOn(eventos, "disparar").mockResolvedValue(false);
        const guild = (id, miembros) => ({ id, name: id, members: { cache: new Set(miembros) } });
        const client = {
            guilds: {
                cache: new Map([
                    ["a", guild("a", ["ana"])],
                    ["b", guild("b", ["otra"])],
                ]),
            },
        };
        await anuncios.anunciarResultados(client, {
            pagos: [
                { userId: "ana", premio: eventos.UMBRAL_APUESTA_GRANDE, descripcion: "x" },
                { userId: "otra", premio: 5000, reembolso: true, descripcion: "x" },
            ],
        });
        expect(spy.mock.calls).toEqual([["a", "apuesta_grande"]]);
        spy.mockClear();
        await anuncios.anunciarResultados(client, {
            pagos: [{ userId: "ana", premio: eventos.UMBRAL_APUESTA_GRANDE - 1, descripcion: "x" }],
        });
        expect(spy).not.toHaveBeenCalled();
        spy.mockRestore();
    });
});
