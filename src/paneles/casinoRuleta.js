// Selectores de la ruleta del panel de casino: el tipo de apuesta, la docena, el número exacto y el importe.
// Solo construyen mensajes; la tirada la juega juegos/casino/ruleta.
const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder } = require("discord.js");
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

// Número exacto en dos pasos (#310, grupo G6): el rango, y luego el número en un desplegable. El 0 va solo, y cada
// docena tiene 12 números, que sí caben en un desplegable (Discord admite 25).
const RANGOS_NUMERO = [
    { label: "0", inicio: 0, fin: 0 },
    { label: "1–12", inicio: 1, fin: 12 },
    { label: "13–24", inicio: 13, fin: 24 },
    { label: "25–36", inicio: 25, fin: 36 },
];

/** Ruleta, número exacto, paso 1: el rango del número (botones, uno por cada RANGOS_NUMERO). */
function buildPickRangoNumero(userId) {
    const rangos = new ActionRowBuilder().addComponents(
        RANGOS_NUMERO.map((r, grupo) =>
            new ButtonBuilder().setCustomId(`casino_pick_ruleta_rango_${grupo}`).setLabel(r.label).setStyle(ButtonStyle.Secondary),
        ),
    );
    const embed = new EmbedBuilder()
        .setTitle("🎡 Ruleta — Número exacto")
        .setDescription(`Elige el rango del número (cobra ×36).\n${lineaDinero(userId)}`)
        .setColor(0xe74c3c);
    return { embeds: [embed], components: [rangos, filaVolverRuleta("◄ Tipos")] };
}

/** Ruleta, número exacto, paso 2: el número del rango elegido. El 0 va directo al importe. */
function buildPickNumeroRuleta(userId, grupo) {
    const rango = RANGOS_NUMERO[grupo];
    if (!rango) return buildPickRangoNumero(userId);
    if (grupo === 0) return buildPickMontoRuleta(userId, "numero", 0);

    const numeros = [];
    for (let n = rango.inicio; n <= rango.fin; n++) numeros.push({ label: String(n), value: String(n) });
    const desplegable = new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder()
            .setCustomId("casino_ruleta_numero_sel")
            .setPlaceholder(`Número del ${rango.label}`)
            .addOptions(numeros),
    );
    const volver = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId("casino_pick_ruleta_numero").setLabel("◄ Rangos").setStyle(ButtonStyle.Secondary),
        backBtn(),
    );
    const embed = new EmbedBuilder()
        .setTitle("🎡 Ruleta — Número exacto")
        .setDescription(`Elige el número del ${rango.label} (cobra ×36).\n${lineaDinero(userId)}`)
        .setColor(0xe74c3c);
    return { embeds: [embed], components: [desplegable, volver] };
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

module.exports = { buildPickRuleta, buildPickDocenas, buildPickRangoNumero, buildPickNumeroRuleta, buildPickMontoRuleta };
