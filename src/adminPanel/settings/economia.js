// ⚙️ Config Global → 🛡️ Economía (#526): la prima, la duración, el cooldown y el tope del seguro
// antirrobo. El seguro se compra en /perfil → 💰 Economía; aquí solo se ajusta lo que cuesta y dura.
const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags } = require("discord.js");
const seguro = require("../../systems/seguroAntirrobo");
const { fmtNumero } = require("../../core/formato");
const { modalConCampos } = require("../common");
const { guardarAuditado } = require("./guardar");
const { navRow } = require("./vistas");

const entero = (n, min, max) => Number.isInteger(n) && n >= min && n <= max;

function buildEconomiaPanel(guildId) {
    const cfg = seguro.config(guildId);
    const embed = new EmbedBuilder()
        .setTitle("🛡️ Economía")
        .setDescription(
            "El **seguro antirrobo** se compra en `/perfil` → 💰 Economía. Mientras está activo, los robos contra esa " +
                "persona fallan el 60 % de las veces y, si aciertan, se llevan la mitad.",
        )
        .addFields(
            { name: "Prima", value: `**${fmtNumero(cfg.precio)}** 🪙`, inline: true },
            { name: "Duración", value: `**${cfg.horas} h**`, inline: true },
            { name: "Cooldown", value: `**${cfg.cooldownMs / seguro.HORA_MS} h**`, inline: true },
            { name: "Tope", value: `**${cfg.topeMs / seguro.DIA_MS} días** por delante`, inline: true },
        )
        .setColor(0x2ecc71)
        .setTimestamp();
    const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId("paneladmin_cfg_economia_seguro_edit").setLabel("✏️ Editar seguro").setStyle(ButtonStyle.Primary),
    );
    return { embeds: [embed], components: [row, navRow()] };
}

async function abrirModalSeguro(interaction, guildId) {
    const cfg = seguro.config(guildId);
    await interaction.showModal(
        modalConCampos("paneladmin_cfg_economia_seguro_modal", "Seguro antirrobo", [
            { id: "precio", label: "Prima (monedas)", value: String(cfg.precio) },
            { id: "horas", label: "Duración (horas)", value: String(cfg.horas) },
            { id: "cooldown", label: "Cooldown entre compras (h)", value: String(cfg.cooldownMs / seguro.HORA_MS) },
            { id: "tope", label: "Tope por delante (días)", value: String(cfg.topeMs / seguro.DIA_MS) },
        ]),
    );
    return true;
}

async function guardarSeguro(interaction, id, guildId) {
    const campo = (nombre) => Number(interaction.fields.getTextInputValue(nombre).trim());
    const precio = campo("precio");
    const horas = campo("horas");
    const cooldown = campo("cooldown");
    const tope = campo("tope");
    if (!entero(precio, 1, 1_000_000) || !entero(horas, 1, 720) || !entero(cooldown, 0, 720) || !entero(tope, 1, 365)) {
        await interaction.reply({
            content: "❌ Prima 1-1.000.000, horas 1-720, cooldown 0-720 y tope 1-365 (números enteros).",
            flags: MessageFlags.Ephemeral,
        });
        return true;
    }
    guardarAuditado(guildId, interaction.user.id, "settings.economia.update", {
        "economia.seguro_precio": precio,
        "economia.seguro_horas": horas,
        "economia.seguro_cooldown_h": cooldown,
        "economia.seguro_tope_dias": tope,
    });
    await interaction.reply({ content: "✅ Seguro antirrobo actualizado.", flags: MessageFlags.Ephemeral });
    return true;
}

module.exports = { buildEconomiaPanel, abrirModalSeguro, guardarSeguro };
