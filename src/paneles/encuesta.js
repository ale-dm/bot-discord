// 📊 El mensaje de una encuesta (#426): la pregunta, el recuento en vivo de cada opción y un botón por opción, o el resultado
// final con los botones desactivados cuando está cerrada. Solo construye mensajes; las reglas están en systems/encuestas.
const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require("discord.js");
const encuestas = require("../systems/encuestas");

const ANCHO_BARRA = 10;
const ts = (ms, estilo = "R") => `<t:${Math.floor(ms / 1000)}:${estilo}>`;

/** «██████░░░░ 3 (60 %)» para una opción con `n` votos de `total`. */
function barra(n, total) {
    const pct = total ? Math.round((n / total) * 100) : 0;
    const llenos = total ? Math.round((n / total) * ANCHO_BARRA) : 0;
    return `${"█".repeat(llenos)}${"░".repeat(ANCHO_BARRA - llenos)} **${n}** (${pct} %)`;
}

/** El mensaje público de una encuesta, con el recuento actual. */
function mensajeEncuesta(encuesta, recuento = encuestas.recuento(encuesta.id)) {
    const cerrada = encuesta.estado !== "abierta";
    const max = Math.max(...recuento.conteos);
    const lineas = encuesta.opciones.map((opcion, n) => {
        const ganadora = cerrada && recuento.total > 0 && recuento.conteos[n] === max;
        return `**${n + 1}. ${opcion}**${ganadora ? " 🏆" : ""}\n${barra(recuento.conteos[n], recuento.total)}`;
    });
    const embed = new EmbedBuilder()
        .setTitle(`📊 ${encuesta.pregunta}`)
        .setColor(cerrada ? 0x95a5a6 : 0x3498db)
        .setDescription(
            `${lineas.join("\n\n")}\n\n` +
                (cerrada
                    ? `🔒 **Encuesta cerrada** · ${recuento.total} ${recuento.total === 1 ? "voto" : "votos"}`
                    : `${recuento.total} ${recuento.total === 1 ? "voto" : "votos"} · se cierra ${ts(encuesta.cierra_en)} · puedes cambiar tu voto`),
        )
        .setFooter({ text: `Encuesta #${encuesta.id} · solo se ve el recuento, no quién votó` });
    const botones = encuesta.opciones.map((opcion, n) =>
        new ButtonBuilder()
            .setCustomId(`encuesta_voto_${encuesta.id}_${n}`)
            .setLabel(`${n + 1}. ${opcion}`.slice(0, 80))
            .setStyle(ButtonStyle.Primary)
            .setDisabled(cerrada),
    );
    const cerrar = new ButtonBuilder()
        .setCustomId(`encuesta_cerrar_${encuesta.id}`)
        .setLabel("🔒 Cerrar (quien la creó)")
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(cerrada);
    return { embeds: [embed], components: [new ActionRowBuilder().addComponents(botones), new ActionRowBuilder().addComponents(cerrar)] };
}

module.exports = { mensajeEncuesta, barra };
