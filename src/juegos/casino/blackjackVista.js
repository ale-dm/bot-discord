// Lo que se ve de una partida de blackjack: textos, embeds y botones. El flujo de la partida está en
// juegos/casino/blackjack y los cobros en systems/blackjackCobros.
const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require("discord.js");
const { handValue } = require("../../systems/blackjack");
const casino = require("../../paneles/casino");

const ayudaBlackjack = `
**Cómo jugar al Blackjack**

**Objetivo**
Gana al crupier acercándote lo máximo posible a 21, sin pasarte.

**Pedir carta / Plantarse**
- **Pedir carta:** Roba una carta más.
- **Plantarse:** Termina tu turno y deja que juegue el crupier.

**Doblar**
Dobla tu apuesta, roba una carta más y luego te plantas automáticamente.

**Separar (Split)**
Si tus dos primeras cartas tienen el mismo valor, puedes separarlas en dos manos. Se realiza una apuesta igual para la nueva mano y se reparte una carta extra a cada una.

**Blackjack del crupier**
Al repartir, el crupier comprueba si tiene Blackjack; si lo tiene, la mano termina en ese momento.

**Partidas abandonadas**
Si dejas una partida sin tocar más de 15 minutos, se da por perdida.

**Valor de las cartas**
- Un as 🂡 vale 1 u 11 (el valor se elige automáticamente para no pasarte de 21). Si el as cuenta como 11, tu mano será "blanda" (Soft).
- Las cartas del 2 al 10 valen su número.
- Las figuras (J, Q, K) valen 10.

**Turno del crupier**
El crupier pedirá cartas hasta llegar a 17 o más.

**Resultado**
- Si tus dos primeras cartas suman 21, es un Blackjack natural y gana a cualquier otra combinación de 21.
- Si empatas con el crupier, recuperas tu apuesta.
`;

// --- Mensajes ---
const COLOR = { gana: 0x27ae60, empate: 0xf1c40f, pierde: 0xe74c3c, juego: 0x2ecc71 };
const ERROR_RESULTADO = "❌ Error procesando el resultado. Contacta un administrador.";
const cartas = (mano) => mano.map((c) => c.display).join(" ");
// Repetir juega con la apuesta del principio (no la doblada ni la de las dos manos).
const filaFin = (state) => casino.filaFinJuego("blackjack", state.apuestaBase);

// Texto de la liquidación de una mano (lo que se dice al pagar, ganar, empatar o perder).
const TEXTO_RESULTADO = {
    gana: (cobro) => `¡Ganaste! Has ganado \`${cobro}\` monedas.`,
    empate: () => "Empate. Recuperas tu apuesta.",
    pierde: () => "Perdiste la apuesta.",
};

function embedAyuda() {
    return new EmbedBuilder().setTitle("ℹ️ Cómo jugar al Blackjack").setDescription(ayudaBlackjack).setColor(0x3498db);
}

function filasJuego({ puedeDoblar, puedeSplit }) {
    return [
        new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId("bj_hit").setLabel("Pedir carta").setStyle(ButtonStyle.Primary),
            new ButtonBuilder().setCustomId("bj_stand").setLabel("Plantarse").setStyle(ButtonStyle.Success),
            new ButtonBuilder().setCustomId("bj_double").setLabel("Doblar").setStyle(ButtonStyle.Secondary).setDisabled(!puedeDoblar),
            new ButtonBuilder().setCustomId("bj_split").setLabel("Separar").setStyle(ButtonStyle.Secondary).setDisabled(!puedeSplit),
        ),
        new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId("bj_help").setLabel("Ayuda").setStyle(ButtonStyle.Secondary)),
    ];
}

function filaSplit() {
    return new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId("bj_hit_split").setLabel("Pedir carta").setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId("bj_stand_split").setLabel("Plantarse").setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId("bj_help").setLabel("Ayuda").setStyle(ButtonStyle.Secondary),
    );
}

function embedJugando(state, valor = handValue(state.userHand)) {
    return new EmbedBuilder()
        .setTitle("🃏 Blackjack")
        .setDescription(
            `Tus cartas: ${cartas(state.userHand)} (**${valor}**)\n` +
                `Carta visible del crupier: ${state.botHand[0].display}\n\n` +
                "¿Qué quieres hacer?",
        )
        .setColor(COLOR.juego);
}

// Tras cerrar una mano separada (pasada o plantada), la siguiente.
function embedSiguienteMano(state, estadoAnterior) {
    const n = state.currentHand;
    return new EmbedBuilder()
        .setTitle(`🃏 Blackjack - Mano ${n + 1} (Separada)`)
        .setDescription(
            `**Mano ${n}:** ${cartas(state.hands[n - 1])} (**${state.handResults[n - 1].value}**) - ${estadoAnterior}\n\n` +
                `**Mano ${n + 1}:** ${cartas(state.hands[n])} (**${handValue(state.hands[n])}**)\n` +
                `Carta visible del crupier: ${state.botHand[0].display}\n\n` +
                "Juega tu segunda mano.",
        )
        .setColor(COLOR.juego);
}

// El embed de un blackjack natural al repartir.
function embedNatural(tipo, { userHand, botHand }, cobro) {
    if (tipo === "empate_blackjack") {
        return new EmbedBuilder()
            .setTitle("🃏 Blackjack - Empate de Blackjacks")
            .setDescription(
                `Tus cartas: ${cartas(userHand)} (Blackjack)\n` +
                    `Cartas del crupier: ${cartas(botHand)} (Blackjack)\n\n` +
                    "Empate. Recuperas tu apuesta.",
            )
            .setColor(COLOR.empate);
    }
    if (tipo === "blackjack") {
        return new EmbedBuilder()
            .setTitle("🃏 ¡Blackjack natural!")
            .setDescription(`Tus cartas: ${cartas(userHand)} (Blackjack)\n` + `¡Has ganado \`${cobro}\` monedas!`)
            .setColor(COLOR.gana);
    }
    return new EmbedBuilder()
        .setTitle("🃏 El crupier tiene Blackjack")
        .setDescription(
            `Tus cartas: ${cartas(userHand)}\n` + `Cartas del crupier: ${cartas(botHand)} (Blackjack)\n\n` + "Perdiste la apuesta.",
        )
        .setColor(COLOR.pierde);
}

// Texto de cada mano en el resumen de un split.
function textoManoSplit(mano, botVal) {
    if (mano.resultado === "pasada") return "❌ Se pasó";
    if (mano.resultado === "gana") return (mano.blackjack ? "🎯 Blackjack" : "✅ Ganaste") + (botVal > 21 ? " (crupier se pasó)" : "");
    if (mano.resultado === "empate") return "🟡 Empate";
    return "❌ Perdiste";
}

// Resumen de un split ya liquidado: las manos, el crupier, lo ganado y las estadísticas (`stats`, de la base de datos).
function embedResumenSplit(state, stats, { botVal, resultadosTexto, totalGanancia, manosGanadas, manosEmpate }) {
    // Ganancia neta: lo cobrado menos las dos apuestas.
    const gananciaReal = totalGanancia - state.apuesta * 2;
    const winRate = stats.partidas > 0 ? ((stats.victorias / stats.partidas) * 100).toFixed(1) : "0.0";

    const color = gananciaReal > 0 ? COLOR.gana : gananciaReal < 0 ? COLOR.pierde : COLOR.empate;
    let tituloResultado = "Split";
    if (manosGanadas === 2) tituloResultado = "¡Doble Victoria!";
    else if (manosGanadas === 1 && manosEmpate === 1) tituloResultado = "Victoria y Empate";
    else if (manosEmpate === 2) tituloResultado = "Doble Empate";
    else if (manosGanadas === 0 && manosEmpate === 0) tituloResultado = "Doble Derrota";

    return new EmbedBuilder()
        .setTitle(`🃏 Blackjack - ${tituloResultado}`)
        .setDescription(
            resultadosTexto +
                `\n**Crupier:** ${cartas(state.botHand)} (**${botVal}**)\n\n` +
                `💰 **Ganancia total:** ${totalGanancia} monedas\n` +
                `💸 **Ganancia neta:** ${gananciaReal >= 0 ? "+" : ""}${gananciaReal} monedas`,
        )
        .addFields(
            { name: "🎮 Partidas", value: `${stats.partidas}`, inline: true },
            { name: "📊 Ratio victoria", value: `${winRate}%`, inline: true },
            { name: "💎 Mejor ganancia", value: `${stats.mejorGanancia || 0}`, inline: true },
        )
        .setColor(color)
        .setFooter({ text: state.splitAses ? "Split de Ases completado" : "Split completado" });
}

module.exports = {
    COLOR,
    ERROR_RESULTADO,
    cartas,
    filaFin,
    TEXTO_RESULTADO,
    textoManoSplit,
    embedAyuda,
    filasJuego,
    filaSplit,
    embedJugando,
    embedSiguienteMano,
    embedNatural,
    embedResumenSplit,
};
