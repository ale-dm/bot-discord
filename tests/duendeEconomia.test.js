// 🧙 El Duende en la economía (F-DU-03, #14): retarle a piedra, papel o tijera, apostar contra él a un partido y pedirle
// préstamos desde el chat. Él solo propone (un mensaje con ✅/❌ debajo de su respuesta) y el dinero se mueve al aceptar;
// su parte la pone la banca, como en el casino. Con Gemini simulado, como en duende.test.js.
process.env.DATA_DIR = require("fs").mkdtempSync(require("path").join(require("os").tmpdir(), "el-duende-economia-"));
process.env.GOOGLE_API_KEY = "clave-de-prueba";
process.env.ODDS_API_KEY = "clave-de-prueba";
process.env.DUENDE_GIF_PROB = "0";

const mockRespuestas = [];
const mockPeticiones = [];
jest.mock("../src/services/geminiClient", () => ({
    generateContentWithTimeout: jest.fn(async (params) => {
        mockPeticiones.push(JSON.parse(JSON.stringify(params)));
        return mockRespuestas.shift();
    }),
}));

const db = require("../src/core/db");
const dinero = require("../src/systems/dinero");
const retos = require("../src/systems/retos");
const prestamos = require("../src/systems/prestamos");
const liquidacion = require("../src/systems/apuestas/liquidacion");
const paneles = require("../src/paneles/retos");
const propuestas = require("../src/paneles/duendeEconomia");
const economia = require("../src/paneles/economia");
const botones = require("../src/juegos/retos/duende");
const botonesRetos = require("../src/juegos/retos/retos");
const perfilDinero = require("../src/perfil/dinero");
const duende = require("../src/commands/duende/duende");
const { DUENDE_TOOL_EXECUTORS } = require("../src/services/duende/herramientas");

const G = "guild-duende-eco";
const DIA = 24 * 3600 * 1000;
// Números "aleatorios" en el orden dado (y vuelta a empezar): 0 → piedra, 0.5 → papel, 0.9 → tijera.
const secuencia = (...vals) => {
    let n = 0;
    return () => vals[n++ % vals.length];
};
afterEach(() => retos.__test.setRng(null));
beforeEach(() => {
    mockRespuestas.length = 0;
    mockPeticiones.length = 0;
});

const efectivo = (id) => dinero.efectivo(id);
const historial = (id) => db.prepare("SELECT descripcion, cantidad, tipo FROM historial WHERE userId = ? ORDER BY id").all(id);
const enDias = (dias) => new Date(Date.now() + dias * DIA).toISOString();
function partido(matchId, inicio, home = "Betis", away = "Sevilla") {
    db.prepare(
        "INSERT INTO apuestas_partidos (match_id, home_team, away_team, start_time, estado, deporte) VALUES (?, ?, ?, ?, 'abierto', 'laliga')",
    ).run(matchId, home, away, inicio);
}
const ids = (payload) => payload.components.flatMap((f) => f.toJSON().components.map((c) => c.custom_id));

describe("🧙 retos contra el Duende", () => {
    test("piedra, papel o tijera: solo se le cobra a la persona; si gana, cobra lo de los dos (lo del Duende lo pone la banca)", () => {
        retos.__test.setRng(secuencia(0)); // el Duende: piedra
        const r = retos.crearContraDuende({ userId: "pd-a", cantidad: 300, guildId: G });
        expect(r.ok).toBe(true);
        expect(r.reto).toMatchObject({ tipo: "duelo", juego: "ppt", estado: "en_juego", creador: retos.DUENDE, rival: "pd-a" });
        expect(r.reto.datos.jugadas).toEqual({ [retos.DUENDE]: "piedra" });
        expect(efectivo("pd-a")).toBe(700);
        const texto = paneles.mensajeReto(r.reto).embeds[0].data.description;
        expect(texto).toMatch(/^🧙 \*\*el Duende\*\* reta a <@pd-a> por \*\*300\*\* 🪙 cada uno/);
        expect(texto).toMatch(/🧙 \*\*el Duende\*\* ✅ ya ha elegido\n<@pd-a> ⏳ pensando/);

        const j = retos.jugarPpt(r.reto.id, "pd-a", "papel");
        expect(j.reto).toMatchObject({ estado: "resuelto", resultado: "🪨 piedra contra 📄 papel" });
        // Lo ganado paga el impuesto del servidor como cualquier reto (el 5 % que viene por defecto).
        expect(efectivo("pd-a")).toBe(1270);
        expect(historial("pd-a")).toEqual([
            { descripcion: "Reto: duelo de Piedra, papel o tijera contra el Duende", cantidad: -300, tipo: "retos" },
            { descripcion: "Reto ganado: duelo de Piedra, papel o tijera contra el Duende", cantidad: 600, tipo: "retos" },
            { descripcion: "Impuesto sobre ⚔️ Retos", cantidad: -30, tipo: "impuesto" },
        ]);
        expect(paneles.mensajeReto(j.reto).embeds[0].data.description).toMatch(/🏆 Gana <@pd-a> y se lleva \*\*600\*\* 🪙/);
        // El Duende no tiene cuenta ni movimientos.
        expect(db.prepare("SELECT COUNT(*) AS n FROM banco WHERE userId = ?").get(retos.DUENDE).n).toBe(0);
        expect(historial(retos.DUENDE)).toEqual([]);
    });

    test("si gana el Duende, lo apostado desaparece: no se le paga a nadie", () => {
        retos.__test.setRng(secuencia(0.5)); // papel
        const r = retos.crearContraDuende({ userId: "pd-b", cantidad: 200 });
        const j = retos.jugarPpt(r.reto.id, "pd-b", "piedra");
        expect(j.reto.estado).toBe("resuelto");
        expect(efectivo("pd-b")).toBe(800);
        expect(j.reto.participantes.find((p) => p.userId === retos.DUENDE).premio).toBe(400);
        expect(paneles.mensajeReto(j.reto).embeds[0].data.description).toMatch(/🏆 Gana 🧙 \*\*el Duende\*\* y se lleva \*\*400\*\* 🪙/);
        expect(historial(retos.DUENDE)).toEqual([]);
    });

    test("con empate, el Duende vuelve a elegir para la ronda siguiente", () => {
        retos.__test.setRng(secuencia(0, 0.9)); // piedra y, en la segunda ronda, tijera
        const r = retos.crearContraDuende({ userId: "pd-c", cantidad: 100 });
        const empate = retos.jugarPpt(r.reto.id, "pd-c", "piedra");
        expect(empate.mensaje).toMatch(/Empate a 🪨/);
        expect(empate.reto.datos).toMatchObject({ ronda: 2, jugadas: { [retos.DUENDE]: "tijera" } });
        expect(retos.jugarPpt(r.reto.id, "pd-c", "piedra").reto.estado).toBe("resuelto");
        expect(efectivo("pd-c")).toBe(1100);
    });

    test("de 10 a 1.000 y con efectivo", () => {
        expect(retos.crearContraDuende({ userId: "pd-d", cantidad: 1001 }).mensaje).toMatch(/entre 10 y 1\.?000/);
        expect(retos.crearContraDuende({ userId: "pd-d", cantidad: 5 }).ok).toBe(false);
        expect(retos.crearContraDuende({ userId: "pd-d", cantidad: 1000 }).ok).toBe(true);
        expect(retos.crearContraDuende({ userId: "pd-d", cantidad: 10 }).mensaje).toMatch(/^❌ No te llega el efectivo/);
    });

    test("un duelo contra el Duende sin jugar se devuelve, como cualquier otro", () => {
        const r = retos.crearContraDuende({ userId: "pd-e", cantidad: 250 });
        expect(efectivo("pd-e")).toBe(750);
        retos.revisar(Date.now() + retos.ABANDONO_MS + 1000);
        expect(retos.obtener(r.reto.id).estado).toBe("devuelto");
        expect(efectivo("pd-e")).toBe(1000);
    });
});

describe("🧙 apostar contra el Duende a un partido", () => {
    let resultadosApi = [];
    beforeEach(() => {
        global.fetch = jest.fn(async () => ({
            ok: true,
            headers: new Map([["x-requests-remaining", "400"]]),
            json: async () => resultadosApi,
        }));
    });

    test("la persona va con un resultado y el Duende con lo contrario; la liquidación paga si acierta y lo anuncia", async () => {
        partido("pdp-1", enDias(1));
        const r = retos.crearContraDuende({ userId: "pp-a", cantidad: 400, matchId: "pdp-1", eleccion: "home" });
        expect(r.reto).toMatchObject({ tipo: "partido", estado: "en_juego", creador: "pp-a", rival: retos.DUENDE, eleccion: "home" });
        expect(paneles.mensajeReto(r.reto).embeds[0].data.description).toMatch(
            /🧙 \*\*el Duende\*\* va con lo contrario: \*\*empate o gana Sevilla\*\*/,
        );
        const pierde = retos.crearContraDuende({ userId: "pp-b", cantidad: 100, matchId: "pdp-1", eleccion: "away" });
        expect(efectivo("pp-a")).toBe(600);

        db.prepare("UPDATE apuestas_partidos SET start_time = ? WHERE match_id = 'pdp-1'").run(enDias(-0.25));
        resultadosApi = [
            {
                id: "pdp-1",
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
        expect(efectivo("pp-a")).toBe(1400);
        expect(efectivo("pp-b")).toBe(900);
        expect(retos.obtener(pierde.reto.id).estado).toBe("resuelto");
        expect(resumen.pagos.map((p) => p.userId)).not.toContain(retos.DUENDE);
        const anuncio = liquidacion.resultadosEmbed(resumen).data.description;
        expect(anuncio).toMatch(
            /⚔️ \*\*Reto\*\* <@pp-a> vs 🧙 \*\*el Duende\*\* · Betis 2-1 Sevilla\n🏆 Gana <@pp-a> y se lleva \*\*800\*\*/,
        );
        expect(anuncio).toMatch(/⚔️ \*\*Reto\*\* <@pp-b> vs 🧙 \*\*el Duende\*\* · Betis 2-1 Sevilla\n🏆 Gana 🧙 \*\*el Duende\*\*/);
    });

    test("no se puede a un partido ya empezado", () => {
        partido("pdp-2", enDias(-0.1));
        expect(retos.crearContraDuende({ userId: "pp-c", cantidad: 100, matchId: "pdp-2", eleccion: "home" }).mensaje).toMatch(
            /ya ha empezado/,
        );
        expect(efectivo("pp-c")).toBe(1000);
    });

    test("encontrar el partido por los equipos y saber por cuál va", () => {
        partido("pdp-3", enDias(2), "Real Madrid", "Real Sociedad");
        partido("pdp-4", enDias(3), "Atlético Madrid", "Barcelona");
        expect(retos.buscarPartido("Sociedad")?.match_id).toBe("pdp-3");
        expect(retos.buscarPartido("atletico - barcelona")?.match_id).toBe("pdp-4");
        expect(retos.buscarPartido("Osasuna")).toBeNull();
        const madrid = retos.partidoDe("pdp-3");
        expect(retos.eleccionPara(madrid, "Real Madrid")).toBe("home");
        expect(retos.eleccionPara(madrid, "la Real Sociedad")).toBe("away");
        expect(retos.eleccionPara(madrid, "empate")).toBe("draw");
        expect(retos.eleccionPara(madrid, "Real")).toBeNull(); // los dos igual de "Real"
        expect(retos.eleccionPara(retos.partidoDe("pdp-4"), "Atleti")).toBe("home");
    });
});

describe("🧙 préstamos del Duende", () => {
    test("aceptar: el dinero al efectivo, y se devuelve un 10 % más en 7 días; uno a la vez y hasta 1.000", () => {
        const ahora = Date.now();
        const r = prestamos.aceptar("pr-a", 500, G, ahora);
        expect(r.prestamo).toMatchObject({ cantidad: 500, total: 550, pagado: 0, estado: "activo", falta: 550, vence_en: ahora + 7 * DIA });
        expect(efectivo("pr-a")).toBe(1500);
        expect(historial("pr-a")).toEqual([{ descripcion: "Préstamo del Duende (devuelves 550)", cantidad: 500, tipo: "prestamo" }]);
        expect(prestamos.aceptar("pr-a", 100).mensaje).toMatch(/Ya tienes un préstamo: devuelve los \*\*550\*\*/);
        expect(prestamos.aceptar("pr-b", 1001).ok).toBe(false);
        expect(prestamos.totalDe(333)).toBe(367); // el interés, redondeado hacia arriba
    });

    test("devolverlo antes desde 💰 Economía, con lo que haya en el efectivo", async () => {
        prestamos.aceptar("pr-c", 1000, G); // 2.000 de efectivo
        dinero.ingresar("pr-c", 1500); // 500 de efectivo; debe 1.100
        const panel = await economia.buildEconomia({ viewerId: "pr-c", nombre: "pr-c", guildId: G });
        const campo = panel.embeds[0].data.fields.find((f) => f.name === "🧙 Préstamo del Duende");
        expect(campo.value).toMatch(/^Devuelve \*\*1\.?100\*\* 🪙 antes del <t:\d+:f>/);
        expect(ids(panel)).toContain("dinero_prestamo_devolver");
        // Quien mira la Economía de otro ve el préstamo, pero sin el botón.
        const ajeno = await economia.buildEconomia({ viewerId: "otro", targetId: "pr-c", nombre: "pr-c", guildId: G });
        expect(ajeno.embeds[0].data.fields.some((f) => f.name === "🧙 Préstamo del Duende")).toBe(true);
        expect(ids(ajeno)).not.toContain("dinero_prestamo_devolver");

        const pulsar = async () => {
            const i = {
                customId: "dinero_prestamo_devolver",
                user: { id: "pr-c", tag: "pr-c", username: "pr-c" },
                guildId: G,
                message: {},
                reply: jest.fn(async () => {}),
                update: jest.fn(async () => {}),
            };
            await perfilDinero.handleButton(null, i);
            return i;
        };
        const sinEfectivo = await pulsar();
        expect(sinEfectivo.reply.mock.calls[0][0].content).toMatch(/te faltan \*\*600\*\* 🪙 de efectivo/);
        dinero.sacar("pr-c", 1500);
        const devuelto = await pulsar();
        expect(devuelto.update.mock.calls[0][0].embeds[0].data.description).toMatch(
            /^🧙 Has devuelto el préstamo del Duende: \*\*1\.?100\*\* 🪙\./,
        );
        expect(prestamos.abierto("pr-c")).toBeNull();
        expect(efectivo("pr-c")).toBe(900);
        expect(historial("pr-c").at(-1)).toEqual({ descripcion: "Devolución del préstamo del Duende", cantidad: -1100, tipo: "prestamo" });
    });

    test("al vencer se cobra solo (efectivo y luego banco); lo que falta queda como deuda y se cobra de lo que gane", async () => {
        prestamos.aceptar("pr-d", 1000, G, Date.now() - 8 * DIA); // venció ayer: debe 1.100
        dinero.cobrar("pr-d", 1500); // le quedan 500 de efectivo...
        dinero.ingresar("pr-d", 200); // ...300 en efectivo y 200 en el banco
        const dm = jest.fn(async () => {});
        const client = { users: { fetch: jest.fn(async () => ({ send: dm })) } };
        expect(await botones.revisarPrestamos(client)).toBe(1);
        expect(client.users.fetch).toHaveBeenCalledWith("pr-d");
        expect(dm.mock.calls[0][0]).toMatch(/te he cobrado \*\*500\*\* 🪙 y aún debes \*\*600\*\* 🪙/);
        expect(dinero.cuenta("pr-d")).toMatchObject({ efectivo: 0, banco: 0 });
        expect(historial("pr-d").slice(-2)).toEqual([
            { descripcion: "Cobro del préstamo vencido del Duende (del efectivo)", cantidad: -300, tipo: "prestamo" },
            { descripcion: "Cobro del préstamo vencido del Duende (del banco)", cantidad: -200, tipo: "prestamo" },
        ]);
        expect(prestamos.abierto("pr-d")).toMatchObject({ estado: "deuda", falta: 600 });
        expect(DUENDE_TOOL_EXECUTORS.consultar_saldo({}, { userId: "pr-d" }).prestamo_del_duende).toMatchObject({
            le_falta_devolver: 600,
            vencido_y_en_deuda: true,
        });

        // Con deuda: ni otro préstamo ni jugar contra el Duende.
        expect(prestamos.aceptar("pr-d", 50).mensaje).toMatch(/Debes \*\*600\*\* 🪙 de un préstamo vencido/);
        expect(retos.crearContraDuende({ userId: "pr-d", cantidad: 10 }).mensaje).toMatch(/Debes \*\*600\*\* 🪙 al Duende/);

        // Lo que gana, después de su impuesto (el 5 % por defecto), va primero a la deuda.
        dinero.pagarConImpuesto("pr-d", G, "premio", "Premio de prueba", 400);
        expect(efectivo("pr-d")).toBe(0);
        expect(historial("pr-d").slice(-2)).toEqual([
            { descripcion: "Impuesto sobre 🏆 Premios", cantidad: -20, tipo: "impuesto" },
            { descripcion: "Cobro de la deuda con el Duende", cantidad: -380, tipo: "prestamo" },
        ]);
        expect(prestamos.abierto("pr-d")).toMatchObject({ estado: "deuda", falta: 220 });
        dinero.pagarConImpuesto("pr-d", G, "premio", "Otro premio", 500); // 475 netos: 220 a la deuda
        expect(efectivo("pr-d")).toBe(255);
        expect(prestamos.abierto("pr-d")).toBeNull();
        // Ya saldada, lo siguiente que gana es suyo (menos el impuesto).
        dinero.pagarConImpuesto("pr-d", G, "premio", "Y otro", 100);
        expect(efectivo("pr-d")).toBe(350);
    });

    test("si al vencer le llega para todo, queda devuelto", async () => {
        prestamos.aceptar("pr-e", 100, G, Date.now() - 8 * DIA);
        const dm = jest.fn(async () => {});
        await botones.revisarPrestamos({ users: { fetch: async () => ({ send: dm }) } });
        expect(dm.mock.calls[0][0]).toMatch(/te he cobrado los \*\*110\*\* 🪙 que faltaban/);
        expect(prestamos.abierto("pr-e")).toBeNull();
        expect(efectivo("pr-e")).toBe(990);
    });
});

describe("🧙 el Duende lo propone desde el chat", () => {
    const texto = (t) => ({
        text: t,
        functionCalls: undefined,
        candidates: [{ finishReason: "STOP", content: { role: "model", parts: [{ text: t }] } }],
    });
    const llamadaHerramienta = (name, args) => ({
        text: undefined,
        functionCalls: [{ name, args }],
        candidates: [{ finishReason: "STOP", content: { role: "model", parts: [{ functionCall: { name, args } }] } }],
    });
    function charla(textoUsuario, user, extra = {}) {
        const enviados = [];
        return {
            enviados,
            id: "msg-x",
            user,
            guildId: G,
            guild: undefined,
            member: { permissions: { has: () => false } },
            channel: { id: "canal-eco", send: async (c) => enviados.push(c) },
            deferReply: jest.fn(async () => {}),
            editReply: async (p) => enviados.push(typeof p === "string" ? p : p.content),
            followUp: async (p) => enviados.push(p),
            options: { getSubcommand: () => "talk", getString: (n) => (n === "texto" ? textoUsuario : null), getUser: () => null },
            ...extra,
        };
    }
    const herramientasOfrecidas = (n = 0) => mockPeticiones[n].config.tools[0].functionDeclarations.map((d) => d.name);

    test("la herramienta deja la propuesta y sale con botones debajo de la respuesta; sin aceptar no se mueve nada", async () => {
        mockRespuestas.push(llamadaHerramienta("retar_piedra_papel_tijera", { cantidad: 200 }), texto("Venga, a ver si tienes narices."));
        const i = charla("te reto a piedra papel tijera por 200", { id: "ch-a", username: "ana" });
        await duende.run(null, i);
        expect(herramientasOfrecidas()).toEqual(
            expect.arrayContaining(["retar_piedra_papel_tijera", "apostar_partido_con_duende", "ofrecer_prestamo"]),
        );
        expect(mockPeticiones[1].contents.at(-1).parts[0].functionResponse.response).toMatchObject({ propuesta_enviada: true });
        expect(i.enviados[0]).toBe("Venga, a ver si tienes narices.");
        const propuesta = i.enviados[1];
        expect(propuesta.embeds[0].data.title).toBe("🧙 El Duende te reta a 🪨 Piedra, papel o tijera");
        expect(ids(propuesta)).toEqual([
            expect.stringMatching(/^duende_acepto_ppt_ch-a_200_[0-9a-z]+$/),
            expect.stringMatching(/^duende_no_/),
        ]);
        expect(efectivo("ch-a")).toBe(1000);
    });

    test("por voz (/escuchar) no se ofrecen: no hay dónde pulsar", async () => {
        mockRespuestas.push(texto("Hola."));
        await duende.run(null, charla("hola", { id: "ch-v", username: "v" }, { silentTextReply: true }));
        expect(herramientasOfrecidas()).not.toContain("ofrecer_prestamo");
        expect(DUENDE_TOOL_EXECUTORS.ofrecer_prestamo({ cantidad: 100 }, { guildId: G, userId: "ch-v" }).error).toMatch(/chat de texto/);
    });

    test("las herramientas comprueban antes de proponer: cantidad y partido", () => {
        const ctx = { guildId: G, userId: "ch-b", propuestas: [] };
        expect(DUENDE_TOOL_EXECUTORS.ofrecer_prestamo({ cantidad: 5000 }, ctx).error).toMatch(/entre 10 y 1\.?000/);
        expect(DUENDE_TOOL_EXECUTORS.retar_piedra_papel_tijera({ cantidad: 2000 }, ctx).error).toMatch(/entre 10 y 1\.?000/);
        const sinPartido = DUENDE_TOOL_EXECUTORS.apostar_partido_con_duende({ equipo: "Osasuna", cantidad: 100 }, ctx);
        expect(sinPartido.error).toMatch(/No encuentro ese partido/);
        expect(sinPartido.proximos_partidos).toEqual(expect.arrayContaining([expect.stringMatching(/^Real Madrid vs Real Sociedad/)]));
        expect(DUENDE_TOOL_EXECUTORS.apostar_partido_con_duende({ equipo: "Real Madrid", cantidad: 100 }, ctx)).toMatchObject({
            propuesta_enviada: true,
        });
        expect(ctx.propuestas).toEqual([{ tipo: "partido", cantidad: 100, matchId: "pdp-3", eleccion: "home", userId: "ch-b" }]);
        expect(propuestas.mensajePropuesta(ctx.propuestas[0]).embeds[0].data.description).toMatch(
            /<@ch-b> apuesta \*\*100\*\* 🪙 a que \*\*gana Real Madrid\*\*[\s\S]*🧙 El Duende va con lo contrario: \*\*empate o gana Real Sociedad\*\*/,
        );
    });
});

describe("🧙 los botones de la propuesta", () => {
    const pulsar = async (customId, userId, messageId = "m-1") => {
        const i = {
            customId,
            user: { id: userId, tag: userId },
            guildId: G,
            channelId: "canal-eco",
            message: { id: messageId },
            reply: jest.fn(async () => {}),
            update: jest.fn(async () => {}),
        };
        await botones.handleButton(null, i);
        return i;
    };

    test("la propuesta va entera en el id del botón, que cabe en los 100 caracteres de Discord", () => {
        const p = {
            tipo: "partido",
            userId: "1234567890123456789",
            cantidad: 1000,
            matchId: "e1f3c9a0b2d4f6a8c0e2a4b6d8f0a2c4",
            eleccion: "away",
            caduca: 1_800_000_000_000,
        };
        const id = propuestas.idBoton("acepto", p);
        expect(id.length).toBeLessThanOrEqual(100);
        expect(propuestas.leerPropuesta(id)).toEqual({ accion: "acepto", ...p });
        expect(propuestas.leerPropuesta("duende_acepto_partido_1_10_abc")).toBeNull();
    });

    test("solo la persona a la que se lo propuso; ❌ lo cierra sin mover dinero; caducada no vale", async () => {
        const [acepto, no] = ids(propuestas.mensajePropuesta({ tipo: "ppt", userId: "bt-a", cantidad: 100 }));
        expect((await pulsar(acepto, "bt-z")).reply.mock.calls[0][0].content).toMatch(/^⛔/);
        expect((await pulsar(no, "bt-a")).update.mock.calls[0][0].embeds[0].data.description).toBe(
            "❌ <@bt-a> ha dicho que no. No se ha movido dinero.",
        );
        const vieja = propuestas.mensajePropuesta({ tipo: "ppt", userId: "bt-a", cantidad: 100 }, Date.now() - propuestas.CADUCA_MS - 1000);
        expect((await pulsar(ids(vieja)[0], "bt-a")).update.mock.calls[0][0].embeds[0].data.description).toMatch(/^⌛/);
        expect(efectivo("bt-a")).toBe(1000);
    });

    test("✅ en un reto: se crea, la propuesta pasa a ser el mensaje del reto y se juega con sus botones; dos clics no crean dos", async () => {
        retos.__test.setRng(secuencia(0.9)); // el Duende: tijera
        const [acepto] = ids(propuestas.mensajePropuesta({ tipo: "ppt", userId: "bt-b", cantidad: 150 }));
        const payload = (await pulsar(acepto, "bt-b", "m-ppt")).update.mock.calls[0][0];
        expect(payload.embeds[0].data.title).toBe("⚔️ Duelo de 🪨 Piedra, papel o tijera");
        const retoId = Number(ids(payload)[0].split("_").at(-1));
        expect(retos.obtener(retoId)).toMatchObject({ messageId: "m-ppt", channelId: "canal-eco", estado: "en_juego" });
        expect(efectivo("bt-b")).toBe(850);
        expect((await pulsar(acepto, "bt-b", "m-ppt")).reply.mock.calls[0][0].content).toMatch(/ya está aceptada/);
        expect(efectivo("bt-b")).toBe(850);

        // Se juega con el botón del reto, como cualquier duelo: piedra gana a tijera.
        const jugada = {
            customId: `retos_ppt_piedra_${retoId}`,
            user: { id: "bt-b" },
            reply: jest.fn(),
            update: jest.fn(async () => {}),
            followUp: jest.fn(),
        };
        await botonesRetos.handleButton(null, jugada);
        expect(jugada.update.mock.calls[0][0].embeds[0].data.description).toMatch(/🏆 Gana <@bt-b> y se lleva \*\*300\*\* 🪙/);
        expect(efectivo("bt-b")).toBe(1135); // 300 menos el 5 % de impuesto del servidor
    });

    test("✅ en un préstamo: se hace y la propuesta pasa a ser su resumen; un segundo clic no da otro", async () => {
        const [acepto] = ids(propuestas.mensajePropuesta({ tipo: "prestamo", userId: "bt-c", cantidad: 300 }));
        const embed = (await pulsar(acepto, "bt-c")).update.mock.calls[0][0].embeds[0].data;
        expect(embed.title).toBe("🧙 Préstamo del Duende: 300 🪙");
        expect(embed.description).toMatch(/Devuelve \*\*330\*\* 🪙 antes del <t:\d+:f>/);
        expect(efectivo("bt-c")).toBe(1300);
        expect((await pulsar(acepto, "bt-c")).reply.mock.calls[0][0].content).toMatch(/Ya tienes un préstamo/);
        expect(efectivo("bt-c")).toBe(1300);
    });
});
