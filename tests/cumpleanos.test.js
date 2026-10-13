// #427: cumpleaños. /cumpleaños guarda día y mes (sin año; una fecha que no existe se rechaza), el cron felicita una sola vez el
// día en el canal de avisos con mención, y `ver` lista los cinco próximos. El día de calendario es el de Madrid.
const db = require("../src/core/db");
const guildSettings = require("../src/systems/guildSettings");
const cumpleanos = require("../src/systems/cumpleanos");
const comando = require("../src/commands/general/cumpleanos");
const { momentoMadrid } = require("../src/core/zonaMadrid");

const G = "g-cumple";
// 14 de octubre de 2026 a las 10:00 en Madrid (UTC+2).
const HOY_10H = Date.parse("2026-10-14T08:00:00Z");
const hoy = momentoMadrid(HOY_10H);

beforeEach(() => {
    db.prepare("DELETE FROM cumpleanos").run();
    db.prepare("DELETE FROM cumpleanos_felicitados").run();
    guildSettings.setSetting(G, "avisos.cumple_channel_id", "");
});

describe("la fecha", () => {
    test("solo valen días que existen; el 29 de febrero vale porque no se guarda el año", () => {
        expect(cumpleanos.fechaValida(14, 10)).toBe(true);
        expect(cumpleanos.fechaValida(29, 2)).toBe(true);
        expect(cumpleanos.fechaValida(31, 12)).toBe(true);
        for (const [dia, mes] of [
            [30, 2],
            [31, 4],
            [31, 11],
            [0, 5],
            [15, 0],
            [15, 13],
            [1.5, 3],
            [NaN, 3],
        ]) {
            expect(cumpleanos.fechaValida(dia, mes)).toBe(false);
        }
    });

    test("guardar valida, reemplaza la fecha anterior y no toca otros servidores", () => {
        expect(cumpleanos.guardar("u1", G, 30, 2)).toMatchObject({ ok: false });
        expect(cumpleanos.de("u1", G)).toBeNull();
        expect(cumpleanos.guardar("u1", G, 14, 10)).toEqual({ ok: true });
        expect(cumpleanos.guardar("u1", G, 3, 5)).toEqual({ ok: true });
        expect(cumpleanos.de("u1", G)).toEqual({ dia: 3, mes: 5 });
        expect(cumpleanos.de("u1", "otro-servidor")).toBeNull();
        expect(cumpleanos.borrar("u1", G)).toBe(true);
        expect(cumpleanos.borrar("u1", G)).toBe(false);
    });

    test("el 29 de febrero se celebra el 28 en los años no bisiestos", () => {
        expect(cumpleanos.celebracion(29, 2, 2028)).toEqual({ dia: 29, mes: 2 });
        expect(cumpleanos.celebracion(29, 2, 2027)).toEqual({ dia: 28, mes: 2 });
        expect(cumpleanos.celebracion(29, 2, 2100)).toEqual({ dia: 28, mes: 2 });
        expect(cumpleanos.celebracion(29, 2, 2000)).toEqual({ dia: 29, mes: 2 });
        expect(cumpleanos.celebracion(14, 10, 2027)).toEqual({ dia: 14, mes: 10 });
    });
});

describe("próximos", () => {
    test("cuántos días faltan: hoy es 0, mañana 1 y uno que ya pasó este año, el año que viene", () => {
        expect(cumpleanos.diasHasta(14, 10, hoy)).toBe(0);
        expect(cumpleanos.diasHasta(15, 10, hoy)).toBe(1);
        expect(cumpleanos.diasHasta(13, 10, hoy)).toBe(364);
        expect(cumpleanos.diasHasta(1, 1, hoy)).toBe(79);
        // El 29 de febrero, desde octubre de 2026, es el 28 de febrero de 2027 (año no bisiesto).
        expect(cumpleanos.diasHasta(29, 2, hoy)).toBe(137);
        // Desde diciembre de 2027 el siguiente es el 29 de febrero de 2028 (bisiesto).
        expect(cumpleanos.diasHasta(29, 2, { anio: 2027, mes: 12, dia: 31 })).toBe(60);
    });

    test("los cinco más cercanos, ordenados, y solo del servidor", () => {
        const fechas = [
            ["a", 14, 10],
            ["b", 20, 10],
            ["c", 1, 11],
            ["d", 13, 10],
            ["e", 25, 12],
            ["f", 15, 10],
            ["g", 15, 10],
        ];
        for (const [u, d, m] of fechas) cumpleanos.guardar(u, G, d, m);
        cumpleanos.guardar("ajeno", "otro-servidor", 14, 10);
        const lista = cumpleanos.proximos(G, hoy, 5);
        expect(lista.map((p) => [p.userId, p.enDias])).toEqual([
            ["a", 0],
            ["f", 1],
            ["g", 1],
            ["b", 6],
            ["c", 18],
        ]);
        expect(cumpleanos.proximos(G, hoy, 50)).toHaveLength(7);
    });
});

describe("la felicitación automática", () => {
    function cliente({ falla = false, sinCanal = false } = {}) {
        const publicados = [];
        const canal = {
            id: "canal-cumple",
            send: async (payload) => {
                if (falla) throw new Error("Missing Permissions");
                publicados.push(payload);
            },
        };
        const guild = {
            id: G,
            name: "Servidor",
            channels: {
                cache: new Map(sinCanal ? [] : [["canal-cumple", canal]]),
                fetch: async () => {
                    if (sinCanal) throw new Error("Unknown Channel");
                    return canal;
                },
            },
        };
        return { publicados, client: { guilds: { cache: new Map([[G, guild]]) } } };
    }

    test("el día del cumpleaños publica una sola felicitación con mención, y el cron repetido no la duplica", async () => {
        guildSettings.setSetting(G, "avisos.cumple_channel_id", "canal-cumple");
        cumpleanos.guardar("cumple-1", G, 14, 10);
        cumpleanos.guardar("otro-dia", G, 15, 10);
        const c = cliente();
        expect(await cumpleanos.felicitarSiToca(c.client, HOY_10H)).toBe(1);
        expect(c.publicados).toHaveLength(1);
        expect(c.publicados[0].content).toContain("<@cumple-1>");
        expect(c.publicados[0].content).toContain("Feliz cumpleaños");
        expect(c.publicados[0].allowedMentions).toEqual({ users: ["cumple-1"] });
        expect(await cumpleanos.felicitarSiToca(c.client, HOY_10H + 3600 * 1000)).toBe(0);
        expect(await cumpleanos.felicitarSiToca(c.client, HOY_10H + 8 * 3600 * 1000)).toBe(0);
        expect(c.publicados).toHaveLength(1);
    });

    test("antes de las 9:00 de Madrid no se publica; después sí", async () => {
        guildSettings.setSetting(G, "avisos.cumple_channel_id", "canal-cumple");
        cumpleanos.guardar("cumple-2", G, 14, 10);
        const c = cliente();
        expect(await cumpleanos.felicitarSiToca(c.client, Date.parse("2026-10-14T06:00:00Z"))).toBe(0); // 08:00 en Madrid
        expect(await cumpleanos.felicitarSiToca(c.client, Date.parse("2026-10-14T07:00:00Z"))).toBe(1); // 09:00
    });

    test("sin canal configurado no hace nada ni falla, y si se configura ese mismo día, se felicita", async () => {
        cumpleanos.guardar("cumple-3", G, 14, 10);
        const c = cliente();
        await expect(cumpleanos.felicitarSiToca(c.client, HOY_10H)).resolves.toBe(0);
        expect(c.publicados).toEqual([]);
        guildSettings.setSetting(G, "avisos.cumple_channel_id", "canal-cumple");
        expect(await cumpleanos.felicitarSiToca(c.client, HOY_10H + 1000)).toBe(1);
    });

    test("si el canal no existe o el bot no puede escribir, queda en el log y se reintenta después", async () => {
        guildSettings.setSetting(G, "avisos.cumple_channel_id", "canal-cumple");
        cumpleanos.guardar("cumple-4", G, 14, 10);
        const roto = cliente({ sinCanal: true });
        await expect(cumpleanos.felicitarSiToca(roto.client, HOY_10H)).resolves.toBe(0);
        const sinPermiso = cliente({ falla: true });
        await expect(cumpleanos.felicitarSiToca(sinPermiso.client, HOY_10H)).resolves.toBe(0);
        const bien = cliente();
        expect(await cumpleanos.felicitarSiToca(bien.client, HOY_10H + 3600 * 1000)).toBe(1);
    });

    test("cada año se felicita de nuevo, y quien nace un 29 de febrero, el 28 los años no bisiestos y el 29 en los bisiestos", async () => {
        guildSettings.setSetting(G, "avisos.cumple_channel_id", "canal-cumple");
        cumpleanos.guardar("bisiesto", G, 29, 2);
        const c = cliente();
        const diez = (iso) => Date.parse(`${iso}T09:00:00Z`);
        expect(await cumpleanos.felicitarSiToca(c.client, diez("2027-02-28"))).toBe(1);
        expect(await cumpleanos.felicitarSiToca(c.client, diez("2027-03-01"))).toBe(0);
        expect(await cumpleanos.felicitarSiToca(c.client, diez("2028-02-28"))).toBe(0);
        expect(await cumpleanos.felicitarSiToca(c.client, diez("2028-02-29"))).toBe(1);
        expect(c.publicados).toHaveLength(2);
    });
});

describe("/cumpleaños", () => {
    const interaccion = (sub, valores = {}) => ({
        guildId: G,
        user: { id: "cmd-user" },
        options: { getSubcommand: () => sub, getInteger: (n) => valores[n] },
        reply: jest.fn(async () => {}),
    });
    const respuesta = (i) => i.reply.mock.calls[0][0];

    test("fecha guarda día y mes y responde en privado; una fecha que no existe se rechaza", async () => {
        const bien = interaccion("fecha", { dia: 14, mes: 10 });
        await comando.run(null, bien);
        expect(respuesta(bien).content).toContain("14 de octubre");
        expect(respuesta(bien).flags).toBeDefined();
        expect(cumpleanos.de("cmd-user", G)).toEqual({ dia: 14, mes: 10 });

        const mal = interaccion("fecha", { dia: 30, mes: 2 });
        await comando.run(null, mal);
        expect(respuesta(mal).content).toMatch(/no es una fecha que exista/);
        expect(cumpleanos.de("cmd-user", G)).toEqual({ dia: 14, mes: 10 }); // sigue la de antes
    });

    test("ver lista los próximos cinco sin mencionar a nadie, y borrar quita el propio", async () => {
        const vacio = interaccion("ver");
        await comando.run(null, vacio);
        expect(respuesta(vacio).content).toMatch(/Nadie ha guardado/);

        for (let i = 1; i <= 7; i++) cumpleanos.guardar(`v${i}`, G, i, 12);
        const ver = interaccion("ver");
        await comando.run(null, ver);
        expect(respuesta(ver).content.split("\n")).toHaveLength(6); // título + 5
        expect(respuesta(ver).allowedMentions).toEqual({ parse: [] });

        cumpleanos.guardar("cmd-user", G, 1, 1);
        const borrar = interaccion("borrar");
        await comando.run(null, borrar);
        expect(respuesta(borrar).content).toMatch(/borrado/);
        const otra = interaccion("borrar");
        await comando.run(null, otra);
        expect(respuesta(otra).content).toMatch(/No tenías/);
    });

    test("tiene los subcomandos fecha, ver y borrar", () => {
        expect(comando.data.toJSON().options.map((o) => o.name)).toEqual(["fecha", "ver", "borrar"]);
        expect(comando.data.name).toBe("cumpleaños");
    });
});
