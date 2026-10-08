// 🔴 Apuestas en directo (#12): con ODDS_DIRECTO=1, un partido que ya ha empezado sigue admitiendo apuestas durante su
// partido (DURACION_MS), con las cuotas que se refrescan cada pocos minutos (services/oddsApi.refrescarEnDirecto). Sin
// esa variable, todo se cierra al empezar, como antes. Cada refresco gasta créditos de la Odds API (3 por competición),
// por eso va apagado: el plan gratuito se agota en un fin de semana si se refresca mucho.
// Lo que sigue cerrado al empezar: retos, quinielas y combinadas no (las combinadas sí, igual que las apuestas simples).
const DURACION_MS = 2 * 60 * 60 * 1000; // lo mismo que la liquidación espera antes de preguntar el resultado

const directoActivo = () => process.env.ODDS_DIRECTO === "1";

/** ¿Se puede apostar a este partido ahora? Mismo criterio para las apuestas simples y las combinadas. */
function abiertoParaApostar(partido, ahora = Date.now()) {
    if (!partido || partido.estado !== "abierto") return false;
    const inicio = Date.parse(partido.start_time);
    if (!Number.isFinite(inicio)) return false;
    if (inicio > ahora) return true;
    return directoActivo() && ahora < inicio + DURACION_MS;
}

/** Desde cuándo (ISO) se listan los partidos para apostar: los que aún no han empezado, y los en directo si está activo. */
function inicioListado(ahora = Date.now()) {
    return new Date(directoActivo() ? ahora - DURACION_MS : ahora).toISOString();
}

/** Desde cuándo (ISO) un partido empezado sigue en juego (para refrescar sus cuotas). */
function enJuegoDesde(ahora = Date.now()) {
    return new Date(ahora - DURACION_MS).toISOString();
}

module.exports = { DURACION_MS, directoActivo, abiertoParaApostar, inicioListado, enJuegoDesde };
