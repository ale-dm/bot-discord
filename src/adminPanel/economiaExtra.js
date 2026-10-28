// ⚙️ Config Global → 🛡️ Economía → 🎟️ Más economía: los ajustes de las funciones de economía nuevas (#524 y siguientes),
// cada una con su formulario. De momento, la 🎟️ lotería semanal: canal de los anuncios, precio del boleto y tope por persona.
// Todo cambio se audita con su diff (familia `settings`).
const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags } = require("discord.js");
const loteria = require("../systems/loteria");
const { fmtNumero } = require("../core/formato");
const { modalConCampos, canalElegido } = require("./common");
const { guardarAuditado } = require("./settings/guardar");

const PREFIJO = "paneladmin_ecox_";
const COLOR = 0x2ecc71;

const entero = (texto, min, max) => {
    const n = Number(String(texto ?? "").trim());
    return Number.isInteger(n) && n >= min && n <= max ? n : null;
};

/** La pantalla: un campo por función con sus ajustes. */
function buildHome(guildId, aviso = "") {
    const l = loteria.ajustes(guildId);
    const sorteo = loteria.abierto(guildId);
    const embed = new EmbedBuilder()
        .setTitle("🎟️ Más economía")
        .setColor(COLOR)
        .setDescription((aviso ? `${aviso}\n\n` : "") + "Ajustes de las funciones de economía nuevas. La gente las usa con sus comandos.")
        .addFields({
            name: "🎟️ Lotería (`/loteria`)",
            value:
                `Canal de los anuncios: ${l.canal ? `<#${l.canal}>` : "ninguno (se sortea igual, sin anuncio)"}\n` +
                `Boleto: **${fmtNumero(l.precio)}** 🪙 · hasta **${l.maxBoletos}** por persona\n` +
                `Bote ahora: **${fmtNumero(sorteo.bote)}** 🪙 · sorteo <t:${Math.floor(sorteo.sorteo_en / 1000)}:R>`,
        });
    const fila = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`${PREFIJO}loteria`).setLabel("✏️ Lotería").setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId("paneladmin_cfg_economia").setLabel("🛡️ Economía").setStyle(ButtonStyle.Secondary),
    );
    return { content: "", embeds: [embed], components: [fila], allowedMentions: { parse: [] } };
}

function modalLoteria(guildId) {
    const l = loteria.ajustes(guildId);
    return modalConCampos(`${PREFIJO}loteria_modal`, "Lotería semanal", [
        { id: "canal", label: "Canal de los anuncios (vacío = ninguno)", tipo: "canal", required: false, valor: l.canal },
        { id: "precio", label: "Precio del boleto (1 a 100.000)", value: String(l.precio), maxLength: 6 },
        { id: "max", label: "Boletos por persona y sorteo (1 a 50)", value: String(l.maxBoletos), maxLength: 2 },
    ]);
}

const pintar = (interaction, payload) =>
    interaction.isFromMessage?.() === false
        ? interaction.reply({ ...payload, flags: MessageFlags.Ephemeral })
        : interaction.update(payload);

async function guardarLoteria(interaction) {
    const precio = entero(interaction.fields.getTextInputValue("precio"), 1, 100_000);
    const max = entero(interaction.fields.getTextInputValue("max"), 1, 50);
    if (precio === null || max === null) {
        return pintar(interaction, buildHome(interaction.guildId, "❌ Precio de 1 a 100.000 y de 1 a 50 boletos (números enteros)."));
    }
    guardarAuditado(interaction.guildId, interaction.user.id, "settings.loteria.update", {
        "loteria.canal": canalElegido(interaction.fields, "canal"),
        "loteria.precio": precio,
        "loteria.max_boletos": max,
    });
    return pintar(interaction, buildHome(interaction.guildId, "✅ Lotería actualizada."));
}

/** Botones de 🎟️ Más economía. Devuelve false si no es suyo. */
async function handleEconomiaExtraButton(interaction) {
    const id = interaction.customId;
    if (!id.startsWith(PREFIJO)) return false;
    const accion = id.slice(PREFIJO.length);
    if (accion === "home") await interaction.update(buildHome(interaction.guildId));
    else if (accion === "loteria") await interaction.showModal(modalLoteria(interaction.guildId));
    else return false;
    return true;
}

/** Formularios de 🎟️ Más economía. */
async function handleEconomiaExtraModal(interaction) {
    if (interaction.customId === `${PREFIJO}loteria_modal`) await guardarLoteria(interaction);
    else return false;
    return true;
}

module.exports = { PREFIJO, buildHome, handleEconomiaExtraButton, handleEconomiaExtraModal };
