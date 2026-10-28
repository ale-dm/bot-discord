// ⚙️ Config Global → 🛡️ Economía (#526 y #518): seguro antirrobo (prima, duración, cooldown y tope) y
// depósito a plazo (importes e interés de cada plazo). Se usan desde /perfil → 💰 Economía.
const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags } = require("discord.js");
const seguro = require("../../systems/seguroAntirrobo");
const depositos = require("../../systems/depositos");
const { fmtNumero } = require("../../core/formato");
const { modalConCampos } = require("../common");
const { guardarAuditado } = require("./guardar");
const { navRow } = require("./vistas");

const entero = (n, min, max) => Number.isInteger(n) && n >= min && n <= max;

function buildEconomiaPanel(guildId) {
    const cfg = seguro.config(guildId);
    const dep = depositos.config(guildId);
    const embed = new EmbedBuilder()
        .setTitle("🛡️ Economía")
        .setDescription(
            "El **seguro antirrobo** y el **depósito a plazo** se usan desde `/perfil` → 💰 Economía. Aquí se ajusta lo que " +
                "cuestan, lo que duran y lo que pagan.",
        )
        .addFields(
            { name: "🛡️ Seguro · prima", value: `**${fmtNumero(cfg.precio)}** 🪙`, inline: true },
            { name: "🛡️ Seguro · duración", value: `**${cfg.horas} h**`, inline: true },
            { name: "🛡️ Seguro · cooldown", value: `**${cfg.cooldownMs / seguro.HORA_MS} h**`, inline: true },
            { name: "🛡️ Seguro · tope", value: `**${cfg.topeMs / seguro.DIA_MS} días**`, inline: true },
            {
                name: "📈 Depósito · importes",
                value: `De **${fmtNumero(dep.min)}** a **${fmtNumero(dep.max)}** 🪙`,
                inline: true,
            },
            {
                name: "📈 Depósito · interés",
                value: `7 días: **${dep.pct[7]} %** · 30: **${dep.pct[30]} %** · 90: **${dep.pct[90]} %**`,
                inline: true,
            },
        )
        .setColor(0x2ecc71)
        .setTimestamp();
    const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId("paneladmin_cfg_economia_seguro_edit").setLabel("✏️ Editar seguro").setStyle(ButtonStyle.Primary),
        new ButtonBuilder()
            .setCustomId("paneladmin_cfg_economia_deposito_edit")
            .setLabel("✏️ Editar depósito")
            .setStyle(ButtonStyle.Primary),
        // 🎟️ Más economía (#524 y siguientes): la lotería y las funciones nuevas, en su propia sección.
        new ButtonBuilder().setCustomId("paneladmin_ecox_home").setLabel("🎟️ Más economía").setStyle(ButtonStyle.Success),
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

async function abrirModalDeposito(interaction, guildId) {
    const cfg = depositos.config(guildId);
    await interaction.showModal(
        modalConCampos("paneladmin_cfg_economia_deposito_modal", "Depósito a plazo", [
            { id: "min", label: "Importe mínimo", value: String(cfg.min) },
            { id: "max", label: "Importe máximo", value: String(cfg.max) },
            { id: "pct7", label: "Interés a 7 días (%)", value: String(cfg.pct[7]) },
            { id: "pct30", label: "Interés a 30 días (%)", value: String(cfg.pct[30]) },
            { id: "pct90", label: "Interés a 90 días (%)", value: String(cfg.pct[90]) },
        ]),
    );
    return true;
}

async function guardarDeposito(interaction, id, guildId) {
    const campo = (nombre) => Number(interaction.fields.getTextInputValue(nombre).trim());
    const min = campo("min");
    const max = campo("max");
    const pct = { 7: campo("pct7"), 30: campo("pct30"), 90: campo("pct90") };
    if (!entero(min, 1, 1_000_000) || !entero(max, min, 1_000_000) || !Object.values(pct).every((p) => entero(p, 0, 100))) {
        await interaction.reply({
            content: "❌ Mínimo 1-1.000.000, máximo mayor o igual que el mínimo (hasta 1.000.000) e intereses 0-100 %.",
            flags: MessageFlags.Ephemeral,
        });
        return true;
    }
    guardarAuditado(guildId, interaction.user.id, "settings.economia.deposito.update", {
        "economia.deposito_min": min,
        "economia.deposito_max": max,
        "economia.deposito_pct_7": pct[7],
        "economia.deposito_pct_30": pct[30],
        "economia.deposito_pct_90": pct[90],
    });
    await interaction.reply({ content: "✅ Depósito a plazo actualizado.", flags: MessageFlags.Ephemeral });
    return true;
}

module.exports = { buildEconomiaPanel, abrirModalSeguro, guardarSeguro, abrirModalDeposito, guardarDeposito };
