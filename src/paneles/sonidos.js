// 🔊 El panel de sonidos (/sonidos): un botón por sonido, de 20 en 20 (4 filas de 5 y una de páginas).
const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require("discord.js");
const sonidos = require("../systems/sonidos");
const { trozos } = require("./filas");

const POR_PAGINA = 20;

function pantallaSonidos(guildId, pagina = 0) {
    const lista = sonidos.listar(guildId);
    const paginas = Math.max(1, Math.ceil(lista.length / POR_PAGINA));
    const p = Math.min(Math.max(0, Number(pagina) || 0), paginas - 1);
    const embed = new EmbedBuilder()
        .setTitle("🔊 Sonidos")
        .setColor(0x3498db)
        .setDescription(
            lista.length
                ? "Pulsa uno: el bot entra a tu canal de voz, lo toca y se sale."
                : "Todavía no hay sonidos. Un admin puede añadir uno con `/sonidos archivo:… nombre:…`.",
        );
    if (lista.length) embed.setFooter({ text: `Página ${p + 1} de ${paginas} · ${lista.length} sonidos` });

    const botones = lista
        .slice(p * POR_PAGINA, (p + 1) * POR_PAGINA)
        .map((s) =>
            new ButtonBuilder().setCustomId(`sonido_play_${s.id}`).setLabel(`🔊 ${s.nombre}`.slice(0, 80)).setStyle(ButtonStyle.Secondary),
        );
    const filas = trozos(botones).map((grupo) => new ActionRowBuilder().addComponents(...grupo));
    if (paginas > 1) {
        filas.push(
            new ActionRowBuilder().addComponents(
                new ButtonBuilder()
                    .setCustomId(`sonido_pagina_${p - 1}`)
                    .setLabel("◀ Anteriores")
                    .setStyle(ButtonStyle.Primary)
                    .setDisabled(p === 0),
                new ButtonBuilder()
                    .setCustomId(`sonido_pagina_${p + 1}`)
                    .setLabel("Siguientes ▶")
                    .setStyle(ButtonStyle.Primary)
                    .setDisabled(p >= paginas - 1),
            ),
        );
    }
    return { content: "", embeds: [embed], components: filas };
}

module.exports = { pantallaSonidos, POR_PAGINA };
