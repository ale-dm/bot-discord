// Tickets de soporte (#537): las reglas sin Discord (systems/tickets) y la transcripción (systems/ticketsTranscripcion).
// Configuración y categorías, uno abierto por persona, la hora de espera tras cerrar, quién puede cerrar, el registro de
// quién abrió y cerró, y el .txt con su tope de tamaño. BD en memoria; el reloj se pasa como `ahora`.
const db = require("../src/core/db");
const guildSettings = require("../src/systems/guildSettings");
const tickets = require("../src/systems/tickets");
const { generarTranscripcion, lineasMensaje } = require("../src/systems/ticketsTranscripcion");

let n = 0;
const nuevoServidor = () => `g-tic-${++n}`;
const HORA = 3600 * 1000;
const T0 = Date.UTC(2026, 9, 24, 16, 0, 0); // 2026-10-24 18:00 en Madrid

/** Un servidor con los tickets configurados (canal, rol de staff y canal de logs). */
function configurado(extra = {}) {
    const g = nuevoServidor();
    guildSettings.setManySettings(g, {
        "tickets.canal_id": "c-tickets",
        "tickets.rol_staff": "r-staff",
        "tickets.canal_logs": "c-logs",
        ...extra,
    });
    return g;
}

const abrir = (g, autorId, extra = {}) =>
    tickets.abrir({ guildId: g, autorId, categoria: "General", asunto: "No me llega el sueldo", ahora: T0, ...extra });

describe("configuración y categorías", () => {
    test("sin configurar falta el canal, el rol y el canal de transcripciones, y la categoría es General", () => {
        const cfg = tickets.configuracion(nuevoServidor());
        expect(cfg.lista).toBe(false);
        expect(cfg.falta).toEqual(["el canal de tickets", "el rol de staff", "el canal de transcripciones"]);
        expect(cfg.categorias).toEqual(["General"]);
    });

    test("las categorías se limpian, no se repiten y vacías se quedan en General", () => {
        expect(tickets.normalizarCategorias("  Duda \nReporte,  duda\n\nApelación  de   sanción")).toEqual({
            ok: true,
            categorias: ["Duda", "Reporte", "Apelación de sanción"],
        });
        expect(tickets.normalizarCategorias("  \n , ").categorias).toEqual(["General"]);
    });

    test("más de 10 categorías o una de más de 40 caracteres se rechazan", () => {
        const once = Array.from({ length: 11 }, (_, i) => `Cat ${i}`).join("\n");
        expect(tickets.normalizarCategorias(once)).toMatchObject({ ok: false, motivo: expect.stringMatching(/Como mucho 10/) });
        expect(tickets.normalizarCategorias("x".repeat(41)).ok).toBe(false);
        expect(tickets.normalizarCategorias("x".repeat(40)).ok).toBe(true);
    });
});

describe("abrir", () => {
    test("sin configurar no se puede abrir y no queda ningún ticket", () => {
        const g = nuevoServidor();
        expect(abrir(g, "u1")).toMatchObject({ ok: false, motivo: expect.stringMatching(/no están configurados/) });
        expect(db.prepare("SELECT COUNT(*) AS n FROM tickets WHERE guildId = ?").get(g).n).toBe(0);
    });

    test("abre un ticket con su autor, categoría, asunto y fecha, todavía sin hilo", () => {
        const g = configurado({ "tickets.categorias": "Duda\nReporte" });
        const r = abrir(g, "u1", { categoria: "reporte", asunto: "  Alguien   hace trampas  " });
        expect(r.ok).toBe(true);
        expect(r.ticket).toMatchObject({
            guildId: g,
            autorId: "u1",
            categoria: "Reporte",
            asunto: "Alguien hace trampas",
            estado: "abierto",
            abiertoEn: T0,
            threadId: null,
            cerradoPor: null,
        });
    });

    test("una categoría que no existe o un asunto demasiado corto no abren nada", () => {
        const g = configurado();
        expect(abrir(g, "u1", { categoria: "Inventada" }).motivo).toMatch(/categoría ya no existe/);
        expect(abrir(g, "u1", { asunto: "hey" }).motivo).toMatch(/al menos 5/);
        expect(tickets.abiertoDe(g, "u1")).toBeNull();
    });

    test("uno abierto por persona: el segundo se rechaza y enlaza el hilo del primero", () => {
        const g = configurado();
        const primero = abrir(g, "u1").ticket;
        tickets.guardarHilo(primero.id, "hilo-1", "msg-1");
        const segundo = abrir(g, "u1");
        expect(segundo).toMatchObject({ ok: false, motivo: expect.stringContaining("<#hilo-1>") });
        expect(segundo.ticket.id).toBe(primero.id);
        expect(abrir(g, "u2").ok).toBe(true);
    });

    test("el índice único impide dos abiertos de la misma persona aunque se salte la comprobación", () => {
        const g = configurado();
        abrir(g, "u1");
        expect(() =>
            db.prepare("INSERT INTO tickets (guildId, autorId, categoria, abiertoEn) VALUES (?, ?, 'General', ?)").run(g, "u1", T0),
        ).toThrow(/UNIQUE/);
    });

    test("tras cerrar hay que esperar una hora para abrir otro", () => {
        const g = configurado();
        const t = abrir(g, "u1").ticket;
        tickets.cerrar(t.id, "staff-1", T0 + 10 * 60 * 1000);
        const pronto = abrir(g, "u1", { ahora: T0 + 30 * 60 * 1000 });
        expect(pronto).toMatchObject({ ok: false, motivo: expect.stringMatching(/dentro de 40 minutos/) });
        expect(abrir(g, "u1", { ahora: T0 + 10 * 60 * 1000 + HORA }).ok).toBe(true);
    });

    test("un ticket perdido (su hilo desapareció) no bloquea ni cuenta para la espera", () => {
        const g = configurado();
        const t = abrir(g, "u1").ticket;
        tickets.guardarHilo(t.id, "hilo-borrado");
        expect(tickets.marcarPerdido(t.id, T0 + 1000)).toBe(true);
        expect(tickets.porId(t.id).estado).toBe("perdido");
        expect(abrir(g, "u1", { ahora: T0 + 2000 }).ok).toBe(true);
    });

    test("una apertura que se quedó sin hilo más de 5 minutos se da por perdida al volver a intentarlo", () => {
        const g = configurado();
        const t = abrir(g, "u1").ticket;
        expect(abrir(g, "u1", { ahora: T0 + 60 * 1000 }).motivo).toMatch(/se está creando/);
        expect(abrir(g, "u1", { ahora: T0 + tickets.SIN_HILO_MS + 1000 }).ok).toBe(true);
        expect(tickets.porId(t.id).estado).toBe("perdido");
    });

    test("descartar borra el ticket cuyo hilo no se pudo crear, sin dejar espera", () => {
        const g = configurado();
        const t = abrir(g, "u1").ticket;
        expect(tickets.descartar(t.id)).toBe(true);
        expect(tickets.porId(t.id)).toBeNull();
        expect(tickets.esperaRestante(g, "u1", T0)).toBe(0);
    });
});

describe("cerrar", () => {
    test("queda quién lo cerró y cuándo; un segundo cierre no cambia nada", () => {
        const g = configurado();
        const t = abrir(g, "u1").ticket;
        const r = tickets.cerrar(t.id, "staff-1", T0 + HORA);
        expect(r.ok).toBe(true);
        expect(tickets.porId(t.id)).toMatchObject({ estado: "cerrado", autorId: "u1", cerradoPor: "staff-1", cerradoEn: T0 + HORA });
        expect(tickets.cerrar(t.id, "u1", T0 + 2 * HORA)).toMatchObject({ ok: false, motivo: expect.stringMatching(/ya está cerrado/) });
        expect(tickets.porId(t.id).cerradoPor).toBe("staff-1");
    });

    test("pueden cerrar el autor y el staff, nadie más", () => {
        const t = { autorId: "u1" };
        expect(tickets.puedeCerrar(t, { userId: "u1", esStaff: false })).toBe(true);
        expect(tickets.puedeCerrar(t, { userId: "otro", esStaff: true })).toBe(true);
        expect(tickets.puedeCerrar(t, { userId: "otro", esStaff: false })).toBe(false);
    });

    test("la lista de abiertos solo cuenta los abiertos del servidor", () => {
        const g = configurado();
        const a = abrir(g, "u1").ticket;
        abrir(g, "u2");
        tickets.cerrar(a.id, "u1", T0);
        expect(tickets.cuentaAbiertos(g)).toBe(1);
        expect(tickets.abiertos(g).map((t) => t.autorId)).toEqual(["u2"]);
    });
});

describe("permisos en español", () => {
    test("los nombres de los permisos que faltan salen como en Discord", () => {
        expect(tickets.describirPermisos(["CreatePrivateThreads", "AttachFiles"])).toBe("«Crear hilos privados», «Adjuntar archivos»");
    });
});

describe("transcripción", () => {
    const ticket = {
        id: 7,
        categoria: "Duda",
        autorId: "u1",
        asunto: "¿Cómo va el banco?",
        abiertoEn: T0,
        cerradoEn: T0 + HORA,
        cerradoPor: "s1",
    };
    const mensaje = (i, extra = {}) => ({ fecha: T0 + i * 60000, autor: "ana", autorId: "u1", texto: `mensaje ${i}`, ...extra });

    test("lleva la cabecera con quién abrió y cerró y cada mensaje con su hora de Madrid", () => {
        const t = generarTranscripcion(ticket, [mensaje(1), mensaje(2, { autor: "staffer", autorId: "s1", texto: "Te ayudo" })], {
            nombres: { autor: "ana", cerradoPor: "staffer" },
        });
        expect(t.texto).toContain("Ticket #7 · Duda");
        expect(t.texto).toContain("Abierto por: ana (u1) el 2026-10-24 18:00");
        expect(t.texto).toContain("Cerrado por: staffer (s1) el 2026-10-24 19:00");
        expect(t.texto).toContain("[2026-10-24 18:02] staffer (s1): Te ayudo");
        expect(t).toMatchObject({ incluidos: 2, total: 2, recortada: false });
        expect(t.bytes).toBe(Buffer.byteLength(t.texto));
    });

    test("los adjuntos y los embeds van debajo de su mensaje", () => {
        const texto = lineasMensaje(mensaje(1, { adjuntos: ["https://cdn/x.png"], embeds: ["Título — descripción"] }));
        expect(texto.split("\n")).toEqual([
            "[2026-10-24 18:01] ana (u1): mensaje 1",
            "    📎 https://cdn/x.png",
            "    [embed] Título — descripción",
        ]);
    });

    test("si no cabe, se recorta por el final, no pasa del tope y dice cuántos mensajes faltan", () => {
        const muchos = Array.from({ length: 200 }, (_, i) => mensaje(i, { texto: "x".repeat(100) }));
        const t = generarTranscripcion(ticket, muchos, { maxBytes: 5000 });
        expect(t.recortada).toBe(true);
        expect(t.bytes).toBeLessThanOrEqual(5000);
        expect(t.texto).toContain(`faltan ${200 - t.incluidos} mensajes`);
        expect(t.texto).toContain("[2026-10-24 18:00] ana (u1): xxx");
    });

    test("un ticket sin mensajes lo dice", () => {
        expect(generarTranscripcion(ticket, []).texto).toContain("(Sin mensajes)");
    });
});
