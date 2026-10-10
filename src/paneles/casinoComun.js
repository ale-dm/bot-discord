// Piezas comunes del panel de casino: nombres y emojis de cada juego, el botón de volver, la fila de importes y
// la de "sacar del banco". Las usan el resumen (./casino) y los selectores de la ruleta (./casinoRuleta).
const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require("discord.js");
const casinoTx = require("../systems/casinoTransactions");
const { botonSacar } = require("./economia");
const dinero = require("../systems/dinero");

const EMOJI = {
    blackjack: "🃏",
    tragaperras: "🎰",
    slots: "🎰",
    ruleta: "🎡",
    adivinar: "🔮",
    ppt: "✂️",
    apuestas: "⚽",
    quiniela: "📋",
};
const NOMBRE = {
    blackjack: "Blackjack",
    tragaperras: "Tragaperras",
    ruleta: "Ruleta",
    adivinar: "Adivinar",
    ppt: "Piedra, papel o tijera",
};
const MONTOS = [50, 100, 500, 1000, 5000];

// El 💵 efectivo, con lo que se juega.
function getSaldo(userId) {
    return casinoTx.obtenerSaldo(userId);
}

// "💵 Sacar del banco" (vuelve a esta pantalla después) si hay algo en el banco.
function filaSacar(userId, volver, ...otros) {
    const fila = new ActionRowBuilder().addComponents(...otros);
    if (dinero.banco(userId) > 0) fila.addComponents(botonSacar(volver));
    return fila;
}

function backBtn() {
    return new ButtonBuilder().setCustomId("casino_home").setLabel("◄ Casino").setStyle(ButtonStyle.Secondary);
}

// Una fila con un botón por importe (desactivados los que no se puede pagar).
function filaMontos(saldo, customId) {
    return new ActionRowBuilder().addComponents(
        ...MONTOS.map((m) =>
            new ButtonBuilder()
                .setCustomId(customId(m))
                .setLabel(`${m.toLocaleString("es")} 💰`)
                .setStyle(m <= 100 ? ButtonStyle.Secondary : m <= 500 ? ButtonStyle.Primary : ButtonStyle.Danger)
                .setDisabled(saldo < m),
        ),
    );
}

module.exports = { EMOJI, NOMBRE, getSaldo, filaSacar, backBtn, filaMontos };
