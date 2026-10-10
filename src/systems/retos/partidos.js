// Partidos y retos: encontrar el partido por un texto ("el Betis"), saber a qué equipo se refiere cada elección, y
// resolver o devolver los retos de un partido cuando se liquida.
const db = require("../../core/db");
const { partidosParaRetar, partidoDe } = require("./persistencia");
const { devolver, ganar } = require("./cobros");

/** Sin mayúsculas, tildes ni signos, para comparar nombres de equipos. */
const normalizar = (texto) =>
    String(texto || "")
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, " ")
        .trim();

/**
 * El próximo partido abierto que mejor encaja con un texto con uno o los dos equipos ("Betis", "betis - sevilla"): el
 * que tiene más palabras del texto en sus equipos y, a igualdad, el más cercano. null si ninguno tiene ninguna.
 */
function buscarPartido(texto) {
    const palabras = normalizar(texto)
        .split(" ")
        .filter((w) => w.length >= 3);
    let mejor = null;
    let aciertos = 0;
    for (const p of partidosParaRetar(100)) {
        const equipos = ` ${normalizar(p.home_team)} ${normalizar(p.away_team)} `;
        const n = palabras.filter((w) => equipos.includes(` ${w}`)).length;
        if (n > aciertos) [mejor, aciertos] = [p, n];
    }
    return mejor;
}

/**
 * home/draw/away según el equipo que se dice que gana (o "empate") en un partido. Gana el equipo que más encaja ("Real
 * Madrid" es el Madrid aunque el otro sea la Real Sociedad); null si no es ninguno o encajan igual.
 */
function eleccionPara(p, equipo) {
    const e = normalizar(equipo);
    if (!e) return null;
    if (["empate", "empatan", "x", "draw"].includes(e)) return "draw";
    const puntos = (nombre) => {
        const n = normalizar(nombre);
        if (n.includes(e) || e.includes(n)) return 100;
        return e.split(" ").filter((w) => w.length >= 3 && ` ${n} `.includes(` ${w}`)).length;
    };
    const local = puntos(p.home_team);
    const visitante = puntos(p.away_team);
    if (local === visitante) return null;
    return local > visitante ? "home" : "away";
}

/**
 * Resuelve los retos de un partido terminado (`resultado`: home/draw/away). Se llama dentro de la transacción que
 * cierra el partido. Los que nadie aceptó se devuelven.
 * @returns {{ cerrados: object[], pagos: object[] }}
 */
function resolverPartido(matchId, resultado, marcador) {
    const p = partidoDe(matchId);
    const cerrados = [];
    const pagos = [];
    const retos = db
        .prepare(
            "SELECT id, estado, eleccion, creador, rival FROM retos WHERE tipo = 'partido' AND match_id = ? AND estado IN ('pendiente', 'en_juego')",
        )
        .all(matchId);
    for (const r of retos) {
        const hecho =
            r.estado === "pendiente"
                ? devolver(r.id, "nadie lo aceptó antes del partido")
                : ganar(r.id, [r.eleccion === resultado ? r.creador : r.rival], p ? `${p.home_team} ${marcador} ${p.away_team}` : marcador);
        if (!hecho) continue;
        cerrados.push(hecho.reto);
        pagos.push(...hecho.pagos);
    }
    return { cerrados, pagos };
}

/** Devuelve los retos de un partido que se ha quedado sin resultado. */
function devolverPorPartido(matchId, motivo) {
    const cerrados = [];
    const pagos = [];
    for (const r of db
        .prepare("SELECT id FROM retos WHERE tipo = 'partido' AND match_id = ? AND estado IN ('pendiente', 'en_juego')")
        .all(matchId)) {
        const hecho = devolver(r.id, motivo);
        if (!hecho) continue;
        cerrados.push(hecho.reto);
        pagos.push(...hecho.pagos);
    }
    return { cerrados, pagos };
}

module.exports = { buscarPartido, eleccionPara, resolverPartido, devolverPorPartido };
