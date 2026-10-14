// 🔁 Revancha de un duelo (#318): el botón del mensaje de un duelo resuelto, lo que crea y las comprobaciones (quién, una sola vez,
// efectivo de los dos, bloqueos, el Duende). BD en memoria; los duelos se juegan de verdad con piedra-papel-tijera.
const db = require("../src/core/db");
const dinero = require("../src/systems/dinero");
const retos = require("../src/systems/retos");
const bloqueos = require("../src/systems/retos/bloqueos");
const paneles = require("../src/paneles/retos");
const botones = require("../src/juegos/retos/retos");

let n = 0;
function persona(efectivo = 1000) {
    const id = `rev-${++n}`;
    dinero.asegurarCuenta(id);
    db.prepare("UPDATE banco SET enMano = ? WHERE userId = ?").run(efectivo, id);
    return id;
}
const idsDe = (payload) => payload.components.flatMap((f) => (f.toJSON ? f.toJSON() : f).components.map((c) => c.custom_id));
const descripcion = (reto) => paneles.mensajeReto(reto).embeds[0].toJSON().description;

/** Un duelo de piedra-papel-tijera ya jugado: gana quien reta (piedra contra tijera). */
function dueloResuelto({ cantidad = 100, serie = 1 } = {}) {
    const a = persona();
    const b = persona();
    const { reto } = retos.crearDuelo({ creador: a, rival: b, juego: "ppt", cantidad, serie });
    expect(retos.aceptar(reto.id, b).ok).toBe(true);
    if (serie === 1) {
        retos.jugarPpt(reto.id, a, "piedra");
        retos.jugarPpt(reto.id, b, "tijera");
    }
    return { a, b, id: reto.id };
}
const interaccion = (customId, userId) => ({
    customId,
    user: { id: userId, username: userId, tag: userId },
    guildId: "g-rev",
    channelId: "c-rev",
    message: { interaction: { user: { id: userId } } },
    reply: jest.fn(async () => {}),
    update: jest.fn(async () => {}),
    followUp: jest.fn(async () => ({ id: "m-rev", channelId: "c-rev" })),
});

describe("el botón 🔁 Revancha en el mensaje", () => {
    test("un duelo resuelto lo ofrece; uno pendiente, en juego o devuelto no", () => {
        const { a, b, id } = dueloResuelto();
        expect(retos.obtener(id).estado).toBe("resuelto");
        expect(idsDe(paneles.mensajeReto(retos.obtener(id)))).toEqual([`retos_revancha_${id}`]);

        const pendiente = retos.crearDuelo({ creador: a, rival: b, juego: "ppt", cantidad: 100 }).reto;
        expect(idsDe(paneles.mensajeReto(pendiente))).not.toContain(`retos_revancha_${pendiente.id}`);
        retos.aceptar(pendiente.id, b);
        expect(idsDe(paneles.mensajeReto(retos.obtener(pendiente.id)))).not.toContain(`retos_revancha_${pendiente.id}`);
        const devuelto = retos.crearDuelo({ creador: a, rival: b, juego: "ppt", cantidad: 100 }).reto;
        retos.rechazar(devuelto.id, b);
        expect(idsDe(paneles.mensajeReto(retos.obtener(devuelto.id)))).toEqual([]);
    });

    test("tampoco en un duelo contra el Duende ni en una porra", () => {
        const a = persona();
        const { reto } = retos.crearContraDuende({ userId: a, cantidad: 100, guildId: "g-rev" });
        expect(retos.admiteRevancha({ ...retos.obtener(reto.id), estado: "resuelto" })).toBe(false);
        expect(retos.admiteRevancha(null)).toBe(false);
        expect(retos.admiteRevancha({ tipo: "porra", estado: "resuelto", rival: null })).toBe(false);
    });
});

describe("pedir la revancha", () => {
    test("crea el mismo duelo (juego, cantidad y serie) de quien la pide contra el otro, y deja anotada la revancha", () => {
        const { a, b, id } = dueloResuelto({ cantidad: 250 });
        const r = retos.pedirRevancha(id, b, { guildId: "g-rev", channelId: "c-rev" });
        expect(r.ok).toBe(true);
        expect(r.reto).toMatchObject({ tipo: "duelo", estado: "pendiente", creador: b, rival: a, juego: "ppt", cantidad: 250, serie: 1 });
        expect(r.reto.guildId).toBe("g-rev");
        expect(retos.obtener(id).datos.revancha).toBe(r.reto.id);
        // El duelo de origen ya no la ofrece y apunta a la nueva.
        expect(idsDe(paneles.mensajeReto(r.origen))).toEqual([]);
        expect(descripcion(r.origen)).toContain(`🔁 Revancha: reto #${r.reto.id}.`);
    });

    test("la puede pedir cualquiera de los dos, pero solo una vez", () => {
        const { a, b, id } = dueloResuelto();
        expect(retos.pedirRevancha(id, a).ok).toBe(true);
        expect(retos.pedirRevancha(id, b)).toEqual({ ok: false, mensaje: "🔁 Ya se ha pedido la revancha de este duelo." });
        expect(retos.pedirRevancha(id, a).ok).toBe(false);
    });

    test("al duelo al mejor de tres le sale la misma serie", () => {
        const { b, id } = dueloResuelto({ serie: 3 });
        db.prepare("UPDATE retos SET estado = 'resuelto', resultado = 'x' WHERE id = ?").run(id);
        expect(retos.pedirRevancha(id, b).reto.serie).toBe(3);
    });

    test("solo quien jugó el duelo, y solo cuando ha terminado", () => {
        const { id } = dueloResuelto();
        expect(retos.pedirRevancha(id, persona()).mensaje).toMatch(/Solo quien jugó/);
        const a = persona();
        const b = persona();
        const pendiente = retos.crearDuelo({ creador: a, rival: b, juego: "ppt", cantidad: 100 }).reto;
        expect(retos.pedirRevancha(pendiente.id, a).mensaje).toMatch(/cuando el duelo ha terminado/);
        expect(retos.pedirRevancha(999999, a).mensaje).toMatch(/Solo se puede pedir la revancha de un duelo/);
    });

    test("si a uno de los dos no le llega el efectivo, no se crea nada", () => {
        const { a, b, id } = dueloResuelto({ cantidad: 100 });
        db.prepare("UPDATE banco SET enMano = 50 WHERE userId = ?").run(b);
        expect(retos.pedirRevancha(id, a).mensaje).toMatch(/Esa persona no tiene efectivo/);
        expect(retos.pedirRevancha(id, b).mensaje).toMatch(/No te llega el efectivo/);
        expect(retos.obtener(id).datos?.revancha).toBeUndefined();
        expect(db.prepare("SELECT COUNT(*) AS n FROM retos WHERE creador IN (?, ?) AND estado = 'pendiente'").get(a, b).n).toBe(0);
    });

    test("quien ha bloqueado al otro, o ya tiene demasiados retos sin aceptar, no recibe la revancha", () => {
        const { a, b, id } = dueloResuelto();
        expect(bloqueos.bloquear(a, b).ok).toBe(true); // `a` bloquea a `b`: b ya no puede retarle
        expect(retos.pedirRevancha(id, b).mensaje).toMatch(/No puedes retar a esa persona/);
        bloqueos.desbloquear(a, b);

        for (let k = 0; k < retos.MAX_PENDIENTES; k++) retos.crearDuelo({ creador: b, rival: persona(), juego: "ppt", cantidad: 100 });
        expect(retos.pedirRevancha(id, b).mensaje).toMatch(/Ya tienes \d+ retos sin aceptar/);
        expect(retos.obtener(id).datos?.revancha).toBeUndefined();
    });

    test("contra el Duende no hay revancha: se pidió en el chat y se repite en el chat", () => {
        const a = persona();
        const { reto } = retos.crearContraDuende({ userId: a, cantidad: 100, guildId: "g-rev" });
        db.prepare("UPDATE retos SET estado = 'resuelto', resultado = 'x' WHERE id = ?").run(reto.id);
        expect(retos.pedirRevancha(reto.id, a).mensaje).toMatch(/Contra el Duende no hay revancha/);
        expect(retos.admiteRevancha(retos.obtener(reto.id))).toBe(false);
    });
});

describe("el botón, en el canal", () => {
    test("repinta el duelo sin el botón y publica la revancha mencionando al rival, guardando su mensaje", async () => {
        const { a, b, id } = dueloResuelto();
        const i = interaccion(`retos_revancha_${id}`, a);
        await botones.handleButton(null, i);
        expect(i.reply).not.toHaveBeenCalled();
        expect(idsDe(i.update.mock.calls[0][0])).toEqual([]);
        const publicado = i.followUp.mock.calls[0][0];
        expect(publicado.content).toBe(`🔁 <@${b}>, <@${a}> te pide la revancha.`);
        expect(publicado.allowedMentions).toEqual({ users: [b] });
        const nuevo = retos.obtener(retos.obtener(id).datos.revancha);
        expect(idsDe(publicado)).toEqual(expect.arrayContaining([`retos_aceptar_${nuevo.id}`]));
        expect(nuevo).toMatchObject({ messageId: "m-rev", channelId: "c-rev", creador: a, rival: b });
    });

    test("pulsarlo dos veces, o quien no jugó, recibe el aviso en privado y no se crea otra", async () => {
        const { a, id } = dueloResuelto();
        await botones.handleButton(null, interaccion(`retos_revancha_${id}`, a));
        const otra = interaccion(`retos_revancha_${id}`, a);
        await botones.handleButton(null, otra);
        expect(otra.reply).toHaveBeenCalledWith({ content: "🔁 Ya se ha pedido la revancha de este duelo.", flags: 64 });
        expect(otra.update).not.toHaveBeenCalled();
        const ajeno = interaccion(`retos_revancha_${dueloResuelto().id}`, persona());
        await botones.handleButton(null, ajeno);
        expect(ajeno.reply.mock.calls[0][0].content).toMatch(/Solo quien jugó/);
    });
});
