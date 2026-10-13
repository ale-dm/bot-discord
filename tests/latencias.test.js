// #481: latencias por manejador. Percentiles de las últimas muestras, el procesado de mensajes, las tareas programadas
// (runJob), el prefijo de los botones y la tabla de /paneladmin → Sistema. Solo mide: no cambia lo que hace cada manejador.
const latencias = require("../src/core/latencias");
const { runJob } = require("../src/core/interactionLog");
const xpSystem = require("../src/systems/xpSystem");
const { registrarMensajes } = require("../src/core/mensajes");
const { handleSistemaButton } = require("../src/adminPanel/sistema");

beforeEach(() => latencias.reiniciar());
afterEach(() => jest.restoreAllMocks());

describe("percentiles", () => {
    test("p50 y p95 por el rango más cercano", () => {
        const cien = Array.from({ length: 100 }, (_, i) => i + 1);
        expect(latencias.percentil(cien, 50)).toBe(50);
        expect(latencias.percentil(cien, 95)).toBe(95);
        expect(latencias.percentil([7], 95)).toBe(7);
        expect(latencias.percentil([], 50)).toBe(0);
    });

    test("resumen: llamadas, p50 y p95 de cada manejador, del más lento al más rápido", () => {
        for (let i = 1; i <= 100; i++) latencias.registrar("mensaje", "xp", i);
        latencias.registrar("mensaje", "rapido", 1);
        const r = latencias.resumen();
        expect(r[0]).toEqual({ tipo: "mensaje", nombre: "xp", n: 100, p50: 50, p95: 95 });
        expect(r[1]).toMatchObject({ nombre: "rapido", n: 1, p95: 1 });
        expect(latencias.resumen({ tipo: "tarea" })).toEqual([]);
    });

    test("solo cuentan las últimas muestras: una ráfaga lenta antigua deja de pesar", () => {
        for (let i = 0; i < latencias.MAX_MUESTRAS; i++) latencias.registrar("componente", "a_b", 1000);
        for (let i = 0; i < latencias.MAX_MUESTRAS; i++) latencias.registrar("componente", "a_b", 2);
        const [fila] = latencias.resumen();
        expect(fila.p95).toBe(2);
        expect(fila.n).toBe(latencias.MAX_MUESTRAS * 2);
    });

    test("ignora valores raros y no crece sin fin con manejadores distintos", () => {
        latencias.registrar("tarea", "x", NaN);
        latencias.registrar("tarea", "x", -5);
        expect(latencias.resumen()).toEqual([]);
        for (let i = 0; i < latencias.MAX_MANEJADORES + 50; i++) latencias.registrar("componente", `p${i}`, 1);
        expect(latencias.resumen()).toHaveLength(latencias.MAX_MANEJADORES);
    });
});

describe("qué se mide", () => {
    test("el prefijo de un botón son sus dos primeras partes", () => {
        expect(latencias.prefijoDe("casino_play_ruleta_100_color_rojo")).toBe("casino_play");
        expect(latencias.prefijoDe("retos_aceptar_12")).toBe("retos_aceptar");
        expect(latencias.prefijoDe("ayuda")).toBe("ayuda");
        expect(latencias.prefijoDe(undefined)).toBe("?");
    });

    test("medir anota el tiempo y devuelve lo mismo que la función, también si falla", async () => {
        expect(await latencias.medir("mensaje", "duende", async () => "hola")).toBe("hola");
        await expect(
            latencias.medir("mensaje", "duende", async () => {
                throw new Error("boom");
            }),
        ).rejects.toThrow("boom");
        expect(latencias.resumen()[0]).toMatchObject({ tipo: "mensaje", nombre: "duende", n: 2 });
    });

    test("las tareas programadas (runJob) se anotan, salgan bien o mal, y siguen devolviendo lo mismo", async () => {
        expect(await runJob("Tarea buena", async () => 42)).toBe(42);
        expect(
            await runJob("Tarea mala", async () => {
                throw new Error("falla");
            }),
        ).toBeUndefined();
        const nombres = latencias.resumen({ tipo: "tarea" }).map((f) => f.nombre);
        expect(nombres.sort()).toEqual(["Tarea buena", "Tarea mala"]);
    });

    test("el procesado de un mensaje anota la XP y los recuerdos", async () => {
        const xp = jest.spyOn(xpSystem, "handleMessageXp").mockResolvedValue(undefined);
        let manejador;
        registrarMensajes({ on: (evento, fn) => evento === "messageCreate" && (manejador = fn), user: { id: "bot" } });
        // Un mensaje que empieza por "/" se descarta antes de llegar al Duende, pero ya ha pasado por la XP y los recuerdos.
        const message = {
            id: "m-latencias-1",
            content: "/algo",
            author: { bot: false, tag: "u#1" },
            attachments: new Map(),
            channelId: "c",
            guildId: null,
        };
        await manejador(message);
        expect(xp).toHaveBeenCalledTimes(1);
        const nombres = latencias.resumen({ tipo: "mensaje" }).map((f) => f.nombre);
        expect(nombres).toEqual(expect.arrayContaining(["xp", "recuerdos"]));
    });
});

describe("la tabla de /paneladmin → Sistema", () => {
    test("sin datos lo dice; con datos enseña p50 y p95", () => {
        expect(latencias.tabla()).toBe("Todavía no hay muestras desde el arranque.");
        for (let i = 1; i <= 100; i++) latencias.registrar("mensaje", "xp", i / 10);
        const t = latencias.tabla();
        expect(t).toMatch(/manejador\s+n\s+p50 ms\s+p95 ms/);
        expect(t).toMatch(/mensaje:xp\s+100\s+5\.00\s+9\.50/);
    });

    test("el botón ⏱️ Latencias pinta la tabla", async () => {
        latencias.registrar("tarea", "Backup de la BD", 120);
        let vista = null;
        const ok = await handleSistemaButton({ customId: "paneladmin_sis_latencias", update: async (v) => (vista = v) });
        expect(ok).toBe(true);
        const descripcion = vista.embeds[0].toJSON().description;
        expect(descripcion).toContain("tarea:Backup de la BD");
        expect(JSON.stringify(vista.components.map((c) => c.toJSON()))).toContain("paneladmin_sis_latencias");
    });

    test("el log periódico escribe cada minuto solo si ha habido muestras nuevas", () => {
        jest.useFakeTimers();
        try {
            const escrito = [];
            const timer = latencias.iniciarLog(1000, (texto) => escrito.push(texto));
            jest.advanceTimersByTime(1000); // sin muestras: no escribe
            expect(escrito).toHaveLength(0);
            latencias.registrar("tarea", "x", 5);
            jest.advanceTimersByTime(1000);
            expect(escrito).toHaveLength(1);
            expect(escrito[0]).toMatch(/tarea:x\s+1\s+5\.00\s+5\.00/);
            jest.advanceTimersByTime(1000); // sin muestras nuevas desde el último
            expect(escrito).toHaveLength(1);
            clearInterval(timer);
        } finally {
            jest.useRealTimers();
        }
    });
});
