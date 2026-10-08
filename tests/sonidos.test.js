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
let n = 0;

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
        expect(primera.components.at(-1).components.map((b) => b.data.custom_id)).toEqual(["sonido_pagina_-1", "sonido_pagina_1"]);
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
        expect((await sonidos.reproducir(G, canal(), sonido, deps())).motivo).toMatch(/Ya está sonando/);
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
