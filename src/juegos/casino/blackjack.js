// /blackjack: cobra y paga, y pinta la partida. Las reglas de cada jugada están en systems/blackjack.
const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags } = require("discord.js");
const db = require("../../core/db");
const { registrarUsuario, descontarApuesta, procesarGanancia, procesarPerdida } = require("../../systems/casinoTransactions");
const activeGames = require("../../systems/activeGames");
const { hayPartidaEnCurso } = require("./partidaEnCurso");
const bj = require("../../systems/blackjack");
const { liquidarMano, cobrarExtraBJ } = require("../../systems/blackjackCobros");
const casino = require("../../paneles/casino");
const { createLogger } = require("../../core/logger");

const { handValue } = bj;
const log = createLogger("Blackjack");

// Partidas en curso: userId -> estado. El dinero apostado se registra además en
// activeGames para poder devolverlo si el bot se reinicia a mitad de partida.
const partidasBJ = {};

function terminarPartida(userId) {
    delete partidasBJ[userId];
    activeGames.cerrar(userId, "blackjack");
}

// Una partida sin tocar durante más de 15 min ya no se puede seguir jugando (los botones
// de Discord caducan), así que se liquida como perdida, igual que dejar la mesa en un casino.
function abandonarPartida(userId, state) {
    const apostado = bj.totalApostado(state);
    log.info(`Partida de ${userId} abandonada (>15 min sin tocar): se liquida como perdida (${apostado} monedas)`);
    procesarPerdida(userId, "blackjack", apostado, "Blackjack: partida abandonada", {
        tipo: "abandono",
        guildId: state.guildId,
        userHand: state.split ? state.hands : state.userHand,
        botHand: state.botHand,
    });
    terminarPartida(userId);
}

function limpiarAbandonadas() {
    for (const [userId, state] of Object.entries(partidasBJ)) {
        if (!state.finished && activeGames.estaAbandonada(state.ultimaAccion)) {
            abandonarPartida(userId, state);
        }
    }
}

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

// --- Dinero ---
// Liquida una mano: "gana" cobra el doble (2,5× con blackjack) con el RTP aplicado, "empate"
// devuelve lo apostado y el resto la pierde. Devuelve { exito, cobro }.
const TEXTO_RESULTADO = {
    gana: (cobro) => `¡Ganaste! Has ganado \`${cobro}\` monedas.`,
    empate: () => "Empate. Recuperas tu apuesta.",
    pierde: () => "Perdiste la apuesta.",
};
const SUFIJO_TIPO = { gana: "victoria", empate: "empate", pierde: "derrota" };
const TEXTO_HISTORIAL = { gana: "ganado", empate: "empatado", pierde: "perdido" };

// Blackjack natural al repartir: se liquida y se responde en el acto.
async function responderNatural(interaction, state, tipo) {
    const userId = interaction.user.id;
    const { apuesta, userHand, botHand } = state;
    const detalle = { tipo, userHand, botHand };
    let exito, embed;
    if (tipo === "empate_blackjack") {
        exito = procesarGanancia(userId, "blackjack", apuesta, apuesta, "Blackjack: empate de blackjacks naturales", detalle);
        embed = new EmbedBuilder()
            .setTitle("🃏 Blackjack - Empate de Blackjacks")
            .setDescription(
                `Tus cartas: ${cartas(userHand)} (Blackjack)\n` +
                    `Cartas del crupier: ${cartas(botHand)} (Blackjack)\n\n` +
                    "Empate. Recuperas tu apuesta.",
            )
            .setColor(COLOR.empate);
    } else if (tipo === "blackjack") {
        const r = liquidarMano(userId, interaction.guildId, apuesta, "gana", {
            blackjack: true,
            descripcion: (cobro) => `Blackjack: blackjack natural (+${cobro - apuesta})`,
            detalle,
        });
        exito = r.exito;
        embed = new EmbedBuilder()
            .setTitle("🃏 ¡Blackjack natural!")
            .setDescription(`Tus cartas: ${cartas(userHand)} (Blackjack)\n` + `¡Has ganado \`${r.cobro}\` monedas!`)
            .setColor(COLOR.gana);
    } else {
        exito = procesarPerdida(userId, "blackjack", apuesta, "Blackjack: crupier tiene blackjack natural", detalle);
        embed = new EmbedBuilder()
            .setTitle("🃏 El crupier tiene Blackjack")
            .setDescription(
                `Tus cartas: ${cartas(userHand)}\n` + `Cartas del crupier: ${cartas(botHand)} (Blackjack)\n\n` + "Perdiste la apuesta.",
            )
            .setColor(COLOR.pierde);
    }
    if (!exito) {
        await interaction.reply({ content: ERROR_RESULTADO, flags: MessageFlags.Ephemeral });
        return;
    }
    await interaction.reply({ embeds: [embed], components: [filaFin(state)] });
    terminarPartida(userId);
}

// Plantarse o doblar: el crupier ya ha jugado; se liquida y se enseña el resultado.
async function responderFinal(interaction, state, { userVal, botVal, resultado }, { accion, titulo }) {
    const userId = interaction.user.id;
    const r = liquidarMano(userId, interaction.guildId, state.apuesta, resultado, {
        descripcion: () => `Blackjack: ${accion} ${TEXTO_HISTORIAL[resultado]}`,
        detalle: {
            tipo: `${SUFIJO_TIPO[resultado]}_${accion === "doblar" ? "doblar" : "stand"}`,
            userHand: state.userHand,
            botHand: state.botHand,
        },
    });
    if (!r.exito) {
        await interaction.reply({ content: ERROR_RESULTADO, flags: MessageFlags.Ephemeral });
        return;
    }
    const embed = new EmbedBuilder()
        .setTitle(titulo)
        .setDescription(
            `Tus cartas: ${cartas(state.userHand)} (**${userVal}**)\n` +
                `Cartas del crupier: ${cartas(state.botHand)} (**${botVal}**)\n\n` +
                TEXTO_RESULTADO[resultado](r.cobro),
        )
        .setColor(COLOR[resultado]);
    await interaction.update({ embeds: [embed], components: [filaFin(state)] });
    terminarPartida(userId);
}

// Fin del split: juega el crupier, se liquida cada mano por separado y se enseña el resumen.
async function evaluarSplitFinal(interaction, state, userId) {
    const { botVal, manos } = bj.resolverSplit(state);
    let totalGanancia = 0;
    let resultadosTexto = "";
    let manosGanadas = 0;
    let manosEmpate = 0;

    for (const [i, mano] of manos.entries()) {
        const n = i + 1;
        const detalle = { mano: n, userHand: mano.cartas, botHand: state.botHand };
        let texto, r;
        if (mano.resultado === "pasada") {
            texto = "❌ Se pasó";
            r = liquidarMano(userId, interaction.guildId, state.apuesta, "pierde", {
                descripcion: () => `Blackjack split: mano ${n} se pasó`,
                detalle: { tipo: "derrota_bust_split", ...detalle },
            });
        } else if (mano.resultado === "gana") {
            const crupierPasado = botVal > 21;
            texto = (mano.blackjack ? "🎯 Blackjack" : "✅ Ganaste") + (crupierPasado ? " (crupier se pasó)" : "");
            r = liquidarMano(userId, interaction.guildId, state.apuesta, "gana", {
                blackjack: mano.blackjack,
                descripcion: () => `Blackjack split: mano ${n} ganó${crupierPasado ? " (crupier se pasó)" : ""}`,
                detalle: { tipo: mano.blackjack ? "blackjack_split" : "victoria_split", ...detalle },
            });
            manosGanadas++;
        } else if (mano.resultado === "empate") {
            texto = "🟡 Empate";
            r = liquidarMano(userId, interaction.guildId, state.apuesta, "empate", {
                descripcion: () => `Blackjack split: mano ${n} empató`,
                detalle: { tipo: "empate_split", ...detalle },
            });
            manosEmpate++;
        } else {
            texto = "❌ Perdiste";
            r = liquidarMano(userId, interaction.guildId, state.apuesta, "pierde", {
                descripcion: () => `Blackjack split: mano ${n} perdió`,
                detalle: { tipo: "derrota_split", ...detalle },
            });
        }

        if (!r.exito) {
            await interaction.update({
                content: `❌ Error procesando resultado de mano ${n}. Contacta un administrador.`,
                embeds: [],
                components: [],
            });
            terminarPartida(userId);
            return;
        }
        totalGanancia += r.cobro;
        resultadosTexto += `**Mano ${n}:** ${cartas(mano.cartas)} (**${mano.valor}**) - ${texto}\n`;
    }

    // Ganancia neta: lo cobrado menos las dos apuestas.
    const gananciaReal = totalGanancia - state.apuesta * 2;
    const stats = db
        .prepare(
            `
        SELECT
            COUNT(*) as partidas,
            SUM(CASE WHEN resultado > 0 THEN 1 ELSE 0 END) as victorias,
            SUM(CASE WHEN resultado = 0 THEN 1 ELSE 0 END) as empates,
            SUM(resultado) as gananciaTotal,
            MAX(resultado) as mejorGanancia
        FROM casino
        WHERE userId = ? AND juego = 'blackjack'
    `,
        )
        .get(userId);
    const winRate = stats.partidas > 0 ? ((stats.victorias / stats.partidas) * 100).toFixed(1) : "0.0";

    const color = gananciaReal > 0 ? COLOR.gana : gananciaReal < 0 ? COLOR.pierde : COLOR.empate;
    let tituloResultado = "Split";
    if (manosGanadas === 2) tituloResultado = "¡Doble Victoria!";
    else if (manosGanadas === 1 && manosEmpate === 1) tituloResultado = "Victoria y Empate";
    else if (manosEmpate === 2) tituloResultado = "Doble Empate";
    else if (manosGanadas === 0 && manosEmpate === 0) tituloResultado = "Doble Derrota";

    const embed = new EmbedBuilder()
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

    await interaction.update({ embeds: [embed], components: [filaFin(state)] });
    terminarPartida(userId);
}

// Cobra la apuesta extra de doblar o separar (parte de la misma jugada: sin mínimo ni cooldown).
async function cobrarExtra(interaction, state) {
    const resultado = cobrarExtraBJ(interaction.user.id, interaction.guildId, state.apuesta);
    if (!resultado.exito) {
        await interaction.reply({ content: resultado.mensaje, flags: MessageFlags.Ephemeral });
        return false;
    }
    return true;
}

module.exports = {
    componentHandlers: [{ types: ["button"], prefixes: ["bj_"], method: "handleButton", acl: "juegos" }],

    async run(client, interaction) {
        const userId = interaction.user.id;
        const apuesta = interaction.options.getInteger("apuesta");
        // Sin apuesta, el selector de importes del casino (como desde el panel).
        if (!apuesta) {
            await interaction.reply(casino.buildPickApuesta(userId, "blackjack"));
            return;
        }

        const previa = partidasBJ[userId];
        if (
            await hayPartidaEnCurso(interaction, previa && !previa.finished ? previa : null, "Blackjack", () =>
                abandonarPartida(userId, previa),
            )
        )
            return;

        registrarUsuario(userId, interaction.user.username, interaction.user.tag);

        // Validar y descontar apuesta de forma segura
        const resultado = descontarApuesta(userId, apuesta, interaction.guildId);
        if (!resultado.exito) {
            await interaction.reply({ content: resultado.mensaje, flags: MessageFlags.Ephemeral });
            return;
        }
        activeGames.registrar(userId, "blackjack", interaction.guildId, apuesta);

        const state = bj.nuevaPartida({ apuesta, guildId: interaction.guildId, saldoRestante: resultado.saldoRestante });
        state.apuestaBase = apuesta;
        partidasBJ[userId] = state;

        const natural = bj.naturales(state);
        if (natural) {
            await responderNatural(interaction, state, natural);
            return;
        }
        await interaction.reply({ embeds: [embedJugando(state)], components: filasJuego(state) });
    },

    // Handler para botones
    async handleButton(client, interaction) {
        const userId = interaction.user.id;
        const id = interaction.customId;
        const state = partidasBJ[userId];
        if (!state) {
            if (id === "bj_help") await interaction.reply({ embeds: [embedAyuda()], flags: MessageFlags.Ephemeral });
            return;
        }
        if (state.finished) {
            await interaction.reply({ content: "Esta partida ya terminó.", flags: MessageFlags.Ephemeral });
            return;
        }
        state.ultimaAccion = Date.now();

        if (id === "bj_help") {
            await interaction.reply({ embeds: [embedAyuda()], flags: MessageFlags.Ephemeral });
            return;
        }

        if (id === "bj_double") {
            if (!state.puedeDoblar) {
                await interaction.reply({ content: "No puedes doblar ahora.", flags: MessageFlags.Ephemeral });
                return;
            }
            if (!(await cobrarExtra(interaction, state))) return;
            await responderFinal(interaction, state, bj.doblar(state), { accion: "doblar", titulo: "🃏 Blackjack - Resultado (Doblar)" });
            return;
        }

        if (id === "bj_split") {
            if (!state.puedeSplit) {
                await interaction.reply({ content: "No puedes separar ahora.", flags: MessageFlags.Ephemeral });
                return;
            }
            if (!(await cobrarExtra(interaction, state))) return;
            // Con dos ases solo se reparte una carta a cada mano y se resuelve directamente.
            if (bj.separar(state).sonAses) {
                await evaluarSplitFinal(interaction, state, userId);
                return;
            }
            const embed = new EmbedBuilder()
                .setTitle("🃏 Blackjack - Mano 1 (Separada)")
                .setDescription(
                    `**Mano 1:** ${cartas(state.hands[0])} (**${handValue(state.hands[0])}**)\n` +
                        `**Mano 2:** ${state.hands[1][0].display} + ?\n\n` +
                        `Carta visible del crupier: ${state.botHand[0].display}\n\n` +
                        "Juega tu primera mano.",
                )
                .setColor(COLOR.juego);
            await interaction.update({ embeds: [embed], components: [filaSplit()] });
            return;
        }

        if (id === "bj_hit") {
            const { valor, pasado } = bj.pedir(state);
            if (!pasado) {
                await interaction.update({ embeds: [embedJugando(state, valor)], components: filasJuego({}) });
                return;
            }
            const exito = procesarPerdida(userId, "blackjack", state.apuesta, "Blackjack: se pasó pidiendo carta", {
                tipo: "derrota_bust",
                userHand: state.userHand,
                botHand: state.botHand,
            });
            if (!exito) {
                await interaction.reply({ content: ERROR_RESULTADO, flags: MessageFlags.Ephemeral });
                return;
            }
            const embed = new EmbedBuilder()
                .setTitle("🃏 Blackjack - ¡Te pasaste!")
                .setDescription(
                    `Tus cartas: ${cartas(state.userHand)} (**${valor}**)\n` + `Perdiste la apuesta de ${state.apuesta} monedas.`,
                )
                .setColor(COLOR.pierde);
            await interaction.update({ embeds: [embed], components: [filaFin(state)] });
            terminarPartida(userId);
            return;
        }

        if (id === "bj_stand") {
            await responderFinal(interaction, state, bj.plantarse(state), { accion: "plantarse", titulo: "🃏 Blackjack - Resultado" });
            return;
        }

        if (id === "bj_hit_split" || id === "bj_stand_split") {
            if (!state.split) {
                await interaction.reply({ content: "No estás en modo split.", flags: MessageFlags.Ephemeral });
                return;
            }
            const pide = id === "bj_hit_split";
            const r = pide ? bj.pedirSplit(state) : bj.plantarseSplit(state);
            if (r.terminado) {
                await evaluarSplitFinal(interaction, state, userId);
            } else if (pide && !r.pasada) {
                // Sigue en la misma mano.
                const embed = new EmbedBuilder()
                    .setTitle(`🃏 Blackjack - Mano ${state.currentHand + 1} (Separada)`)
                    .setDescription(
                        `Tus cartas: ${cartas(state.hands[state.currentHand])} (**${r.valor}**)\n` +
                            `Carta visible del crupier: ${state.botHand[0].display}\n\n` +
                            "¿Qué quieres hacer?",
                    )
                    .setColor(COLOR.juego);
                await interaction.update({ embeds: [embed], components: [filaSplit()] });
            } else {
                await interaction.update({
                    embeds: [embedSiguienteMano(state, pide ? "¡Se pasó!" : "Plantado")],
                    components: [filaSplit()],
                });
            }
        }
    },

    limpiarAbandonadas,
};
