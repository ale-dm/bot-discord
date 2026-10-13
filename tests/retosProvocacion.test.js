// #440: frase de provocación opcional al lanzar un reto. Sale en el mensaje público, se conserva al cambiar o resolverse el
// reto, no admite menciones masivas y, sin frase, el mensaje sale igual que antes.
process.env.ODDS_API_KEY = "clave-de-prueba";

const db = require("../src/core/db");
const dinero = require("../src/systems/dinero");
const retos = require("../src/systems/retos");
const paneles = require("../src/paneles/retos");
const botones = require("../src/juegos/retos/retos");

const descripcion = (reto) => paneles.mensajeReto(reto).embeds[0].toJSON().description;
let n = 0;
const par = () => [`prov-a-${++n}`, `prov-b-${n}`];

afterEach(() => retos.__test.setRng(null));

describe("crear con frase", () => {
    test("un duelo con frase la guarda y la enseña en cada estado, hasta resolverse", () => {
        const tiradas = [0.99, 0.99, 0, 0]; // creador 6+6, rival 1+1
        let k = 0;
        retos.__test.setRng(() => tiradas[k++ % tiradas.length]);
        const [a, b] = par();
        const { ok, reto } = retos.crearDuelo({
            creador: a,
            rival: b,
            juego: "dados",
            cantidad: 100,
            provocacion: "  te voy a dejar   sin monedas ",
        });
        expect(ok).toBe(true);
        expect(reto.provocacion).toBe("te voy a dejar sin monedas");
        expect(descripcion(reto)).toContain(`💬 <@${a}>: «te voy a dejar sin monedas»`);

        const resuelto = retos.aceptar(reto.id, b).reto;
        expect(resuelto.estado).toBe("resuelto");
        expect(resuelto.provocacion).toBe("te voy a dejar sin monedas");
        expect(descripcion(resuelto)).toContain("«te voy a dejar sin monedas»");
        expect(retos.obtener(reto.id).provocacion).toBe("te voy a dejar sin monedas");
    });

    test("un reto a un partido también lleva la frase", () => {
        const [a, b] = par();
        db.prepare(
            "INSERT OR IGNORE INTO apuestas_partidos (match_id, home_team, away_team, start_time, estado, deporte) VALUES ('prov-partido', 'Betis', 'Sevilla', ?, 'abierto', 'laliga')",
        ).run(new Date(Date.now() + 2 * 24 * 3600 * 1000).toISOString());
        const r = retos.crearPartido({
            creador: a,
            rival: b,
            matchId: "prov-partido",
            eleccion: "home",
            cantidad: 100,
            provocacion: "Betis campeón",
        });
        expect(r.ok).toBe(true);
        expect(descripcion(r.reto)).toContain("«Betis campeón»");
    });

    test("sin frase, el mensaje sale igual que antes", () => {
        const [a, b] = par();
        const sin = retos.crearDuelo({ creador: a, rival: b, juego: "ppt", cantidad: 100 }).reto;
        expect(sin.provocacion).toBeNull();
        expect(descripcion(sin)).not.toContain("💬");
        const vacia = retos.crearDuelo({ creador: a, rival: b, juego: "ppt", cantidad: 100, provocacion: "   \n " }).reto;
        expect(vacia.provocacion).toBeNull();
    });

    test("las menciones masivas y las frases largas se rechazan al crear, sin cobrar nada", () => {
        const [a, b] = par();
        const antes = dinero.efectivo(a);
        for (const frase of ["hola @everyone", "mirad @HERE", "x".repeat(retos.MAX_PROVOCACION + 1)]) {
            const r = retos.crearDuelo({ creador: a, rival: b, juego: "dados", cantidad: 100, provocacion: frase });
            expect(r.ok).toBe(false);
        }
        expect(
            retos.crearDuelo({ creador: a, rival: b, juego: "dados", cantidad: 100, provocacion: "x".repeat(retos.MAX_PROVOCACION) }).ok,
        ).toBe(true);
        expect(dinero.efectivo(a)).toBe(antes - 100);
    });
});

describe("el formulario", () => {
    test("lleva el campo opcional de la frase", () => {
        const modal = paneles.modalCantidad("retos_modal_d_dados_x", "Reto", 1000).toJSON();
        const campos = JSON.stringify(modal.components);
        expect(campos).toContain('"custom_id":"provocacion"');
        expect(campos).toContain(`"max_length":${retos.MAX_PROVOCACION}`);
    });

    test("al enviarlo, la frase llega al reto publicado", async () => {
        const [a, b] = par();
        const publicados = [];
        const i = {
            customId: `retos_modal_d_dados_${b}`,
            user: { id: a },
            guildId: "g",
            channelId: "c",
            fields: {
                getStringSelectValues: () => ["100"],
                getTextInputValue: (id) => (id === "provocacion" ? "a ver si te atreves" : ""),
            },
            update: async () => {},
            reply: async (x) => publicados.push(x),
            followUp: async (x) => {
                publicados.push(x);
                return { id: "m-prov", channelId: "c" };
            },
        };
        await botones.handleModal(null, i);
        const mensaje = publicados.at(-1);
        expect(mensaje.embeds[0].toJSON().description).toContain("«a ver si te atreves»");
    });

    test("con una mención masiva, el formulario responde con el error y no publica nada", async () => {
        const [a, b] = par();
        const respuestas = [];
        const i = {
            customId: `retos_modal_d_dados_${b}`,
            user: { id: a },
            guildId: "g",
            channelId: "c",
            fields: { getStringSelectValues: () => ["100"], getTextInputValue: (id) => (id === "provocacion" ? "@everyone" : "") },
            update: async () => respuestas.push("update"),
            reply: async (x) => respuestas.push(x.content),
            followUp: async () => respuestas.push("followUp"),
        };
        await botones.handleModal(null, i);
        expect(respuestas).toHaveLength(1);
        expect(respuestas[0]).toMatch(/mencionar a todo el mundo/);
    });
});
