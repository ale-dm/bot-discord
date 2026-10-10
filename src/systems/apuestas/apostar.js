// Reglas de apostar a un partido (DT-16): cuota de cada elección, cobro y listado de partidos abiertos.
// Sin Discord: los mensajes al usuario los decide src/juegos/apuestas/apuestas.js.
const db = require("../../core/db");
const dinero = require("../dinero");
const marcadorExacto = require("./marcador");
const mercados = require("./mercados");
const directo = require("./directo");
const { logInfo } = require("../../core/logger");

const PARTIDOS_POR_PAGINA = 25;

function yaApostadoApuesta(userId, matchId, eleccion) {
    return db.prepare("SELECT 1 FROM apuestas_usuario WHERE user_id = ? AND match_id = ? AND eleccion = ?").get(userId, matchId, eleccion);
}

function cuotaDeEleccion(eleccion, match) {
    if (eleccion === "home") return match.cuota_home;
    if (eleccion === "draw") return match.cuota_draw;
    if (eleccion === "away") return match.cuota_away;
    if (marcadorExacto.marcadorDe(eleccion)) return marcadorExacto.PREMIO;
    if (mercados.esMercado(eleccion)) return mercados.cuotaDe(match, eleccion);
    return null;
}

// Descuenta el saldo y registra la apuesta, todo o nada (antes eran dos escrituras sueltas: si fallaba la segunda,
// se cobraba una apuesta que no existía). Devuelve false si no había efectivo suficiente.
function cobrarApuesta({ userId, match_id, match, eleccion, cantidad, cuota, linea }) {
    return db.transaction(() => {
        if (!dinero.cobrarCombinado(userId, cantidad)) return false;
        db.prepare(
            `
            INSERT INTO apuestas_usuario (user_id, match_id, eleccion, cantidad, cuota, linea)
            VALUES (?, ?, ?, ?, ?, ?)
        `,
        ).run(userId, match_id, eleccion, cantidad, cuota, linea);
        // Antes solo se apuntaba el premio al ganar: en /banco historial no aparecía lo apostado
        // y el "ganado/perdido" de /nivel contaba el premio entero como ganancia.
        dinero.apuntar(userId, "apuestas", `Apuesta: ${match.home_team} vs ${match.away_team}`, -cantidad);
        return true;
    })();
}

// Una página de partidos abiertos con cuotas, y el total (para saber si hay página siguiente).
function partidosDePagina(deporteSeleccionado, page) {
    const offset = (page - 1) * PARTIDOS_POR_PAGINA;
    const ahora = new Date().toISOString();
    const inicioListado = directo.inicioListado(); // con ODDS_DIRECTO=1, también los partidos en juego
    const partidos = db
        .prepare(
            `
            SELECT id, match_id, home_team, away_team, start_time, cuota_home, cuota_draw, cuota_away, estado, deporte, resultado, cuota_mas, cuota_menos, total_linea, cuota_casa, cuota_fuera, hcap_linea FROM apuestas_partidos
            WHERE estado = 'abierto'
                AND deporte = ?
                AND cuota_home IS NOT NULL
                AND cuota_draw IS NOT NULL
                AND cuota_away IS NOT NULL
                AND start_time > ?
            ORDER BY start_time
            LIMIT ? OFFSET ?
        `,
        )
        .all(deporteSeleccionado, inicioListado, PARTIDOS_POR_PAGINA, offset);

    logInfo(`[APUESTAS] Consultando partidos desde ${ahora}, encontrados: ${partidos.length}`);

    const totalPartidos = db
        .prepare(
            `
            SELECT COUNT(*) as total FROM apuestas_partidos
            WHERE estado = 'abierto'
                AND deporte = ?
                AND cuota_home IS NOT NULL
                AND cuota_draw IS NOT NULL
                AND cuota_away IS NOT NULL
                AND start_time > ?
        `,
        )
        .get(deporteSeleccionado, inicioListado).total;
    return { partidos, offset, totalPartidos };
}

// Las columnas que usan las apuestas a un partido, en un solo sitio (antes se repetían en cada consulta).
const COLUMNAS_PARTIDO =
    "id, match_id, home_team, away_team, start_time, cuota_home, cuota_draw, cuota_away, estado, deporte, resultado, cuota_mas, cuota_menos, total_linea, cuota_casa, cuota_fuera, hcap_linea";
const partidoPorMatch = (matchId) => db.prepare(`SELECT ${COLUMNAS_PARTIDO} FROM apuestas_partidos WHERE match_id = ?`).get(matchId);

module.exports = {
    PARTIDOS_POR_PAGINA,
    cuotaDeEleccion,
    cobrarApuesta,
    partidosDePagina,
    yaApostadoApuesta,
    partidoPorMatch,
};
