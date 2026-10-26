// 🗳️ Lo que se publica en el canal de las elecciones al cambiar de fase, y los programas electorales (en el canal, en el botón
// 📜 Programas y por DM al empezar las generales). Solo construye mensajes.
const { EmbedBuilder } = require("discord.js");
const { fases } = require("../../systems/elecciones");
const { tablaResultados, ts } = require("./panel");

const COLOR_PROGRAMA = 0xf1c40f;

const mencionar = (lista) => lista.map((c) => `<@${c.userId}>`).join(", ");

/** El texto del anuncio de un cambio de fase (lo que devuelve fases.avanzar), o null si no hay nada que contar. */
function textoAnuncio(r) {
    const e = r.eleccion;
    switch (r.a) {
        case "primarias":
            return `🗳️ **¡Empiezan las primarias!** Se presentan ${r.candidatos.length} candidatos y pasan los ${fases.FINALISTAS} más votados. Se vota hasta ${ts(e.fase_fin, "f")}.`;
        case "programas":
            return r.sinPrimarias
                ? `📜 **Inscripción cerrada.** Como no hay más candidatos que plazas, todos pasan a las generales: ${mencionar(r.finalistas)}. Ahora escriben su programa electoral.`
                : `📜 **Resultado de las primarias**\n${tablaResultados(r.clasificacion)}\n\nPasan a las generales: ${mencionar(r.finalistas)}. Tienen hasta ${ts(e.fase_fin, "f")} para escribir su programa.`;
        case "generales":
            return `🏛️ **¡Empiezan las elecciones generales!** Os he enviado por privado el programa de cada candidato. Se vota hasta ${ts(e.fase_fin, "f")}.`;
        case "mandato":
            return `👑 **¡<@${r.ganador.userId}>${r.ganador.partido ? ` (${r.ganador.partido})` : ""} es el nuevo presidente del servidor!**\n${tablaResultados(r.clasificacion)}\n\nSu mandato dura hasta ${ts(e.fase_fin, "f")}.`;
        case "cerrada":
            return `🏁 **Se acabó el mandato de <@${r.presidenteId}>.** Gracias por tu servicio, presidente.`;
        case "cancelada":
            return `✖️ **Elecciones canceladas.** ${r.motivo}`;
        default:
            return null;
    }
}

/** Un embed por programa electoral (los finalistas sin programa salen avisando de que no lo entregaron). */
function embedsProgramas(finalistas, nombres = new Map()) {
    return finalistas.slice(0, fases.FINALISTAS).map((c) =>
        new EmbedBuilder()
            .setColor(COLOR_PROGRAMA)
            .setAuthor({ name: `${c.partido ? `🎗️ ${c.partido} · ` : ""}${nombres.get(c.userId) || c.userId}` })
            .setTitle(c.programa_titulo ? `📜 ${c.programa_titulo}` : "📜 Sin programa")
            .setDescription(
                c.programa_texto ? `*«${c.eslogan}»*\n\n${c.programa_texto}` : "Este candidato no ha entregado programa electoral.",
            ),
    );
}

/** El DM con los programas que reciben los votantes al empezar las generales. */
function dmProgramas(eleccion, finalistas, nombreServidor, nombres) {
    return {
        content:
            `🏛️ **Empiezan las elecciones generales en ${nombreServidor}.** Estos son los programas de los candidatos. ` +
            `Vota en el canal de las elecciones antes del ${ts(eleccion.fase_fin, "f")}.\n` +
            "-# Puedes dejar de recibir estos avisos con /avisos → 🗳️ Elecciones.",
        embeds: embedsProgramas(finalistas, nombres),
        allowedMentions: { parse: [] },
    };
}

module.exports = { textoAnuncio, embedsProgramas, dmProgramas };
