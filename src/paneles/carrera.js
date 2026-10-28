// 🏇 El mensaje de una carrera (#535): los 6 caballos con su cuota y lo apostado a cada uno, un botón por caballo para
// apostar, los fotogramas de la carrera (la pista con cada caballo avanzando) y el resultado con quién ha cobrado. También el
// formulario de la apuesta. Solo construye mensajes; las reglas están en systems/carreras.js.
const {
    EmbedBuilder,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    ModalBuilder,
    TextInputBuilder,
    TextInputStyle,
} = require("discord.js");
const carreras = require("../systems/carreras");
const { fmtNumero } = require("../core/formato");

const COLOR = 0x27ae60;
const META = 20;
const FOTOGRAMAS = 5;

const ts = (ms, estilo = "R") => `<t:${Math.floor(ms / 1000)}:${estilo}>`;
const cuota = (n) => String(n).replace(".", ",");

/** Lo apostado a cada caballo (número de apuestas y monedas). */
function apostadoPorCaballo(c) {
    const totales = c.corredores.map(() => ({ n: 0, monedas: 0 }));
    for (const a of carreras.apuestas(c.id)) {
        totales[a.corredor].n++;
        totales[a.corredor].monedas += a.cantidad;
    }
    return totales;
}

/**
 * Las posiciones de cada caballo en cada fotograma (de 0 a la meta). El ganador ya decidido es el único que llega a la meta en
 * el último. `azar` se inyecta en los tests.
 */
function fotogramas(ganador, numero = 6, azar = Math.random) {
    const pos = Array.from({ length: numero }, () => 0);
    const salida = [];
    for (let f = 1; f <= FOTOGRAMAS; f++) {
        for (let i = 0; i < numero; i++) pos[i] = Math.min(META - 1, pos[i] + 1 + Math.floor(azar() * 4));
        if (f === FOTOGRAMAS) pos[ganador] = META;
        salida.push([...pos]);
    }
    return salida;
}

function pista(c, posiciones) {
    return c.corredores
        .map((cab, i) => {
            const p = posiciones[i];
            return `\`${"·".repeat(p)}${cab.emoji}${" ".repeat(META - p)}\`🏁 ${cab.nombre}`;
        })
        .join("\n");
}

function lineasCaballos(c) {
    const totales = apostadoPorCaballo(c);
    return c.corredores
        .map((cab, i) => {
            const t = totales[i];
            const marca = c.estado === "resuelta" && c.ganador === i ? " 🏆" : "";
            return `${cab.emoji} **${cab.nombre}** · ×${cuota(cab.cuota)} · ${t.n} ${t.n === 1 ? "apuesta" : "apuestas"} (${fmtNumero(t.monedas)} 🪙)${marca}`;
        })
        .join("\n");
}

/** El mensaje de la carrera: abierta (con los botones de apostar), corriéndose (con `posiciones`) o resuelta. */
function mensajeCarrera(c, posiciones = null, ganadores = null) {
    const { maxApuesta } = carreras.ajustes(c.guildId);
    const embed = new EmbedBuilder().setColor(COLOR).setTitle(`🏇 Carrera #${c.id}`);
    if (posiciones) {
        embed.setDescription(`🏁 **¡Ya corren!**\n\n${pista(c, posiciones)}`);
    } else if (c.estado === "resuelta") {
        const g = c.corredores[c.ganador];
        const cobran = (ganadores || []).map((x) => `<@${x.userId}> · **${fmtNumero(x.premio)}** 🪙`).join("\n");
        embed.setDescription(
            `🏆 **Ha ganado ${g.emoji} ${g.nombre}** (×${cuota(g.cuota)})\n\n${lineasCaballos(c)}${cobran ? `\n\n💰 Cobran:\n${cobran}` : ""}`,
        );
    } else {
        embed.setDescription(
            `Sale ${ts(c.empieza, "t")} (${ts(c.empieza)}). Apuesta a un caballo (uno por carrera, de ${carreras.MIN_APUESTA} a ` +
                `${fmtNumero(maxApuesta)} 🪙): si gana, cobras lo apostado × su cuota.\n\n${lineasCaballos(c)}`,
        );
    }
    const abierta = c.estado === "abierta" && !posiciones;
    const botones = c.corredores.map((cab, i) =>
        new ButtonBuilder()
            .setCustomId(`carrera_apostar_${c.id}_${i}`)
            .setLabel(`${cab.nombre} ×${cuota(cab.cuota)}`)
            .setEmoji(cab.emoji)
            .setStyle(ButtonStyle.Primary)
            .setDisabled(!abierta),
    );
    const components = abierta
        ? [new ActionRowBuilder().addComponents(botones.slice(0, 3)), new ActionRowBuilder().addComponents(botones.slice(3))]
        : [];
    return { content: "", embeds: [embed], components, allowedMentions: { parse: [] } };
}

/** El formulario de apostar a un caballo. */
function modalApuesta(c, corredor) {
    const cab = c.corredores[corredor];
    return new ModalBuilder()
        .setCustomId(`carrera_modal_${c.id}_${corredor}`)
        .setTitle(`🏇 ${cab.nombre} ×${cuota(cab.cuota)}`.slice(0, 45))
        .addComponents(
            new ActionRowBuilder().addComponents(
                new TextInputBuilder()
                    .setCustomId("cantidad")
                    .setLabel(`Cuánto apuestas (${carreras.MIN_APUESTA} a ${fmtNumero(carreras.ajustes(c.guildId).maxApuesta)})`)
                    .setStyle(TextInputStyle.Short)
                    .setMaxLength(9)
                    .setRequired(true),
            ),
        );
}

module.exports = { mensajeCarrera, modalApuesta, fotogramas, META, FOTOGRAMAS };
