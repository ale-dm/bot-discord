// Selectores de la ruleta del panel de casino: el tipo de apuesta, la docena, el número exacto y el importe.
// Solo construyen mensajes; la tirada la juega juegos/casino/ruleta.
const {
    EmbedBuilder,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    ModalBuilder,
    TextInputBuilder,
    TextInputStyle,
} = require("discord.js");
const { lineaDinero } = require("./economia");
const { backBtn, filaMontos, filaSacar, getSaldo } = require("./casinoComun");

function filaVolverRuleta(label) {
    return new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId("casino_ruleta").setLabel(label).setStyle(ButtonStyle.Secondary),
        backBtn(),
    );
}

/** Ruleta, paso 1: tipo de apuesta. */
function buildPickRuleta(userId) {
    const tipos = [
        { label: "🔴 Rojo (×2)", value: "color_rojo" },
        { label: "⚫ Negro (×2)", value: "color_negro" },
        { label: "Par (×2)", value: "paridad_par" },
        { label: "Impar (×2)", value: "paridad_impar" },
        { label: "Bajo 1-18 (×2)", value: "mitad_bajo" },
        { label: "Alto 19-36 (×2)", value: "mitad_alto" },
        { label: "🎲 Docenas (×3)", value: "docenas" },
        { label: "🔢 Número exacto (×36)", value: "numero" },
    ];
    const mkBtn = (t) => new ButtonBuilder().setCustomId(`casino_pick_ruleta_${t.value}`).setLabel(t.label).setStyle(ButtonStyle.Secondary);
    const embed = new EmbedBuilder()
        .setTitle("🎡 Ruleta — Elige tipo de apuesta")
        .setDescription(`${lineaDinero(userId)}\n\nSelecciona el tipo antes de elegir cantidad:`)
        .setColor(0xe74c3c);
    return {
        embeds: [embed],
        components: [
            new ActionRowBuilder().addComponents(tipos.slice(0, 4).map(mkBtn)),
            new ActionRowBuilder().addComponents(tipos.slice(4).map(mkBtn)),
            new ActionRowBuilder().addComponents(backBtn()),
        ],
    };
}

/** Ruleta, paso 1b: qué docena. */
function buildPickDocenas(userId) {
    const docenas = [
        { label: "1ª Docena  1-12  (×3)", value: "docena_1" },
        { label: "2ª Docena 13-24 (×3)", value: "docena_2" },
        { label: "3ª Docena 25-36 (×3)", value: "docena_3" },
    ];
    const docRow = new ActionRowBuilder().addComponents(
        ...docenas.map((d) =>
            new ButtonBuilder().setCustomId(`casino_pick_ruleta_${d.value}`).setLabel(d.label).setStyle(ButtonStyle.Secondary),
        ),
    );
    const embed = new EmbedBuilder().setTitle("🎡 Ruleta — Docenas").setDescription(lineaDinero(userId)).setColor(0xe74c3c);
    return { embeds: [embed], components: [docRow, filaVolverRuleta("◄ Tipos")] };
}

/** Ruleta, paso 1c: formulario del número exacto. */
function modalNumeroRuleta() {
    const input = new TextInputBuilder()
        .setCustomId("casino_ruleta_numero_input")
        .setLabel("Número (0 – 36)")
        .setStyle(TextInputStyle.Short)
        .setMinLength(1)
        .setMaxLength(2)
        .setPlaceholder("Ej: 17")
        .setRequired(true);
    return new ModalBuilder()
        .setCustomId("casino_ruleta_numero_modal")
        .setTitle("🎡 Ruleta — Número exacto")
        .addComponents(new ActionRowBuilder().addComponents(input));
}

/** Ruleta, paso 2: importe (casino_play_ruleta_{importe}_{tipo}_{valor}). */
function buildPickMontoRuleta(userId, tipo, valor) {
    const saldo = getSaldo(userId);
    const numero = tipo === "numero";
    const embed = new EmbedBuilder()
        .setTitle(numero ? "🎡 Ruleta — Número exacto" : "🎡 Ruleta — Elige tu apuesta")
        .setDescription(
            numero ? `Número: **${valor}** (×36)\n${lineaDinero(userId)}` : `Tipo: **${tipo} ${valor}**\n${lineaDinero(userId)}`,
        )
        .setColor(0xe74c3c);
    return {
        embeds: [embed],
        components: [
            filaMontos(saldo, (m) => `casino_play_ruleta_${m}_${tipo}_${valor}`),
            filaSacar(
                userId,
                `casino_pick_ruleta_${tipo}_${valor}`,
                new ButtonBuilder().setCustomId("casino_ruleta").setLabel("◄ Cambiar tipo").setStyle(ButtonStyle.Secondary),
                backBtn(),
            ),
        ],
    };
}

module.exports = { buildPickRuleta, buildPickDocenas, modalNumeroRuleta, buildPickMontoRuleta };
