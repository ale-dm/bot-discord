// 🔔 Alertas de cuota (#345): desde la ficha de un partido, eliges una elección (1, X, 2, goles o hándicap) y una cuota objetivo, y el bot
// te manda un DM cuando la cuota de esa elección la alcanza antes de que empiece el partido: igual o por encima («arriba») o igual o por
// debajo («abajo»). Se avisa una sola vez, y la alerta se borra al dispararse o al empezar el partido. Cada persona tiene como mucho
// MAX_ALERTAS activas y las ve y cancela en 📋 Mis jugadas. Se miran tras cada refresco de cuotas (services/oddsApi.alRefrescarCuotas, que
// registra index.js), con las cuotas que ya se guardan: no gasta créditos de la Odds API.
const db = require("../../core/db");
const { enviarAviso } = require("../avisosDm");
const { createLogger } = require("../../core/logger");
const { cuotaDeEleccion, partidoPorMatch } = require("./apostar");
const mercados = require("./mercados");

const log = createLogger("Apuestas");

const MAX_ALERTAS = 10;
const OBJETIVO_MIN = 1.01;
const OBJETIVO_MAX = 1000;
/** Las dos direcciones: lo que se dice en el formulario y la comparación con la cuota. */
const DIRECCIONES = {
    arriba: { texto: "llegue o suba a", cumple: (actual, objetivo) => actual >= objetivo },
    abajo: { texto: "llegue o baje a", cumple: (actual, objetivo) => actual <= objetivo },
};
const ELECCIONES_1X2 = ["home", "draw", "away"];

const esEleccion = (eleccion) => ELECCIONES_1X2.includes(eleccion) || mercados.esMercado(eleccion);
const sinEmpezar = (partido, ahora) => partido?.estado === "abierto" && Date.parse(partido.start_time) > ahora;
const redondear = (n) => Math.round(n * 100) / 100;

/** Las elecciones de un partido a las que se puede poner una alerta (con cuota), con su cuota de ahora. */
function eleccionesConCuota(partido) {
    return [...ELECCIONES_1X2, ...mercados.MERCADOS]
        .map((eleccion) => ({ eleccion, cuota: cuotaDeEleccion(eleccion, partido) }))
        .filter((e) => e.cuota >= 1);
}

/**
 * Crea una alerta (o cambia el objetivo de la misma elección y dirección en ese partido). La cuota objetivo se escribe con coma o punto.
 * @returns {{ ok: true, id: number, actual: number } | { ok: false, mensaje: string }}
 */
function crear({ userId, matchId, eleccion, objetivo, direccion }, ahora = Date.now()) {
    const partido = partidoPorMatch(matchId);
    if (!sinEmpezar(partido, ahora)) return { ok: false, mensaje: "❌ Ese partido ya ha empezado o no está disponible." };
    if (!esEleccion(eleccion)) return { ok: false, mensaje: "❌ Elige una de las opciones del partido." };
    if (!DIRECCIONES[direccion]) return { ok: false, mensaje: "❌ Elige si quieres el aviso cuando suba o cuando baje." };
    const valor = redondear(Number(String(objetivo).trim().replace(",", ".")));
    if (!Number.isFinite(valor) || valor < OBJETIVO_MIN || valor > OBJETIVO_MAX) {
        return { ok: false, mensaje: `❌ La cuota objetivo es un número entre ${OBJETIVO_MIN} y ${OBJETIVO_MAX}.` };
    }
    const actual = cuotaDeEleccion(eleccion, partido);
    if (!(actual >= 1)) return { ok: false, mensaje: "❌ Esa opción no tiene cuota ahora mismo." };
    if (DIRECCIONES[direccion].cumple(actual, valor)) {
        return { ok: false, mensaje: `❌ La cuota ya está en **${actual}**: elige un valor que aún no se cumpla.` };
    }
    const igual = db
        .prepare("SELECT id FROM alertas_cuota WHERE userId = ? AND match_id = ? AND eleccion = ? AND direccion = ?")
        .get(String(userId), String(matchId), eleccion, direccion);
    if (igual) {
        db.prepare("UPDATE alertas_cuota SET objetivo = ?, creada_en = ? WHERE id = ?").run(valor, ahora, igual.id);
        return { ok: true, id: igual.id, actual };
    }
    const n = db.prepare("SELECT COUNT(*) AS n FROM alertas_cuota WHERE userId = ?").get(String(userId)).n;
    if (n >= MAX_ALERTAS) return { ok: false, mensaje: `❌ Ya tienes ${MAX_ALERTAS} alertas activas: cancela alguna en 📋 Mis jugadas.` };
    const { lastInsertRowid } = db
        .prepare("INSERT INTO alertas_cuota (userId, match_id, eleccion, objetivo, direccion, creada_en) VALUES (?, ?, ?, ?, ?, ?)")
        .run(String(userId), String(matchId), eleccion, valor, direccion, ahora);
    return { ok: true, id: Number(lastInsertRowid), actual };
}

const COLUMNAS_PARTIDO =
    "p.home_team, p.away_team, p.start_time, p.estado, p.deporte, p.cuota_home, p.cuota_draw, p.cuota_away, p.cuota_mas, p.cuota_menos, p.total_linea, p.cuota_casa, p.cuota_fuera, p.hcap_linea, " +
    "p.cuota_ambos_si, p.cuota_ambos_no, p.cuota_dc_1x, p.cuota_dc_12, p.cuota_dc_x2";

/** Las alertas activas de una persona con su partido, la cuota de ahora y el nombre de la elección; el partido más próximo primero. */
function activasDe(userId) {
    return db
        .prepare(
            `SELECT a.*, ${COLUMNAS_PARTIDO} FROM alertas_cuota a JOIN apuestas_partidos p ON p.match_id = a.match_id
             WHERE a.userId = ? ORDER BY p.start_time, a.id`,
        )
        .all(String(userId))
        .map((a) => ({
            ...a,
            actual: cuotaDeEleccion(a.eleccion, a),
            textoEleccion: mercados.textoEleccion({ ...a, linea: mercados.lineaDe(a, a.eleccion) }),
        }));
}

/** Quita una alerta suya. @returns {boolean} si había una */
const cancelar = (userId, id) =>
    db.prepare("DELETE FROM alertas_cuota WHERE id = ? AND userId = ?").run(Number(id), String(userId)).changes > 0;

function mensajeAviso(a) {
    const unix = Math.floor(Date.parse(a.start_time) / 1000);
    return (
        `🔔 **Tu alerta de cuota**: ${a.textoEleccion} en **${a.home_team} vs ${a.away_team}** ya está a **${a.actual}** ` +
        `(querías que ${DIRECCIONES[a.direccion].texto} **${a.objetivo}**).\nEl partido empieza <t:${unix}:R>. Apuesta en /juegos → ⚽ Apuestas.`
    );
}

/**
 * Mira las alertas pendientes con las cuotas guardadas: avisa por DM de las que se cumplen (una sola vez) y borra esas y las de partidos
 * que ya han empezado. @returns {Promise<{ disparadas: number, caducadas: number }>}
 */
async function comprobar(client, ahora = Date.now()) {
    const todas = db
        .prepare(`SELECT a.*, ${COLUMNAS_PARTIDO} FROM alertas_cuota a JOIN apuestas_partidos p ON p.match_id = a.match_id`)
        .all();
    // Las de un partido que ya no existe en las cuotas guardadas tampoco se pueden cumplir.
    const huerfanas = db.prepare("SELECT id FROM alertas_cuota WHERE match_id NOT IN (SELECT match_id FROM apuestas_partidos)").all();
    const borrar = db.prepare("DELETE FROM alertas_cuota WHERE id = ?");
    let disparadas = 0;
    let caducadas = huerfanas.length;
    for (const { id } of huerfanas) borrar.run(id);
    for (const a of todas) {
        if (!sinEmpezar(a, ahora)) {
            borrar.run(a.id);
            caducadas++;
            continue;
        }
        const actual = cuotaDeEleccion(a.eleccion, a);
        if (!(actual >= 1) || !DIRECCIONES[a.direccion].cumple(actual, a.objetivo)) continue;
        // Se borra antes de avisar: una alerta se dispara una sola vez, aunque el DM falle.
        if (borrar.run(a.id).changes !== 1) continue;
        disparadas++;
        const textoEleccion = mercados.textoEleccion({ ...a, linea: mercados.lineaDe(a, a.eleccion) });
        await enviarAviso(client, a.userId, "alerta_cuota", { content: mensajeAviso({ ...a, actual, textoEleccion }) });
    }
    if (disparadas) log.info(`Alertas de cuota: ${disparadas} avisadas, ${caducadas} caducadas`);
    return { disparadas, caducadas };
}

module.exports = { MAX_ALERTAS, OBJETIVO_MIN, OBJETIVO_MAX, DIRECCIONES, eleccionesConCuota, crear, activasDe, cancelar, comprobar };
