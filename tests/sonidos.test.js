// 🔊 Panel de sonidos (/sonidos): validar y guardar un sonido (formato, tamaño, nombre único, tope), la página del panel,
// y reproducir (un solo sonido a la vez, sin tocar una conversación de voz, con los permisos del canal). Sin Discord ni audio real.
const fs = require("fs");
const os = require("os");
const path = require("path");
const db = require("../src/core/db");
const sonidos = require("../src/systems/sonidos");
const { pantallaSonidos } = require("../src/paneles/sonidos");

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sonidos-"));
process.env.SONIDOS_DIR = dir;
const G = "g-sonidos";

beforeEach(() => {
    db.prepare("DELETE FROM sonidos WHERE guildId = ?").run(G);
});
afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

const descarga =
    (bytes = 1000, ok = true) =>
    async () => ({
        ok,
        status: ok ? 200 : 404,
        arrayBuffer: async () => Buffer.alloc(bytes, 1).buffer,
    });
const subir = (nombre, nombreArchivo = "risa.mp3", bytes = 1000, ok = true) =>
    sonidos.guardar(G, {
        nombre,
        archivo: { nombreArchivo, url: "https://cdn.test/x", tamano: bytes, fetchFn: descarga(bytes, ok) },
        userId: "admin",
    });

describe("el nombre", () => {
    test("se limpia y no puede estar vacío ni pasarse de 32", () => {
        expect(sonidos.validarNombre("  Risa   fuerte ")).toEqual({ ok: true, nombre: "Risa fuerte" });
        expect(sonidos.validarNombre("   ").ok).toBe(false);
        expect(sonidos.validarNombre("x".repeat(33)).ok).toBe(false);
    });
});

describe("guardar", () => {
    test("un mp3 se guarda con su fichero y aparece en el panel", async () => {
        const r = await subir("Risa");
        expect(r.ok).toBe(true);
        expect(fs.existsSync(sonidos.rutaDe(r.sonido))).toBe(true);
        expect(sonidos.listar(G).map((s) => s.nombre)).toEqual(["Risa"]);
    });

    test("solo mp3, ogg o wav; y no más de 1 MB", async () => {
        expect((await subir("Texto", "notas.txt")).ok).toBe(false);
        expect((await subir("Grande", "gordo.mp3", 2 * 1024 * 1024)).motivo).toMatch(/1 MB/);
    });

    test("el nombre es único en el servidor, sin distinguir mayúsculas", async () => {
        expect((await subir("Aplauso")).ok).toBe(true);
        const r = await subir("APLAUSO");
        expect(r.ok).toBe(false);
        expect(r.motivo).toMatch(/Ya hay un sonido/);
    });

    test("si la descarga falla, no queda nada guardado", async () => {
        const r = await subir("Roto", "roto.mp3", 100, false);
        expect(r.ok).toBe(false);
        expect(sonidos.listar(G)).toEqual([]);
    });

    test("como mucho 40 sonidos por servidor", async () => {
        for (let i = 0; i < sonidos.MAX_SONIDOS; i++)
            db.prepare("INSERT INTO sonidos (guildId, nombre, archivo, creado_por, creado_en) VALUES (?, ?, 'x.mp3', 'a', 0)").run(
                G,
                `s${i}`,
            );
        expect((await subir("Uno más")).motivo).toMatch(/40/);
    });
});

test("borrar quita la fila y el fichero", async () => {
    const r = await subir("Borrame");
    const ruta = sonidos.rutaDe(r.sonido);
    expect(sonidos.borrarPorNombre(G, "borrame")).toBe(true);
    expect(fs.existsSync(ruta)).toBe(false);
    expect(sonidos.listar(G)).toEqual([]);
});

describe("el panel", () => {
    test("sin sonidos, lo dice y no tiene botones", () => {
        const p = pantallaSonidos(G, 0);
        expect(p.embeds[0].data.description).toMatch(/Todavía no hay sonidos/);
        expect(p.components).toEqual([]);
    });

    test("veinte sonidos por página, con páginas al pasar de veinte", async () => {
        for (let i = 0; i < 22; i++)
            db.prepare("INSERT INTO sonidos (guildId, nombre, archivo, creado_por, creado_en) VALUES (?, ?, 'x.mp3', 'a', 0)").run(
                G,
                `s${String(i).padStart(2, "0")}`,
            );
        const primera = pantallaSonidos(G, 0);
        const botonesPrimera = primera.components.flatMap((f) => f.components).filter((b) => b.data.custom_id.startsWith("sonido_play_"));
        expect(botonesPrimera).toHaveLength(20);
        // La última fila: buscar, aleatorio, más usados y las dos flechas (#323, #324, #297).
        expect(primera.components.at(-1).components.map((b) => b.data.custom_id)).toEqual([
            "sonido_buscar|",
            "sonido_azar",
            "sonido_top",
            "sonido_pagina_-1",
            "sonido_pagina_1",
        ]);
        const segunda = pantallaSonidos(G, 1);
        expect(segunda.components.flatMap((f) => f.components).filter((b) => b.data.custom_id.startsWith("sonido_play_"))).toHaveLength(2);
        expect(segunda.embeds[0].data.footer.text).toMatch(/Página 2 de 2/);
    });
});

describe("reproducir", () => {
    const canal = (permisos = true) => ({
        id: "c1",
        name: "General",
        guild: { id: G, voiceAdapterCreator: () => {}, members: { me: {} } },
        permissionsFor: () => (permisos ? { has: () => true } : null),
    });
    const sonido = { id: 1, guildId: G, nombre: "Risa", archivo: "1.mp3" };
    function deps() {
        const conexion = { subscribe: jest.fn(), destroy: jest.fn() };
        return {
            conexion,
            unirse: jest.fn(() => conexion),
            esperarListo: async () => {},
            crearReproductor: () => new sonidos.ReproductorFalso(),
            crearRecurso: (ruta) => ({ ruta }),
            getConnection: () => undefined,
        };
    }

    test("con /conectar ya dentro, suena en ese canal sin entrar ni salir", async () => {
        const d = deps();
        const conexion = { subscribe: jest.fn(), destroy: jest.fn() };
        const r = await sonidos.reproducir(G, null, sonido, { ...d, presencia: { conexion } });
        expect(r).toEqual({ ok: true });
        expect(conexion.subscribe).toHaveBeenCalled();
        expect(conexion.destroy).not.toHaveBeenCalled();
        expect(d.unirse).not.toHaveBeenCalled();
    });

    test("sin estar en voz ni con /conectar, pide entrar a un canal", async () => {
        const r = await sonidos.reproducir(G, null, sonido, { ...deps(), presencia: null });
        expect(r.ok).toBe(false);
        expect(r.motivo).toMatch(/\/conectar/);
    });

    test("entra, toca y se sale", async () => {
        const d = deps();
        expect(await sonidos.reproducir(G, canal(), sonido, d)).toEqual({ ok: true });
        expect(d.unirse).toHaveBeenCalledWith(expect.objectContaining({ channelId: "c1", guildId: G, selfDeaf: true }));
        expect(d.conexion.subscribe).toHaveBeenCalled();
        expect(d.conexion.destroy).toHaveBeenCalled();
    });

    test("sin permisos en el canal, no entra", async () => {
        const d = deps();
        const r = await sonidos.reproducir(G, canal(false), sonido, d);
        expect(r.ok).toBe(false);
        expect(d.unirse).not.toHaveBeenCalled();
    });

    test("si ya hay una conversación de voz, no la toca", async () => {
        const d = deps();
        d.getConnection = () => ({});
        expect((await sonidos.reproducir(G, canal(), sonido, d)).motivo).toMatch(/otra conversación/);
        expect(d.unirse).not.toHaveBeenCalled();
    });

    test("un sonido a la vez por servidor", async () => {
        let liberar;
        const d = deps();
        d.crearReproductor = () => {
            const r = new sonidos.ReproductorFalso();
            r.play = () => {
                liberar = () => r.emit("idle");
            };
            return r;
        };
        const primero = sonidos.reproducir(G, canal(), sonido, d);
        await new Promise((r) => setImmediate(r));
        expect((await sonidos.reproducir(G, canal(), sonido, { ...deps(), sinCola: true })).motivo).toMatch(/Ya está sonando/);
        liberar();
        expect((await primero).ok).toBe(true);
    });

    test("si falla al tocar, se sale igual y se libera el servidor", async () => {
        const d = deps();
        d.crearReproductor = () => {
            const r = new sonidos.ReproductorFalso();
            r.play = () => setImmediate(() => r.emit("error", new Error("roto")));
            return r;
        };
        const r = await sonidos.reproducir(G, canal(), sonido, d);
        expect(r.ok).toBe(false);
        expect(d.conexion.destroy).toHaveBeenCalled();
        expect((await sonidos.reproducir(G, canal(), sonido, deps())).ok).toBe(true);
    });
});

describe("reproducir bien: el sonido entero, sin dejar nada colgado", () => {
    const { EventEmitter } = require("events");
    const { AudioPlayerStatus } = require("@discordjs/voice");
    const sonido = { id: 1, guildId: G, nombre: "Risa", archivo: "1.mp3" };
    /** Un reproductor que se controla desde el test: Playing, Idle y error a mano. */
    function reproductorManual() {
        const r = new EventEmitter();
        r.play = jest.fn();
        r.stop = jest.fn();
        return r;
    }

    afterEach(() => jest.useRealTimers());

    test("un sonido largo no se corta a los 30 segundos: acaba cuando acaba", async () => {
        jest.useFakeTimers();
        const reproductor = reproductorManual();
        const conexion = { subscribe: jest.fn(), destroy: jest.fn() };
        const pendiente = sonidos.reproducir(G, null, sonido, {
            presencia: { conexion },
            crearReproductor: () => reproductor,
            crearRecurso: (ruta) => ({ ruta }),
        });
        jest.advanceTimersByTime(90 * 1000);
        expect(reproductor.stop).not.toHaveBeenCalled();
        expect(sonidos.sonando(G)).toBe(true);
        reproductor.emit(AudioPlayerStatus.Idle);
        expect(await pendiente).toEqual({ ok: true });
        expect(sonidos.sonando(G)).toBe(false);
    });

    test("al acabar quita la suscripción y para el reproductor", async () => {
        const reproductor = reproductorManual();
        const suscripcion = { unsubscribe: jest.fn() };
        const conexion = { subscribe: jest.fn(() => suscripcion), destroy: jest.fn() };
        const pendiente = sonidos.reproducir(G, null, sonido, {
            presencia: { conexion },
            crearReproductor: () => reproductor,
            crearRecurso: (ruta) => ({ ruta }),
        });
        reproductor.emit(AudioPlayerStatus.Idle);
        await pendiente;
        expect(suscripcion.unsubscribe).toHaveBeenCalled();
        expect(reproductor.stop).toHaveBeenCalledWith(true);
    });

    test("si el reproductor se atasca, el tope lo para (4 minutos) y el servidor queda libre", async () => {
        jest.useFakeTimers();
        const reproductor = reproductorManual();
        const conexion = { subscribe: jest.fn(), destroy: jest.fn() };
        const pendiente = sonidos.reproducir(G, null, sonido, {
            presencia: { conexion },
            crearReproductor: () => reproductor,
            crearRecurso: (ruta) => ({ ruta }),
        });
        jest.advanceTimersByTime(4 * 60 * 1000);
        expect(await pendiente).toEqual({ ok: true });
        expect(reproductor.stop).toHaveBeenCalledWith(true);
        expect(sonidos.sonando(G)).toBe(false);
    });

    test("avisa cuando el sonido empieza a sonar (no cuando acaba)", async () => {
        const reproductor = reproductorManual();
        const conexion = { subscribe: jest.fn(), destroy: jest.fn() };
        const alEmpezar = jest.fn();
        const pendiente = sonidos.reproducir(G, null, sonido, {
            presencia: { conexion },
            crearReproductor: () => reproductor,
            crearRecurso: (ruta) => ({ ruta }),
            alEmpezar,
        });
        expect(alEmpezar).not.toHaveBeenCalled();
        reproductor.emit(AudioPlayerStatus.Playing);
        expect(alEmpezar).toHaveBeenCalledTimes(1);
        reproductor.emit(AudioPlayerStatus.Idle);
        await pendiente;
    });

    test("si Discord cierra la conexión a mitad, no se espera al tope", async () => {
        const reproductor = reproductorManual();
        const conexion = Object.assign(new EventEmitter(), { subscribe: jest.fn(), destroy: jest.fn() });
        const pendiente = sonidos.reproducir(G, null, sonido, {
            presencia: { conexion },
            crearReproductor: () => reproductor,
            crearRecurso: (ruta) => ({ ruta }),
        });
        conexion.emit("destroyed");
        expect(await pendiente).toEqual({ ok: true });
        expect(sonidos.sonando(G)).toBe(false);
    });
});

describe("renombrar y cambiar el archivo (#321)", () => {
    const enDisco = (archivo) => fs.readFileSync(path.join(dir, G, archivo));
    const bajada = (bytes, relleno) => async () => ({
        ok: true,
        status: 200,
        arrayBuffer: async () => Buffer.alloc(bytes, relleno).buffer,
    });

    test("renombrar cambia el nombre y conserva el id", async () => {
        const s = (await subir("Risa vieja")).sonido;
        expect(sonidos.renombrar(G, s.id, "  Risa   de Ana ")).toMatchObject({ ok: true, sonido: { id: s.id, nombre: "Risa de Ana" } });
    });

    test("no admite el nombre de otro sonido del servidor, y sí el suyo en otras mayúsculas", async () => {
        const gol = (await subir("Gol")).sonido;
        await subir("Pitido");
        expect(sonidos.renombrar(G, gol.id, "pitido").motivo).toMatch(/Ya hay un sonido/);
        expect(sonidos.renombrar(G, gol.id, "GOL").ok).toBe(true);
    });

    test("renombrar un sonido que no existe, o a un nombre vacío, lo dice", async () => {
        const tos = (await subir("Tos")).sonido;
        expect(sonidos.renombrar(G, 999999, "Otro").motivo).toMatch(/ya no existe/);
        expect(sonidos.renombrar(G, tos.id, "   ").motivo).toMatch(/vacío/);
    });

    test("cambiar el archivo mantiene id y nombre, y el fichero nuevo sustituye al anterior", async () => {
        const campana = (await subir("Campana", "campana.mp3", 100)).sonido;
        const r = await sonidos.reemplazarArchivo(G, campana.id, {
            nombreArchivo: "campana2.mp3",
            url: "u",
            tamano: 50,
            fetchFn: bajada(50, 7),
        });
        expect(r).toMatchObject({ ok: true, sonido: { id: campana.id, nombre: "Campana", archivo: `${campana.id}.mp3` } });
        expect(enDisco(`${campana.id}.mp3`).equals(Buffer.alloc(50, 7))).toBe(true);
    });

    test("si la extensión cambia, el fichero anterior se borra", async () => {
        const bocina = (await subir("Bocina", "bocina.mp3")).sonido;
        const antes = path.join(dir, G, bocina.archivo);
        expect(fs.existsSync(antes)).toBe(true);
        const r = await sonidos.reemplazarArchivo(G, bocina.id, {
            nombreArchivo: "bocina.ogg",
            url: "u",
            tamano: 10,
            fetchFn: bajada(10, 3),
        });
        expect(r.sonido.archivo).toBe(`${bocina.id}.ogg`);
        expect(fs.existsSync(antes)).toBe(false);
        expect(fs.existsSync(path.join(dir, G, `${bocina.id}.ogg`))).toBe(true);
    });

    test("un archivo que no vale, o una descarga que falla, no toca el sonido", async () => {
        const silbato = (await subir("Silbato", "silbato.mp3", 100)).sonido;
        expect(
            (await sonidos.reemplazarArchivo(G, silbato.id, { nombreArchivo: "x.exe", url: "u", tamano: 1, fetchFn: bajada(1, 1) })).motivo,
        ).toMatch(/Formato/);
        expect(
            (await sonidos.reemplazarArchivo(G, silbato.id, { nombreArchivo: "x.mp3", url: "u", tamano: 2 * 1024 * 1024 })).motivo,
        ).toMatch(/1 MB/);
        expect(
            (await sonidos.reemplazarArchivo(G, silbato.id, { nombreArchivo: "x.mp3", url: "u", tamano: 1, fetchFn: descarga(1, false) }))
                .motivo,
        ).toMatch(/descargar/);
        expect(sonidos.obtener(G, silbato.id).archivo).toBe(silbato.archivo);
        expect(fs.existsSync(path.join(dir, G, silbato.archivo))).toBe(true);
    });
});

describe("correcciones de #468 y #469: cambio de archivo y tiempo de descarga", () => {
    const { EventEmitter } = require("events");
    const enDisco = (archivo) => fs.readFileSync(path.join(dir, G, archivo));
    const bajada = (bytes, relleno) => async () => ({
        ok: true,
        status: 200,
        arrayBuffer: async () => Buffer.alloc(bytes, relleno).buffer,
    });
    // Un reproductor que no termina hasta que se le pida (un sonido que está sonando).
    const sonando = (s) => {
        const reproductor = new EventEmitter();
        reproductor.play = () => {};
        reproductor.stop = () => {};
        const conexion = { subscribe: () => ({ unsubscribe() {} }), once() {}, off() {} };
        const pendiente = sonidos.reproducir(G, null, s, {
            presencia: { conexion },
            crearReproductor: () => reproductor,
            crearRecurso: () => ({}),
        });
        return { reproductor, pendiente };
    };

    test("mientras se descarga el cambio, el servidor queda reservado y ningún sonido puede empezar", async () => {
        const original = (await subir("Reservado", "r.mp3", 100)).sonido;
        const otro = (await subir("Otro sonido", "o.mp3", 100)).sonido;
        let liberar;
        const retraso = new Promise((r) => (liberar = r));
        const cambio = sonidos.reemplazarArchivo(G, original.id, {
            nombreArchivo: "r2.mp3",
            url: "u",
            tamano: 10,
            fetchFn: async () => {
                await retraso;
                return { ok: true, status: 200, arrayBuffer: async () => Buffer.alloc(10, 9).buffer };
            },
        });
        await new Promise((r) => setImmediate(r));
        expect(sonidos.sonando(G)).toBe(true);
        expect((await sonidos.reproducir(G, null, otro, { sinCola: true })).motivo).toMatch(/Ya está sonando/);
        liberar();
        expect((await cambio).ok).toBe(true);
        expect(sonidos.sonando(G)).toBe(false);
    });

    test("un sonido que ya suena impide el cambio, y el fichero no se toca", async () => {
        const original = (await subir("Fijo", "f.mp3", 100)).sonido;
        const otro = (await subir("Suena", "s.mp3", 100)).sonido;
        const { reproductor, pendiente } = sonando(otro);
        await new Promise((r) => setImmediate(r));
        const r = await sonidos.reemplazarArchivo(G, original.id, {
            nombreArchivo: "f2.mp3",
            url: "u",
            tamano: 10,
            fetchFn: bajada(10, 5),
        });
        expect(r.ok).toBe(false);
        expect(r.motivo).toMatch(/suena un sonido/);
        expect(enDisco(original.archivo).equals(Buffer.alloc(100, 1))).toBe(true);
        reproductor.emit("idle");
        await pendiente;
    });

    test("una descarga que tarda más del tiempo límite avisa, no cambia nada y libera el servidor", async () => {
        const original = (await subir("Lenta", "l.mp3", 100)).sonido;
        const r = await sonidos.reemplazarArchivo(G, original.id, {
            nombreArchivo: "l2.mp3",
            url: "u",
            tamano: 10,
            tiempoMs: 30,
            fetchFn: (url, { signal }) => new Promise((_, rechazar) => signal.addEventListener("abort", () => rechazar(signal.reason))),
        });
        expect(r.motivo).toMatch(/tiempo agotado/);
        expect(enDisco(original.archivo).equals(Buffer.alloc(100, 1))).toBe(true);
        expect(sonidos.sonando(G)).toBe(false);
    });

    test("un adjunto que anuncia más de 1 MB se rechaza sin leer el cuerpo", async () => {
        const original = (await subir("Grande", "g.mp3", 100)).sonido;
        const arrayBuffer = jest.fn(async () => Buffer.alloc(10, 1).buffer);
        const r = await sonidos.reemplazarArchivo(G, original.id, {
            nombreArchivo: "g2.mp3",
            url: "u",
            tamano: 10,
            fetchFn: async () => ({ ok: true, status: 200, headers: new Map([["content-length", String(2 * 1024 * 1024)]]), arrayBuffer }),
        });
        expect(r.motivo).toMatch(/1 MB/);
        expect(arrayBuffer).not.toHaveBeenCalled();
        expect(sonidos.sonando(G)).toBe(false);
    });
});
