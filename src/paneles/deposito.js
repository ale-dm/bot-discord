// Pantalla del 📈 depósito a plazo (#518), dentro de /perfil → 💰 Economía: abrir uno con el dinero del
// banco (7, 30 o 90 días), ver el que está activo y cancelarlo antes de tiempo. Las reglas, en systems/depositos.
const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require("discord.js");
const depositos = require("../systems/depositos");
const dinero = require("../systems/dinero");
const { fmtNumero } = require("../core/formato");

const volver = () => new ButtonBuilder().setCustomId("dinero_panel").setLabel("◀ Economía").setStyle(ButtonStyle.Secondary);

function embedActivo(e, cfg, aviso) {
    const vence = Math.floor(e.vencimiento / 1000);
    return new EmbedBuilder()
        .setTitle("📈 Depósito a plazo")
        .setDescription(
            (aviso ? `${aviso}\n\n` : "") +
                (e.vencido
                    ? "Ha vencido: vuelve solo al banco con el interés en el próximo chequeo (cada 5 minutos)."
                    : "El dinero está bloqueado hasta el vencimiento. Si lo cancelas antes, recuperas el principal y pierdes el interés."),
        )
        .addFields(
            { name: "Importe", value: `**${fmtNumero(e.importe)}** 🪙`, inline: true },
            { name: "Interés", value: `+**${fmtNumero(e.interes)}** 🪙 (${cfg.pct[e.dias]} %)`, inline: true },
            { name: "Al vencer", value: `**${fmtNumero(e.total)}** 🪙`, inline: true },
            { name: "Vence", value: `<t:${vence}:f> (<t:${vence}:R>)`, inline: true },
            { name: "Plazo", value: `${e.dias} días`, inline: true },
        )
        .setColor(0x3498db)
        .setTimestamp();
}

function embedNuevo(cfg, userId, aviso) {
    const plazos = depositos.PLAZOS.map(
        (d) =>
            `**${d} días** · ${cfg.pct[d]} % · interés **${fmtNumero(Math.floor((cfg.min * cfg.pct[d]) / 100))}** 🪙 por cada ${fmtNumero(cfg.min)}`,
    );
    return new EmbedBuilder()
        .setTitle("📈 Depósito a plazo")
        .setDescription(
            (aviso ? `${aviso}\n\n` : "") +
                "Guarda dinero del **banco** durante un plazo y recupéralo con intereses. El efectivo no se toca. " +
                "Al vencer vuelve solo al banco; si lo cancelas antes, recuperas el principal pero pierdes el interés. " +
                "Solo un depósito activo por persona.",
        )
        .addFields(
            { name: "Plazos", value: plazos.join("\n"), inline: false },
            { name: "Límites", value: `De **${fmtNumero(cfg.min)}** a **${fmtNumero(cfg.max)}** 🪙`, inline: true },
            { name: "Tienes en el banco", value: `**${fmtNumero(dinero.banco(userId))}** 🪙`, inline: true },
        )
        .setColor(0x3498db)
        .setTimestamp();
}

/** Botones del depósito activo: cancelar (con confirmación) y volver. */
function filaActiva(e) {
    return new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId("dinero_deposito_cancelar")
            .setLabel("❌ Cancelar depósito")
            .setStyle(ButtonStyle.Danger)
            .setDisabled(e.vencido),
        volver(),
    );
}

/** Botones para abrir un depósito: un plazo por botón, desactivados si no llega el banco para el mínimo. */
function filaNuevo(cfg, userId) {
    return new ActionRowBuilder().addComponents(
        ...depositos.PLAZOS.map((d) =>
            new ButtonBuilder()
                .setCustomId(`dinero_deposito_abrir_${d}`)
                .setLabel(`${d} días · ${cfg.pct[d]} %`)
                .setStyle(ButtonStyle.Primary)
                .setDisabled(dinero.banco(userId) < cfg.min),
        ),
        volver(),
    );
}

/** Pantalla del depósito. `aviso` es el resultado de abrir o cancelar (o el motivo de que no se pueda). */
function buildDeposito(userId, guildId, aviso = null) {
    const cfg = depositos.config(guildId);
    const e = depositos.estado(userId);
    if (e) return { content: "", embeds: [embedActivo(e, cfg, aviso)], components: [filaActiva(e)] };
    return { content: "", embeds: [embedNuevo(cfg, userId, aviso)], components: [filaNuevo(cfg, userId)] };
}

/** Confirmación antes de cancelar: enseña lo que se pierde de interés. */
function buildConfirmar(userId, guildId) {
    const e = depositos.estado(userId);
    const cfg = depositos.config(guildId);
    if (!e) return buildDeposito(userId, guildId, "❌ No tienes ningún depósito activo.");
    const embed = new EmbedBuilder()
        .setTitle("❌ Cancelar depósito")
        .setDescription(
            `Si lo cancelas ahora, vuelven **${fmtNumero(e.importe)}** 🪙 al banco y pierdes **${fmtNumero(e.interes)}** 🪙 de interés ` +
                `(${cfg.pct[e.dias]} %). El depósito acabaría el <t:${Math.floor(e.vencimiento / 1000)}:f>.`,
        )
        .setColor(0xe74c3c);
    const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId("dinero_deposito_confirmar").setLabel("✅ Sí, cancelar").setStyle(ButtonStyle.Danger),
        new ButtonBuilder().setCustomId("dinero_deposito").setLabel("◀ No, seguir").setStyle(ButtonStyle.Secondary),
    );
    return { content: "", embeds: [embed], components: [row] };
}

module.exports = { buildDeposito, buildConfirmar };
