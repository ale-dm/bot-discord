// Orquesta de la liquidación: el cerrojo para que no corran dos a la vez y el orden de partidos, quinielas y combinadas.

const { logInfo, logError } = require("../../../core/logger");
const { DEPORTES, DIAS_RESULTADOS, obtenerResultados } = require("../../../services/oddsApi");
const { caducarSinResultado } = require("./caducidad");
const { liquidarPartidosSueltos } = require("./partidos");
const { liquidarQuinielas } = require("./quinielas");

let liquidacionEnCurso = false;
async function liquidarApuestas({ minHorasDesdeInicio = 0, origen = "manual" } = {}) {
    if (liquidacionEnCurso) return null;
    if (!process.env.ODDS_API_KEY) throw new Error("Falta ODDS_API_KEY en .env");
    liquidacionEnCurso = true;
    try {
        const resumen = {
            pagadas: 0,
            fallidas: 0,
            total: 0,
            partidosProcesados: {},
            quinielasCerradas: 0,
            premiosQuiniela: 0,
            caducados: 0,
            reembolsos: 0,
            pagos: [],
            // Lo que se ha cerrado en esta pasada, para publicarlo en el canal de resultados (anunciarResultados).
            partidos: [],
            quinielas: [],
            retos: [],
            // Ids de todos los retos cerrados (también los devueltos), para repintar sus mensajes.
            retosCerrados: [],
        };
        const ahora = Date.now();
        const corte = new Date(ahora - minHorasDesdeInicio * 3600 * 1000).toISOString();
        // La API solo devuelve resultados de los últimos DIAS_RESULTADOS días: lo que empezó antes
        // ya no se puede resolver, y preguntar por ello solo gasta cuota.
        const limite = new Date(ahora - DIAS_RESULTADOS * 24 * 3600 * 1000).toISOString();

        caducarSinResultado(limite, resumen);

        // Los scores de cada deporte se piden una sola vez por liquidación (partidos + quinielas).
        const cacheScores = new Map();
        const scoresDe = async (deporteKey) => {
            if (!cacheScores.has(deporteKey)) {
                const deporte = DEPORTES[deporteKey];
                try {
                    const scores = await obtenerResultados(deporteKey);
                    logInfo(`[PAGARAPUESTAS] API devolvió ${scores.length} resultados para ${deporte.name}`);
                    cacheScores.set(deporteKey, scores);
                } catch (e) {
                    logError(`[PAGARAPUESTAS] Error consultando la API para ${deporte.name}:`, e);
                    cacheScores.set(deporteKey, null);
                }
            }
            return cacheScores.get(deporteKey);
        };

        await liquidarPartidosSueltos({ corte, limite, resumen, scoresDe, origen });

        await liquidarQuinielas({ corte, resumen, scoresDe, origen });

        return resumen;
    } finally {
        liquidacionEnCurso = false;
    }
}

module.exports = { liquidacionEnCurso, liquidarApuestas };
