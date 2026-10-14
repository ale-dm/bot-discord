// Lo que se le dice a quien intenta apostar a un partido y no se le cobra: un título y un texto por motivo. Los motivos los decide
// systems/apuestas/formularioApuesta.apostarAPartido; lo usan el formulario de la ficha del partido y el botón de repetir apuesta.
const marcadorExacto = require("../../systems/apuestas/marcador");
const formulario = require("../../systems/apuestas/formularioApuesta");

const { MIN_BET_AMOUNT, MAX_BET_AMOUNT } = formulario;

/**
 * El aviso de una apuesta rechazada: { titulo, descripcion }.
 * @param {{ motivo: string, match?: object, eleccion?: string, limite?: string }} rechazo lo que devuelve apostarAPartido
 */
function textoRechazo({ motivo, match, eleccion, limite }) {
    switch (motivo) {
        case "cantidad":
            return { titulo: "❌ Error", descripcion: `La cantidad debe estar entre ${MIN_BET_AMOUNT} y ${MAX_BET_AMOUNT} monedas.` };
        case "sinEfectivo":
            return { titulo: "❌ No te llega el efectivo", descripcion: "Saca dinero del banco (💵 Sacar) para hacer esta apuesta." };
        case "sinPartido":
            return { titulo: "❌ Error", descripcion: "No se encontró el partido seleccionado." };
        case "cerrado":
            return {
                titulo: "⏱️ Apuestas cerradas",
                descripcion: `**${match.home_team}** vs **${match.away_team}** ya ha empezado: no se admiten más apuestas.`,
            };
        case "cuota":
            return { titulo: "❌ Error", descripcion: "La cuota para este resultado no es válida." };
        case "duplicada":
            return {
                titulo: "❌ Ya has apostado",
                descripcion: marcadorExacto.marcadorDe(eleccion)
                    ? "Ya tienes una apuesta a ese marcador en este partido."
                    : "Ya tienes una apuesta activa para este partido y resultado.",
            };
        case "limite":
            return { titulo: "🚦 Límite de apuestas", descripcion: limite };
        default:
            return { titulo: "❌ Error", descripcion: "No se pudo hacer la apuesta." };
    }
}

module.exports = { textoRechazo };
