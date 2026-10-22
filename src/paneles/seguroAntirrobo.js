// Pantalla del 🛡️ seguro antirrobo (#526), dentro de /perfil → 💰 Economía. Enseña si está activo, lo
// que le queda, la prima y los límites, y deja comprarlo o renovarlo. Las reglas, en systems/seguroAntirrobo.
const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require("discord.js");
const seguro = require("../systems/seguroAntirrobo");
const dinero = require("../systems/dinero");
const { fmtNumero } = require("../core/formato");

/** Pantalla del seguro. `aviso` es lo que ha pasado al comprar o renovar (o el motivo de que no se pueda). */
function buildSeguro(userId, guildId, aviso = null) {
    const cfg = seguro.config(guildId);
    const e = seguro.estado(userId);
    const gastable = dinero.efectivo(userId) + dinero.negro(userId);
    const estado = e.activo
        ? `Activo hasta <t:${Math.floor(e.vencimiento / 1000)}:f> (<t:${Math.floor(e.vencimiento / 1000)}:R>)`
        : "Sin seguro";
    const embed = new EmbedBuilder()
        .setTitle("🛡️ Seguro antirrobo")
        .setDescription(
            (aviso ? `${aviso}\n\n` : "") +
                "Mientras está activo, los robos contra ti fallan el **60 %** de las veces; si aciertan, se llevan **la mitad**. " +
                "No se acumula: renovar extiende desde el vencimiento. Se cobra del dinero gastable (🥷 negro primero y luego 💵 efectivo).",
        )
        .addFields(
            { name: "Estado", value: estado, inline: true },
            { name: "Prima", value: `**${fmtNumero(cfg.precio)}** 🪙`, inline: true },
            { name: "Duración", value: `**${cfg.horas} h**`, inline: true },
            {
                name: "Límites",
                value: `Una compra cada **${cfg.cooldownMs / seguro.HORA_MS} h** · como mucho **${cfg.topeMs / seguro.DIA_MS} días** por delante`,
                inline: false,
            },
            { name: "Tu dinero gastable", value: `**${fmtNumero(gastable)}** 🪙`, inline: true },
        )
        .setColor(0x2ecc71)
        .setTimestamp();
    const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId("dinero_seguro_comprar")
            .setLabel(e.activo ? "🔁 Renovar seguro" : "🛡️ Comprar seguro")
            .setStyle(ButtonStyle.Success)
            .setDisabled(gastable < cfg.precio),
        new ButtonBuilder().setCustomId("dinero_panel").setLabel("◀ Economía").setStyle(ButtonStyle.Secondary),
    );
    return { content: "", embeds: [embed], components: [row] };
}

module.exports = { buildSeguro };
