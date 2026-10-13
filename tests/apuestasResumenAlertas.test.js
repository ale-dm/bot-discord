// ⚽ Apuestas, fase 4 (3): el resumen semanal por DM (#361) y las alertas de cuota (#345). BD en memoria; los DM y la API de cuotas se simulan.
const db = require("../src/core/db");
const dinero = require("../src/systems/dinero");
const avisosDm = require("../src/systems/avisosDm");
const resumen = require("../src/systems/apuestas/resumenSemanal");
const ranking = require("../src/systems/apuestas/ranking");
const alertas = require("../src/systems/apuestas/alertasCuota");
const oddsApi = require("../src/services/oddsApi");
const alertasUi = require("../src/juegos/apuestas/alertas");
const { filasPartido } = require("../src/juegos/apuestas/partido");
const { buildMisJugadas, handleSelect } = require("../src/paneles/misJugadas");

const HORA = 3600_000;
let n = 0;
const persona = () => {
    const id = `ra-${++n}`;
    dinero.asegurarCuenta(id);
    return id;
};
function cliente() {
    const enviados = [];
    return {
        enviados,
        users: { fetch: async (id) => ({ send: jest.fn(async (p) => enviados.push([id, p.content])) }) },
    };
}

describe("resumen semanal de apuestas por DM (#361)", () => {
    // Lunes 12 de octubre de 2026: la semana anterior va del 5 al 11.
    const LUNES_11H = Date.UTC(2026, 9, 12, 9);
    const SEMANA = { lunes: "2026-10-05", domingo: "2026-10-11" };
    function resuelta(userId, inicio, cantidad, premio) {
        const matchId = `ra-r${++n}`;
        db.prepare(
            "INSERT INTO apuestas_partidos (match_id, home_team, away_team, start_time, estado, resultado) VALUES (?, 'A', 'B', ?, 'finalizado', 'home')",
        ).run(matchId, inicio);
        db.prepare(
            "INSERT INTO apuestas_usuario (user_id, match_id, eleccion, cantidad, cuota, pagado, premio) VALUES (?, ?, 'home', ?, 2, 1, ?)",
        ).run(userId, matchId, cantidad, premio);
    }
    const [ana, beto, sin] = [persona(), persona(), persona()];
    beforeAll(() => {
        resuelta(ana, "2026-10-07T18:00:00.000Z", 100, 200);
        resuelta(ana, "2026-10-08T18:00:00.000Z", 50, 0);
        resuelta(beto, "2026-10-06T18:00:00.000Z", 80, 0);
        resuelta(sin, "2026-10-14T18:00:00.000Z", 10, 20); // de esta semana: no cuenta
        // Ana ha sumado 4 puntos en la liga de esta temporada.
        const q = db
            .prepare(
                "INSERT INTO quinielas (deporte, jornada, estado, creada_en, cerrada_en) VALUES ('laliga', 'J', 'cerrada', '2026-10-01', '2026-10-04T10:00:00.000Z')",
            )
            .run().lastInsertRowid;
        db.prepare(
            "INSERT INTO quiniela_apuestas (quiniela_id, user_id, predicciones, cantidad, aciertos, premio, pagado, creada_en) VALUES (?, ?, '1', 10, 4, 0, 1, 'x')",
        ).run(q, ana);
    });

    test("solo recibe el DM quien tuvo apuestas resueltas esa semana, con cifras que cuadran con la clasificación semanal", async () => {
        const c = cliente();
        expect(await resumen.enviarSiToca(c, LUNES_11H)).toBe(2);
        expect(c.enviados.map(([id]) => id).sort()).toEqual([ana, beto].sort());
        const [, textoAna] = c.enviados.find(([id]) => id === ana);
        expect(textoAna).toMatch(/Tu semana de apuestas.* del 5 de octubre al 11 de octubre/);
        expect(textoAna).toMatch(/Apuestas resueltas: \*\*2\*\*/);
        expect(textoAna).toMatch(/Apostado: \*\*150\*\* 🪙 · cobrado: \*\*200\*\* 🪙/);
        expect(textoAna).toMatch(/📈 Beneficio: \*\*\+50\*\* 🪙/);
        expect(textoAna).toMatch(/Liga de pronósticos: \*\*1\.º\*\* con \*\*4\*\* puntos/);
        const [, textoBeto] = c.enviados.find(([id]) => id === beto);
        expect(textoBeto).toMatch(/📉 Beneficio: \*\*-80\*\* 🪙/);
        expect(textoBeto).toMatch(/todavía sin puntos/);
        // Misma consulta que la clasificación semanal.
        const delRanking = ranking.beneficioEntre(SEMANA.lunes, SEMANA.domingo).find((r) => r.userId === ana);
        expect(delRanking).toMatchObject({ beneficio: 50, apostado: 150, cobrado: 200, resueltas: 2 });
    });

    test("una sola vez por persona y semana, aunque el bot se reinicie o se repita la pasada", async () => {
        const otra = cliente();
        expect(await resumen.enviarSiToca(otra, LUNES_11H + 5 * HORA)).toBe(0);
        expect(otra.enviados).toEqual([]);
        expect(db.prepare("SELECT COUNT(*) AS n FROM apuestas_resumen_semanal WHERE semana = ?").get(SEMANA.lunes).n).toBe(2);
    });

    test("solo los lunes y desde las 10:00 (hora de Madrid)", async () => {
        const c = cliente();
        expect(await resumen.enviarSiToca(c, Date.UTC(2026, 9, 12, 7))).toBe(0); // lunes 09:00
        expect(await resumen.enviarSiToca(c, Date.UTC(2026, 9, 13, 12))).toBe(0); // martes
        expect(c.enviados).toEqual([]);
    });

    test("si nadie apostó la semana no se manda nada, y quien apagó el aviso en /avisos no lo recibe", async () => {
        const c = cliente();
        expect(await resumen.enviarSiToca(c, Date.UTC(2026, 11, 14, 12))).toBe(0); // una semana sin apuestas
        const quiet = persona();
        resuelta(quiet, "2026-10-14T18:00:00.000Z", 10, 30);
        avisosDm.fijar(quiet, "resumen_apuestas", false);
        const semanaSiguiente = Date.UTC(2026, 9, 19, 9);
        const d = cliente();
        await resumen.enviarSiToca(d, semanaSiguiente);
        expect(d.enviados.map(([id]) => id)).not.toContain(quiet);
        expect(avisosDm.tipoValido("resumen_apuestas")).toBe(true);
    });
});

describe("alertas de cuota (#345)", () => {
    function partido(extra = {}) {
        const p = {
            match_id: `ra-a${++n}`,
            home_team: "Betis",
            away_team: "Sevilla",
            start_time: new Date(Date.now() + 24 * HORA).toISOString(),
            estado: "abierto",
            deporte: "laliga",
            cuota_home: 2,
            cuota_draw: 3,
            cuota_away: 4,
            cuota_mas: null,
            cuota_menos: null,
            total_linea: null,
            ...extra,
        };
        db.prepare(
            `INSERT INTO apuestas_partidos (match_id, home_team, away_team, start_time, estado, deporte, cuota_home, cuota_draw, cuota_away, cuota_mas, cuota_menos, total_linea)
             VALUES (@match_id, @home_team, @away_team, @start_time, @estado, @deporte, @cuota_home, @cuota_draw, @cuota_away, @cuota_mas, @cuota_menos, @total_linea)`,
        ).run(p);
        return p;
    }
    const cuota = (matchId, campo, valor) => db.prepare(`UPDATE apuestas_partidos SET ${campo} = ? WHERE match_id = ?`).run(valor, matchId);
    const nuevaAlerta = (userId, p, extra = {}) =>
        alertas.crear({ userId, matchId: p.match_id, eleccion: "home", objetivo: 2.5, direccion: "arriba", ...extra });

    test("se crea con elección, objetivo y dirección; el objetivo admite coma y no puede estar ya cumplido", () => {
        const u = persona();
        const p = partido();
        expect(nuevaAlerta(u, p, { objetivo: "2,5" })).toMatchObject({ ok: true, actual: 2 });
        expect(nuevaAlerta(u, p, { objetivo: 1.5 }).mensaje).toMatch(/ya está en \*\*2\*\*/); // arriba, y ya está por encima de 1,5
        expect(nuevaAlerta(u, p, { direccion: "abajo", objetivo: 2.5 }).mensaje).toMatch(/ya está en/);
        for (const mal of [0.5, 5000, "abc", ""]) expect(nuevaAlerta(u, p, { objetivo: mal }).ok).toBe(false);
        expect(nuevaAlerta(u, p, { direccion: "lado" }).ok).toBe(false);
        expect(nuevaAlerta(u, p, { eleccion: "exacto_1-0" }).ok).toBe(false);
        expect(nuevaAlerta(u, p, { eleccion: "mas" }).mensaje).toMatch(/no tiene cuota/);
    });

    test("no se puede en un partido empezado o cerrado, y repetir la misma alerta solo cambia el objetivo", () => {
        const u = persona();
        expect(nuevaAlerta(u, partido({ start_time: new Date(Date.now() - 60_000).toISOString() })).ok).toBe(false);
        expect(nuevaAlerta(u, partido({ estado: "finalizado" })).ok).toBe(false);
        expect(alertas.crear({ userId: u, matchId: "no-existe", eleccion: "home", objetivo: 3, direccion: "arriba" }).ok).toBe(false);
        const p = partido();
        const a = nuevaAlerta(u, p);
        const b = nuevaAlerta(u, p, { objetivo: 3 });
        expect(b.id).toBe(a.id);
        expect(alertas.activasDe(u).map((x) => x.objetivo)).toEqual([3]);
    });

    test("cada persona tiene como mucho MAX_ALERTAS activas", () => {
        const u = persona();
        for (let i = 0; i < alertas.MAX_ALERTAS; i++) expect(nuevaAlerta(u, partido()).ok).toBe(true);
        expect(nuevaAlerta(u, partido()).mensaje).toMatch(new RegExp(`Ya tienes ${alertas.MAX_ALERTAS} alertas activas`));
        const otra = persona();
        expect(nuevaAlerta(otra, partido()).ok).toBe(true);
    });

    test("se avisa una sola vez cuando la cuota cruza el valor, y la alerta se borra al dispararse", async () => {
        const u = persona();
        const p = partido();
        nuevaAlerta(u, p, { objetivo: 2.5, direccion: "arriba" });
        const c = cliente();
        expect(await alertas.comprobar(c)).toEqual({ disparadas: 0, caducadas: 0 });
        cuota(p.match_id, "cuota_home", 2.6);
        expect(await alertas.comprobar(c)).toEqual({ disparadas: 1, caducadas: 0 });
        expect(c.enviados).toHaveLength(1);
        expect(c.enviados[0][1]).toMatch(
            /Tu alerta de cuota.*Betis.*Betis vs Sevilla\*\* ya está a \*\*2\.6\*\*.*llegue o suba a \*\*2\.5\*\*/,
        );
        expect(alertas.activasDe(u)).toEqual([]);
        expect(await alertas.comprobar(c)).toEqual({ disparadas: 0, caducadas: 0 });
        expect(c.enviados).toHaveLength(1);
    });

    test("también hacia abajo (con mercados de goles), e «igual» cuenta", async () => {
        const u = persona();
        const p = partido({ cuota_mas: 2, cuota_menos: 1.8, total_linea: 2.5 });
        nuevaAlerta(u, p, { eleccion: "mas", objetivo: 1.7, direccion: "abajo" });
        const c = cliente();
        cuota(p.match_id, "cuota_mas", 1.7); // igual al objetivo
        await alertas.comprobar(c);
        expect(c.enviados[0][1]).toMatch(/Más de 2,5 goles.*llegue o baje a \*\*1\.7\*\*/);
    });

    test("al empezar el partido (o desaparecer de las cuotas) la alerta se borra sin avisar", async () => {
        const u = persona();
        const p = partido();
        nuevaAlerta(u, p);
        const sinPartido = partido();
        nuevaAlerta(u, sinPartido, { eleccion: "away", objetivo: 5 });
        db.prepare("UPDATE apuestas_partidos SET start_time = ? WHERE match_id = ?").run(
            new Date(Date.now() - 1000).toISOString(),
            p.match_id,
        );
        db.prepare("DELETE FROM apuestas_partidos WHERE match_id = ?").run(sinPartido.match_id);
        const c = cliente();
        expect(await alertas.comprobar(c)).toEqual({ disparadas: 0, caducadas: 2 });
        expect(c.enviados).toEqual([]);
        expect(alertas.activasDe(u)).toEqual([]);
    });

    test("quien tiene apagado el aviso no recibe el DM, pero la alerta se dispara igual (una sola vez)", async () => {
        const u = persona();
        const p = partido();
        nuevaAlerta(u, p, { objetivo: 2.5 });
        avisosDm.fijar(u, "alerta_cuota", false);
        cuota(p.match_id, "cuota_home", 3);
        const c = cliente();
        expect(await alertas.comprobar(c)).toMatchObject({ disparadas: 1 });
        expect(c.enviados).toEqual([]);
        expect(alertas.activasDe(u)).toEqual([]);
    });

    test("tras cada refresco de cuotas de la API se comprueban (el servicio no depende de las apuestas)", async () => {
        const visto = [];
        oddsApi.alRefrescarCuotas((deporte) => visto.push(deporte));
        oddsApi.alRefrescarCuotas(() => {
            throw new Error("un oyente roto no tumba al resto");
        });
        process.env.ODDS_API_KEY = "clave-de-prueba";
        const antes = global.fetch;
        global.fetch = jest.fn(async () => ({ ok: true, status: 200, headers: { get: () => "400" }, json: async () => [] }));
        try {
            oddsApi._limpiarCache();
            await oddsApi.sincronizarPartidos("laliga");
            expect(visto).toEqual(["laliga"]);
            await oddsApi.sincronizarPartidos("laliga"); // de la caché: no hay cuotas nuevas
            expect(visto).toEqual(["laliga"]);
        } finally {
            global.fetch = antes;
            delete process.env.ODDS_API_KEY;
            oddsApi._limpiarCache();
        }
    });

    describe("el botón, el formulario y Mis jugadas", () => {
        const interaccion = (customId, userId, extra = {}) => ({
            customId,
            user: { id: userId },
            reply: jest.fn(async () => {}),
            update: jest.fn(async () => {}),
            showModal: jest.fn(async () => {}),
            values: [],
            ...extra,
        });

        test("la ficha del partido tiene el botón 🔔, con los mercados o sola", () => {
            const sin = filasPartido(partido(), "m1");
            expect(sin[1].components.map((b) => b.data.custom_id)).toEqual(["apuesta_alerta_m1"]);
            const con = filasPartido(partido({ cuota_mas: 2, cuota_menos: 1.8, total_linea: 2.5 }), "m2");
            expect(con[1].components.map((b) => b.data.custom_id)).toEqual([
                "apuesta_mercado_mas_m2",
                "apuesta_mercado_menos_m2",
                "apuesta_alerta_m2",
            ]);
        });

        test("el botón abre el formulario con las elecciones que tienen cuota, y avisa si el partido ya empezó", async () => {
            const p = partido({ cuota_mas: 2, cuota_menos: 1.8, total_linea: 2.5 });
            const i = interaccion(`apuesta_alerta_${p.match_id}`, "x");
            await alertasUi.handleButton(null, i);
            const modal = i.showModal.mock.calls[0][0].toJSON();
            expect(modal.custom_id).toBe(`apuestas_modal_alerta_${p.match_id}`);
            expect(modal.components).toHaveLength(3);
            expect(modal.components[0].component.options.map((o) => o.value)).toEqual(["home", "draw", "away", "mas", "menos"]);
            const empezado = partido({ start_time: new Date(Date.now() - 1000).toISOString() });
            const tarde = interaccion(`apuesta_alerta_${empezado.match_id}`, "x");
            await alertasUi.handleButton(null, tarde);
            expect(tarde.reply.mock.calls[0][0].content).toMatch(/ya ha empezado/);
            expect(tarde.showModal).not.toHaveBeenCalled();
        });

        test("al enviar el formulario se crea la alerta y se confirma en privado; si algo falla, se dice por qué", async () => {
            const u = persona();
            const p = partido();
            const campos = (eleccion, objetivo, direccion) => ({
                getStringSelectValues: () => [eleccion],
                getTextInputValue: () => objetivo,
                getRadioGroup: () => direccion,
            });
            const ok = interaccion(`apuestas_modal_alerta_${p.match_id}`, u, { fields: campos("draw", "3,4", "arriba") });
            await alertasUi.handleModal(null, ok);
            expect(ok.reply.mock.calls[0][0].content).toMatch(/Alerta creada.*Empate.*llegue o suba a \*\*3\.4\*\* \(ahora está a 3\)/);
            expect(alertas.activasDe(u)).toHaveLength(1);
            const mal = interaccion(`apuestas_modal_alerta_${p.match_id}`, u, { fields: campos("draw", "2", "arriba") });
            await alertasUi.handleModal(null, mal);
            expect(mal.reply.mock.calls[0][0].content).toMatch(/ya está en/);
        });

        test("las alertas salen en ⏳ En juego y se cancelan con el menú de cancelar", async () => {
            const u = persona();
            const p = partido();
            const { id } = nuevaAlerta(u, p, { objetivo: 3 });
            const panel = buildMisJugadas(u, "activas");
            const campo = panel.embeds[0].toJSON().fields.find((f) => f.name.startsWith("🔔 Alertas de cuota"));
            expect(campo.name).toBe(`🔔 Alertas de cuota (1/${alertas.MAX_ALERTAS})`);
            expect(campo.value).toBe("**Betis** vs **Sevilla** · Betis ≥ 3 (ahora 2)");
            const menu = panel.components.find((f) => f.components[0].data.custom_id === `misapuestas_cancelarsel_${u}`).components[0];
            expect(menu.options.map((o) => o.data.value)).toEqual([`n${id}`]);

            const sel = interaccion(`misapuestas_cancelarsel_${u}`, u, { values: [`n${id}`] });
            await handleSelect(null, sel);
            expect(sel.update.mock.calls[0][0].content).toBe("🔔 Alerta cancelada.");
            expect(alertas.activasDe(u)).toEqual([]);
            const otra = interaccion(`misapuestas_cancelarsel_${u}`, u, { values: [`n${id}`] });
            await handleSelect(null, otra);
            expect(otra.update.mock.calls[0][0].content).toBe("Esa alerta ya no existe.");
        });

        test("una alerta ajena no se puede cancelar", () => {
            const u = persona();
            const { id } = nuevaAlerta(u, partido(), { objetivo: 3 });
            expect(alertas.cancelar("otra-persona", id)).toBe(false);
            expect(alertas.cancelar(u, id)).toBe(true);
        });
    });
});
