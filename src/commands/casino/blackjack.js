const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require("discord.js");
const db = require("../../core/db");
const {
    registrarUsuario,
    descontarApuesta,
    descontarExtra,
    procesarGanancia,
    procesarPerdida,
    applyRtp,
} = require("../../systems/casinoTransactions");
const activeGames = require("../../systems/activeGames");
const { crearBaraja, sacarCarta, handValue, esBlackjack } = require("../../systems/blackjack");
const { createLogger } = require("../../core/logger");

const log = createLogger("Blackjack");

// Partidas en curso: userId -> estado. El dinero apostado se registra además en
// activeGames para poder devolverlo si el bot se reinicia a mitad de partida.
const partidasBJ = {};

function terminarPartida(userId) {
    delete partidasBJ[userId];
    activeGames.cerrar(userId, "blackjack");
}

function totalApostado(state) {
    return state.split ? state.splitApuesta * 2 : state.apuesta;
}

// Una partida sin tocar durante más de 15 min ya no se puede seguir jugando (los botones
// de Discord caducan), así que se liquida como perdida, igual que dejar la mesa en un casino.
function abandonarPartida(userId, state) {
    const apostado = totalApostado(state);
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

module.exports = {
    componentHandlers: [{ types: ["button"], prefixes: ["bj_"], method: "handleButton" }],
    data: new SlashCommandBuilder()
        .setName("blackjack")
        .setDescription("Juega al Blackjack contra el bot")
        .addIntegerOption((opt) => opt.setName("apuesta").setDescription("Cantidad a apostar").setRequired(true)),

    async run(client, interaction) {
        const userId = interaction.user.id;
        const apuesta = interaction.options.getInteger("apuesta");

        const previa = partidasBJ[userId];
        if (previa && !previa.finished) {
            if (!activeGames.estaAbandonada(previa.ultimaAccion)) {
                await interaction.reply({
                    content: "🃏 Ya tienes una partida de Blackjack en curso. Termínala antes de empezar otra.",
                    ephemeral: true,
                });
                return;
            }
            abandonarPartida(userId, previa);
        }

        // Registrar usuario automáticamente
        registrarUsuario(userId, interaction.user.username, interaction.user.tag);

        // Validar y descontar apuesta de forma segura
        const resultado = descontarApuesta(userId, apuesta, interaction.guildId);
        if (!resultado.exito) {
            await interaction.reply({ content: resultado.mensaje, ephemeral: true });
            return;
        }
        activeGames.registrar(userId, "blackjack", interaction.guildId, apuesta);

        // Baraja real (4 barajas)
        const baraja = crearBaraja(4);

        // Iniciar manos
        const userHand = [sacarCarta(baraja), sacarCarta(baraja)];
        const botHand = [sacarCarta(baraja), sacarCarta(baraja)];

        // Estado de la partida
        partidasBJ[userId] = {
            userHand,
            botHand,
            apuesta,
            guildId: interaction.guildId,
            finished: false,
            baraja,
            ultimaAccion: Date.now(),
            puedeDoblar: resultado.saldoRestante >= apuesta,
            puedeSplit: userHand[0].value === userHand[1].value && resultado.saldoRestante >= apuesta,
        };

        // Comprobar Blackjack natural
        if (esBlackjack(userHand) && esBlackjack(botHand)) {
            // Empate con blackjack - devolver apuesta
            const exito = procesarGanancia(userId, "blackjack", apuesta, apuesta, "Blackjack: empate de blackjacks naturales", {
                tipo: "empate_blackjack",
                userHand,
                botHand,
            });

            if (!exito) {
                await interaction.reply({ content: "❌ Error procesando el resultado. Contacta un administrador.", ephemeral: true });
                return;
            }

            await interaction.reply({
                embeds: [
                    new EmbedBuilder()
                        .setTitle("🃏 Blackjack - Empate de Blackjacks")
                        .setDescription(
                            `Tus cartas: ${userHand.map((c) => c.display).join(" ")} (Blackjack)\n` +
                                `Cartas del crupier: ${botHand.map((c) => c.display).join(" ")} (Blackjack)\n\n` +
                                "Empate. Recuperas tu apuesta.",
                        )
                        .setColor(0xf1c40f),
                ],
                ephemeral: true,
            });
            terminarPartida(userId);
            return;
        } else if (esBlackjack(userHand)) {
            // Blackjack natural jugador - paga 2.5x
            const gananciaTotal = applyRtp(interaction.guildId, "blackjack", apuesta, Math.floor(apuesta * 2.5));
            const exito = procesarGanancia(
                userId,
                "blackjack",
                apuesta,
                gananciaTotal,
                `Blackjack: blackjack natural (+${gananciaTotal - apuesta})`,
                {
                    tipo: "blackjack",
                    userHand,
                    botHand,
                },
            );

            if (!exito) {
                await interaction.reply({ content: "❌ Error procesando el resultado. Contacta un administrador.", ephemeral: true });
                return;
            }

            await interaction.reply({
                embeds: [
                    new EmbedBuilder()
                        .setTitle("🃏 ¡Blackjack natural!")
                        .setDescription(
                            `Tus cartas: ${userHand.map((c) => c.display).join(" ")} (Blackjack)\n` +
                                `¡Has ganado \`${gananciaTotal}\` monedas!`,
                        )
                        .setColor(0x27ae60),
                ],
                ephemeral: true,
            });
            terminarPartida(userId);
            return;
        } else if (esBlackjack(botHand)) {
            // Blackjack natural bot - jugador pierde
            const exito = procesarPerdida(userId, "blackjack", apuesta, "Blackjack: crupier tiene blackjack natural", {
                tipo: "derrota_blackjack",
                userHand,
                botHand,
            });

            if (!exito) {
                await interaction.reply({ content: "❌ Error procesando el resultado. Contacta un administrador.", ephemeral: true });
                return;
            }

            await interaction.reply({
                embeds: [
                    new EmbedBuilder()
                        .setTitle("🃏 El crupier tiene Blackjack")
                        .setDescription(
                            `Tus cartas: ${userHand.map((c) => c.display).join(" ")}\n` +
                                `Cartas del crupier: ${botHand.map((c) => c.display).join(" ")} (Blackjack)\n\n` +
                                "Perdiste la apuesta.",
                        )
                        .setColor(0xe74c3c),
                ],
                ephemeral: true,
            });
            terminarPartida(userId);
            return;
        }

        // Mostrar botones según opciones disponibles
        const row1 = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId("bj_hit").setLabel("Pedir carta").setStyle(ButtonStyle.Primary),
            new ButtonBuilder().setCustomId("bj_stand").setLabel("Plantarse").setStyle(ButtonStyle.Success),
            new ButtonBuilder()
                .setCustomId("bj_double")
                .setLabel("Doblar")
                .setStyle(ButtonStyle.Secondary)
                .setDisabled(!partidasBJ[userId].puedeDoblar),
            new ButtonBuilder()
                .setCustomId("bj_split")
                .setLabel("Separar")
                .setStyle(ButtonStyle.Secondary)
                .setDisabled(!partidasBJ[userId].puedeSplit),
        );

        const row2 = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId("bj_help").setLabel("Ayuda").setStyle(ButtonStyle.Secondary),
        );

        const embed = new EmbedBuilder()
            .setTitle("🃏 Blackjack")
            .setDescription(
                `Tus cartas: ${userHand.map((c) => c.display).join(" ")} (**${handValue(userHand)}**)\n` +
                    `Carta visible del crupier: ${botHand[0].display}\n\n` +
                    "¿Qué quieres hacer?",
            )
            .setColor(0x2ecc71);

        await interaction.reply({ embeds: [embed], components: [row1, row2], ephemeral: true });
    },

    // Handler para botones
    async handleButton(client, interaction) {
        const userId = interaction.user.id;
        if (!partidasBJ[userId]) {
            if (interaction.customId === "bj_help") {
                const embed = new EmbedBuilder().setTitle("ℹ️ Cómo jugar al Blackjack").setDescription(ayudaBlackjack).setColor(0x3498db);
                await interaction.reply({ embeds: [embed], ephemeral: true });
            }
            return;
        }

        const state = partidasBJ[userId];
        if (state.finished) {
            await interaction.reply({ content: "Esta partida ya terminó.", ephemeral: true });
            return;
        }
        state.ultimaAccion = Date.now();

        // Ayuda
        if (interaction.customId === "bj_help") {
            const embed = new EmbedBuilder().setTitle("ℹ️ Cómo jugar al Blackjack").setDescription(ayudaBlackjack).setColor(0x3498db);
            await interaction.reply({ embeds: [embed], ephemeral: true });
            return;
        }

        // Doblar
        if (interaction.customId === "bj_double") {
            if (!state.puedeDoblar) {
                await interaction.reply({ content: "No puedes doblar ahora.", ephemeral: true });
                return;
            }

            // Validar y descontar la segunda apuesta (parte de la misma jugada: sin mínimo ni cooldown)
            const resultado = descontarExtra(userId, state.apuesta, interaction.guildId);
            if (!resultado.exito) {
                await interaction.reply({ content: resultado.mensaje, ephemeral: true });
                return;
            }
            activeGames.sumarApuesta(userId, "blackjack", state.apuesta);

            state.apuesta *= 2;
            state.userHand.push(sacarCarta(state.baraja));
            state.finished = true;

            // Turno del bot
            let botVal = handValue(state.botHand);
            while (botVal < 17) {
                state.botHand.push(sacarCarta(state.baraja));
                botVal = handValue(state.botHand);
            }

            const userVal = handValue(state.userHand);
            let resultado_msg, color, exito;

            if (botVal > 21 || (userVal > botVal && userVal <= 21)) {
                // Jugador gana - recibe el doble de la apuesta
                const gananciaTotal = applyRtp(interaction.guildId, "blackjack", state.apuesta, state.apuesta * 2);
                exito = procesarGanancia(userId, "blackjack", state.apuesta, gananciaTotal, "Blackjack: doblar ganado", {
                    tipo: "victoria_doblar",
                    userHand: state.userHand,
                    botHand: state.botHand,
                });
                resultado_msg = `¡Ganaste! Has ganado \`${gananciaTotal}\` monedas.`;
                color = 0x27ae60;
            } else if (userVal === botVal) {
                // Empate - recupera solo la apuesta (sin ganancia)
                exito = procesarGanancia(userId, "blackjack", state.apuesta, state.apuesta, "Blackjack: doblar empatado", {
                    tipo: "empate_doblar",
                    userHand: state.userHand,
                    botHand: state.botHand,
                });
                resultado_msg = "Empate. Recuperas tu apuesta.";
                color = 0xf1c40f;
            } else {
                // Jugador pierde
                exito = procesarPerdida(userId, "blackjack", state.apuesta, "Blackjack: doblar perdido", {
                    tipo: "derrota_doblar",
                    userHand: state.userHand,
                    botHand: state.botHand,
                });
                resultado_msg = "Perdiste la apuesta.";
                color = 0xe74c3c;
            }

            if (!exito) {
                await interaction.reply({ content: "❌ Error procesando el resultado. Contacta un administrador.", ephemeral: true });
                return;
            }

            const embed = new EmbedBuilder()
                .setTitle("🃏 Blackjack - Resultado (Doblar)")
                .setDescription(
                    `Tus cartas: ${state.userHand.map((c) => c.display).join(" ")} (**${userVal}**)\n` +
                        `Cartas del crupier: ${state.botHand.map((c) => c.display).join(" ")} (**${botVal}**)\n\n` +
                        resultado_msg,
                )
                .setColor(color);
            await interaction.update({ embeds: [embed], components: [], ephemeral: true });
            terminarPartida(userId);
            return;
        }

        // Separar (Split) - Lógica completa
        if (interaction.customId === "bj_split") {
            if (!state.puedeSplit) {
                await interaction.reply({ content: "No puedes separar ahora.", ephemeral: true });
                return;
            }

            // Validar y descontar la segunda apuesta para el split (sin mínimo ni cooldown)
            const resultado = descontarExtra(userId, state.apuesta, interaction.guildId);
            if (!resultado.exito) {
                await interaction.reply({ content: resultado.mensaje, ephemeral: true });
                return;
            }
            activeGames.sumarApuesta(userId, "blackjack", state.apuesta);

            // Verificar si son Ases (regla especial: solo una carta más por As)
            const sonAses = state.userHand[0].value === 11 && state.userHand[1].value === 11;

            // Dos manos
            state.split = true;
            state.hands = [
                [state.userHand[0], sacarCarta(state.baraja)],
                [state.userHand[1], sacarCarta(state.baraja)],
            ];
            state.currentHand = 0;
            state.splitApuesta = state.apuesta;
            state.splitAses = sonAses;

            if (sonAses) {
                // Regla especial: Con Ases divididos, solo se reparte una carta más automáticamente
                await evaluarSplitFinal(interaction, state, userId);
            } else {
                // Mostrar la primera mano
                const embed = new EmbedBuilder()
                    .setTitle("🃏 Blackjack - Mano 1 (Separada)")
                    .setDescription(
                        `**Mano 1:** ${state.hands[0].map((c) => c.display).join(" ")} (**${handValue(state.hands[0])}**)\n` +
                            `**Mano 2:** ${state.hands[1][0].display} + ?\n\n` +
                            `Carta visible del crupier: ${state.botHand[0].display}\n\n` +
                            "Juega tu primera mano.",
                    )
                    .setColor(0x2ecc71);
                const row = new ActionRowBuilder().addComponents(
                    new ButtonBuilder().setCustomId("bj_hit_split").setLabel("Pedir carta").setStyle(ButtonStyle.Primary),
                    new ButtonBuilder().setCustomId("bj_stand_split").setLabel("Plantarse").setStyle(ButtonStyle.Success),
                    new ButtonBuilder().setCustomId("bj_help").setLabel("Ayuda").setStyle(ButtonStyle.Secondary),
                );
                await interaction.update({ embeds: [embed], components: [row], ephemeral: true });
            }
            return;
        }

        // Pedir carta
        if (interaction.customId === "bj_hit") {
            state.userHand.push(sacarCarta(state.baraja));
            const val = handValue(state.userHand);
            if (val > 21) {
                // Jugador se pasó - pierde automáticamente
                state.finished = true;
                const exito = procesarPerdida(userId, "blackjack", state.apuesta, "Blackjack: se pasó pidiendo carta", {
                    tipo: "derrota_bust",
                    userHand: state.userHand,
                    botHand: state.botHand,
                });

                if (!exito) {
                    await interaction.reply({ content: "❌ Error procesando el resultado. Contacta un administrador.", ephemeral: true });
                    return;
                }

                const embed = new EmbedBuilder()
                    .setTitle("🃏 Blackjack - ¡Te pasaste!")
                    .setDescription(
                        `Tus cartas: ${state.userHand.map((c) => c.display).join(" ")} (**${val}**)\n` +
                            `Perdiste la apuesta de ${state.apuesta} monedas.`,
                    )
                    .setColor(0xe74c3c);
                await interaction.update({ embeds: [embed], components: [], ephemeral: true });
                terminarPartida(userId);
                return;
            } else {
                const embed = new EmbedBuilder()
                    .setTitle("🃏 Blackjack")
                    .setDescription(
                        `Tus cartas: ${state.userHand.map((c) => c.display).join(" ")} (**${val}**)\n` +
                            `Carta visible del crupier: ${state.botHand[0].display}\n\n` +
                            "¿Qué quieres hacer?",
                    )
                    .setColor(0x2ecc71);
                const row1 = new ActionRowBuilder().addComponents(
                    new ButtonBuilder().setCustomId("bj_hit").setLabel("Pedir carta").setStyle(ButtonStyle.Primary),
                    new ButtonBuilder().setCustomId("bj_stand").setLabel("Plantarse").setStyle(ButtonStyle.Success),
                    new ButtonBuilder().setCustomId("bj_double").setLabel("Doblar").setStyle(ButtonStyle.Secondary).setDisabled(true),
                    new ButtonBuilder().setCustomId("bj_split").setLabel("Separar").setStyle(ButtonStyle.Secondary).setDisabled(true),
                );
                const row2 = new ActionRowBuilder().addComponents(
                    new ButtonBuilder().setCustomId("bj_help").setLabel("Ayuda").setStyle(ButtonStyle.Secondary),
                );
                await interaction.update({ embeds: [embed], components: [row1, row2], ephemeral: true });
                return;
            }
        }

        // Plantarse
        if (interaction.customId === "bj_stand") {
            // Turno del bot
            let botVal = handValue(state.botHand);
            while (botVal < 17) {
                state.botHand.push(sacarCarta(state.baraja));
                botVal = handValue(state.botHand);
            }
            const userVal = handValue(state.userHand);
            let resultado_msg, color, exito;

            if (botVal > 21 || (userVal > botVal && userVal <= 21)) {
                // Jugador gana
                const gananciaTotal = applyRtp(interaction.guildId, "blackjack", state.apuesta, state.apuesta * 2);
                exito = procesarGanancia(userId, "blackjack", state.apuesta, gananciaTotal, "Blackjack: plantarse ganado", {
                    tipo: "victoria_stand",
                    userHand: state.userHand,
                    botHand: state.botHand,
                });
                resultado_msg = `¡Ganaste! Has ganado \`${gananciaTotal}\` monedas.`;
                color = 0x27ae60;
            } else if (userVal === botVal) {
                // Empate
                exito = procesarGanancia(userId, "blackjack", state.apuesta, state.apuesta, "Blackjack: plantarse empatado", {
                    tipo: "empate_stand",
                    userHand: state.userHand,
                    botHand: state.botHand,
                });
                resultado_msg = "Empate. Recuperas tu apuesta.";
                color = 0xf1c40f;
            } else {
                // Jugador pierde
                exito = procesarPerdida(userId, "blackjack", state.apuesta, "Blackjack: plantarse perdido", {
                    tipo: "derrota_stand",
                    userHand: state.userHand,
                    botHand: state.botHand,
                });
                resultado_msg = "Perdiste la apuesta.";
                color = 0xe74c3c;
            }

            if (!exito) {
                await interaction.reply({ content: "❌ Error procesando el resultado. Contacta un administrador.", ephemeral: true });
                return;
            }

            state.finished = true;
            const embed = new EmbedBuilder()
                .setTitle("🃏 Blackjack - Resultado")
                .setDescription(
                    `Tus cartas: ${state.userHand.map((c) => c.display).join(" ")} (**${userVal}**)\n` +
                        `Cartas del crupier: ${state.botHand.map((c) => c.display).join(" ")} (**${botVal}**)\n\n` +
                        resultado_msg,
                )
                .setColor(color);
            await interaction.update({ embeds: [embed], components: [], ephemeral: true });
            terminarPartida(userId);
            return;
        }

        // Split: Pedir carta en mano activa
        if (interaction.customId === "bj_hit_split") {
            if (!state.split || state.currentHand === undefined) {
                await interaction.reply({ content: "No estás en modo split.", ephemeral: true });
                return;
            }

            // Añadir carta a la mano actual
            state.hands[state.currentHand].push(sacarCarta(state.baraja));
            const val = handValue(state.hands[state.currentHand]);

            if (val > 21) {
                // Mano se pasa
                state.handResults = state.handResults || [];
                state.handResults[state.currentHand] = { result: "bust", value: val };

                // Pasar a la siguiente mano o terminar
                if (state.currentHand < state.hands.length - 1) {
                    state.currentHand++;
                    const embed = new EmbedBuilder()
                        .setTitle(`🃏 Blackjack - Mano ${state.currentHand + 1} (Separada)`)
                        .setDescription(
                            `**Mano ${state.currentHand}:** ${state.hands[state.currentHand - 1].map((c) => c.display).join(" ")} (**${state.handResults[state.currentHand - 1].value}**) - ¡Se pasó!\n\n` +
                                `**Mano ${state.currentHand + 1}:** ${state.hands[state.currentHand].map((c) => c.display).join(" ")} (**${handValue(state.hands[state.currentHand])}**)\n` +
                                `Carta visible del crupier: ${state.botHand[0].display}\n\n` +
                                "Juega tu segunda mano.",
                        )
                        .setColor(0x2ecc71);
                    const row = new ActionRowBuilder().addComponents(
                        new ButtonBuilder().setCustomId("bj_hit_split").setLabel("Pedir carta").setStyle(ButtonStyle.Primary),
                        new ButtonBuilder().setCustomId("bj_stand_split").setLabel("Plantarse").setStyle(ButtonStyle.Success),
                        new ButtonBuilder().setCustomId("bj_help").setLabel("Ayuda").setStyle(ButtonStyle.Secondary),
                    );
                    await interaction.update({ embeds: [embed], components: [row], ephemeral: true });
                } else {
                    // Ambas manos terminadas, evaluar resultados
                    await evaluarSplitFinal(interaction, state, userId);
                }
            } else {
                // Continuar con la mano actual
                const embed = new EmbedBuilder()
                    .setTitle(`🃏 Blackjack - Mano ${state.currentHand + 1} (Separada)`)
                    .setDescription(
                        `Tus cartas: ${state.hands[state.currentHand].map((c) => c.display).join(" ")} (**${val}**)\n` +
                            `Carta visible del crupier: ${state.botHand[0].display}\n\n` +
                            "¿Qué quieres hacer?",
                    )
                    .setColor(0x2ecc71);
                const row = new ActionRowBuilder().addComponents(
                    new ButtonBuilder().setCustomId("bj_hit_split").setLabel("Pedir carta").setStyle(ButtonStyle.Primary),
                    new ButtonBuilder().setCustomId("bj_stand_split").setLabel("Plantarse").setStyle(ButtonStyle.Success),
                    new ButtonBuilder().setCustomId("bj_help").setLabel("Ayuda").setStyle(ButtonStyle.Secondary),
                );
                await interaction.update({ embeds: [embed], components: [row], ephemeral: true });
            }
            return;
        }

        // Split: Plantarse en mano activa
        if (interaction.customId === "bj_stand_split") {
            if (!state.split || state.currentHand === undefined) {
                await interaction.reply({ content: "No estás en modo split.", ephemeral: true });
                return;
            }

            // Guardar resultado de la mano actual
            state.handResults = state.handResults || [];
            state.handResults[state.currentHand] = {
                result: "stand",
                value: handValue(state.hands[state.currentHand]),
            };

            // Pasar a la siguiente mano o terminar
            if (state.currentHand < state.hands.length - 1) {
                state.currentHand++;
                const embed = new EmbedBuilder()
                    .setTitle(`🃏 Blackjack - Mano ${state.currentHand + 1} (Separada)`)
                    .setDescription(
                        `**Mano ${state.currentHand}:** ${state.hands[state.currentHand - 1].map((c) => c.display).join(" ")} (**${state.handResults[state.currentHand - 1].value}**) - Plantado\n\n` +
                            `**Mano ${state.currentHand + 1}:** ${state.hands[state.currentHand].map((c) => c.display).join(" ")} (**${handValue(state.hands[state.currentHand])}**)\n` +
                            `Carta visible del crupier: ${state.botHand[0].display}\n\n` +
                            "Juega tu segunda mano.",
                    )
                    .setColor(0x2ecc71);
                const row = new ActionRowBuilder().addComponents(
                    new ButtonBuilder().setCustomId("bj_hit_split").setLabel("Pedir carta").setStyle(ButtonStyle.Primary),
                    new ButtonBuilder().setCustomId("bj_stand_split").setLabel("Plantarse").setStyle(ButtonStyle.Success),
                    new ButtonBuilder().setCustomId("bj_help").setLabel("Ayuda").setStyle(ButtonStyle.Secondary),
                );
                await interaction.update({ embeds: [embed], components: [row], ephemeral: true });
            } else {
                // Ambas manos terminadas, evaluar resultados
                await evaluarSplitFinal(interaction, state, userId);
            }
            return;
        }
    },

    limpiarAbandonadas,
};

// Función para evaluar el resultado final del split
async function evaluarSplitFinal(interaction, state, userId) {
    // Si no hay resultados guardados (caso de Ases divididos), crearlos
    if (!state.handResults) {
        state.handResults = [
            { result: "stand", value: handValue(state.hands[0]) },
            { result: "stand", value: handValue(state.hands[1]) },
        ];
    }

    // Jugar turno del crupier
    let botVal = handValue(state.botHand);
    while (botVal < 17) {
        state.botHand.push(sacarCarta(state.baraja));
        botVal = handValue(state.botHand);
    }

    let totalGanancia = 0;
    let resultadosTexto = "";
    let manosGanadas = 0;
    let manosEmpate = 0;

    // Evaluar cada mano y procesar transacciones individualmente
    for (let i = 0; i < state.hands.length; i++) {
        const handVal = state.handResults[i].value;
        let ganancia = 0;
        let resultado = "";
        let exito = true;

        // Verificar si es blackjack en split (solo si son 2 cartas con valor 21)
        const esBlackjackSplit = state.hands[i].length === 2 && handVal === 21;

        if (state.handResults[i].result === "bust") {
            resultado = "❌ Se pasó";
            ganancia = 0;
            exito = procesarPerdida(userId, "blackjack", state.apuesta, `Blackjack split: mano ${i + 1} se pasó`, {
                tipo: "derrota_bust_split",
                mano: i + 1,
                userHand: state.hands[i],
                botHand: state.botHand,
            });
        } else if (botVal > 21) {
            resultado = esBlackjackSplit ? "🎯 Blackjack (crupier se pasó)" : "✅ Ganaste (crupier se pasó)";
            ganancia = applyRtp(
                interaction.guildId,
                "blackjack",
                state.apuesta,
                esBlackjackSplit ? Math.floor(state.apuesta * 2.5) : state.apuesta * 2,
            );
            exito = procesarGanancia(
                userId,
                "blackjack",
                state.apuesta,
                ganancia,
                `Blackjack split: mano ${i + 1} ganó (crupier se pasó)`,
                {
                    tipo: esBlackjackSplit ? "blackjack_split" : "victoria_split",
                    mano: i + 1,
                    userHand: state.hands[i],
                    botHand: state.botHand,
                },
            );
            manosGanadas++;
        } else if (handVal > botVal) {
            resultado = esBlackjackSplit ? "🎯 Blackjack" : "✅ Ganaste";
            ganancia = applyRtp(
                interaction.guildId,
                "blackjack",
                state.apuesta,
                esBlackjackSplit ? Math.floor(state.apuesta * 2.5) : state.apuesta * 2,
            );
            exito = procesarGanancia(userId, "blackjack", state.apuesta, ganancia, `Blackjack split: mano ${i + 1} ganó`, {
                tipo: esBlackjackSplit ? "blackjack_split" : "victoria_split",
                mano: i + 1,
                userHand: state.hands[i],
                botHand: state.botHand,
            });
            manosGanadas++;
        } else if (handVal === botVal) {
            resultado = "🟡 Empate";
            ganancia = state.apuesta;
            exito = procesarGanancia(userId, "blackjack", state.apuesta, ganancia, `Blackjack split: mano ${i + 1} empató`, {
                tipo: "empate_split",
                mano: i + 1,
                userHand: state.hands[i],
                botHand: state.botHand,
            });
            manosEmpate++;
        } else {
            resultado = "❌ Perdiste";
            ganancia = 0;
            exito = procesarPerdida(userId, "blackjack", state.apuesta, `Blackjack split: mano ${i + 1} perdió`, {
                tipo: "derrota_split",
                mano: i + 1,
                userHand: state.hands[i],
                botHand: state.botHand,
            });
        }

        if (!exito) {
            await interaction.update({
                content: `❌ Error procesando resultado de mano ${i + 1}. Contacta un administrador.`,
                embeds: [],
                components: [],
                ephemeral: true,
            });
            terminarPartida(userId);
            return;
        }

        totalGanancia += ganancia;
        resultadosTexto += `**Mano ${i + 1}:** ${state.hands[i].map((c) => c.display).join(" ")} (**${handVal}**) - ${resultado}\n`;
    }

    // Calcular ganancia neta (restando las dos apuestas iniciales)
    const gananciaReal = totalGanancia - state.apuesta * 2;

    // Las transacciones individuales ya fueron registradas arriba,
    // no necesitamos insertarCasino aquí

    // Obtener estadísticas del jugador
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

    const color = gananciaReal > 0 ? 0x27ae60 : gananciaReal < 0 ? 0xe74c3c : 0xf1c40f;
    let tituloResultado = "Split";
    if (manosGanadas === 2) tituloResultado = "¡Doble Victoria!";
    else if (manosGanadas === 1 && manosEmpate === 1) tituloResultado = "Victoria y Empate";
    else if (manosEmpate === 2) tituloResultado = "Doble Empate";
    else if (manosGanadas === 0 && manosEmpate === 0) tituloResultado = "Doble Derrota";

    const embed = new EmbedBuilder()
        .setTitle(`🃏 Blackjack - ${tituloResultado}`)
        .setDescription(
            resultadosTexto +
                `\n**Crupier:** ${state.botHand.map((c) => c.display).join(" ")} (**${botVal}**)\n\n` +
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

    await interaction.update({ embeds: [embed], components: [], ephemeral: true });
    terminarPartida(userId);
}
