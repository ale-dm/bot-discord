// ⚔️ Retos entre jugadores: apuestas 1 contra 1 a un partido, duelos de casino y porras, con el dinero retenido
// hasta que se resuelven. Y la pestaña ⚔️ Retos de /juegos con sus botones.
process.env.ODDS_API_KEY = "clave-de-prueba";

const db = require("../src/core/db");
const dinero = require("../src/systems/dinero");
const retos = require("../src/systems/retos");
const liquidacion = require("../src/systems/apuestas/liquidacion");
const paneles = require("../src/paneles/retos");
const botones = require("../src/juegos/retos/retos");
const juegos = require("../src/commands/juegos/juegos");
const { buildStatsJuegos } = require("../src/paneles/juegos");

// Números "aleatorios" en el orden dado (y vuelta a empezar).
const secuencia = (...vals) => {
    let n = 0;
    return () => vals[n++ % vals.length];
};
afterEach(() => retos.__test.setRng(null));

const efectivo = (id) => dinero.efectivo(id);
const historial = (id) => db.prepare("SELECT descripcion, cantidad, tipo FROM historial WHERE userId = ? ORDER BY id").all(id);
const enDias = (dias) => new Date(Date.now() + dias * 24 * 3600 * 1000).toISOString();
function partido(matchId, inicio, home = "Betis", away = "Sevilla") {
    db.prepare(
        "INSERT INTO apuestas_partidos (match_id, home_team, away_team, start_time, estado, deporte) VALUES (?, ?, ?, ?, 'abierto', 'laliga')",
    ).run(matchId, home, away, inicio);
}

describe("duelos", () => {
    test("dados: se cobra al crear y al aceptar, y el ganador se lleva lo de los dos", () => {
        retos.__test.setRng(secuencia(0.99, 0.99, 0, 0)); // creador 6+6, rival 1+1
        const r = retos.crearDuelo({ creador: "d-a", rival: "d-b", juego: "dados", cantidad: 300 });
        expect(r.ok).toBe(true);
        expect(r.reto.estado).toBe("pendiente");
        expect(efectivo("d-a")).toBe(700);

        const aceptado = retos.aceptar(r.reto.id, "d-b");
        expect(aceptado.ok).toBe(true);
        expect(aceptado.reto.estado).toBe("resuelto");
        expect(aceptado.reto.resultado).toMatch(/6\+6 = \*\*12\*\* contra 1\+1 = \*\*2\*\*/);
        expect(efectivo("d-a")).toBe(1300);
        expect(efectivo("d-b")).toBe(700);
        expect(historial("d-a")).toEqual([
            { descripcion: "Reto: duelo de Dados", cantidad: -300, tipo: "retos" },
            { descripcion: "Reto ganado: duelo de Dados", cantidad: 600, tipo: "retos" },
        ]);
    });

    test("dados: si empatan se vuelve a tirar", () => {
        retos.__test.setRng(secuencia(0, 0, 0, 0, 0, 0, 0.99, 0.99)); // 2 vs 2, después 2 vs 12
        const { reto } = retos.crearDuelo({ creador: "e-a", rival: "e-b", juego: "dados", cantidad: 100 });
        const r = retos.aceptar(reto.id, "e-b");
        expect(r.reto.resultado).toMatch(/tras 1 empate/);
        expect(efectivo("e-b")).toBe(1100);
    });

    test("solo el rival acepta o rechaza, solo el creador cancela, y rechazar devuelve", () => {
        const { reto } = retos.crearDuelo({ creador: "f-a", rival: "f-b", juego: "ppt", cantidad: 200 });
        expect(retos.aceptar(reto.id, "f-a").mensaje).toMatch(/no es para ti/);
        expect(retos.cancelar(reto.id, "f-b").mensaje).toMatch(/Solo quien lanzó/);
        const r = retos.rechazar(reto.id, "f-b");
        expect(r.reto).toMatchObject({ estado: "devuelto", resultado: "rechazado" });
        expect(efectivo("f-a")).toBe(1000);
        expect(retos.aceptar(reto.id, "f-b").ok).toBe(false);
    });

    test("sin efectivo no se crea ni se acepta, y el reto sigue pendiente", () => {
        dinero.asegurarCuenta("g-pobre");
        dinero.ingresar("g-pobre", 1000); // todo al banco
        expect(retos.crearDuelo({ creador: "g-pobre", rival: "g-b", juego: "ppt", cantidad: 50 }).mensaje).toMatch(
            /No te llega el efectivo/,
        );
        expect(db.prepare("SELECT COUNT(*) AS n FROM retos WHERE creador = 'g-pobre'").get().n).toBe(0);

        const { reto } = retos.crearDuelo({ creador: "g-b", rival: "g-pobre", juego: "ppt", cantidad: 50 });
        expect(retos.aceptar(reto.id, "g-pobre").mensaje).toMatch(/No te llega el efectivo/);
        expect(retos.obtener(reto.id).estado).toBe("pendiente");
    });

    test("cantidad fuera de límites, retarse a uno mismo y demasiados pendientes", () => {
        expect(retos.crearDuelo({ creador: "h-a", rival: "h-b", juego: "ppt", cantidad: 5 }).ok).toBe(false);
        expect(retos.crearDuelo({ creador: "h-a", rival: "h-a", juego: "ppt", cantidad: 50 }).mensaje).toMatch(/ti mismo/);
        for (let n = 0; n < retos.MAX_PENDIENTES; n++) {
            expect(retos.crearDuelo({ creador: "h-a", rival: `h-${n}`, juego: "ppt", cantidad: 10 }).ok).toBe(true);
        }
        expect(retos.crearDuelo({ creador: "h-a", rival: "h-x", juego: "ppt", cantidad: 10 }).mensaje).toMatch(/sin aceptar/);
    });

    test("piedra, papel o tijera: jugadas en secreto, empate a otra ronda y gana quien gana", () => {
        const { reto } = retos.crearDuelo({ creador: "p-a", rival: "p-b", juego: "ppt", cantidad: 100 });
        retos.aceptar(reto.id, "p-b");
        expect(retos.jugarPpt(reto.id, "intruso", "piedra").mensaje).toMatch(/No juegas/);

        const r1 = retos.jugarPpt(reto.id, "p-a", "piedra");
        expect(r1.mensaje).toMatch(/Falta el otro/);
        // El mensaje público dice quién ha elegido, pero no qué.
        const publico = paneles.mensajeReto(r1.reto).embeds[0].data.description;
        expect(publico).toMatch(/<@p-a> ✅ ya ha elegido/);
        expect(publico).not.toMatch(/piedra/i);
        expect(retos.jugarPpt(reto.id, "p-a", "papel").mensaje).toMatch(/Ya has elegido/);

        expect(retos.jugarPpt(reto.id, "p-b", "piedra").mensaje).toMatch(/Empate/);
        expect(retos.obtener(reto.id).datos.ronda).toBe(2);

        retos.jugarPpt(reto.id, "p-a", "tijera");
        const fin = retos.jugarPpt(reto.id, "p-b", "piedra");
        expect(fin.reto).toMatchObject({ estado: "resuelto", resultado: "✂️ tijera contra 🪨 piedra" });
        expect(efectivo("p-b")).toBe(1100);
        expect(efectivo("p-a")).toBe(900);
    });

    test("blackjack: cada uno juega su mano y gana el que más se acerca a 21", () => {
        retos.__test.setRng(() => 0); // siempre la primera carta: 2♠ 3♠ al creador, 4♠ 5♠ al rival, luego 6, 7...
        const { reto } = retos.crearDuelo({ creador: "b-a", rival: "b-b", juego: "blackjack", cantidad: 100 });
        retos.aceptar(reto.id, "b-b");
        expect(retos.valorMano(retos.obtener(reto.id), "b-a")).toBe(5);

        retos.jugarBlackjack(reto.id, "b-a", "pedir"); // + 6 = 11
        retos.jugarBlackjack(reto.id, "b-a", "pedir"); // + 7 = 18
        const r = retos.jugarBlackjack(reto.id, "b-a", "plantarse");
        expect(r.reto.estado).toBe("en_juego");
        expect(retos.jugarBlackjack(reto.id, "b-a", "pedir").mensaje).toMatch(/Ya has terminado/);
        // La mano se ve en privado; el mensaje público solo dice cuántas cartas.
        expect(JSON.stringify(paneles.mensajeReto(r.reto).embeds[0].data)).toMatch(/<@b-a> ✋ ha terminado \(4 cartas\)/);
        expect(paneles.vistaManoBlackjack(r.reto, "b-b").components).toHaveLength(1);

        const fin = retos.jugarBlackjack(reto.id, "b-b", "plantarse"); // 9
        expect(fin.reto).toMatchObject({ estado: "resuelto", resultado: "🃏 18 contra 9" });
        expect(efectivo("b-a")).toBe(1100);
        expect(JSON.stringify(paneles.mensajeReto(fin.reto).embeds[0].data)).toMatch(/2♠️ 3♠️ 6♠️ 7♠️ \(\*\*18\*\*\)/);
    });

    test("un duelo abandonado: el blackjack se resuelve plantando a quien no terminó; el ppt se devuelve", () => {
        retos.__test.setRng(() => 0);
        const bjDuelo = retos.crearDuelo({ creador: "ab-a", rival: "ab-b", juego: "blackjack", cantidad: 100 }).reto;
        retos.aceptar(bjDuelo.id, "ab-b");
        const ppt = retos.crearDuelo({ creador: "ab-c", rival: "ab-d", juego: "ppt", cantidad: 100 }).reto;
        retos.aceptar(ppt.id, "ab-d");
        retos.jugarPpt(ppt.id, "ab-c", "papel");

        const { cerrados, pagos } = retos.revisar(Date.now() + retos.ABANDONO_MS + 1000);
        const porId = Object.fromEntries(cerrados.map((r) => [r.id, r]));
        expect(porId[bjDuelo.id]).toMatchObject({ estado: "resuelto", resultado: "🃏 5 contra 9" });
        expect(porId[ppt.id]).toMatchObject({ estado: "devuelto" });
        expect(efectivo("ab-b")).toBe(1100);
        expect(efectivo("ab-c")).toBe(1000);
        expect(pagos).toEqual(expect.arrayContaining([expect.objectContaining({ userId: "ab-d", premio: 100, reembolso: true })]));
    });
});

describe("retos a un partido", () => {
    let resultadosApi = {};
    beforeEach(() => {
        global.fetch = jest.fn(async () => ({
            ok: true,
            headers: new Map([["x-requests-remaining", "400"]]),
            json: async () => resultadosApi,
        }));
    });

    test("el creador va con un resultado, el rival con lo contrario, y la liquidación paga al que acierta", async () => {
        partido("rp-1", enDias(1));
        const r = retos.crearPartido({ creador: "rp-a", rival: "rp-b", matchId: "rp-1", eleccion: "home", cantidad: 500 });
        expect(r.ok).toBe(true);
        const texto = paneles.mensajeReto(r.reto).embeds[0].data.description;
        expect(texto).toMatch(/a que \*\*gana Betis\*\*/);
        expect(texto).toMatch(/va con lo contrario: \*\*empate o gana Sevilla\*\*/);
        expect(retos.aceptar(r.reto.id, "rp-b").reto.estado).toBe("en_juego");

        // Un reto que nadie aceptó antes del partido se devuelve en la misma liquidación.
        const sinAceptar = retos.crearPartido({ creador: "rp-c", rival: "rp-d", matchId: "rp-1", eleccion: "away", cantidad: 100 }).reto;

        db.prepare("UPDATE apuestas_partidos SET start_time = ? WHERE match_id = 'rp-1'").run(enDias(-0.25));
        resultadosApi = [
            {
                id: "rp-1",
                completed: true,
                home_team: "Betis",
                away_team: "Sevilla",
                scores: [
                    { name: "Betis", score: "2" },
                    { name: "Sevilla", score: "1" },
                ],
            },
        ];
        const resumen = await liquidacion.liquidarApuestas({ minHorasDesdeInicio: 2 });
        expect(retos.obtener(r.reto.id)).toMatchObject({ estado: "resuelto", resultado: "Betis 2-1 Sevilla" });
        expect(efectivo("rp-a")).toBe(1500);
        expect(efectivo("rp-b")).toBe(500);
        expect(retos.obtener(sinAceptar.id).estado).toBe("devuelto");
        expect(efectivo("rp-c")).toBe(1000);
        expect(resumen.retosCerrados).toEqual(expect.arrayContaining([r.reto.id, sinAceptar.id]));
        expect(resumen.pagos).toEqual(expect.arrayContaining([expect.objectContaining({ userId: "rp-a", premio: 1000 })]));
        // Sin apuestas normales a ese partido, no sale como "nadie acertó"; el reto sale aparte.
        expect(resumen.partidos).toEqual([]);
        expect(liquidacion.resultadosEmbed(resumen).data.description).toMatch(
            /⚔️ \*\*Reto\*\* <@rp-a> vs <@rp-b> · Betis 2-1 Sevilla\n🏆 Gana <@rp-a> y se lleva \*\*1\.?000\*\*/,
        );
    });

    test("no se puede retar ni aceptar un partido ya empezado", () => {
        partido("rp-2", enDias(1));
        const { reto } = retos.crearPartido({ creador: "rq-a", rival: "rq-b", matchId: "rp-2", eleccion: "draw", cantidad: 100 });
        db.prepare("UPDATE apuestas_partidos SET start_time = ? WHERE match_id = 'rp-2'").run(enDias(-0.01));
        expect(retos.aceptar(reto.id, "rq-b").mensaje).toMatch(/caducado|empezado/);
        expect(retos.crearPartido({ creador: "rq-a", rival: "rq-b", matchId: "rp-2", eleccion: "draw", cantidad: 100 }).mensaje).toMatch(
            /empezado/,
        );
        // El cron lo devuelve (caducó al empezar el partido).
        retos.revisar();
        expect(retos.obtener(reto.id)).toMatchObject({ estado: "devuelto", resultado: "nadie lo aceptó a tiempo" });
        expect(efectivo("rq-a")).toBe(1000);
    });

    test("un partido sin resultado devuelve sus retos", async () => {
        partido("rp-3", enDias(1));
        const { reto } = retos.crearPartido({ creador: "rs-a", rival: "rs-b", matchId: "rp-3", eleccion: "home", cantidad: 100 });
        retos.aceptar(reto.id, "rs-b");
        db.prepare("UPDATE apuestas_partidos SET start_time = ? WHERE match_id = 'rp-3'").run(enDias(-5));
        resultadosApi = [];
        const resumen = await liquidacion.liquidarApuestas({ minHorasDesdeInicio: 2 });
        expect(retos.obtener(reto.id)).toMatchObject({ estado: "devuelto", resultado: "el partido se quedó sin resultado" });
        expect(efectivo("rs-a")).toBe(1000);
        expect(efectivo("rs-b")).toBe(1000);
        expect(resumen.retosCerrados).toContain(reto.id);
    });
});

describe("porras", () => {
    const nueva = (extra = {}) =>
        retos.crearPorra({ creador: "po-c", pregunta: "¿Llegará Jorge tarde?", opciones: ["Sí", "No"], cantidad: 100, ...extra }).reto;

    test("leer las opciones del formulario", () => {
        expect(retos.leerOpciones("")).toEqual(["Sí", "No"]);
        expect(retos.leerOpciones("Antes de las 9\n Entre 9 y 10 \n\nDespués")).toEqual(["Antes de las 9", "Entre 9 y 10", "Después"]);
        expect(retos.leerOpciones("Rojo, Azul")).toEqual(["Rojo", "Azul"]);
        expect(retos.crearPorra({ creador: "x", pregunta: "¿Qué?", opciones: ["Sí"], cantidad: 100 }).ok).toBe(false);
        expect(retos.crearPorra({ creador: "x", pregunta: "¿Qué?", opciones: ["Sí", "sí"], cantidad: 100 }).mensaje).toMatch(/repetidas/);
    });

    test("cada uno entra con una opción; un admin reparte el bote entre los que acertaron", () => {
        const porra = nueva();
        expect(efectivo("po-c")).toBe(1000); // crearla no cobra
        expect(retos.entrarPorra(porra.id, "po-1", 0).mensaje).toMatch(/Vas con \*\*Sí\*\*/);
        expect(retos.entrarPorra(porra.id, "po-1", 1).mensaje).toMatch(/Ya estás dentro: vas con \*\*Sí\*\*/);
        retos.entrarPorra(porra.id, "po-2", 0);
        retos.entrarPorra(porra.id, "po-3", 1);
        expect(efectivo("po-3")).toBe(900);

        expect(retos.cerrarPorra(porra.id, "po-1", false).mensaje).toMatch(/Solo quien creó/);
        expect(retos.cerrarPorra(porra.id, "po-c", false).reto.estado).toBe("cerrada");
        expect(retos.entrarPorra(porra.id, "po-4", 0).mensaje).toMatch(/ya no admite/);

        expect(retos.resolverPorra(porra.id, 0, false).mensaje).toMatch(/Solo un admin/);
        const r = retos.resolverPorra(porra.id, 0, true);
        expect(r.reto).toMatchObject({ estado: "resuelto", resultado: "ganó «Sí»" });
        expect(efectivo("po-1")).toBe(1050);
        expect(efectivo("po-2")).toBe(1050);
        expect(efectivo("po-3")).toBe(900);
        expect(r.pagos.map((p) => p.userId).sort()).toEqual(["po-1", "po-2"]);
        expect(paneles.mensajeReto(r.reto).components).toEqual([]);
    });

    test("si nadie eligió la opción ganadora, se devuelve; el creador solo anula si no ha entrado nadie más", () => {
        const a = nueva();
        retos.entrarPorra(a.id, "pn-1", 1);
        expect(retos.resolverPorra(a.id, 0, true).reto).toMatchObject({ estado: "devuelto", resultado: "ganó «Sí» y nadie la eligió" });
        expect(efectivo("pn-1")).toBe(1000);

        const b = nueva();
        retos.entrarPorra(b.id, "pn-2", 0);
        expect(retos.anularPorra(b.id, "po-c", false).ok).toBe(false);
        expect(retos.anularPorra(b.id, "admin", true).reto.estado).toBe("devuelto");
        expect(efectivo("pn-2")).toBe(1000);

        const c = nueva();
        expect(retos.anularPorra(c.id, "po-c", false).ok).toBe(true);
    });

    test("una porra que nadie resuelve se devuelve a los 30 días", () => {
        const porra = nueva();
        retos.entrarPorra(porra.id, "pc-1", 0);
        retos.revisar(Date.now() + (retos.PORRA_DIAS + 1) * 24 * 3600 * 1000);
        expect(retos.obtener(porra.id).estado).toBe("devuelto");
        expect(efectivo("pc-1")).toBe(1000);
    });
});

describe("pestaña ⚔️ Retos y botones", () => {
    const interaccion = (customId, extra = {}) => ({
        customId,
        user: { id: "ui-a", username: "ui-a", tag: "ui-a" },
        guildId: "g-retos",
        channelId: "canal-retos",
        message: { interaction: { user: { id: "ui-a" } } },
        memberPermissions: { has: () => false },
        isFromMessage: () => true,
        isButton: () => true,
        options: { getString: () => null },
        reply: jest.fn(async () => {}),
        update: jest.fn(async () => {}),
        showModal: jest.fn(async () => {}),
        deferUpdate: jest.fn(async () => {}),
        editReply: jest.fn(async () => {}),
        followUp: jest.fn(async () => ({ id: "mensaje-reto", channelId: "canal-retos" })),
        ...extra,
    });
    const idsDe = (payload) => payload.components.flatMap((r) => (r.toJSON ? r.toJSON() : r).components.map((c) => c.custom_id));

    test("lanzar un duelo desde el panel: juego → rival → cantidad → mensaje público que menciona al rival", async () => {
        const tab = interaccion("juegos_retos");
        await juegos.handleButton(null, tab);
        expect(idsDe(tab.update.mock.calls[0][0])).toEqual(
            expect.arrayContaining(["retos_nuevo_partido", "retos_nuevo_duelo", "retos_nuevo_porra"]),
        );

        const duelo = interaccion("retos_nuevo_duelo");
        await botones.handleButton(null, duelo);
        expect(idsDe(duelo.update.mock.calls[0][0])).toEqual([
            "retos_juego_ppt",
            "retos_juego_dados",
            "retos_juego_blackjack",
            "juegos_retos",
        ]);

        const juego = interaccion("retos_juego_ppt");
        await botones.handleButton(null, juego);
        expect(idsDe(juego.update.mock.calls[0][0])[0]).toBe("retos_rival_d_ppt");

        const aMiMismo = interaccion("retos_rival_d_ppt", { values: ["ui-a"], users: { first: () => ({ id: "ui-a" }) } });
        await botones.handleSelect(null, aMiMismo);
        expect(aMiMismo.reply.mock.calls[0][0].content).toMatch(/ti mismo/);

        const rival = interaccion("retos_rival_d_ppt", { values: ["ui-b"], users: { first: () => ({ id: "ui-b", bot: false }) } });
        await botones.handleSelect(null, rival);
        expect(rival.showModal.mock.calls[0][0].data.custom_id).toBe("retos_modal_d_ppt_ui-b");

        const modal = interaccion("retos_modal_d_ppt_ui-b", {
            fields: { getStringSelectValues: () => null, getTextInputValue: () => "250" },
        });
        await botones.handleModal(null, modal);
        expect(modal.update.mock.calls[0][0].embeds[0].data.description).toMatch(/Reto publicado/);
        const publico = modal.followUp.mock.calls[0][0];
        expect(publico.content).toMatch(/<@ui-b>, <@ui-a> te ha retado/);
        expect(publico.allowedMentions).toEqual({ users: ["ui-b"] });
        const reto = db.prepare("SELECT * FROM retos WHERE creador = 'ui-a' ORDER BY id DESC").get();
        expect(reto).toMatchObject({ juego: "ppt", rival: "ui-b", cantidad: 250, messageId: "mensaje-reto", channelId: "canal-retos" });
        expect(efectivo("ui-a")).toBe(750);

        // En el mensaje público acepta el rival (aunque el mensaje lo "abrió" el creador); otro no puede.
        const otro = interaccion(`retos_aceptar_${reto.id}`, { user: { id: "ui-c" } });
        await botones.handleButton(null, otro);
        expect(otro.reply.mock.calls[0][0].content).toMatch(/no es para ti/);
        const acepta = interaccion(`retos_aceptar_${reto.id}`, { user: { id: "ui-b" } });
        await botones.handleButton(null, acepta);
        expect(idsDe(acepta.update.mock.calls[0][0])).toEqual([
            `retos_ppt_piedra_${reto.id}`,
            `retos_ppt_papel_${reto.id}`,
            `retos_ppt_tijera_${reto.id}`,
        ]);

        // La jugada se confirma en privado.
        const juega = interaccion(`retos_ppt_papel_${reto.id}`, { user: { id: "ui-b" } });
        await botones.handleButton(null, juega);
        expect(juega.followUp.mock.calls[0][0]).toMatchObject({ content: expect.stringMatching(/Has elegido 📄/), flags: 64 });

        // Y el reto sale en la pestaña de los dos.
        expect(JSON.stringify(paneles.buildRetos("ui-b").embeds[0].data.fields)).toMatch(/Piedra, papel o tijera/);
    });

    test("lanzar un reto a un partido desde el panel: partido → resultado → rival → cantidad", async () => {
        partido("a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4", enDias(3), "Real Madrid", "Barcelona");
        dinero.pagar("ui-a", 1000); // el duelo del test anterior le dejó 750
        const nuevo = interaccion("retos_nuevo_partido", { user: { id: "ui-a" } });
        await botones.handleButton(null, nuevo);
        const opciones = nuevo.update.mock.calls[0][0].components[0].toJSON().components[0].options;
        expect(opciones.map((o) => o.value)).toContain("a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4");

        const elige = interaccion("retos_partido_select", { values: ["a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4"] });
        await botones.handleSelect(null, elige);
        expect(idsDe(elige.update.mock.calls[0][0]).slice(0, 3)).toEqual([
            "retos_lado_home_a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4",
            "retos_lado_draw_a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4",
            "retos_lado_away_a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4",
        ]);

        const lado = interaccion("retos_lado_away_a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4");
        await botones.handleButton(null, lado);
        expect(lado.update.mock.calls[0][0].embeds[0].data.description).toMatch(
            /Vas con \*\*gana Barcelona\*\*.*\n.*empate o gana Real Madrid/,
        );

        const rival = interaccion("retos_rival_p_away_a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4", {
            values: ["123456789012345678"],
            users: { first: () => ({ id: "123456789012345678", bot: false }) },
        });
        await botones.handleSelect(null, rival);
        const modalId = rival.showModal.mock.calls[0][0].data.custom_id;
        expect(modalId).toBe("retos_modal_p_away_a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4_123456789012345678");
        expect(modalId.length).toBeLessThanOrEqual(100);

        const modal = interaccion(modalId, { fields: { getStringSelectValues: () => null, getTextInputValue: () => "1.000" } });
        await botones.handleModal(null, modal);
        const reto = db.prepare("SELECT * FROM retos WHERE match_id = 'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4'").get();
        expect(reto).toMatchObject({ creador: "ui-a", rival: "123456789012345678", eleccion: "away", cantidad: 1000, estado: "pendiente" });
    });

    test("los pasos del panel solo los usa quien lo abrió", async () => {
        const i = interaccion("retos_nuevo_duelo", { user: { id: "intruso" } });
        await botones.handleButton(null, i);
        expect(i.update).not.toHaveBeenCalled();
        expect(i.reply.mock.calls[0][0].content).toMatch(/Solo quien/);
    });

    test("resolver una porra desde su mensaje: solo admins, con un menú privado", async () => {
        const porra = retos.crearPorra({ creador: "ui-p", pregunta: "¿Lloverá?", opciones: ["Sí", "No"], cantidad: 100 }).reto;
        retos.entrarPorra(porra.id, "ui-q", 1);
        const noAdmin = interaccion(`retos_porra_resolver_${porra.id}`, { user: { id: "ui-q" } });
        await botones.handleButton(null, noAdmin);
        expect(noAdmin.reply.mock.calls[0][0].content).toMatch(/Solo un admin/);

        const admin = { memberPermissions: { has: () => true }, user: { id: "jefe", tag: "jefe" } };
        const abre = interaccion(`retos_porra_resolver_${porra.id}`, admin);
        await botones.handleButton(null, abre);
        expect(abre.reply.mock.calls[0][0].flags).toBe(64);
        expect(idsDe(abre.reply.mock.calls[0][0])).toEqual([`retos_porra_ganadora_${porra.id}`]);

        const client = {
            channels: { fetch: jest.fn(async () => ({ messages: { edit: jest.fn() } })) },
            users: { fetch: async () => ({ send: async () => {} }) },
        };
        const elige = interaccion(`retos_porra_ganadora_${porra.id}`, { ...admin, values: ["1"] });
        await botones.handleSelect(client, elige);
        expect(elige.update.mock.calls[0][0].content).toMatch(/Porra resuelta: ganó «No»/);
        expect(efectivo("ui-q")).toBe(1000);
    });

    test("ninguna pantalla de retos repite un customId", () => {
        partido("ui-m", enDias(2), "Arsenal", "Chelsea");
        const p = retos.partidoDe("ui-m");
        const porra = retos.crearPorra({ creador: "ui-z", pregunta: "¿Sí o no?", opciones: ["Sí", "No", "Ni idea"], cantidad: 10 }).reto;
        const duelo = retos.crearDuelo({ creador: "ui-z", rival: "ui-y", juego: "blackjack", cantidad: 10 }).reto;
        for (const payload of [
            paneles.buildRetos("ui-z"),
            paneles.buildElegirPartido(retos.partidosParaRetar()),
            paneles.buildElegirLado(p),
            paneles.buildElegirJuego(),
            paneles.buildElegirRival("d_ppt", "x"),
            paneles.mensajeReto(porra),
            paneles.mensajeReto(duelo),
            paneles.mensajeReto(retos.aceptar(duelo.id, "ui-y").reto),
        ]) {
            const ids = idsDe(payload);
            expect(ids.filter((id, n) => ids.indexOf(id) !== n)).toEqual([]);
        }
    });

    test("📊 Stats cuenta los retos en el total", () => {
        const fields = buildStatsJuegos("d-a", "d-a").embeds[0].data.fields;
        expect(fields.find((f) => f.name === "⚔️ Retos").value).toMatch(/\*\*1\*\* ganados .* → \*\*\+300\*\*/);
        expect(fields.find((f) => f.name === "📊 Total").value).toMatch(/Retos \*\*\+300\*\*/);
    });
});
