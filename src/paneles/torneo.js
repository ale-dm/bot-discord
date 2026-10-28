// 🏆 El mensaje público de un torneo de casino (#525): juego, inscripción, bote, horario y quién se ha apuntado, la
// clasificación en directo mientras se juega y el resultado con los premios al terminar, con el botón de inscribirse.
// También el anuncio de cada cambio de fase. Solo construye mensajes; las reglas están en systems/torneos.js.
const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require("discord.js");
const torneos = require("../systems/torneos");
const { fmtNumero } = require("../core/formato");

const COLOR = 0xd4ac0d;
const MAX_LINEAS = 10;
const ESTADO = { inscripcion: "📝 Inscripción abierta", en_curso: "🎰 En juego", terminado: "🏁 Terminado", cancelado: "✖️ Cancelado" };
const MEDALLA = ["🥇", "🥈", "🥉"];

const ts = (ms, estilo = "R") => `<t:${Math.floor(ms / 1000)}:${estilo}>`;
const nombreJuego = (juego) => (juego === "todos" ? "todos los juegos del casino" : juego);
const signo = (n) => `${n > 0 ? "+" : ""}${fmtNumero(n)}`;

function lineas(t) {
    if (t.estado === "inscripcion") {
        const lista = torneos.inscritos(t.id);
        return lista.length
            ? lista
                  .slice(0, MAX_LINEAS * 2)
                  .map((i) => `<@${i.userId}>`)
                  .join(" · ")
            : "Nadie todavía.";
    }
    if (t.estado === "terminado") {
        const filas = torneos
            .inscritos(t.id)
            .sort((a, b) => a.puesto - b.puesto)
            .slice(0, MAX_LINEAS);
        return filas
            .map(
                (f) =>
                    `${MEDALLA[f.puesto - 1] || `${f.puesto}.`} <@${f.userId}> · ${signo(f.neto)}${f.premio ? ` · **${fmtNumero(f.premio)}** 🪙` : ""}`,
            )
            .join("\n");
    }
    const tabla = torneos.clasificacion(t, Date.now()).slice(0, MAX_LINEAS);
    return tabla.map((f, n) => `${MEDALLA[n] || `${n + 1}.`} <@${f.userId}> · ${signo(f.neto)}`).join("\n") || "Nadie.";
}

/** El mensaje del torneo, según su estado. */
function mensajeTorneo(t) {
    const premios = torneos.REPARTO.map((p, n) => `${MEDALLA[n]} ${p} %`).join(" · ");
    const horario =
        t.estado === "inscripcion"
            ? `Empieza ${ts(t.empieza, "f")} (${ts(t.empieza)}) y dura hasta ${ts(t.termina, "f")}`
            : t.estado === "en_curso"
              ? `Acaba ${ts(t.termina, "f")} (${ts(t.termina)})`
              : `Jugado del ${ts(t.empieza, "f")} al ${ts(t.termina, "f")}`;
    const embed = new EmbedBuilder()
        .setTitle(`🏆 Torneo de casino #${t.id} · ${ESTADO[t.estado]}`)
        .setColor(COLOR)
        .setDescription(
            `🎰 Juego: **${nombreJuego(t.juego)}** · gana quien más gane en neto (premios menos apuestas) durante el torneo.\n` +
                `🎟️ Inscripción **${fmtNumero(t.inscripcion)}** 🪙 · 💰 Bote **${fmtNumero(t.bote)}** 🪙 · ${premios}\n⏰ ${horario}`,
        )
        .addFields({
            name: t.estado === "inscripcion" ? `Inscritos (${torneos.inscritos(t.id).length})` : "Clasificación",
            value: lineas(t),
        })
        .setFooter({ text: "Solo cuentan las partidas jugadas dentro del horario del torneo." });
    const fila = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId(`torneo_inscribir_${t.id}`)
            .setLabel(`🎟️ Inscribirme (${fmtNumero(t.inscripcion)} 🪙)`)
            .setStyle(ButtonStyle.Success)
            .setDisabled(t.estado !== "inscripcion"),
    );
    return { content: "", embeds: [embed], components: [fila], allowedMentions: { parse: [] } };
}

/** El anuncio de un cambio de fase (lo que devuelve torneos.avanzar). */
function textoAnuncio(r) {
    const t = r.torneo;
    if (r.paso === "empieza")
        return `🎰 **¡Empieza el torneo de casino #${t.id}!** Juega a ${nombreJuego(t.juego)} hasta ${ts(t.termina, "t")}. Bote: **${fmtNumero(t.bote)}** 🪙.`;
    if (r.paso === "cancelado")
        return `✖️ **Torneo #${t.id} cancelado**: hacían falta al menos ${torneos.MIN_INSCRITOS} inscritos. Se ha devuelto la inscripción.`;
    const ganadores = r.premios
        .filter((p) => p.premio > 0)
        .map((p) => `${MEDALLA[p.puesto - 1] || `${p.puesto}.`} <@${p.userId}> (${signo(p.neto)}) · **${fmtNumero(p.premio)}** 🪙`)
        .join("\n");
    return `🏁 **Ha terminado el torneo de casino #${t.id}.**\n${ganadores}`;
}

module.exports = { mensajeTorneo, textoAnuncio };
