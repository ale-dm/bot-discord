// Entre dos personas, en ⚔️ Retos: la contraoferta de cantidad (#442), los bloqueos (#450) y el cara a cara (#437).
const db = require("../src/core/db");
const dinero = require("../src/systems/dinero");
const retos = require("../src/systems/retos");
const bloqueos = require("../src/systems/retos/bloqueos");
const paneles = require("../src/paneles/retos");
const botones = require("../src/juegos/retos/retos");

let n = 0;
const par = () => {
    n++;
    return [`neg-a${n}`, `neg-b${n}`];
};
const efectivo = (id) => dinero.efectivo(id);
const idsDe = (payload) => payload.components.flatMap((f) => (f.toJSON ? f.toJSON() : f).components.map((c) => c.custom_id));
const texto = (reto) => paneles.mensajeReto(reto).embeds[0].toJSON().description;
const duelo = (extra = {}) => {
    const [a, b] = par();
    return { a, b, reto: retos.crearDuelo({ creador: a, rival: b, juego: "ppt", cantidad: 100, ...extra }).reto };
};
function partido(matchId) {
    db.prepare(
        "INSERT INTO apuestas_partidos (match_id, home_team, away_team, start_time, estado, deporte) VALUES (?, 'Betis', 'Sevilla', ?, 'abierto', 'laliga')",
    ).run(matchId, new Date(Date.now() + 3 * 24 * 3600 * 1000).toISOString());
}
const interaccion = (customId, userId, extra = {}) => ({
    customId,
    user: { id: userId, username: userId, tag: userId },
    guildId: "g-neg",
    channelId: "c-neg",
    message: { interaction: { user: { id: userId } } },
    reply: jest.fn(async () => {}),
    update: jest.fn(async () => {}),
    showModal: jest.fn(async () => {}),
    followUp: jest.fn(async () => ({ id: "m", channelId: "c-neg" })),
    ...extra,
});

describe("contraoferta de cantidad (#442)", () => {
    test("el rival propone otra cantidad: el mensaje la enseña y solo quien retó puede aceptarla", () => {
        const { a, b, reto } = duelo();
        const r = retos.contraofertar(reto.id, b, 200);
        expect(r.ok).toBe(true);
        expect(r.reto.contraoferta).toBe(200);
        expect(texto(r.reto)).toContain(`<@${b}> propone **200**`);
        expect(idsDe(paneles.mensajeReto(r.reto))).toEqual([
            `retos_acepcontra_${reto.id}`,
            `retos_rechazar_${reto.id}`,
            `retos_cancelar_${reto.id}`,
        ]);
        // El rival ya no puede aceptar el importe original, y nadie más puede aceptar la contraoferta.
        expect(retos.aceptar(reto.id, b).mensaje).toMatch(/Has propuesto otra cantidad/);
        expect(retos.aceptarContraoferta(reto.id, b).mensaje).toMatch(/Solo quien lanzó/);
        expect(retos.aceptarContraoferta(reto.id, a).ok).toBe(true);
    });

    test("solo el rival, solo una vez y solo dentro del mínimo y el máximo", () => {
        const { a, b, reto } = duelo();
        expect(retos.contraofertar(reto.id, a, 200).mensaje).toMatch(/no es para ti/);
        expect(retos.contraofertar(reto.id, b, retos.MIN - 1).mensaje).toMatch(/entre/);
        expect(retos.contraofertar(reto.id, b, retos.MAX + 1).mensaje).toMatch(/entre/);
        expect(retos.contraofertar(reto.id, b, 100).mensaje).toMatch(/Esa es la cantidad del reto/);
        expect(retos.contraofertar(reto.id, b, 50.5).ok).toBe(false);
        expect(retos.contraofertar(reto.id, b, 300).ok).toBe(true);
        expect(retos.contraofertar(reto.id, b, 400).mensaje).toMatch(/solo se permite una/);
        expect(retos.obtener(reto.id).contraoferta).toBe(300);
    });

    test("al aceptar una cantidad mayor, quien retó paga la diferencia, el rival paga la nueva, y el bote es el nuevo", () => {
        const { a, b, reto } = duelo();
        retos.contraofertar(reto.id, b, 250);
        const r = retos.aceptarContraoferta(reto.id, a);
        expect(r.reto).toMatchObject({ estado: "en_juego", cantidad: 250, contraoferta: null });
        expect(efectivo(a)).toBe(750);
        expect(efectivo(b)).toBe(750);
        expect(r.reto.participantes.map((p) => p.cantidad)).toEqual([250, 250]);
        retos.rendirse(reto.id, b);
        expect(efectivo(a)).toBe(1250);
        const movimientos = db
            .prepare("SELECT descripcion, cantidad FROM historial WHERE userId = ? AND tipo = 'retos' ORDER BY id")
            .all(a);
        expect(movimientos.map((m) => m.cantidad)).toEqual([-100, -150, 500]);
    });

    test("al aceptar una cantidad menor, a quien retó se le devuelve la diferencia", () => {
        const { a, b, reto } = duelo();
        retos.contraofertar(reto.id, b, 40);
        retos.aceptarContraoferta(reto.id, a);
        expect(efectivo(a)).toBe(960);
        expect(efectivo(b)).toBe(960);
        expect(retos.obtener(reto.id).cantidad).toBe(40);
    });

    test("si a quien retó no le llega la diferencia, o al rival no le llega lo suyo, no cambia nada y la contraoferta sigue", () => {
        const { a, b, reto } = duelo();
        retos.contraofertar(reto.id, b, 5000);
        dinero.ingresar(a, 850); // le quedan 50 en efectivo
        const sin = retos.aceptarContraoferta(reto.id, a);
        expect(sin.mensaje).toMatch(/No te llega el efectivo para la nueva cantidad/);
        expect(efectivo(a)).toBe(50);
        expect(efectivo(b)).toBe(1000);
        expect(retos.obtener(reto.id)).toMatchObject({ estado: "pendiente", cantidad: 100, contraoferta: 5000 });

        const [c, d] = par();
        const otro = retos.crearDuelo({ creador: c, rival: d, juego: "ppt", cantidad: 100 }).reto;
        retos.contraofertar(otro.id, d, 800);
        dinero.ingresar(d, 700); // el rival se queda sin efectivo para 800
        const rival = retos.aceptarContraoferta(otro.id, c);
        expect(rival.mensaje).toMatch(/A tu rival ya no le llega/);
        expect(efectivo(c)).toBe(900); // la diferencia de quien retó se revierte con la transacción
        expect(retos.obtener(otro.id)).toMatchObject({ estado: "pendiente", cantidad: 100 });
    });

    test("si quien retó cancela, lo cobrado vuelve y el reto se devuelve; el rival también puede rechazarla", () => {
        const { a, b, reto } = duelo();
        retos.contraofertar(reto.id, b, 200);
        expect(retos.cancelar(reto.id, a).reto.estado).toBe("devuelto");
        expect(efectivo(a)).toBe(1000);
        expect(efectivo(b)).toBe(1000);

        const otro = duelo();
        retos.contraofertar(otro.reto.id, otro.b, 200);
        expect(retos.rechazar(otro.reto.id, otro.b).reto.estado).toBe("devuelto");
        expect(efectivo(otro.a)).toBe(1000);
    });

    test("también en un reto a un partido: cada uno va con lo suyo", () => {
        partido("contra-1");
        const [a, b] = par();
        const { reto } = retos.crearPartido({ creador: a, rival: b, matchId: "contra-1", eleccion: "home", cantidad: 100 });
        retos.contraofertar(reto.id, b, 300);
        const r = retos.aceptarContraoferta(reto.id, a);
        expect(r.reto.participantes.map((p) => [p.userId, p.opcion, p.cantidad])).toEqual([
            [a, "a_favor", 300],
            [b, "en_contra", 300],
        ]);
        expect(efectivo(a)).toBe(700);
    });

    test("desde los botones: el rival abre el formulario, lo envía y el mensaje se repinta con la propuesta", async () => {
        const { a, b, reto } = duelo();
        const intruso = interaccion(`retos_contra_${reto.id}`, a);
        await botones.handleButton(null, intruso);
        expect(intruso.reply.mock.calls[0][0].content).toMatch(/no es para ti/);

        const abre = interaccion(`retos_contra_${reto.id}`, b);
        await botones.handleButton(null, abre);
        const modal = abre.showModal.mock.calls[0][0];
        expect(modal.data.custom_id).toBe(`retos_modal_contra_${reto.id}`);
        expect(JSON.stringify(modal.toJSON())).not.toContain("provocacion");

        const envia = interaccion(`retos_modal_contra_${reto.id}`, b, {
            fields: { getStringSelectValues: () => ["200"], getTextInputValue: () => "" },
        });
        await botones.handleModal(null, envia);
        expect(envia.update.mock.calls[0][0].embeds[0].toJSON().description).toContain("propone **200**");

        const otraVez = interaccion(`retos_contra_${reto.id}`, b);
        await botones.handleButton(null, otraVez);
        expect(otraVez.reply.mock.calls[0][0].content).toMatch(/solo se permite una/);

        const acepta = interaccion(`retos_acepcontra_${reto.id}`, a);
        await botones.handleButton(null, acepta);
        expect(acepta.update.mock.calls[0][0].embeds[0].toJSON().description).toContain("**400**");
        expect(retos.obtener(reto.id).estado).toBe("en_juego");
    });
});

describe("bloquear retos (#450)", () => {
    test("quien está bloqueado no puede retar, con un error que no habla de bloqueo, pero quien bloquea sí puede retarle", () => {
        const [a, b] = par();
        bloqueos.bloquear(a, b);
        const r = retos.crearDuelo({ creador: b, rival: a, juego: "ppt", cantidad: 100 });
        expect(r.ok).toBe(false);
        expect(r.mensaje).toMatch(/No puedes retar a esa persona ahora mismo/);
        expect(r.mensaje).not.toMatch(/bloque/i);
        expect(efectivo(b)).toBe(1000);
        partido("bloq-1");
        expect(retos.crearPartido({ creador: b, rival: a, matchId: "bloq-1", eleccion: "home", cantidad: 100 }).ok).toBe(false);
        // Es de un solo sentido.
        expect(retos.crearDuelo({ creador: a, rival: b, juego: "ppt", cantidad: 100 }).ok).toBe(true);
    });

    test("al bloquear se devuelven los retos pendientes entre los dos, en ambos sentidos, y los que están en juego siguen", () => {
        const [a, b] = par();
        const de = retos.crearDuelo({ creador: b, rival: a, juego: "ppt", cantidad: 100 }).reto;
        const enviado = retos.crearDuelo({ creador: a, rival: b, juego: "dados", cantidad: 50 }).reto;
        const jugando = retos.crearDuelo({ creador: b, rival: a, juego: "ppt", cantidad: 10 }).reto;
        retos.aceptar(jugando.id, a);
        const [, c] = par();
        const ajeno = retos.crearDuelo({ creador: b, rival: c, juego: "ppt", cantidad: 10 }).reto;

        const r = bloqueos.bloquear(a, b);
        expect(r.devueltos.map((x) => x.id).sort()).toEqual([de.id, enviado.id].sort());
        expect(retos.obtener(de.id)).toMatchObject({ estado: "devuelto", resultado: "bloqueo" });
        expect(retos.obtener(enviado.id).estado).toBe("devuelto");
        expect(retos.obtener(jugando.id).estado).toBe("en_juego");
        expect(retos.obtener(ajeno.id).estado).toBe("pendiente");
        expect(efectivo(b)).toBe(1000 - 10 - 10); // lo pendiente vuelve; el ajeno y el de juego siguen retenidos
        expect(r.pagos.map((p) => p.userId).sort()).toEqual([b, a].sort());
    });

    test("desde un reto recibido, solo su rival puede bloquear, y se puede quitar el bloqueo", () => {
        const { a, b, reto } = duelo();
        expect(retos.bloquearDesdeReto(reto.id, a).mensaje).toMatch(/Solo quien recibe/);
        expect(retos.bloquearDesdeReto(reto.id, "otro").ok).toBe(false);
        const r = retos.bloquearDesdeReto(reto.id, b);
        expect(r.ok).toBe(true);
        expect(r.devueltos.map((x) => x.id)).toEqual([reto.id]);
        expect(retos.bloqueado(b, a)).toBe(true);
        expect(retos.bloqueado(a, b)).toBe(false);
        expect(retos.listarBloqueos(b)).toEqual([a]);
        expect(retos.bloquearDesdeReto(reto.id, b).mensaje).toMatch(/ya no está pendiente/);
        expect(bloqueos.bloquear(b, b).ok).toBe(false);

        expect(retos.desbloquear(b, a)).toBe(true);
        expect(retos.desbloquear(b, a)).toBe(false);
        expect(retos.crearDuelo({ creador: a, rival: b, juego: "ppt", cantidad: 100 }).ok).toBe(true);
    });

    test("el mensaje del reto ofrece Bloquear, y el botón bloquea, devuelve y avisa solo a quien bloquea", async () => {
        const { a, b, reto } = duelo();
        expect(idsDe(paneles.mensajeReto(reto))).toContain(`retos_bloquear_${reto.id}`);
        const fuera = interaccion(`retos_bloquear_${reto.id}`, a);
        await botones.handleButton({ channels: { fetch: async () => null } }, fuera);
        expect(fuera.reply.mock.calls[0][0].content).toMatch(/Solo quien recibe/);

        const i = interaccion(`retos_bloquear_${reto.id}`, b);
        await botones.handleButton({ channels: { fetch: async () => null }, users: { fetch: async () => null } }, i);
        expect(i.reply.mock.calls[0][0].content).toContain(`<@${a}>`);
        expect(i.reply.mock.calls[0][0].flags).toBeDefined();
        expect(retos.obtener(reto.id).estado).toBe("devuelto");
        expect(efectivo(a)).toBe(1000);
    });

    test("⚔️ Retos → 🚫 Bloqueos lista a quien tienes bloqueado y lo desbloquea", async () => {
        const [a, b] = par();
        bloqueos.bloquear(a, b);
        expect(idsDe(paneles.buildRetos(a))).toContain("retos_bloqueos");
        const abre = interaccion("retos_bloqueos", a);
        await botones.handleButton(null, abre);
        const vista = abre.update.mock.calls[0][0];
        expect(vista.embeds[0].toJSON().description).toContain(`1. <@${b}>`);
        expect(idsDe(vista)).toEqual([`retos_desbloquear_${b}`, "juegos_retos"]);

        const quita = interaccion(`retos_desbloquear_${b}`, a);
        await botones.handleButton(null, quita);
        expect(quita.update.mock.calls[0][0].embeds[0].toJSON().description).toContain("Desbloqueado");
        expect(retos.listarBloqueos(a)).toEqual([]);
        expect(paneles.buildBloqueos(a).embeds[0].toJSON().description).toContain("No tienes a nadie bloqueado");
    });
});

describe("cara a cara (#437)", () => {
    /** a y b juegan varios duelos: a gana el primero y el tercero, b el segundo; hay uno devuelto, uno con otra persona y uno pendiente. */
    function historia() {
        const [a, b] = par();
        const [, c] = par();
        const jugar = (rinde, extra = {}) => {
            const { reto } = retos.crearDuelo({ creador: a, rival: b, juego: "ppt", cantidad: 100, ...extra });
            retos.aceptar(reto.id, b);
            return retos.rendirse(reto.id, rinde).reto;
        };
        const d1 = jugar(b);
        const d2 = jugar(a);
        const d3 = jugar(b);
        const devuelto = retos.crearDuelo({ creador: a, rival: b, juego: "ppt", cantidad: 100 }).reto;
        retos.rechazar(devuelto.id, b);
        const contraC = retos.crearDuelo({ creador: a, rival: c, juego: "ppt", cantidad: 100 }).reto;
        retos.aceptar(contraC.id, c);
        retos.rendirse(contraC.id, c);
        retos.crearDuelo({ creador: a, rival: b, juego: "dados", cantidad: 100 });
        return { a, b, c, d1, d2, d3 };
    }

    test("cuenta las victorias de cada uno y el beneficio neto, solo con retos resueltos entre los dos", () => {
        const { a, b, d1, d2, d3 } = historia();
        const r = retos.caraACara(a, b);
        expect(r).toMatchObject({ victoriasA: 2, victoriasB: 1, netoA: 100, total: 3 });
        expect(r.ultimos.map((x) => x.id)).toEqual([d3.id, d2.id, d1.id]);
        const inverso = retos.caraACara(b, a);
        expect(inverso).toMatchObject({ victoriasA: 1, victoriasB: 2, netoA: -100, total: 3 });
    });

    test("los devueltos, las porras y los retos pendientes no cuentan, y consigo mismo no hay nada", () => {
        const { a, b } = historia();
        const antes = retos.caraACara(a, b).total;
        const porra = retos.crearPorra({ creador: a, pregunta: "¿Llueve mañana?", opciones: ["Sí", "No"], cantidad: 10 }).reto;
        retos.entrarPorra(porra.id, a, 0);
        retos.entrarPorra(porra.id, b, 1);
        retos.resolverPorra(porra.id, 0, true);
        expect(retos.caraACara(a, b).total).toBe(antes);
        expect(retos.caraACara(a, a)).toEqual({ victoriasA: 0, victoriasB: 0, netoA: 0, total: 0, ultimos: [] });
    });

    test("los últimos son como mucho 5", () => {
        const [a, b] = par();
        for (let i = 0; i < 7; i++) {
            const { reto } = retos.crearDuelo({ creador: a, rival: b, juego: "ppt", cantidad: 10 });
            retos.aceptar(reto.id, b);
            retos.rendirse(reto.id, b);
        }
        const r = retos.caraACara(a, b);
        expect(r.total).toBe(7);
        expect(r.ultimos).toHaveLength(5);
    });

    test("desde ⚔️ Retos: el botón pide a quién, y el resumen privado muestra marcador, beneficio y últimos", async () => {
        const { a, b } = historia();
        expect(idsDe(paneles.buildRetos(a))).toContain("retos_caraacara");
        const abre = interaccion("retos_caraacara", a);
        await botones.handleButton(null, abre);
        expect(abre.reply.mock.calls[0][0].flags).toBeDefined();
        expect(idsDe(abre.reply.mock.calls[0][0])).toEqual(["retos_cara_sel"]);

        const elige = interaccion("retos_cara_sel", a, { values: [b], users: { first: () => ({ id: b, bot: false }) } });
        await botones.handleSelect(null, elige);
        const vista = elige.update.mock.calls[0][0];
        const d = vista.embeds[0].toJSON().description;
        expect(d).toContain(`<@${a}> **2** – **1** <@${b}> (3 retos resueltos)`);
        expect(d).toContain("**+100** 🪙");
        expect(d).toContain("**Últimos 3**");
        expect(d).toContain("devueltos no cuentan");
        expect(vista.content).toBe("");

        const contigo = interaccion("retos_cara_sel", a, { values: [a], users: { first: () => ({ id: a }) } });
        await botones.handleSelect(null, contigo);
        expect(contigo.reply.mock.calls[0][0].content).toMatch(/otra persona/);
        const bot = interaccion("retos_cara_sel", a, { values: ["x"], users: { first: () => ({ id: "x", bot: true }) } });
        await botones.handleSelect(null, bot);
        expect(bot.reply.mock.calls[0][0].content).toMatch(/bots/);
    });

    test("sin retos entre los dos, lo dice", () => {
        const [a, b] = par();
        const v = paneles.vistaCaraACara(a, b, retos.caraACara(a, b));
        expect(v.embeds[0].toJSON().description).toContain("Todavía no habéis resuelto ningún reto");
    });
});
