// 🧾 Quiniela, fase 4: rellenar con los favoritos (#366), el borrador que sobrevive a un reinicio (#384), el recordatorio de la quiniela
// sin enviar (#340) y la liga por competición (#380). BD en memoria; la API de cuotas se simula.
const db = require("../src/core/db");
const dinero = require("../src/systems/dinero");
const guildSettings = require("../src/systems/guildSettings");
const reglas = require("../src/systems/apuestas/quinielaReglas");
const borradores = require("../src/systems/apuestas/borradorQuiniela");
const recordatorios = require("../src/systems/apuestas/recordatorios");
const liga = require("../src/systems/apuestas/liga");
const quiniela = require("../src/juegos/apuestas/quiniela");
const editor = require("../src/juegos/apuestas/quiniela/editor");
const { pantallaLiga } = require("../src/paneles/liga");

jest.mock("../src/services/oddsApi", () => ({
    ...jest.requireActual("../src/services/oddsApi"),
    sincronizarPartidos: jest.fn(async () => []),
}));

const G = "g-quiniela-fase4";
const HORA = 3600_000;
let n = 0;
const persona = (efectivo = 100000) => {
    const id = `qs-${++n}`;
    dinero.asegurarCuenta(id);
    db.prepare("UPDATE banco SET enMano = ? WHERE userId = ?").run(efectivo, id);
    return id;
};
/** Una quiniela abierta con `cuotas.length` partidos que empiezan en `horasHasta` horas (y de hora en hora los demás). */
function nuevaQuiniela({ deporte = "laliga", horasHasta = 48, cuotas = [[2, 3, 4]], jornada = `Jornada ${++n}` } = {}) {
    const id = db
        .prepare("INSERT INTO quinielas (deporte, jornada, estado, creada_en) VALUES (?, ?, 'abierta', ?)")
        .run(deporte, jornada, new Date().toISOString()).lastInsertRowid;
    cuotas.forEach(([h, d, a], i) => {
        const matchId = `qs-m${++n}`;
        const inicio = new Date(Date.now() + (horasHasta + i) * HORA).toISOString();
        db.prepare(
            "INSERT INTO apuestas_partidos (match_id, home_team, away_team, start_time, estado, deporte, cuota_home, cuota_draw, cuota_away) VALUES (?, ?, ?, ?, 'abierto', ?, ?, ?, ?)",
        ).run(matchId, `L${i}`, `V${i}`, inicio, deporte, h, d, a);
        db.prepare(
            "INSERT INTO quiniela_partidos (quiniela_id, match_id, orden, home_team, away_team, start_time) VALUES (?, ?, ?, ?, ?, ?)",
        ).run(id, matchId, i + 1, `L${i}`, `V${i}`, inicio);
    });
    return Number(id);
}
const interaccion = (userId, customId, extra = {}) => ({
    customId,
    guildId: G,
    user: { id: userId, username: userId, tag: userId },
    reply: jest.fn(async () => {}),
    update: jest.fn(async () => {}),
    showModal: jest.fn(async () => {}),
    ...extra,
});
const pulsar = async (userId, customId) => {
    const i = interaccion(userId, customId);
    await quiniela.handleButton(null, i);
    return i;
};
const cadena = (i) => /Cadena: `([^`]*)`/.exec(i.update.mock.calls.at(-1)[0].embeds[0].data.description)[1];

afterEach(() => {
    editor.sesionesQuiniela.clear();
});

describe("rellenar con los favoritos (#366)", () => {
    const partido = (h, d, a, horas = 48) => ({
        cuota_home: h,
        cuota_draw: d,
        cuota_away: a,
        start_time: new Date(Date.now() + horas * HORA).toISOString(),
    });

    test("el favorito es la cuota más baja; el empate solo si es la menor sin empatar", () => {
        expect(reglas.favorito({ cuota_home: 1.5, cuota_draw: 4, cuota_away: 6 })).toBe("1");
        expect(reglas.favorito({ cuota_home: 5, cuota_draw: 4, cuota_away: 1.8 })).toBe("2");
        expect(reglas.favorito({ cuota_home: 3, cuota_draw: 2.5, cuota_away: 3 })).toBe("X");
        expect(reglas.favorito({ cuota_home: 2.5, cuota_draw: 2.5, cuota_away: 3 })).toBe("1"); // empate de cuotas: el local, no la X
        expect(reglas.favorito({ cuota_home: 2.5, cuota_draw: 3, cuota_away: 2.5 })).toBe("1");
        expect(reglas.favorito({ cuota_home: null, cuota_draw: 3, cuota_away: 2 })).toBe("2");
        expect(reglas.favorito({})).toBeNull();
    });

    test("rellena solo los que no tienen pronóstico, y deja los que ya se eligieron", () => {
        const partidos = [partido(1.5, 4, 6), partido(5, 4, 1.8), partido(3, 2.5, 3), partido(1.5, 4, 6)];
        const r = reglas.sugerirPronosticos(partidos, ["2", null, null, "X"]);
        expect(r).toEqual({ pronosticos: ["2", "2", "X", "X"], rellenados: 2 });
    });

    test("no toca los partidos ya bloqueados por tiempo ni los que no tienen cuotas", () => {
        const partidos = [partido(1.5, 4, 6, 0.05), partido(null, null, null), partido(1.5, 4, 6)];
        const r = reglas.sugerirPronosticos(partidos, [null, null, null]);
        expect(r).toEqual({ pronosticos: [null, null, "1"], rellenados: 1 });
    });

    test("el botón rellena el editor, guarda el borrador y se puede cambiar cualquiera después", async () => {
        const u = persona();
        const id = nuevaQuiniela({
            cuotas: [
                [1.5, 4, 6],
                [5, 4, 1.8],
                [3, 2.5, 3],
            ],
        });
        await pulsar(u, `quiniela_apostar_${id}`);
        await pulsar(u, `quiniela_pick_${id}_2`); // el primero lo elige él: 2 (contra el favorito)
        const i = await pulsar(u, `quiniela_sugerir_${id}`);
        expect(cadena(i)).toBe("22X"); // el primero no cambia; el segundo y el tercero, con su favorito
        expect(i.update.mock.calls.at(-1)[0].components[1].components.map((b) => b.data.custom_id)).toContain(`quiniela_sugerir_${id}`);
        expect(borradores.cargar(u, id, 3)).toEqual(["2", "2", "X"]);
        const limpia = await pulsar(u, `quiniela_clear_${id}`); // «limpiar» quita el del partido actual (el segundo)
        expect(cadena(limpia)).toBe("2-X");
        const cambia = await pulsar(u, `quiniela_pick_${id}_1`);
        expect(cadena(cambia)).toBe("21X");
    });

    test("sin nada que rellenar, lo dice en privado", async () => {
        const u = persona();
        const id = nuevaQuiniela({
            cuotas: [
                [null, null, null],
                [null, null, null],
            ],
        });
        await pulsar(u, `quiniela_apostar_${id}`);
        const i = await pulsar(u, `quiniela_sugerir_${id}`);
        expect(i.reply.mock.calls[0][0].content).toMatch(/No hay partidos sin pronóstico a los que sugerir/);
        expect(i.update).not.toHaveBeenCalled();
    });
});

describe("borrador de la quiniela (#384)", () => {
    test("se guarda en la base de datos al elegir y se recupera tras un reinicio, aunque se use un botón del editor viejo", async () => {
        const u = persona();
        const id = nuevaQuiniela({
            cuotas: [
                [2, 3, 4],
                [2, 3, 4],
                [2, 3, 4],
            ],
        });
        await pulsar(u, `quiniela_apostar_${id}`);
        await pulsar(u, `quiniela_pick_${id}_1`);
        await pulsar(u, `quiniela_pick_${id}_X`);
        expect(borradores.cargar(u, id, 3)).toEqual(["1", "X", null]);

        // Un reinicio: se pierde la memoria, no la base de datos.
        editor.sesionesQuiniela.clear();
        const viejo = await pulsar(u, `quiniela_pick_${id}_2`);
        expect(viejo.reply).not.toHaveBeenCalled();
        expect(cadena(viejo)).toBe("1X2");
        expect(borradores.cargar(u, id, 3)).toEqual(["1", "X", "2"]);
    });

    test("al volver a abrir la quiniela, el editor enseña lo elegido y avisa de que se ha recuperado", async () => {
        const u = persona();
        const id = nuevaQuiniela({
            cuotas: [
                [2, 3, 4],
                [2, 3, 4],
                [2, 3, 4],
            ],
        });
        borradores.guardar(u, id, ["2", null, "1"]);
        const i = interaccion(u, `quiniela_apostar_${id}`);
        await quiniela.handleButton(null, i);
        const embed = i.reply.mock.calls[0][0].embeds[0].data;
        expect(embed.description).toMatch(/📝 Se ha recuperado tu borrador/);
        expect(embed.description).toMatch(/Cadena: `2-1`/);
        expect(embed.description).toMatch(/▶ 2\. L1 vs V1/); // empieza en el primer partido sin pronóstico
        // En cuanto elige algo, el aviso ya no sale.
        const siguiente = await pulsar(u, `quiniela_pick_${id}_X`);
        expect(siguiente.update.mock.calls[0][0].embeds[0].data.description).not.toMatch(/recuperado/);
    });

    test("hay un solo borrador por persona y quiniela; el nuevo sustituye al anterior, y sin pronósticos no queda ninguno", () => {
        const u = persona();
        const id = nuevaQuiniela({
            cuotas: [
                [2, 3, 4],
                [2, 3, 4],
            ],
        });
        borradores.guardar(u, id, ["1", null]);
        borradores.guardar(u, id, [null, "2"]);
        expect(db.prepare("SELECT COUNT(*) AS n FROM quiniela_borrador WHERE userId = ? AND quinielaId = ?").get(u, id).n).toBe(1);
        expect(borradores.cargar(u, id, 2)).toEqual([null, "2"]);
        borradores.guardar(u, id, [null, null]);
        expect(borradores.cargar(u, id, 2)).toBeNull();
    });

    test("un borrador que ya no encaja (otro número de partidos o letras raras) no se carga", () => {
        const u = persona();
        const id = nuevaQuiniela({
            cuotas: [
                [2, 3, 4],
                [2, 3, 4],
            ],
        });
        borradores.guardar(u, id, ["1", "X", "2"]);
        expect(borradores.cargar(u, id, 2)).toBeNull();
        db.prepare("UPDATE quiniela_borrador SET pronosticos = '1Z' WHERE userId = ?").run(u);
        expect(borradores.cargar(u, id, 2)).toBeNull();
    });

    test("se borra al apostar, al cancelar y cuando la quiniela se cierra", async () => {
        const id = nuevaQuiniela({
            cuotas: [
                [2, 3, 4],
                [2, 3, 4],
            ],
        });
        const apuesta = persona();
        await pulsar(apuesta, `quiniela_apostar_${id}`);
        await pulsar(apuesta, `quiniela_pick_${id}_1`);
        await pulsar(apuesta, `quiniela_pick_${id}_2`);
        const modal = interaccion(apuesta, `quiniela_modal_confirmar_${id}`, {
            fields: { getTextInputValue: () => "100", getStringSelectValues: () => null },
        });
        await quiniela.handleModal(null, modal);
        expect(db.prepare("SELECT COUNT(*) AS n FROM quiniela_apuestas WHERE user_id = ?").get(apuesta).n).toBe(1);
        expect(borradores.cargar(apuesta, id, 2)).toBeNull();

        const cancela = persona();
        await pulsar(cancela, `quiniela_apostar_${id}`);
        await pulsar(cancela, `quiniela_pick_${id}_X`);
        expect(borradores.cargar(cancela, id, 2)).not.toBeNull();
        await pulsar(cancela, `quiniela_cancelar_${id}`);
        expect(borradores.cargar(cancela, id, 2)).toBeNull();

        const queda = persona();
        borradores.guardar(queda, id, ["1", null]);
        borradores.borrarDeQuiniela(id); // lo que hacen la liquidación y la caducidad al cerrarla
        expect(borradores.cargar(queda, id, 2)).toBeNull();
    });
});

describe("recordatorio de la quiniela sin enviar (#340)", () => {
    const cliente = () => {
        const enviados = [];
        const usuario = (id) => ({ send: jest.fn(async (p) => enviados.push([id, p.content])) });
        return {
            enviados,
            guilds: { cache: new Map([[G, { id: G }]]) },
            users: { fetch: async (id) => usuario(id) },
        };
    };
    /** Alguien que ya juega quinielas: una apuesta en otra quiniela. */
    function jugador() {
        const u = persona();
        const otra = nuevaQuiniela({ deporte: "premier", horasHasta: 400 });
        db.prepare(
            "INSERT INTO quiniela_apuestas (quiniela_id, user_id, predicciones, cantidad, creada_en) VALUES (?, ?, '1', 10, 'x')",
        ).run(otra, u);
        return u;
    }
    beforeEach(() => {
        db.prepare("UPDATE quinielas SET estado = 'cerrada', cerrada_en = ? WHERE estado = 'abierta'").run(new Date().toISOString()); // solo las de este test
        guildSettings.setManySettings(G, { "apuestas.recordatorio": true, "apuestas.recordatorio_quiniela_horas": 3 });
        db.prepare("DELETE FROM quiniela_recordadas").run();
    });

    test("avisa unas horas antes del cierre a quien juega quinielas y no la ha enviado, una sola vez", async () => {
        const u = jugador();
        const id = nuevaQuiniela({ horasHasta: 2 }); // se cierra a la hora y tres cuartos: dentro de las 3 h
        const c = cliente();
        expect(await recordatorios.enviarRecordatorios(c)).toBeGreaterThanOrEqual(1);
        const suyo = c.enviados.find(([id2]) => id2 === u);
        expect(suyo[1]).toMatch(/Te falta enviar la quiniela Jornada \d+/);
        expect(suyo[1]).toMatch(/se cierra <t:\d+:R>/);
        expect(db.prepare("SELECT COUNT(*) AS n FROM quiniela_recordadas WHERE quinielaId = ? AND userId = ?").get(id, u).n).toBe(1);
        // Segunda pasada: nada nuevo.
        const otra = cliente();
        await recordatorios.enviarRecordatorios(otra);
        expect(otra.enviados.find(([id2]) => id2 === u)).toBeUndefined();
    });

    test("no avisa antes de la ventana, ni después del bloqueo, ni a quien ya la envió o no suele jugar", async () => {
        const jugadorA = jugador();
        const yaEnvio = jugador();
        const novato = persona();
        const lejos = nuevaQuiniela({ horasHasta: 30 });
        const cerrada = nuevaQuiniela({ horasHasta: 0.1 }); // ya dentro de los últimos 15 min: bloqueada
        expect(recordatorios.quinielasPorCerrar(3).map((q) => q.id)).not.toEqual(expect.arrayContaining([lejos, cerrada]));
        const c = cliente();
        await recordatorios.enviarRecordatorios(c);
        expect(c.enviados).toEqual([]);

        const cerca = nuevaQuiniela({ horasHasta: 2 });
        db.prepare(
            "INSERT INTO quiniela_apuestas (quiniela_id, user_id, predicciones, cantidad, creada_en) VALUES (?, ?, '1', 10, 'x')",
        ).run(cerca, yaEnvio);
        const d = cliente();
        await recordatorios.enviarRecordatorios(d);
        const destinatarios = d.enviados.map(([id2]) => id2);
        expect(destinatarios).toContain(jugadorA);
        expect(destinatarios).not.toContain(yaEnvio);
        expect(destinatarios).not.toContain(novato);
    });

    test("cuenta con el borrador: quien tiene uno a medias lo recibe con su progreso, aunque no haya jugado antes", async () => {
        const u = persona();
        const id = nuevaQuiniela({
            horasHasta: 2,
            cuotas: [
                [2, 3, 4],
                [2, 3, 4],
                [2, 3, 4],
                [2, 3, 4],
            ],
        });
        borradores.guardar(u, id, ["1", "X", null, null]);
        const c = cliente();
        await recordatorios.enviarRecordatorios(c);
        const suyo = c.enviados.find(([id2]) => id2 === u);
        expect(suyo[1]).toMatch(/📝 Tienes un borrador a medias: 2 de 4 pronósticos/);
    });

    test("se configura en horas (0 = no avisar) y el aviso se puede apagar en /avisos", async () => {
        const u = jugador();
        nuevaQuiniela({ horasHasta: 2 });
        guildSettings.setSetting(G, "apuestas.recordatorio_quiniela_horas", 0);
        const apagado = cliente();
        await recordatorios.enviarRecordatorios(apagado);
        expect(apagado.enviados).toEqual([]);

        guildSettings.setSetting(G, "apuestas.recordatorio_quiniela_horas", 3);
        require("../src/systems/avisosDm").fijar(u, "quiniela_recordatorio", false);
        const sin = cliente();
        await recordatorios.enviarRecordatorios(sin);
        expect(sin.enviados.find(([id2]) => id2 === u)).toBeUndefined();
    });
});

describe("liga por competición (#380)", () => {
    const OCT_2026 = Date.UTC(2026, 9, 14, 12);
    function cerrada(deporte, userId, aciertos, cerradaEn = "2026-10-05T10:00:00.000Z") {
        const q = db
            .prepare("INSERT INTO quinielas (deporte, jornada, estado, creada_en, cerrada_en) VALUES (?, ?, 'cerrada', '2026-10-01', ?)")
            .run(deporte, `J${++n}`, cerradaEn).lastInsertRowid;
        db.prepare(
            "INSERT INTO quiniela_apuestas (quiniela_id, user_id, predicciones, cantidad, aciertos, premio, pagado, creada_en) VALUES (?, ?, '1', 10, ?, 0, 1, 'x')",
        ).run(q, userId, aciertos);
    }
    beforeAll(() => db.prepare("DELETE FROM quiniela_apuestas").run());

    test("el filtro cuenta solo las quinielas de esa competición, con el mismo desempate; la general no cambia", () => {
        const [a, b, c] = [persona(), persona(), persona()];
        cerrada("laliga", a, 7);
        cerrada("laliga", b, 6);
        cerrada("premier", b, 5);
        cerrada("premier", c, 4);
        cerrada("premier", c, 4);
        const general = liga.clasificacion("2026-27", 10).map((r) => [r.userId, r.puntos, r.quinielas]);
        expect(general).toEqual([
            [b, 11, 2],
            [c, 8, 2],
            [a, 7, 1],
        ]);
        expect(liga.clasificacion("2026-27", 10, "laliga").map((r) => [r.userId, r.puntos])).toEqual([
            [a, 7],
            [b, 6],
        ]);
        expect(liga.clasificacion("2026-27", 10, "premier").map((r) => [r.userId, r.puntos])).toEqual([
            [c, 8],
            [b, 5],
        ]);
        expect(liga.clasificacion("2026-27", 10, "champions")).toEqual([]);
        expect(liga.clasificacion("2026-27", 10).map((r) => [r.userId, r.puntos, r.quinielas])).toEqual(general);
    });

    test("el panel tiene un menú de competiciones, y al elegir una enseña su clasificación y tu posición en ella", () => {
        const [a, b] = [persona(), persona()];
        cerrada("champions", a, 3);
        cerrada("champions", b, 5);
        const general = pantallaLiga(G, a, OCT_2026);
        const menu = general.components[0].components[0];
        expect(menu.data.custom_id).toBe("liga_competicion");
        expect(menu.options[0].data).toMatchObject({ value: "general", default: true });
        expect(menu.options.map((o) => o.data.value)).toEqual(expect.arrayContaining(["laliga", "premier", "champions"]));

        const champions = pantallaLiga(G, a, OCT_2026, "champions");
        const embed = champions.embeds[0].data;
        expect(embed.title).toBe("🏅 Liga de pronósticos · 2026-27 · Champions League 🏆");
        expect(embed.description).toMatch(
            /Es solo informativo: los premios de fin de temporada se reparten con la clasificación \*\*general\*\*/,
        );
        const campos = Object.fromEntries(embed.fields.map((f) => [f.name, f.value]));
        expect(campos["📊 Clasificación"]).toMatch(new RegExp(`1\\. <@${b}> · \\*\\*5\\*\\* puntos`));
        expect(campos["📍 Tu posición"]).toBe("2.º con **3** puntos");
        expect(campos["🏆 Temporadas anteriores"]).toBeUndefined();
        expect(champions.components[0].components[0].options.find((o) => o.data.default).data.value).toBe("champions");
        expect(pantallaLiga(G, a, OCT_2026, "inventada").embeds[0].data.title).toBe(general.embeds[0].data.title);
    });

    test("una competición sin puntos lo dice, y el menú de /juegos la lleva a la liga de esa competición", async () => {
        const vacia = pantallaLiga(G, persona(), OCT_2026, "mundial");
        expect(vacia.embeds[0].data.fields[0].value).toBe("Nadie ha sumado puntos en esta competición todavía.");
        const apuestasCmd = require("../src/juegos/apuestas/apuestas");
        const i = interaccion("x", "liga_competicion", { values: ["premier"] });
        await apuestasCmd.handleLiga(null, i);
        expect(i.update.mock.calls[0][0].embeds[0].data.title).toMatch(/Premier League/);
        const general = interaccion("x", "liga_competicion", { values: ["general"] });
        await apuestasCmd.handleLiga(null, general);
        expect(general.update.mock.calls[0][0].embeds[0].data.title).not.toMatch(/Premier/);
    });
});
