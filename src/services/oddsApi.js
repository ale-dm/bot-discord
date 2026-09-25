// Cliente de The Odds API (https://the-odds-api.com): competiciones, cuotas y resultados.
// Lo usan las apuestas y la quiniela de /juegos y la liquidación (/pagarapuestas y el cron de index.js).
//
// Coste en el plan gratuito (500 créditos al mes): cuotas = 1 crédito por competición
// (1 mercado × 1 región), resultados con daysFrom = 2 créditos.
const db = require("../core/db");
const { createLogger } = require("../core/logger");
const log = createLogger("OddsAPI");

const BASE_URL = "https://api.the-odds-api.com/v4/sports";

const DEPORTES = {
    laliga: { name: "LaLiga 🇪🇸", apiKey: "soccer_spain_la_liga", emoji: "⚽" },
    premier: { name: "Premier League 🏴󠁧󠁢󠁥󠁮󠁧󠁿", apiKey: "soccer_epl", emoji: "⚽" },
    champions: { name: "Champions League 🏆", apiKey: "soccer_uefa_champs_league", emoji: "🏆" },
};

// La API de resultados solo acepta daysFrom de 1 a 3 (con más responde 422
// INVALID_SCORES_DAYS_FROM): no hay forma de saber el resultado de un partido más antiguo.
const DIAS_RESULTADOS = 3;

// Las cuotas apenas cambian en media hora: se reutiliza la última respuesta de cada
// competición durante ODDS_CACHE_MINUTES (antes se pedían en cada consulta de partidos y cada página).
const ODDS_CACHE_MS = Number(process.env.ODDS_CACHE_MINUTES || 30) * 60 * 1000;
const cacheCuotas = new Map(); // deporte -> { data, ts }

// Se lee en cada llamada (no al cargar el módulo) para que los tests puedan fijarla.
const getApiKey = () => process.env.ODDS_API_KEY || "";

function deporteValido(key) {
    return DEPORTES[key] ? key : "laliga";
}

async function pedir(url, deporte) {
    const res = await fetch(url.replace("{KEY}", encodeURIComponent(getApiKey())), { signal: AbortSignal.timeout(15000) });
    const restantes = res.headers?.get?.("x-requests-remaining") ?? "?";
    if (!res.ok) {
        // El cuerpo trae el motivo (p. ej. {"error_code":"INVALID_SCORES_DAYS_FROM"}); sin él, un 422 o
        // un 401 no dicen nada. 401 = clave inválida; 429 = cuota mensual agotada.
        const body = await res.text().catch(() => "");
        throw new Error(`Odds API respondió ${res.status} para ${deporte.apiKey}: ${body.slice(0, 200)}`);
    }
    const data = await res.json();
    if (data && data.error) throw new Error(`Odds API: ${data.error}`);
    return { data, restantes };
}

/** Cuotas 1/X/2 de un partido de la API, o null si ninguna casa las da. */
function cuotasH2H(match) {
    const market = match.bookmakers?.[0]?.markets?.find((m) => m.key === "h2h");
    if (!market) return { home: null, draw: null, away: null };
    const precio = (nombre) => market.outcomes.find((o) => o.name === nombre)?.price ?? null;
    return { home: precio(match.home_team), draw: precio("Draw"), away: precio(match.away_team) };
}

// Si el partido ya existe y sigue abierto se actualizan cuotas y hora: antes era INSERT OR IGNORE
// y se quedaban para siempre las cuotas de la primera consulta y la hora original aunque el
// partido se aplazara (y con ella el cierre de apuestas). La cuota de cada apuesta ya hecha está
// guardada en apuestas_usuario, así que no le afecta.
const upsertPartido = () =>
    db.prepare(`
        INSERT INTO apuestas_partidos (match_id, deporte, home_team, away_team, start_time, cuota_home, cuota_draw, cuota_away)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(match_id) DO UPDATE SET
            start_time = excluded.start_time,
            cuota_home = COALESCE(excluded.cuota_home, cuota_home),
            cuota_draw = COALESCE(excluded.cuota_draw, cuota_draw),
            cuota_away = COALESCE(excluded.cuota_away, cuota_away)
        WHERE apuestas_partidos.estado = 'abierto'
    `);

function guardarPartidos(deporteKey, partidos) {
    const stmt = upsertPartido();
    // Lo mismo en las quinielas: con la hora antigua, un partido aplazado bloqueaba la quiniela
    // antes de tiempo (o la caducaba) aunque aún no se hubiera jugado.
    const horaQuiniela = db.prepare("UPDATE quiniela_partidos SET start_time = ? WHERE match_id = ? AND resultado_final IS NULL");
    db.transaction(() => {
        for (const m of partidos) {
            const c = cuotasH2H(m);
            stmt.run(m.id, deporteKey, m.home_team, m.away_team, m.commence_time, c.home, c.draw, c.away);
            horaQuiniela.run(m.commence_time, m.id);
        }
    })();
}

/**
 * Descarga (o toma de la caché) los próximos partidos con cuotas de una competición y los guarda
 * en apuestas_partidos.
 * @returns {Promise<object[]>} partidos tal y como los devuelve la API
 */
async function sincronizarPartidos(deporteKey) {
    const deporte = DEPORTES[deporteKey];
    if (!deporte) throw new Error(`Competición desconocida: ${deporteKey}`);
    const cached = cacheCuotas.get(deporteKey);
    if (cached && Date.now() - cached.ts < ODDS_CACHE_MS) {
        log.debug(`Cuotas de ${deporte.name} desde caché (${Math.round((Date.now() - cached.ts) / 60000)} min)`);
        return cached.data;
    }
    if (!getApiKey()) throw new Error("Falta ODDS_API_KEY en .env");

    const { data, restantes } = await pedir(`${BASE_URL}/${deporte.apiKey}/odds/?apiKey={KEY}&regions=eu&markets=h2h`, deporte);
    const partidos = Array.isArray(data) ? data : [];
    guardarPartidos(deporteKey, partidos);
    cacheCuotas.set(deporteKey, { data: partidos, ts: Date.now() });
    log.info(`Cuotas de ${deporte.name}: ${partidos.length} partidos · créditos restantes: ${restantes}`);
    return partidos;
}

/** Resultados de los últimos DIAS_RESULTADOS días de una competición. */
async function obtenerResultados(deporteKey) {
    const deporte = DEPORTES[deporteValido(deporteKey)];
    if (!getApiKey()) throw new Error("Falta ODDS_API_KEY en .env");
    const { data, restantes } = await pedir(`${BASE_URL}/${deporte.apiKey}/scores/?apiKey={KEY}&daysFrom=${DIAS_RESULTADOS}`, deporte);
    log.debug(`Resultados de ${deporte.name} · créditos restantes: ${restantes}`);
    return Array.isArray(data) ? data : [];
}

/** "home" | "draw" | "away" a partir de un resultado de la API, o null si no ha terminado. */
function resultadoDeScore(score) {
    if (!score || !score.completed || !Array.isArray(score.scores) || score.scores.length !== 2) return null;
    // La API no garantiza el orden de "scores": se busca cada equipo por su nombre (antes se
    // asumía que el primero era el local, y si venía al revés se pagaba el resultado contrario).
    const porNombre = (n) => score.scores.find((s) => s.name === n);
    let home = porNombre(score.home_team);
    let away = porNombre(score.away_team);
    if (!home || !away || home === away) [home, away] = score.scores;
    const h = Number(home.score);
    const a = Number(away.score);
    if (h > a) return { resultado: "home", home, away };
    if (h < a) return { resultado: "away", home, away };
    return { resultado: "draw", home, away };
}

module.exports = {
    DEPORTES,
    DIAS_RESULTADOS,
    deporteValido,
    sincronizarPartidos,
    obtenerResultados,
    resultadoDeScore,
    cuotasH2H,
    _limpiarCache: () => cacheCuotas.clear(),
};
