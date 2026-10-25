// Cliente de The Odds API (https://the-odds-api.com): competiciones, cuotas y resultados.
// Lo usan las apuestas y la quiniela de /juegos y la liquidación (/pagarapuestas y el cron de index.js).
//
// Coste en el plan gratuito (500 créditos al mes): cuotas = 1 crédito por mercado y competición (con los tres
// mercados, h2h + totals + spreads, son 3 por actualización; ODDS_MERCADOS=h2h para volver a 1), resultados con
// daysFrom = 2 créditos.
const repoOdds = require("../repositorios/odds");
const { createLogger } = require("../core/logger");
const { LINEA_GOLES, LINEA_HCAP } = require("../systems/apuestas/mercados");
const directo = require("../systems/apuestas/directo");
const log = createLogger("OddsAPI");

// Mercados que se piden en cada actualización de cuotas: 1X2 (h2h), goles (totals) y hándicap (spreads). Cada mercado
// cuenta como 1 crédito por competición, así que con los tres una actualización cuesta 3 créditos. Para volver al
// coste de antes: ODDS_MERCADOS=h2h.
const MERCADOS = process.env.ODDS_MERCADOS || "h2h,totals,spreads";

// Mercados adicionales (#532): ambos marcan (btts) y doble oportunidad (double_chance). La API solo los da partido a
// partido (/events/{id}/odds) y cada uno cuesta 1 crédito por partido, así que están apagados salvo que se pidan con
// ODDS_MERCADOS_EXTRA=btts,double_chance. Se piden para los ODDS_EXTRA_MAX partidos que antes empiezan en las próximas
// ODDS_EXTRA_HORAS horas, y no se repiten hasta que pase ODDS_EXTRA_MINUTOS.
const extrasConfig = () => ({
    mercados: String(process.env.ODDS_MERCADOS_EXTRA || "")
        .split(",")
        .map((m) => m.trim())
        .filter((m) => m === "btts" || m === "double_chance"),
    horas: Number(process.env.ODDS_EXTRA_HORAS || 48),
    max: Number(process.env.ODDS_EXTRA_MAX || 10),
    refrescoMs: Number(process.env.ODDS_EXTRA_MINUTOS || 360) * 60 * 1000,
});

const BASE_URL = "https://api.the-odds-api.com/v4/sports";

const DEPORTES = {
    laliga: { name: "LaLiga 🇪🇸", apiKey: "soccer_spain_la_liga", emoji: "⚽" },
    premier: { name: "Premier League 🏴󠁧󠁢󠁥󠁮󠁧󠁿", apiKey: "soccer_epl", emoji: "⚽" },
    champions: { name: "Champions League 🏆", apiKey: "soccer_uefa_champs_league", emoji: "🏆" },
    // Las claves de estas cuatro se comprueban con scripts/competicionesOdds.js (la API cambia el nombre de algunas).
    mundial: { name: "Mundial 🌍", apiKey: "soccer_fifa_world_cup", emoji: "🌍" },
    eurocopa: { name: "Eurocopa 🇪🇺", apiKey: "soccer_uefa_european_championship", emoji: "🇪🇺" },
    copa_rey: { name: "Copa del Rey 👑", apiKey: "soccer_spain_copa_del_rey", emoji: "👑" },
    europa: { name: "Europa League 🟠", apiKey: "soccer_uefa_europa_league", emoji: "🟠" },
};

// La API de resultados solo acepta daysFrom de 1 a 3 (con más responde 422
// INVALID_SCORES_DAYS_FROM): no hay forma de saber el resultado de un partido más antiguo.
const DIAS_RESULTADOS = 3;

// Las cuotas apenas cambian en media hora: se reutiliza la última respuesta de cada
// competición durante ODDS_CACHE_MINUTES (antes se pedían en cada consulta de partidos y cada página).
const ODDS_CACHE_MS = Number(process.env.ODDS_CACHE_MINUTES || 30) * 60 * 1000;
const cacheCuotas = new Map(); // deporte -> { data, ts }

// Quién quiere enterarse de que se han guardado cuotas nuevas (las alertas de cuota, #345): se registran al arrancar (index.js), así el
// servicio no depende de las reglas de las apuestas.
const oyentesDeCuotas = [];
/** Registra una función que se llama cada vez que se guardan cuotas nuevas de una competición, con su clave. */
const alRefrescarCuotas = (fn) => void oyentesDeCuotas.push(fn);

// Se lee en cada llamada (no al cargar el módulo) para que los tests puedan fijarla.
const getApiKey = () => process.env.ODDS_API_KEY || "";

// Créditos que quedan este mes (los dice cada respuesta): se enseñan en /paneladmin → 🩺 Sistema y, por debajo de
// CREDITOS_AVISO, se avisa a los admins (systems/alertas) una vez al día.
const CREDITOS_AVISO = Number(process.env.ODDS_CREDITOS_AVISO || 50);
let creditos = { restantes: null, at: null };

function apuntarCreditos(restantes) {
    const n = Number(restantes);
    if (restantes === "?" || restantes === null || !Number.isFinite(n)) return;
    creditos = { restantes: n, at: Date.now() };
    if (n < CREDITOS_AVISO) {
        require("../systems/alertas")
            .alertar({
                clave: "odds-creditos",
                titulo: "⚽ Quedan pocos créditos de la Odds API",
                detalle:
                    `Quedan **${n}** créditos este mes (se avisa por debajo de ${CREDITOS_AVISO}). Sin créditos no se pueden ver ` +
                    "partidos nuevos ni liquidar apuestas hasta que se renueve el plan.",
                cooldownMs: 24 * 60 * 60 * 1000,
            })
            .catch((e) => log.warn(`No se pudo avisar de los créditos: ${e.message}`));
    }
}

/** { restantes, at } de la última respuesta de la API desde el arranque (null si aún no se ha llamado). */
const creditosRestantes = () => ({ ...creditos });

function deporteValido(key) {
    return DEPORTES[key] ? key : "laliga";
}

async function pedir(url, deporte) {
    const res = await fetch(url.replace("{KEY}", encodeURIComponent(getApiKey())), { signal: AbortSignal.timeout(15000) });
    const restantes = res.headers?.get?.("x-requests-remaining") ?? "?";
    apuntarCreditos(restantes);
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

/**
 * Cuotas de los mercados de goles (línea 2,5) y de hándicap (±1,5) de un partido. Cada una es null si la casa no da esa
 * línea: no se ofrece la apuesta en vez de una línea distinta.
 */
function cuotasMercados(match) {
    const markets = match.bookmakers?.[0]?.markets || [];
    const vacio = { cuota_mas: null, cuota_menos: null, total_linea: null, cuota_casa: null, cuota_fuera: null, hcap_linea: null };
    const totals = markets.find((m) => m.key === "totals");
    const spreads = markets.find((m) => m.key === "spreads");
    const enLinea = (outcomes, nombre, linea) => outcomes.find((o) => o.name === nombre && Number(o.point) === linea)?.price ?? null;

    const out = { ...vacio };
    if (totals) {
        const mas = enLinea(totals.outcomes, "Over", LINEA_GOLES);
        const menos = enLinea(totals.outcomes, "Under", LINEA_GOLES);
        if (mas && menos) Object.assign(out, { cuota_mas: mas, cuota_menos: menos, total_linea: LINEA_GOLES });
    }
    if (spreads) {
        // La línea del local: −1,5 (gana por 2 o más) si la hay; si no, +1,5. El visitante tiene la línea contraria.
        const local = spreads.outcomes.find((o) => o.name === match.home_team && Math.abs(Number(o.point)) === LINEA_HCAP);
        if (local) {
            const linea = Number(local.point);
            const visitante = enLinea(spreads.outcomes, match.away_team, -linea);
            if (local.price && visitante) Object.assign(out, { cuota_casa: local.price, cuota_fuera: visitante, hcap_linea: linea });
        }
    }
    return out;
}

/**
 * Cuotas de ambos marcan y doble oportunidad (#532) de un partido de /events/{id}/odds. Cada pareja o trío va entero o a
 * null: no se ofrece medio mercado. La doble oportunidad llega como «Local/Draw», «Local/Visitante» y «Draw/Visitante» (o
 * «1X», «12», «X2»); se reconoce por los nombres, sin depender del orden.
 */
function cuotasExtra(match) {
    const markets = match.bookmakers?.find((b) => b.markets?.some((m) => m.key === "btts" || m.key === "double_chance"))?.markets || [];
    const out = { cuota_ambos_si: null, cuota_ambos_no: null, cuota_dc_1x: null, cuota_dc_12: null, cuota_dc_x2: null };
    const btts = markets.find((m) => m.key === "btts");
    if (btts) {
        const si = btts.outcomes.find((o) => o.name === "Yes")?.price ?? null;
        const no = btts.outcomes.find((o) => o.name === "No")?.price ?? null;
        if (si && no) Object.assign(out, { cuota_ambos_si: si, cuota_ambos_no: no });
    }
    const doble = markets.find((m) => m.key === "double_chance");
    if (doble) {
        const lado = (parte) => (parte === match.home_team || parte === "1" ? "1" : parte === match.away_team || parte === "2" ? "2" : "X");
        const clave = (nombre) => {
            const partes = nombre.includes("/") ? nombre.split("/").map((p) => p.trim()) : [...nombre];
            return partes
                .map(lado)
                .sort((a, b) => "1X2".indexOf(a) - "1X2".indexOf(b))
                .join("");
        };
        const cuotas = Object.fromEntries(doble.outcomes.map((o) => [clave(o.name), o.price]));
        if (cuotas["1X"] && cuotas["12"] && cuotas.X2)
            Object.assign(out, { cuota_dc_1x: cuotas["1X"], cuota_dc_12: cuotas["12"], cuota_dc_x2: cuotas.X2 });
    }
    return out;
}

/** Cuotas 1/X/2 de un partido de la API, o null si ninguna casa las da. */
function cuotasH2H(match) {
    const market = match.bookmakers?.[0]?.markets?.find((m) => m.key === "h2h");
    if (!market) return { home: null, draw: null, away: null };
    const precio = (nombre) => market.outcomes.find((o) => o.name === nombre)?.price ?? null;
    return { home: precio(match.home_team), draw: precio("Draw"), away: precio(match.away_team) };
}

function guardarPartidos(deporteKey, partidos) {
    repoOdds.guardarPartidos(
        deporteKey,
        partidos.map((m) => {
            const c = cuotasH2H(m);
            const x = cuotasMercados(m);
            return { m, c, x };
        }),
    );
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
    return pedirCuotas(deporteKey);
}

/** Pide las cuotas de una competición a la API (sin caché) y las guarda. Cada mercado cuesta un crédito. */
async function pedirCuotas(deporteKey) {
    const deporte = DEPORTES[deporteKey];
    if (!getApiKey()) throw new Error("Falta ODDS_API_KEY en .env");
    const { data, restantes } = await pedir(`${BASE_URL}/${deporte.apiKey}/odds/?apiKey={KEY}&regions=eu&markets=${MERCADOS}`, deporte);
    const partidos = Array.isArray(data) ? data : [];
    guardarPartidos(deporteKey, partidos);
    cacheCuotas.set(deporteKey, { data: partidos, ts: Date.now() });
    for (const fn of oyentesDeCuotas) {
        try {
            Promise.resolve(fn(deporteKey)).catch((e) =>
                log.warn(`Falló un aviso tras refrescar las cuotas de ${deporteKey}: ${e.message}`),
            );
        } catch (e) {
            log.warn(`Falló un aviso tras refrescar las cuotas de ${deporteKey}: ${e.message}`);
        }
    }
    log.info(`Cuotas de ${deporte.name}: ${partidos.length} partidos · créditos restantes: ${restantes}`);
    await pedirMercadosExtra(deporteKey).catch((e) => log.warn(`Mercados adicionales de ${deporte.name}: ${e.message}`));
    return partidos;
}

/**
 * Pide ambos marcan y doble oportunidad (#532) de los próximos partidos de una competición, si están activados. Un fallo
 * en un partido no para a los demás; ese partido se queda sin esos mercados hasta la siguiente vez.
 * @returns {Promise<number>} partidos consultados
 */
async function pedirMercadosExtra(deporteKey, ahora = Date.now()) {
    const cfg = extrasConfig();
    const deporte = DEPORTES[deporteKey];
    if (!cfg.mercados.length || !deporte || !getApiKey()) return 0;
    const pendientes = repoOdds.partidosSinExtras(deporteKey, {
        desdeIso: new Date(ahora).toISOString(),
        hastaIso: new Date(ahora + cfg.horas * 60 * 60 * 1000).toISOString(),
        antesDeMs: ahora - cfg.refrescoMs,
        limite: cfg.max,
    });
    let pedidos = 0;
    for (const p of pendientes) {
        try {
            const url = `${BASE_URL}/${deporte.apiKey}/events/${encodeURIComponent(p.match_id)}/odds?apiKey={KEY}&regions=eu&markets=${cfg.mercados.join(",")}`;
            const { data } = await pedir(url, deporte);
            repoOdds.guardarMercadosExtra(p.match_id, cuotasExtra({ ...p, ...data }), ahora);
            pedidos++;
        } catch (e) {
            log.warn(`Sin mercados adicionales para ${p.home_team} - ${p.away_team}: ${e.message}`);
        }
    }
    if (pedidos) log.info(`Mercados adicionales de ${deporte.name}: ${pedidos} partidos (${cfg.mercados.join(", ")})`);
    return pedidos;
}

/**
 * Apuestas en directo (#12): refresca las cuotas de cada competición que tenga un partido en juego ahora mismo. Solo con
 * ODDS_DIRECTO=1. Un error de una competición no para a las demás.
 * @returns {Promise<number>} cuántas competiciones se han refrescado
 */
async function refrescarEnDirecto(ahora = Date.now()) {
    if (!directo.directoActivo()) return 0;
    const enJuego = repoOdds.deportesEnJuego(new Date(ahora).toISOString(), directo.enJuegoDesde(ahora));
    let refrescadas = 0;
    for (const deporteKey of enJuego) {
        if (!DEPORTES[deporteKey]) continue;
        try {
            await pedirCuotas(deporteKey);
            refrescadas++;
        } catch (e) {
            log.warn(`No se pudieron refrescar las cuotas en directo de ${deporteKey}: ${e.message}`);
        }
    }
    return refrescadas;
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
    cuotasMercados,
    cuotasExtra,
    pedirMercadosExtra,
    refrescarEnDirecto,
    alRefrescarCuotas,
    DEPORTES,
    DIAS_RESULTADOS,
    deporteValido,
    sincronizarPartidos,
    obtenerResultados,
    resultadoDeScore,

    creditosRestantes,
    CREDITOS_AVISO,
    _limpiarCache: () => cacheCuotas.clear(),
};
