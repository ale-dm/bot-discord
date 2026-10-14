// Fase 11 (Duende e IA): historial de imágenes (#357), «Otra versión» (#363), imagen desde el chat (#367), cuota diaria de respuestas
// (#371) y de imágenes (#408), notas de voz (#376), /resumen (#382), editar y caducar recuerdos (#386, #390), resumen de la conversación
// en directo (#395), voz por personalidad (#396), espontáneos sin repetir (#400) y olvidar una nota (#405). Gemini, Discord y la red se simulan.
process.env.DUENDE_DAILY_LIMIT = "5";
process.env.DUENDE_DAILY_LIMIT_USER = "2";
process.env.GOOGLE_API_KEY = "clave-de-prueba";
process.env.IMAGE_GEN_COOLDOWN_MS = "45000";

jest.mock("../src/services/duende/gemini", () => ({
    ...jest.requireActual("../src/services/duende/gemini"),
    generarConGemini: jest.fn(async () => "Eh, tú"),
}));

const db = require("../src/core/db");
const guildSettings = require("../src/systems/guildSettings");
const cuotas = require("../src/systems/duende/cuotas");
const imagenesSys = require("../src/systems/duende/imagenes");
const generar = require("../src/services/duende/chat/generar");
const imagenCmd = require("../src/commands/duende/imagen");
const imagenesCmd = require("../src/commands/duende/imagenes");
const resumenCmd = require("../src/commands/duende/resumen");
const resumenCanal = require("../src/services/duende/resumenCanal");
const herramientaImagen = require("../src/services/duende/herramientas/imagen");
const { enviarRespuestaTexto } = require("../src/services/duende/chat/enviar");
const notaDeVoz = require("../src/services/notaDeVoz");
const mensajes = require("../src/core/mensajes");
const recuerdos = require("../src/systems/duende/recuerdosAuto");
const duende = require("../src/commands/duende/duende");
const liveResumen = require("../src/services/duende/liveVoz/resumen");
const perfiles = require("../src/systems/duende/perfiles");
const espontaneo = require("../src/systems/duende/espontaneo");
const acciones = require("../src/paneles/duendeAcciones");
const paneles = require("../src/paneles/duende");

let n = 0;
const usuario = () => `f11-${++n}`;
const flagsEfimero = (r) => Boolean(r.flags);

afterEach(() => jest.restoreAllMocks());

describe("contadores diarios que sobreviven al reinicio (#371, #408)", () => {
    test("consumir gasta todos los topes a la vez o ninguno, 0 los apaga y devolver devuelve una unidad", () => {
        const k = usuario();
        expect(
            cuotas.consumir([
                [`a:${k}`, 2],
                [`b:${k}`, 1],
            ]).ok,
        ).toBe(true);
        expect(
            cuotas.consumir([
                [`a:${k}`, 2],
                [`b:${k}`, 1],
            ]),
        ).toEqual({ ok: false, indice: 1 });
        expect(cuotas.usadas(`a:${k}`)).toBe(1); // el segundo intento no gastó nada de `a`
        expect(cuotas.consumir([[`c:${k}`, 0]]).ok).toBe(true);
        expect(cuotas.usadas(`c:${k}`)).toBe(0);
        cuotas.devolver(`a:${k}`);
        expect(cuotas.usadas(`a:${k}`)).toBe(0);
    });

    test("cada día empieza de cero (hora de Madrid) y se sabe cuándo se reinicia", () => {
        const k = usuario();
        const ahora = Date.parse("2026-10-14T10:00:00Z");
        cuotas.consumir([[`d:${k}`, 1]], ahora);
        expect(cuotas.consumir([[`d:${k}`, 1]], ahora).ok).toBe(false);
        expect(cuotas.consumir([[`d:${k}`, 1]], ahora + 86400000).ok).toBe(true);
        expect(cuotas.reinicio(ahora)).toBe(Math.floor(Date.parse("2026-10-14T22:00:00Z") / 1000)); // 00:00 del 15 en Madrid (UTC+2)
        cuotas.limpiar(ahora + 30 * 86400000);
        expect(db.prepare("SELECT COUNT(*) AS n FROM duende_cuotas WHERE clave = ?").get(`d:${k}`).n).toBe(0);
    });
});

describe("cuota diaria de respuestas del Duende por persona (#371)", () => {
    test("al llegar al suyo solo esa persona se queda sin respuesta; el global cuenta a todos", () => {
        const [a, b, c, d] = [usuario(), usuario(), usuario(), usuario()];
        db.prepare("DELETE FROM duende_cuotas WHERE clave LIKE 'chat:%'").run();
        expect(generar.checkAndIncrementDailyLimit(a).ok).toBe(true);
        expect(generar.checkAndIncrementDailyLimit(a).ok).toBe(true);
        expect(generar.checkAndIncrementDailyLimit(a)).toEqual({ ok: false, motivo: "usuario" });
        expect(generar.checkAndIncrementDailyLimit(b).ok).toBe(true); // el resto sigue
        expect(generar.checkAndIncrementDailyLimit(b).ok).toBe(true);
        expect(generar.checkAndIncrementDailyLimit(c).ok).toBe(true); // 5.º global
        expect(generar.checkAndIncrementDailyLimit(d)).toEqual({ ok: false, motivo: "global" });
        expect(cuotas.usadas("chat:global")).toBe(5); // lo rechazado no cuenta
    });
});

describe("imágenes: cooldown, cuota y historial (#408, #357)", () => {
    test("el cooldown se comparte, la cuota diaria se acaba y un fallo devuelve todo", () => {
        const u = usuario();
        const t0 = Date.now();
        expect(imagenesSys.reservar(u, { ahora: t0, limite: 2 })).toMatchObject({ ok: true, restantes: 1 });
        expect(imagenesSys.reservar(u, { ahora: t0 + 1000, limite: 2 })).toMatchObject({ ok: false, motivo: "cooldown", faltan: 44 });
        expect(imagenesSys.reservar(u, { ahora: t0 + 50000, limite: 2 }).ok).toBe(true);
        const r = imagenesSys.reservar(u, { ahora: t0 + 100000, limite: 2 });
        expect(r).toMatchObject({ ok: false, motivo: "cuota" });
        expect(imagenesSys.mensajeDeLimite(r)).toMatch(/imágenes de hoy/);
        imagenesSys.liberar(u, t0 + 100000);
        expect(imagenesSys.reservar(u, { ahora: t0 + 100001, limite: 2 }).ok).toBe(true); // el cupo vuelve
    });

    test("guardar y listar: las propias, las del servidor, y un fallo de la base de datos no rompe nada", () => {
        const [a, b] = [usuario(), usuario()];
        expect(imagenesSys.guardar({ guildId: "gi", userId: a, prompt: "un gato", estilo: "anime, vivo", url: "https://m/1" })).toBe(true);
        imagenesSys.guardar({ guildId: "gi", userId: b, prompt: "un perro", url: "https://m/2", adjunto: "https://c/2.png" });
        expect(imagenesSys.ultimas({ userId: a }).map((f) => f.prompt)).toEqual(["un gato"]);
        expect(imagenesSys.ultimas({ guildId: "gi" }).map((f) => f.prompt)).toEqual(["un perro", "un gato"]);
        jest.spyOn(db, "prepare").mockImplementation(() => {
            throw new Error("base rota");
        });
        expect(imagenesSys.guardar({ userId: a, prompt: "x" })).toBe(false);
    });

    test("/imagenes: cada persona ve las suyas y un admin las del servidor, en privado", async () => {
        const u = usuario();
        imagenesSys.guardar({ guildId: "gi2", userId: u, prompt: "mi dibujo", url: "https://m/9" });
        imagenesSys.guardar({ guildId: "gi2", userId: "otro", prompt: "dibujo ajeno", url: "https://m/10" });
        const reply = jest.fn(async () => {});
        await imagenesCmd.run(null, { guildId: "gi2", user: { id: u }, member: { permissions: { has: () => false } }, reply });
        expect(reply.mock.calls[0][0].content).toMatch(/mi dibujo/);
        expect(reply.mock.calls[0][0].content).not.toMatch(/ajeno/);
        expect(flagsEfimero(reply.mock.calls[0][0])).toBe(true);
        const admin = jest.fn(async () => {});
        await imagenesCmd.run(null, { guildId: "gi2", user: { id: "admin" }, member: { permissions: { has: () => true } }, reply: admin });
        expect(admin.mock.calls[0][0].content).toMatch(/dibujo ajeno/);
        const vacia = jest.fn(async () => {});
        await imagenesCmd.run(null, { guildId: "gi2", user: { id: "nadie" }, member: { permissions: { has: () => false } }, reply: vacia });
        expect(vacia.mock.calls[0][0].content).toMatch(/Todavía no has generado/);
    });
});

describe("/imagen: historial y botón «Otra versión» (#357, #363)", () => {
    const cliente = () => ({});
    const interaccion = (u, id = `i-${++n}`, extra = {}) => ({
        id,
        guildId: "gi3",
        user: { id: u, tag: u, username: u },
        deferReply: jest.fn(async () => {}),
        editReply: jest.fn(async () => ({
            url: `https://discord/${id}`,
            attachments: { first: () => ({ url: `https://cdn/${id}.png` }) },
        })),
        reply: jest.fn(async () => {}),
        options: { getString: (k) => ({ descripcion: "un gato astronauta", estilo: null })[k] ?? null, getAttachment: () => null },
        ...extra,
    });
    const imagenFalsa = () => ({ imageBuffer: Buffer.from("png"), mimeType: "image/png" });

    test("una imagen buena deja su fila con el enlace y trae el botón; el botón repite la petición solo para su dueño y respeta el cooldown", async () => {
        const u = usuario();
        const generar2 = jest.spyOn(imagenesSys, "generarConTimeout").mockResolvedValue(imagenFalsa());
        const i = interaccion(u);
        await imagenCmd.run(cliente(), i);
        const respuesta = i.editReply.mock.calls[0][0];
        expect(respuesta.components[0].components[0].data.custom_id).toBe(`imagen_otra_${i.id}`);
        expect(imagenesSys.ultimas({ userId: u })[0]).toMatchObject({
            prompt: "un gato astronauta",
            url: `https://discord/${i.id}`,
            adjunto: `https://cdn/${i.id}.png`,
        });

        const ajeno = interaccion("intruso", "b1", { customId: `imagen_otra_${i.id}`, user: { id: "intruso", tag: "intruso" } });
        await imagenCmd.handleButton(cliente(), ajeno);
        expect(ajeno.reply.mock.calls[0][0].content).toMatch(/Solo quien pidió/);

        const pronto = interaccion(u, "b2", { customId: `imagen_otra_${i.id}` });
        await imagenCmd.handleButton(cliente(), pronto);
        expect(pronto.reply.mock.calls[0][0].content).toMatch(/Espera/);
        expect(generar2).toHaveBeenCalledTimes(1);

        // Pasado el cooldown, la repite con la misma descripción.
        jest.spyOn(Date, "now").mockReturnValue(Date.now() + 60_000);
        const buena = interaccion(u, "b3", { customId: `imagen_otra_${i.id}` });
        await imagenCmd.handleButton(cliente(), buena);
        expect(generar2).toHaveBeenCalledTimes(2);
        expect(generar2.mock.calls[1][0]).toBe("un gato astronauta");
        expect(buena.editReply.mock.calls[0][0].components[0].components[0].data.custom_id).toBe("imagen_otra_b3");
    });

    test("una petición que no existe (caducada o tras un reinicio) lo dice; un fallo de la API devuelve el cupo", async () => {
        const u = usuario();
        const caducada = interaccion(u, "c1", { customId: "imagen_otra_no-existe" });
        await imagenCmd.handleButton(cliente(), caducada);
        expect(caducada.reply.mock.calls[0][0].content).toMatch(/caducado/);
        jest.spyOn(imagenesSys, "generarConTimeout").mockRejectedValue(new Error("503 unavailable"));
        const i = interaccion(u);
        const antes = cuotas.usadas(`imagen:${u}`);
        await imagenCmd.run(cliente(), i);
        expect(i.editReply.mock.calls[0][0].content).toMatch(/saturado/);
        expect(cuotas.usadas(`imagen:${u}`)).toBe(antes);
        expect(imagenesSys.ultimas({ userId: u })).toEqual([]);
    });

    test("con la cuota agotada no se llama a la API y avisa de cuándo vuelve", async () => {
        const u = usuario();
        const generar2 = jest.spyOn(imagenesSys, "generarConTimeout").mockResolvedValue(imagenFalsa());
        jest.spyOn(imagenesSys, "reservar").mockReturnValue({ ok: false, motivo: "cuota", reinicio: 1799999999 });
        const i = interaccion(u);
        await imagenCmd.run(cliente(), i);
        expect(i.editReply.mock.calls[0][0].content).toMatch(/1799999999/);
        expect(generar2).not.toHaveBeenCalled();
    });
});

describe("imagen desde el chat (#367)", () => {
    const d = (extra = {}) => ({
        imagenes: {
            reservar: jest.fn(() => ({ ok: true })),
            liberar: jest.fn(),
            mensajeDeLimite: (r) => `limite ${r.motivo} <t:1:R>`,
            generarConTimeout: jest.fn(async () => ({ imageBuffer: Buffer.from("x"), mimeType: "image/png" })),
            ...extra,
        },
    });
    const ejecutor = herramientaImagen.DUENDE_IMAGEN_EXECUTORS.generar_imagen;

    test("una sola generación, con la reserva compartida, y la imagen queda para enviarla después del texto", async () => {
        const dobles = d();
        const ctx = { userId: "u", imagenes: [] };
        const r = await ejecutor({ descripcion: "un dragón", estilo: "óleo" }, ctx, dobles);
        expect(r.ok).toBe(true);
        expect(dobles.imagenes.reservar).toHaveBeenCalledWith("u");
        expect(dobles.imagenes.generarConTimeout).toHaveBeenCalledWith("un dragón. Estilo: óleo", []);
        expect(ctx.imagenes).toHaveLength(1);
        expect((await ejecutor({ descripcion: "otra" }, ctx, dobles)).error).toMatch(/una imagen por mensaje/);
        expect(dobles.imagenes.generarConTimeout).toHaveBeenCalledTimes(1);
    });

    test("no se salta el cooldown ni la cuota, un fallo se dice y devuelve el cupo, y por voz no existe", async () => {
        const limitado = d({ reservar: jest.fn(() => ({ ok: false, motivo: "cooldown", faltan: 30 })) });
        expect((await ejecutor({ descripcion: "algo" }, { userId: "u", imagenes: [] }, limitado)).error).toMatch(/limite cooldown/);
        expect(limitado.imagenes.generarConTimeout).not.toHaveBeenCalled();
        const roto = d({
            generarConTimeout: jest.fn(async () => {
                throw new Error("bloqueada");
            }),
        });
        const r = await ejecutor({ descripcion: "algo" }, { userId: "u", imagenes: [] }, roto);
        expect(r.error).toMatch(/No se ha podido generar.*No se ha enviado nada/);
        expect(roto.imagenes.liberar).toHaveBeenCalledWith("u");
        expect((await ejecutor({ descripcion: "algo" }, { userId: "u" }, d())).error).toMatch(/no puedo enviar imágenes/);
        expect((await ejecutor({ descripcion: " " }, { userId: "u", imagenes: [] }, d())).error).toMatch(/descripción/);
    });

    test("el chat la envía como mensaje aparte con el fichero, y la herramienta solo se ofrece donde se puede adjuntar", async () => {
        const followUp = jest.fn(async () => {});
        const interaction = { editReply: jest.fn(async () => {}), followUp, ephemeral: false };
        await enviarRespuestaTexto(interaction, {
            sendText: "Aquí tienes",
            gifUrl: null,
            propuestas: [],
            imagenes: [{ buffer: Buffer.from("x"), mimeType: "image/jpeg" }],
        });
        expect(followUp.mock.calls[0][0].files[0].name).toBe("imagen_duende_1.jpg");
        const tools = require("../src/services/duende/herramientas");
        expect(tools.DUENDE_IMAGEN_TOOL_DECLARATIONS[0].name).toBe("generar_imagen");
        expect(tools.DUENDE_TOOL_EXECUTORS.generar_imagen).toBe(ejecutor);
    });
});

describe("notas de voz (#376)", () => {
    test("solo audios que caben (60 s, 8 MB)", () => {
        expect(notaDeVoz.esAudio({ contentType: "audio/ogg" })).toBe(true);
        expect(notaDeVoz.esAudio({ contentType: "image/png" })).toBe(false);
        expect(notaDeVoz.cabe({ duration: 30, size: 1000 })).toBe(true);
        expect(notaDeVoz.cabe({ duration: 61 })).toBe(false);
        expect(notaDeVoz.cabe({ size: 9 * 1024 * 1024 })).toBe(false);
    });

    test("se transcribe y se borra el temporal; si algo falla, null y sin tocar el canal", async () => {
        const borrado = [];
        const ok = await notaDeVoz.transcribirNota(
            { url: "https://cdn/nota.ogg" },
            {
                descargar: async () => Buffer.from("audio"),
                convertirAWav: async (a, wav) => borrado.push(wav),
                transcribir: async () => "  hola duende  ",
            },
        );
        expect(ok).toBe("hola duende");
        expect(require("fs").existsSync(borrado[0])).toBe(false);
        for (const deps of [
            {
                descargar: async () => {
                    throw new Error("404");
                },
                convertirAWav: jest.fn(),
                transcribir: jest.fn(),
            },
            { descargar: async () => Buffer.from("a"), convertirAWav: async () => {}, transcribir: async () => null },
            { descargar: async () => Buffer.from("a"), convertirAWav: async () => {}, transcribir: async () => "   " },
        ]) {
            expect(await notaDeVoz.transcribirNota({ url: "u" }, deps)).toBeNull();
        }
    });

    test("el texto del Duende es la transcripción (más lo escrito) y sin transcripción no se responde; solo en canales del Duende", async () => {
        const mensaje = (extra = {}) => ({ guildId: "g-voz", channelId: "c-libre", author: { tag: "a" }, ...extra });
        guildSettings.setSetting("g-voz", "duende.allowed_channel_id", "");
        const t = jest.fn(async () => "qué hora es");
        expect(await mensajes.textoConNotasDeVoz(mensaje(), "mira", [{ url: "u" }], t)).toBe("mira qué hora es");
        expect(await mensajes.textoConNotasDeVoz(mensaje(), "solo texto", [], t)).toBe("solo texto");
        expect(await mensajes.textoConNotasDeVoz(mensaje(), "", [{ url: "u" }], async () => null)).toBeNull();
        guildSettings.setSetting("g-voz", "duende.allowed_channel_id", "c-duende");
        t.mockClear();
        expect(await mensajes.textoConNotasDeVoz(mensaje(), "", [{ url: "u" }], t)).toBeNull();
        expect(t).not.toHaveBeenCalled();
    });
});

describe("/resumen (#382)", () => {
    const msg = (autor, texto, ts, extra = {}) => ({
        author: { username: autor, bot: false },
        member: { displayName: autor },
        content: texto,
        createdTimestamp: ts,
        id: `m${ts}`,
        ...extra,
    });
    const canal = (lista) => ({
        id: "c-res",
        messages: {
            fetch: jest.fn(async () => {
                const mapa = new Map(lista.map((m) => [m.id, m]));
                mapa.last = () => lista.at(-1);
                return mapa;
            }),
        },
    });

    test("limpiar quita menciones y enlaces", () => {
        expect(resumenCanal.limpiar("hola <@123> y @everyone mirad https://x.com/a?b=1 y @pepe")).toBe(
            "hola alguien y todos mirad [enlace] y pepe",
        );
    });

    test("lee los últimos N de personas, en orden, sin bots ni vacíos", async () => {
        const lista = [
            msg("ana", "uno", 1),
            msg("bot", "ruido", 2, { author: { username: "bot", bot: true } }),
            msg("beto", "dos https://x.com", 3),
            msg("cris", "   ", 4),
            msg("ana", "tres", 5),
        ];
        const r = await resumenCanal.leerMensajes(canal(lista), 2);
        expect(r).toEqual([
            { autor: "beto", texto: "dos [enlace]" },
            { autor: "ana", texto: "tres" },
        ]);
    });

    test("el resumen sale limpio y, si Gemini bloquea, se reintenta en neutro", async () => {
        const generar2 = jest.fn(async () => "Hablaron con @ana de https://x.com y <@5>");
        const r = await resumenCanal.resumir("c-res", [{ autor: "ana", texto: "hola" }], { generar: generar2 });
        expect(r).toBe("Hablaron con ana de [enlace] y alguien");
        const bloqueado = jest.fn().mockRejectedValueOnce(new Error("PROHIBITED_CONTENT")).mockResolvedValueOnce("Resumen neutro");
        expect(await resumenCanal.resumir("c-res", [{ autor: "ana", texto: "x" }], { generar: bloqueado })).toBe("Resumen neutro");
        const roto = jest.fn().mockRejectedValue(new Error("red"));
        await expect(resumenCanal.resumir("c-res", [{ autor: "a", texto: "x" }], { generar: roto })).rejects.toThrow("red");
    });

    test("el comando: poca conversación, límite diario y permisos", async () => {
        const base = (extra = {}) => ({
            guildId: "g-res",
            channelId: "c-res",
            channel: canal([msg("ana", "solo uno", 1)]),
            user: { id: usuario() },
            member: {},
            options: { getInteger: () => 50 },
            reply: jest.fn(async () => {}),
            deferReply: jest.fn(async () => {}),
            editReply: jest.fn(async () => {}),
            ...extra,
        });
        db.prepare("DELETE FROM duende_cuotas WHERE clave LIKE 'chat:%'").run();
        const pocos = base();
        await resumenCmd.run(null, pocos);
        expect(pocos.editReply.mock.calls.at(-1)[0]).toMatch(/No hay bastante conversación/);

        const sinPermiso = base({ channel: { ...canal([]), permissionsFor: () => ({ has: () => false }) } });
        await resumenCmd.run(null, sinPermiso);
        expect(sinPermiso.reply.mock.calls[0][0].content).toMatch(/No puedes ver/);
        expect(sinPermiso.deferReply).not.toHaveBeenCalled();

        const gasta = base();
        generar.checkAndIncrementDailyLimit(gasta.user.id);
        generar.checkAndIncrementDailyLimit(gasta.user.id);
        await resumenCmd.run(null, gasta);
        expect(gasta.reply.mock.calls[0][0].content).toMatch(/tus respuestas de hoy|límite de hoy/);
    });
});

describe("recuerdos propuestos: editar y caducar (#386, #390)", () => {
    const G = "g-f11-rec";
    const ADMIN = "admin-f11";
    const propuesta = (extra = {}) =>
        db
            .prepare("INSERT INTO duende_recuerdos_propuestos (guildId, userId, nombre, texto, creada_en) VALUES (?, ?, ?, ?, ?)")
            .run(G, extra.userId ?? "persona-1", "Pers", extra.texto ?? "le gusta el pádel", extra.creada ?? Date.now()).lastInsertRowid;
    const boton = (id, quien = ADMIN) => ({
        customId: id,
        user: { id: quien },
        reply: jest.fn(async () => {}),
        update: jest.fn(async () => {}),
        showModal: jest.fn(async () => {}),
    });

    beforeAll(() => guildSettings.setSetting(G, "alertas.admin_ids", ADMIN));

    test("✏️ abre el formulario con el texto, y al guardar el perfil recibe el corregido", async () => {
        const id = propuesta({ userId: "pers-edit" });
        const b = boton(`recuerdo_auto_edit_${id}`);
        await duende.handleRecuerdoAuto(null, b);
        const modal = b.showModal.mock.calls[0][0];
        expect(modal.data.custom_id).toBe(`recuerdo_auto_modal_${id}`);
        expect(modal.toJSON().components[0].components[0].value).toBe("le gusta el pádel");
        const m = {
            customId: `recuerdo_auto_modal_${id}`,
            user: { id: ADMIN },
            fields: { getTextInputValue: () => "  juega al pádel los martes  " },
            reply: jest.fn(async () => {}),
            update: jest.fn(async () => {}),
        };
        await duende.handleRecuerdoAutoModal(null, m);
        expect(m.update.mock.calls[0][0].content).toMatch(/Guardado/);
        expect(perfiles.perfilPorDiscordId("pers-edit").notas).toEqual(["juega al pádel los martes"]);
        expect(db.prepare("SELECT estado FROM duende_recuerdos_propuestos WHERE id = ?").get(id).estado).toBe("aprobado");
    });

    test("solo admins editan, y un texto vacío o de menos de 3 caracteres se rechaza dejando la propuesta pendiente", async () => {
        const id = propuesta({ userId: "pers-edit2" });
        const intruso = boton(`recuerdo_auto_edit_${id}`, "no-admin");
        await duende.handleRecuerdoAuto(null, intruso);
        expect(intruso.showModal).not.toHaveBeenCalled();
        expect(intruso.reply.mock.calls[0][0].content).toMatch(/Solo los admins/);
        for (const texto of ["", "  ", "ab"]) {
            const m = {
                customId: `recuerdo_auto_modal_${id}`,
                user: { id: ADMIN },
                fields: { getTextInputValue: () => texto },
                reply: jest.fn(async () => {}),
                update: jest.fn(async () => {}),
            };
            await duende.handleRecuerdoAutoModal(null, m);
            expect(m.reply.mock.calls[0][0].content).toMatch(/al menos 3 caracteres/);
        }
        expect(db.prepare("SELECT estado FROM duende_recuerdos_propuestos WHERE id = ?").get(id).estado).toBe("pendiente");
        expect(perfiles.perfilPorDiscordId("pers-edit2")).toBeFalsy();
    });

    test("una propuesta de más de 7 días caduca y su DM pierde los botones; las decididas no cambian; resolver lo rechaza", async () => {
        const ahora = Date.now();
        const vieja = propuesta({ creada: ahora - 8 * 86400000 });
        const decidida = propuesta({ creada: ahora - 9 * 86400000 });
        recuerdos.resolver(decidida, ADMIN, false);
        const reciente = propuesta({ creada: ahora - 2 * 86400000 });
        db.prepare("INSERT INTO duende_recuerdos_dms (propuesta_id, userId, canalId, mensajeId) VALUES (?, ?, 'dm1', 'msg1')").run(
            vieja,
            ADMIN,
        );
        const edit = jest.fn(async () => {});
        const client = { users: { fetch: async () => ({ createDM: async () => ({ messages: { fetch: async () => ({ edit }) } }) }) } };
        expect(await recuerdos.caducarPendientes(client, ahora)).toBe(1);
        expect(edit).toHaveBeenCalledWith({ content: expect.stringMatching(/caducó/), components: [] });
        const estado = (id) => db.prepare("SELECT estado FROM duende_recuerdos_propuestos WHERE id = ?").get(id).estado;
        expect([estado(vieja), estado(decidida), estado(reciente)]).toEqual(["caducado", "descartado", "pendiente"]);
        expect(recuerdos.resolver(vieja, ADMIN, true).mensaje).toMatch(/caducó/);
        expect(recuerdos.puedeDecidir(vieja, ADMIN).ok).toBe(false);
        expect(await recuerdos.caducarPendientes(client, ahora)).toBe(0);
    });

    test("avisarAdmins apunta el mensaje del DM de cada admin", async () => {
        const id = propuesta();
        const dm = { id: "dm-777", channelId: "dm-canal" };
        const client = { users: { fetch: async () => ({ send: async () => dm }) } };
        await recuerdos.analizar(client, G, { id: "x", nombre: "X" }, ["t"], { gemini: async () => '{"recuerdo": "algo que recordar"}' });
        expect(db.prepare("SELECT mensajeId, canalId FROM duende_recuerdos_dms WHERE mensajeId = 'dm-777'").get()).toEqual({
            mensajeId: "dm-777",
            canalId: "dm-canal",
        });
        expect(id).toBeTruthy();
    });
});

describe("resumen de la conversación en directo (#395)", () => {
    test("las transcripciones se juntan por quien habla y pasado el tope se tira lo viejo", () => {
        const sesion = {};
        liveResumen.acumular(sesion, "usuario", "hola");
        liveResumen.acumular(sesion, "usuario", "qué tal");
        liveResumen.acumular(sesion, "duende", "bien");
        liveResumen.acumular(sesion, "duende", "   ");
        expect(sesion.transcripcion.entradas).toEqual([
            { quien: "usuario", texto: "hola qué tal" },
            { quien: "duende", texto: "bien" },
        ]);
        const larga = {};
        for (let i = 0; i < 400; i++) liveResumen.acumular(larga, i % 2 ? "duende" : "usuario", "x".repeat(100));
        expect(larga.transcripcion.caracteres).toBeLessThanOrEqual(liveResumen.MAX_CARACTERES);
    });

    test("se publica un resumen en el canal; sin transcripciones o con un fallo, nada y sin romper", async () => {
        const sesion = {};
        liveResumen.acumular(sesion, "usuario", "Hemos hablado de ir al cine el viernes y de la quiniela de la jornada.");
        const send = jest.fn(async () => {});
        const client = { channels: { fetch: async () => ({ send }) } };
        const deps = { generar: jest.fn(async () => "Hablaron del cine del viernes y de la quiniela @alguien") };
        expect(await liveResumen.publicar(client, "c1", sesion.transcripcion, deps)).toBe(true);
        expect(send.mock.calls[0][0].content).toMatch(/Resumen de la conversación[\s\S]*cine del viernes y de la quiniela alguien/);
        expect(send.mock.calls[0][0].allowedMentions).toEqual({ parse: [] });
        expect(await liveResumen.publicar(client, "c1", null, deps)).toBe(false);
        expect(await liveResumen.publicar(client, "c1", { entradas: [{ quien: "usuario", texto: "hola" }] }, deps)).toBe(false); // muy poco
        expect(
            await liveResumen.publicar(client, "c1", sesion.transcripcion, {
                generar: async () => {
                    throw new Error("cuota");
                },
            }),
        ).toBe(false);
        expect(send).toHaveBeenCalledTimes(1);
    });

    test("al terminar la sesión se suelta el texto y se pide el resumen", () => {
        const sesionModulo = require("../src/services/duende/liveVoz/sesion");
        const sesion = sesionModulo.crearSesion({ onTerminada: jest.fn(), soloSiLeLlaman: false, tertulia: false });
        liveResumen.acumular(sesion, "usuario", "hola");
        sesion.resumir = jest.fn();
        sesionModulo.sesiones.set("g-fin", sesion);
        sesionModulo.pararConversacion("g-fin", "prueba");
        expect(sesion.resumir).toHaveBeenCalledWith({ entradas: [{ quien: "usuario", texto: "hola" }], caracteres: 5 });
        expect(sesion.transcripcion).toBeNull();
    });
});

describe("voz por personalidad (#396) y olvidar una nota (#405)", () => {
    const admin = (extra = {}) => ({
        user: { id: "adm", tag: "adm", username: "adm" },
        guildId: "g-voz2",
        channelId: "c-voz2",
        member: { permissions: { has: () => true } },
        client: { users: { fetch: async (id) => ({ id, username: id }) } },
        update: jest.fn(async () => {}),
        reply: jest.fn(async () => {}),
        ...extra,
    });

    test("solo valen las siete voces, se aplica la de la personalidad del canal y sin voz es la global", () => {
        perfiles.guardarPersonalidad({ id: "serio", title: "Serio", systemInstructions: "Formal." });
        perfiles.asignarPersonalidadCanal("c-voz2", "serio");
        expect(perfiles.vozDeCanal("c-voz2")).toBeNull();
        expect(perfiles.fijarVoz("serio", "Kore")).toBe(true);
        expect(perfiles.vozDeCanal("c-voz2")).toBe("Kore");
        expect(perfiles.fijarVoz("serio", "Robot")).toBe(false);
        expect(perfiles.fijarVoz("no-existe", "Kore")).toBe(false);
        expect(perfiles.vozDeCanal("otro-canal")).toBeNull();
        expect(perfiles.fijarVoz("serio", null)).toBe(true);
        expect(perfiles.vozDeCanal("c-voz2")).toBeNull();
        expect(perfiles.VOCES).toHaveLength(7);
    });

    test("el admin la cambia desde el menú de la personalidad (sin reiniciar) y un no admin no", async () => {
        perfiles.guardarPersonalidad({ id: "serio", title: "Serio", systemInstructions: "Formal." });
        perfiles.asignarPersonalidadCanal("c-voz2", "serio");
        const i = admin({ customId: "duendepanel_voz", values: ["Fenrir"] });
        await acciones.handleSelect(null, i);
        expect(perfiles.vozDeCanal("c-voz2")).toBe("Fenrir");
        const menu = i.update.mock.calls[0][0].components.flatMap((r) => r.components).find((c) => c.data.custom_id === "duendepanel_voz");
        expect(menu.toJSON().options.find((o) => o.value === "Fenrir").default).toBe(true);
        const intruso = admin({ customId: "duendepanel_voz", values: ["Puck"], member: { permissions: { has: () => false } } });
        await acciones.handleSelect(null, intruso);
        expect(perfiles.vozDeCanal("c-voz2")).toBe("Fenrir");
        const global = admin({ customId: "duendepanel_voz", values: ["global"] });
        await acciones.handleSelect(null, global);
        expect(perfiles.vozDeCanal("c-voz2")).toBeNull();
    });

    test("olvidar una nota: el menú lista las numeradas, borra solo la elegida y baja el contador", async () => {
        const objetivo = { id: "nota-1", username: "ana" };
        perfiles.anotar(objetivo, "le gusta el té", "Ana");
        perfiles.anotar(objetivo, "odia madrugar", "Ana");
        perfiles.anotar(objetivo, "juega al ajedrez", "Ana");
        const vista = paneles.buildRecuerdos({ esAdmin: false, objetivo, puedeBorrar: true });
        const menu = vista.components.flatMap((r) => r.components).find((c) => c.data.custom_id === "duendepanel_nota_borrar_nota-1");
        expect(menu.toJSON().options.map((o) => o.label)).toEqual(["1. le gusta el té", "2. odia madrugar", "3. juega al ajedrez"]);
        const sin = paneles.buildRecuerdos({ esAdmin: false, objetivo, puedeBorrar: false });
        expect(sin.components.flatMap((r) => r.components).some((c) => String(c.data.custom_id).includes("nota_borrar"))).toBe(false);

        const propio = admin({
            customId: "duendepanel_nota_borrar_nota-1",
            values: ["1"],
            user: { id: "nota-1", tag: "ana", username: "ana" },
            member: { permissions: { has: () => false } },
        });
        await acciones.handleSelect(null, propio);
        expect(perfiles.perfilPorDiscordId("nota-1").notas).toEqual(["le gusta el té", "juega al ajedrez"]);
        expect(propio.update.mock.calls[0][0].embeds[0].data.description).toMatch(/Olvidada una nota/);

        const otraPersona = admin({
            customId: "duendepanel_nota_borrar_nota-1",
            values: ["0"],
            user: { id: "curioso", tag: "c", username: "c" },
            member: { permissions: { has: () => false } },
        });
        await acciones.handleSelect(null, otraPersona);
        expect(perfiles.perfilPorDiscordId("nota-1").notas).toHaveLength(2);
        expect(otraPersona.reply.mock.calls[0][0].content).toMatch(/Solo puedes gestionar/);

        const deAdmin = admin({ customId: "duendepanel_nota_borrar_nota-1", values: ["0"] });
        await acciones.handleSelect(null, deAdmin);
        expect(perfiles.perfilPorDiscordId("nota-1").notas).toEqual(["juega al ajedrez"]);
        expect(perfiles.olvidarNota(objetivo, 9)).toEqual({ ok: false });
    });
});

describe("mensajes espontáneos sin repetir a la misma persona (#400)", () => {
    const G = "g-f11-esp";

    test("quien está en espera o acaba de escribir no sale elegido; con todos en espera no hay gancho", () => {
        db.prepare("DELETE FROM duende_perfiles").run();
        perfiles.guardarDescripcion({ discordId: "esp-1", username: "uno", nombre: "Uno", descripcion: "Le gusta correr" });
        perfiles.guardarDescripcion({ discordId: "esp-2", username: "dos", nombre: "Dos", descripcion: "Le gusta nadar" });
        const ids = new Set();
        for (let i = 0; i < 30; i++) ids.add(espontaneo.elegirGancho(new Set(["esp-1"])).discordId);
        expect([...ids]).toEqual(["esp-2"]);
        expect(
            espontaneo.elegirGancho(new Set(["esp-1", "esp-2", ...perfiles.listarPerfiles().map((p) => String(p.discordId))])),
        ).toBeNull();
    });

    test("se apunta a quien se dirige el mensaje y vuelve a estar libre pasado el plazo (también tras reiniciar: está en la base de datos)", () => {
        const ahora = Date.now();
        espontaneo.marcarDirigido(G, "esp-9", ahora);
        expect(espontaneo.enEspera(G, ahora + 1000).has("esp-9")).toBe(true);
        expect(espontaneo.enEspera(G, ahora + espontaneo.ENFRIAMIENTO_MS + 1000).has("esp-9")).toBe(false);
        expect(espontaneo.enEspera("otro-servidor", ahora).has("esp-9")).toBe(false);
    });

    test("el mensaje espontáneo no se repite a la misma persona seguidas veces", async () => {
        const g = "g-f11-esp2";
        perfiles.guardarDescripcion({ discordId: "solo-1", username: "s1", nombre: "S1", descripcion: "Fan del Betis" });
        db.prepare("DELETE FROM duende_perfiles WHERE discord_id IS NOT NULL AND discord_id <> 'solo-1'").run();
        guildSettings.setManySettings(g, { "duende.espontaneo_enabled": true, "duende.espontaneo_channel_id": "c-esp" });
        const send = jest.fn(async () => {});
        const canal = {
            id: "c-esp",
            name: "c",
            isTextBased: () => true,
            send,
            messages: { fetch: async () => ({ first: () => undefined }) },
        };
        const guild = { id: g, name: "S", channels: { fetch: async () => canal } };
        jest.spyOn(Math, "random").mockReturnValue(0);
        await espontaneo.revisarGuild({}, guild);
        await espontaneo.revisarGuild({}, guild);
        expect(send).toHaveBeenCalledTimes(1);
    });
});
