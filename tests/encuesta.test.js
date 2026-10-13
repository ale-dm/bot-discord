// #426: /encuesta. De 2 a 5 opciones con un botón cada una y el recuento en vivo; un voto por persona (cambiarlo reemplaza el
// anterior); y al cerrarse, por tiempo o por quien la creó, los botones se desactivan y sale el resultado final.
const db = require("../src/core/db");
const encuestas = require("../src/systems/encuestas");
const encuesta = require("../src/commands/general/encuesta");
const { mensajeEncuesta, barra } = require("../src/paneles/encuesta");

const HORA = 3600 * 1000;
let n = 0;
const nueva = (extra = {}) => {
    const r = encuestas.crear({
        guildId: "g-enc",
        channelId: "c-enc",
        creador: "creador-enc",
        pregunta: "¿Qué peli vemos?",
        opciones: ["Dune", "Alien"],
        ...extra,
    });
    expect(r.ok).toBe(true);
    return r.encuesta;
};
const usuario = () => `votante-enc-${++n}`;
const ids = (p) => p.components.flatMap((f) => f.toJSON().components.map((c) => c.custom_id));

describe("validación", () => {
    test("de 2 a 5 opciones: menos, más o una vacía dan un error claro", () => {
        expect(encuestas.validarEncuesta({ pregunta: "¿Qué?", opciones: ["Una"] }).mensaje).toMatch(/al menos 2 opciones/);
        expect(encuestas.validarEncuesta({ pregunta: "¿Qué?", opciones: [] }).mensaje).toMatch(/al menos 2 opciones/);
        expect(encuestas.validarEncuesta({ pregunta: "¿Qué?", opciones: ["a", "b", "c", "d", "e", "f"] }).mensaje).toMatch(
            /como mucho 5 opciones/,
        );
        expect(encuestas.validarEncuesta({ pregunta: "¿Qué?", opciones: ["a", "  "] }).mensaje).toMatch(/puede estar vacía/);
        expect(encuestas.validarEncuesta({ pregunta: "¿Qué?", opciones: ["a", "A"] }).mensaje).toMatch(/repetidas/);
        expect(encuestas.validarEncuesta({ pregunta: "¿Qué?", opciones: ["a", "x".repeat(81)] }).mensaje).toMatch(/80 caracteres/);
        expect(encuestas.validarEncuesta({ pregunta: " ", opciones: ["a", "b"] }).mensaje).toMatch(/pregunta/);
    });

    test("con 2, 3, 4 o 5 opciones es válida y las deja limpias", () => {
        for (const cuantas of [2, 3, 4, 5]) {
            const opciones = Array.from({ length: cuantas }, (_, i) => `  Opción   ${i + 1} `);
            const r = encuestas.validarEncuesta({ pregunta: "  ¿Qué   hacemos? ", opciones });
            expect(r).toEqual({ ok: true, pregunta: "¿Qué hacemos?", opciones: opciones.map((_, i) => `Opción ${i + 1}`) });
        }
    });

    test("la duración tiene que estar entre 1 y 168 horas, y por defecto son 24", () => {
        const e = nueva();
        expect(e.cierra_en - e.creada_en).toBe(24 * HORA);
        expect(encuestas.crear({ guildId: "g", creador: "c", pregunta: "¿Qué?", opciones: ["a", "b"], horas: 0 }).ok).toBe(false);
        expect(encuestas.crear({ guildId: "g", creador: "c", pregunta: "¿Qué?", opciones: ["a", "b"], horas: 169 }).ok).toBe(false);
        expect(nueva({ horas: 2 }).cierra_en - e.creada_en).toBeLessThan(3 * HORA);
    });
});

describe("votos y recuento", () => {
    test("cada persona vota una vez y cambiar el voto reemplaza el anterior sin duplicarlo", () => {
        const e = nueva();
        const a = usuario();
        expect(encuestas.votar(e.id, a, 0)).toMatchObject({ ok: true, antes: null });
        expect(encuestas.recuento(e.id).conteos).toEqual([1, 0]);
        expect(encuestas.votar(e.id, a, 0)).toMatchObject({ ok: true, antes: 0 }); // el mismo voto: nada cambia
        expect(encuestas.recuento(e.id).conteos).toEqual([1, 0]);
        expect(encuestas.votar(e.id, a, 1)).toMatchObject({ ok: true, antes: 0 });
        expect(encuestas.recuento(e.id)).toMatchObject({ conteos: [0, 1], total: 1 });
        expect(db.prepare("SELECT COUNT(*) AS n FROM encuesta_votos WHERE encuesta_id = ? AND userId = ?").get(e.id, a).n).toBe(1);
        expect(encuestas.recuento(e.id, a).voto).toBe(1);
        encuestas.votar(e.id, usuario(), 1);
        expect(encuestas.recuento(e.id).conteos).toEqual([0, 2]);
    });

    test("una opción que no existe o una encuesta cerrada, caducada o inexistente no admiten voto", () => {
        const e = nueva();
        expect(encuestas.votar(e.id, usuario(), 2).mensaje).toMatch(/no existe/);
        expect(encuestas.votar(e.id, usuario(), -1).ok).toBe(false);
        expect(encuestas.votar(999999, usuario(), 0).mensaje).toMatch(/ya no existe/);
        expect(encuestas.votar(e.id, usuario(), 0, e.cierra_en + 1).mensaje).toMatch(/cerrada/);
        encuestas.cerrar(e.id, "creador-enc");
        expect(encuestas.votar(e.id, usuario(), 0).mensaje).toMatch(/cerrada/);
    });
});

describe("cerrar", () => {
    test("solo quien la creó la cierra antes de tiempo", () => {
        const e = nueva();
        expect(encuestas.cerrar(e.id, "otro").mensaje).toMatch(/Solo quien creó/);
        const r = encuestas.cerrar(e.id, "creador-enc");
        expect(r.encuesta.estado).toBe("cerrada");
        expect(encuestas.cerrar(e.id, "creador-enc").mensaje).toMatch(/ya está cerrada/);
    });

    test("al acabar su tiempo la cierra el cron, una sola vez, y solo las vencidas", () => {
        const vencida = nueva({ horas: 1 });
        const viva = nueva({ horas: 48 });
        const cerradas = encuestas.cerrarVencidas(Date.now() + 2 * HORA);
        expect(cerradas.map((x) => x.id)).toContain(vencida.id);
        expect(cerradas.map((x) => x.id)).not.toContain(viva.id);
        expect(encuestas.obtener(vencida.id).estado).toBe("cerrada");
        expect(encuestas.cerrarVencidas(Date.now() + 2 * HORA).map((x) => x.id)).not.toContain(vencida.id);
    });
});

describe("el mensaje", () => {
    test("un botón por opción con el recuento en vivo y un botón para cerrar", () => {
        const e = nueva();
        encuestas.votar(e.id, usuario(), 0);
        encuestas.votar(e.id, usuario(), 0);
        encuestas.votar(e.id, usuario(), 1);
        const m = mensajeEncuesta(encuestas.obtener(e.id));
        expect(ids(m)).toEqual([`encuesta_voto_${e.id}_0`, `encuesta_voto_${e.id}_1`, `encuesta_cerrar_${e.id}`]);
        const d = m.embeds[0].toJSON().description;
        expect(d).toContain("**1. Dune**");
        expect(d).toContain("**2** (67 %)");
        expect(d).toContain("**1** (33 %)");
        expect(d).toContain("3 votos");
        expect(d).not.toContain("<@votante"); // solo el recuento, no quién votó
        expect(m.components.every((f) => f.toJSON().components.every((c) => !c.disabled))).toBe(true);
    });

    test("cerrada, los botones salen desactivados y se marca la opción ganadora", () => {
        const e = nueva();
        encuestas.votar(e.id, usuario(), 1);
        const cerrada = encuestas.cerrar(e.id, "creador-enc").encuesta;
        const m = mensajeEncuesta(cerrada);
        expect(m.components.flatMap((f) => f.toJSON().components).every((c) => c.disabled)).toBe(true);
        const d = m.embeds[0].toJSON().description;
        expect(d).toContain("🔒 **Encuesta cerrada**");
        expect(d).toMatch(/\*\*2\. Alien\*\* 🏆/);
        expect(d).not.toMatch(/\*\*1\. Dune\*\* 🏆/);
    });

    test("sin votos no hay ganadora y la barra no divide entre cero", () => {
        const e = nueva();
        const cerrada = encuestas.cerrar(e.id, "creador-enc").encuesta;
        expect(mensajeEncuesta(cerrada).embeds[0].toJSON().description).not.toContain("🏆");
        expect(barra(0, 0)).toBe("░░░░░░░░░░ **0** (0 %)");
        expect(barra(5, 5)).toBe("██████████ **5** (100 %)");
    });
});

describe("el comando y sus botones", () => {
    const opciones = (valores) => ({
        getString: (nombre) => (nombre === "pregunta" ? valores.pregunta : (valores[nombre] ?? null)),
        getInteger: () => valores.horas ?? null,
    });
    const comando = (valores) => ({
        guildId: "g-enc",
        channelId: "c-enc",
        user: { id: "creador-cmd" },
        options: opciones(valores),
        reply: jest.fn(async () => {}),
        fetchReply: jest.fn(async () => ({ id: "msg-enc" })),
    });

    test("/encuesta publica el mensaje, guarda dónde está y con menos de 2 opciones o una vacía responde con el error", async () => {
        const i = comando({ pregunta: "¿Dónde quedamos?", opcion1: "Bar", opcion2: "Parque", opcion3: "Casa" });
        await encuesta.run(null, i);
        const publicado = i.reply.mock.calls[0][0];
        expect(publicado.flags).toBeUndefined(); // público
        expect(publicado.embeds[0].toJSON().title).toBe("📊 ¿Dónde quedamos?");
        const guardada = db.prepare("SELECT channelId, messageId, opciones FROM encuestas WHERE creador = 'creador-cmd'").get();
        expect(guardada).toMatchObject({ channelId: "c-enc", messageId: "msg-enc" });
        expect(JSON.parse(guardada.opciones)).toEqual(["Bar", "Parque", "Casa"]);

        const vacia = comando({ pregunta: "¿Qué?", opcion1: "Una", opcion2: "   " });
        await encuesta.run(null, vacia);
        expect(vacia.reply.mock.calls[0][0].content).toMatch(/puede estar vacía/);
        expect(vacia.reply.mock.calls[0][0].flags).toBeDefined();
        const una = comando({ pregunta: "¿Qué?", opcion1: "Sola" });
        await encuesta.run(null, una);
        expect(una.reply.mock.calls[0][0].content).toMatch(/al menos 2/);
    });

    test("el comando tiene dos opciones obligatorias, tres opcionales y la duración", () => {
        const o = encuesta.data.toJSON().options;
        expect(o.map((x) => x.name)).toEqual(["pregunta", "opcion1", "opcion2", "opcion3", "opcion4", "opcion5", "horas"]);
        expect(o.filter((x) => x.required).map((x) => x.name)).toEqual(["pregunta", "opcion1", "opcion2"]);
    });

    test("los botones votan (y avisan en privado), cambian el voto, y solo quien la creó la cierra", async () => {
        const e = nueva();
        const boton = (customId, userId) => ({
            customId,
            user: { id: userId },
            update: jest.fn(async () => {}),
            reply: jest.fn(async () => {}),
            followUp: jest.fn(async () => {}),
        });
        const a = usuario();
        const v1 = boton(`encuesta_voto_${e.id}_0`, a);
        await encuesta.handleButton(null, v1);
        expect(v1.update.mock.calls[0][0].embeds[0].toJSON().description).toContain("1 voto");
        expect(v1.followUp.mock.calls[0][0].content).toBe("✅ Has votado **Dune**.");
        const v2 = boton(`encuesta_voto_${e.id}_1`, a);
        await encuesta.handleButton(null, v2);
        expect(v2.followUp.mock.calls[0][0].content).toBe("🔄 Has cambiado tu voto a **Alien**.");
        expect(encuestas.recuento(e.id).conteos).toEqual([0, 1]);

        const intruso = boton(`encuesta_cerrar_${e.id}`, a);
        await encuesta.handleButton(null, intruso);
        expect(intruso.reply.mock.calls[0][0].content).toMatch(/Solo quien creó/);
        const cierra = boton(`encuesta_cerrar_${e.id}`, "creador-enc");
        await encuesta.handleButton(null, cierra);
        expect(cierra.update.mock.calls[0][0].components.flatMap((f) => f.toJSON().components).every((c) => c.disabled)).toBe(true);
        const tarde = boton(`encuesta_voto_${e.id}_0`, usuario());
        await encuesta.handleButton(null, tarde);
        expect(tarde.reply.mock.calls[0][0].content).toMatch(/cerrada/);
    });

    test("el cron repinta el mensaje de las encuestas que se cierran con su resultado final", async () => {
        const e = nueva({ horas: 1 });
        encuestas.guardarMensaje(e.id, "c-enc", "m-cron-enc");
        encuestas.votar(e.id, usuario(), 0);
        db.prepare("UPDATE encuestas SET cierra_en = ? WHERE id = ?").run(Date.now() - 1000, e.id);
        const editados = [];
        const client = { channels: { fetch: async () => ({ messages: { edit: async (m, p) => editados.push({ m, p }) } }) } };
        expect(await encuesta.cerrarVencidas(client)).toBeGreaterThanOrEqual(1);
        const edicion = editados.find((x) => x.m === "m-cron-enc");
        expect(edicion.p.embeds[0].toJSON().description).toContain("Encuesta cerrada");
        expect(edicion.p.components.flatMap((f) => f.toJSON().components).every((c) => c.disabled)).toBe(true);
    });

    test("un mensaje borrado no hace fallar al cron", async () => {
        const e = nueva({ horas: 1 });
        encuestas.guardarMensaje(e.id, "c-enc", "m-borrado");
        db.prepare("UPDATE encuestas SET cierra_en = ? WHERE id = ?").run(Date.now() - 1000, e.id);
        const client = {
            channels: {
                fetch: async () => {
                    throw new Error("Unknown Channel");
                },
            },
        };
        await expect(encuesta.cerrarVencidas(client)).resolves.toBeGreaterThanOrEqual(1);
        expect(encuestas.obtener(e.id).estado).toBe("cerrada");
    });
});
