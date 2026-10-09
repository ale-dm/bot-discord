const { Type: SchemaType } = require("@google/genai");
const { proponer, cantidadDe, sinNegritas } = require("./base");

// 🧙 El Duende en la economía (F-DU-03): proponer un reto, una apuesta o un préstamo al que habla. Solo se ofrecen
// donde la propuesta puede salir con botones (toolContext.propuestas: el chat de texto, no la voz).
const DUENDE_ECONOMIA_TOOL_DECLARATIONS = [
    {
        name: "retar_piedra_papel_tijera",
        description:
            "Reta al usuario que te está hablando a piedra, papel o tijera por monedas (también si te reta él). No mueve dinero: debajo de tu respuesta sale un mensaje con botones y el duelo solo empieza si lo acepta. Tu jugada se elige al azar. De 10 a 1.000 monedas.",
        parameters: {
            type: SchemaType.OBJECT,
            properties: { cantidad: { type: SchemaType.NUMBER, description: "Monedas que se juega cada uno (10 a 1.000)" } },
            required: ["cantidad"],
        },
    },
    {
        name: "apostar_partido_con_duende",
        description:
            "Propón al usuario que te está hablando una apuesta 1 contra 1 contigo a un partido de fútbol de los de ⚽ Apuestas: él va con un resultado y tú con lo contrario (p. ej. 'te apuesto 200 a que gana el Betis'). No mueve dinero: debajo de tu respuesta sale un mensaje con botones y la apuesta solo empieza si la acepta. De 10 a 1.000 monedas.",
        parameters: {
            type: SchemaType.OBJECT,
            properties: {
                equipo: {
                    type: SchemaType.STRING,
                    description:
                        "El equipo que el usuario dice que gana, con su nombre oficial (p. ej. 'Barcelona', no 'Barça'), o 'empate'",
                },
                partido: {
                    type: SchemaType.STRING,
                    description:
                        "Los equipos del partido (p. ej. 'Betis Sevilla'), si hace falta para encontrarlo; obligatorio si apuesta al empate",
                },
                cantidad: { type: SchemaType.NUMBER, description: "Monedas que se juega cada uno (10 a 1.000)" },
            },
            required: ["equipo", "cantidad"],
        },
    },
    {
        name: "ofrecer_prestamo",
        description:
            "Ofrece al usuario que te está hablando un préstamo de monedas cuando te pida dinero: de 10 a 1.000, con un 10 % de interés, a devolver en 7 días. No mueve dinero: debajo de tu respuesta sale un mensaje con botones y el préstamo solo se hace si lo acepta. Uno a la vez.",
        parameters: {
            type: SchemaType.OBJECT,
            properties: { cantidad: { type: SchemaType.NUMBER, description: "Monedas que le prestas (10 a 1.000)" } },
            required: ["cantidad"],
        },
    },
];

/** Deja una propuesta del Duende para que salga con botones debajo de su respuesta (duende.js). */

const DUENDE_ECONOMIA_EXECUTORS = {
    retar_piedra_papel_tijera(args, ctx) {
        if (!ctx.guildId) return { error: "Solo disponible en servidores." };
        const cantidad = cantidadDe(args);
        const motivo = require("../../../systems/retos").motivoNoContraDuende(ctx.userId, cantidad);
        if (motivo) return { error: sinNegritas(motivo) };
        return proponer(ctx, { tipo: "ppt", cantidad });
    },
    apostar_partido_con_duende(args, ctx) {
        if (!ctx.guildId) return { error: "Solo disponible en servidores." };
        const retos = require("../../../systems/retos");
        const cantidad = cantidadDe(args);
        const partido = retos.buscarPartido(`${args?.partido || ""} ${args?.equipo || ""}`);
        const proximos = () =>
            retos
                .partidosParaRetar(8)
                .map(
                    (p) =>
                        `${p.home_team} vs ${p.away_team} (${new Date(p.start_time).toLocaleString("es-ES", { timeZone: "Europe/Madrid" })})`,
                );
        if (!partido) {
            return { error: "No encuentro ese partido entre los próximos de ⚽ Apuestas.", proximos_partidos: proximos() };
        }
        const eleccion = retos.eleccionPara(partido, args?.equipo);
        if (!eleccion) {
            return {
                error: `En ${partido.home_team} vs ${partido.away_team} no sé por cuál va: di uno de los dos equipos o 'empate'.`,
                proximos_partidos: proximos(),
            };
        }
        const motivo = retos.motivoNoContraDuende(ctx.userId, cantidad, { matchId: partido.match_id, eleccion });
        if (motivo) return { error: sinNegritas(motivo) };
        return proponer(ctx, { tipo: "partido", cantidad, matchId: partido.match_id, eleccion });
    },
    ofrecer_prestamo(args, ctx) {
        if (!ctx.guildId) return { error: "Solo disponible en servidores." };
        const cantidad = cantidadDe(args);
        const motivo = require("../../../systems/prestamos").motivoNoPrestar(ctx.userId, cantidad);
        if (motivo) return { error: sinNegritas(motivo) };
        return proponer(ctx, { tipo: "prestamo", cantidad });
    },
};

module.exports = { DUENDE_ECONOMIA_TOOL_DECLARATIONS, DUENDE_ECONOMIA_EXECUTORS };
