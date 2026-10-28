// 🎟️ El panel de /loteria (#524): el bote, cuándo es el sorteo, el precio y el tope, tus boletos y el último resultado, con
// los botones de comprar al azar o eligiendo números; el formulario de elegirlos y el texto del anuncio del sorteo. Solo
// construye mensajes; las reglas están en systems/loteria.js.
const {
    EmbedBuilder,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    ModalBuilder,
    TextInputBuilder,
    TextInputStyle,
} = require("discord.js");
const loteria = require("../systems/loteria");
const { fmtNumero } = require("../core/formato");

const COLOR = 0xf1c40f;
const ts = (ms, estilo = "R") => `<t:${Math.floor(ms / 1000)}:${estilo}>`;
const bolas = (numeros) =>
    numeros
        .split("-")
        .map((n) => `\`${n.padStart(2, " ")}\``)
        .join(" ");

/** El panel de la lotería para `userId`. */
function pantallaLoteria(guildId, userId, aviso = "") {
    const sorteo = loteria.abierto(guildId);
    const { precio, maxBoletos } = loteria.ajustes(guildId);
    const mios = loteria.boletosDe(sorteo.id, userId);
    const ultimo = loteria.ultimo(guildId);
    const embed = new EmbedBuilder()
        .setTitle("🎟️ Lotería semanal")
        .setColor(COLOR)
        .setDescription(
            (aviso ? `${aviso}\n\n` : "") +
                `💰 **Bote: ${fmtNumero(sorteo.bote)}** 🪙 (más el ${loteria.APORTACION_PCT} % del bote de impuestos al sortear)\n` +
                `📅 Sorteo ${ts(sorteo.sorteo_en, "F")} (${ts(sorteo.sorteo_en)})\n` +
                `🎫 Cada boleto: **${fmtNumero(precio)}** 🪙 en efectivo · hasta **${maxBoletos}** por persona\n\n` +
                `Elige ${loteria.NUMEROS} números del 1 al ${loteria.MAX_NUMERO}. Si aciertas los ${loteria.NUMEROS}, te llevas el bote ` +
                "(a partes iguales si hay varios acertantes). Si nadie acierta, el bote se acumula para la semana siguiente.",
        )
        .addFields({
            name: `Tus boletos (${mios.length}/${maxBoletos})`,
            value: mios.length ? mios.map((b) => bolas(b.numeros)).join("\n") : "Todavía no tienes ninguno para este sorteo.",
        });
    if (ultimo) {
        embed.addFields({
            name: "Último sorteo",
            value: `${bolas(ultimo.combinacion)} · ${ts(ultimo.sorteado_en)} · bote de ${fmtNumero(ultimo.bote + ultimo.aportacion)} 🪙`,
        });
    }
    const lleno = mios.length >= maxBoletos;
    const fila = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId("loteria_azar").setLabel("🎲 Boleto al azar").setStyle(ButtonStyle.Success).setDisabled(lleno),
        new ButtonBuilder().setCustomId("loteria_elegir").setLabel("✍️ Elegir números").setStyle(ButtonStyle.Primary).setDisabled(lleno),
        new ButtonBuilder().setCustomId("loteria_actualizar").setLabel("🔄 Actualizar").setStyle(ButtonStyle.Secondary),
    );
    return { content: "", embeds: [embed], components: [fila], allowedMentions: { parse: [] } };
}

/** El formulario de elegir los números. */
function formularioNumeros() {
    return new ModalBuilder()
        .setCustomId("loteria_modal_numeros")
        .setTitle("✍️ Tu boleto")
        .addComponents(
            new ActionRowBuilder().addComponents(
                new TextInputBuilder()
                    .setCustomId("numeros")
                    .setLabel(`${loteria.NUMEROS} números del 1 al ${loteria.MAX_NUMERO}, sin repetir`)
                    .setStyle(TextInputStyle.Short)
                    .setPlaceholder("3 7 12 20")
                    .setMaxLength(20)
                    .setRequired(true),
            ),
        );
}

/** El anuncio del resultado de un sorteo (lo que devuelve loteria.sortear). */
function textoResultado(r, { atrasado = false } = {}) {
    const cabecera = `🎟️ **Sorteo de la lotería${atrasado ? " (atrasado: el bot estaba apagado a la hora)" : ""}**: ${bolas(r.combinacion)}`;
    const aporte = r.aportacion ? ` (con ${fmtNumero(r.aportacion)} 🪙 del bote de impuestos)` : "";
    if (r.ganadores.length) {
        const lista = r.ganadores.map((g) => `<@${g.userId}> — **${fmtNumero(g.premio)}** 🪙`).join("\n");
        return `${cabecera}\n💰 Bote de **${fmtNumero(r.total)}** 🪙${aporte}.\n🏆 ¡Premio!\n${lista}`;
    }
    return (
        `${cabecera}\n💰 Bote de **${fmtNumero(r.total)}** 🪙${aporte}, ${r.boletos} ${r.boletos === 1 ? "boleto" : "boletos"}.\n` +
        `Nadie ha acertado: el bote pasa al sorteo del ${ts(r.siguiente.sorteo_en, "D")}.`
    );
}

module.exports = { pantallaLoteria, formularioNumeros, textoResultado };
