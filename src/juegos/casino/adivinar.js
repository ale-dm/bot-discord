const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags } = require("discord.js");
const { registrarUsuario, descontarApuesta, procesarGanancia, procesarPerdida, applyRtp } = require("../../systems/casinoTransactions");
const activeGames = require("../../systems/activeGames");
const casino = require("../../paneles/casino");
const { createLogger } = require("../../core/logger");

const log = createLogger("Adivinar");

// Utilidad para crear y mezclar baraja
function crearBaraja() {
    const palos = ["♠", "♣", "♥", "♦"];
    const valores = [2, 3, 4, 5, 6, 7, 8, 9, 10, "J", "Q", "K", "A"];
    const baraja = [];
    for (const palo of palos) {
        for (const valor of valores) {
            baraja.push({ palo, valor });
        }
    }
    // Mezclar baraja
    for (let i = baraja.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [baraja[i], baraja[j]] = [baraja[j], baraja[i]];
    }
    return baraja;
}

// Estado temporal en memoria (puedes migrar a DB si lo prefieres)
const partidas = new Map();

function terminarPartida(userId) {
    partidas.delete(userId);
    activeGames.cerrar(userId, "adivinar");
}

// Partida sin tocar más de 15 min: los botones ya han caducado, se liquida como perdida.
function abandonarPartida(userId, partida) {
    log.info(
        `Partida de ${userId} abandonada en la ronda ${partida.ronda} (>15 min sin tocar): se liquida como perdida (${partida.apuesta} monedas)`,
    );
    procesarPerdida(userId, "adivinar", partida.apuesta, "Adivinar: partida abandonada", {
        guildId: partida.guildId,
        cartas: partida.cartas,
        ronda: partida.ronda,
        abandono: true,
    });
    terminarPartida(userId);
}

function limpiarAbandonadas() {
    for (const [userId, partida] of partidas) {
        if (activeGames.estaAbandonada(partida.ultimaAccion)) abandonarPartida(userId, partida);
    }
}

module.exports = {
    componentHandlers: [{ types: ["button"], prefixes: ["adivinar_"], method: "handleButton", acl: "juegos" }],

    // Con apuesta empieza directamente; sin ella, el selector de importes del casino. (Antes era siempre
    // 500, con una pantalla de "Apostar 500 / Cancelar".)
    async run(client, interaction) {
        const userId = interaction.user.id;
        const apuesta = interaction.options.getInteger("apuesta");
        if (!apuesta) {
            await interaction.reply(casino.buildPickApuesta(userId, "adivinar"));
            return;
        }

        const previa = partidas.get(userId);
        if (previa) {
            if (!activeGames.estaAbandonada(previa.ultimaAccion)) {
                await interaction.reply({
                    content: "🃏 Ya tienes una partida de Adivinar en curso. Termínala antes de empezar otra.",
                    flags: MessageFlags.Ephemeral,
                });
                return;
            }
            abandonarPartida(userId, previa);
        }

        registrarUsuario(userId, interaction.user.username, interaction.user.tag);
        const resultado = descontarApuesta(userId, apuesta, interaction.guildId);
        if (!resultado.exito) {
            await interaction.reply({ content: resultado.mensaje, flags: MessageFlags.Ephemeral });
            return;
        }

        const baraja = crearBaraja();
        const carta1 = baraja.pop();
        partidas.set(userId, {
            ronda: 1,
            apuesta,
            acumulado: apuesta,
            baraja,
            cartas: [carta1],
            guildId: interaction.guildId,
            ultimaAccion: Date.now(),
        });
        activeGames.registrar(userId, "adivinar", interaction.guildId, apuesta);

        const embed = new EmbedBuilder()
            .setTitle("🃏 Adivinar la carta — Ronda 1/4: Color")
            .setDescription(
                `💰 **Apuesta:** \`${apuesta}\` monedas\n\n` +
                    "Supera 4 rondas adivinando cartas: si fallas pierdes la apuesta; desde la ronda 3 puedes retirarte con lo ganado, y si aciertas las 4 ganas ×20.\n\n" +
                    "¿De qué color será la carta?\n\n" +
                    "🔴 **Rojo** (♥♦)\n⚫ **Negro** (♠♣)",
            )
            .setColor(0x2ecc40)
            .setThumbnail("https://cdn-icons-png.flaticon.com/512/616/616492.png")
            .setFooter({ text: "Elige un color para continuar" });
        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId("adivinar_color_rojo").setLabel("🔴 Rojo").setStyle(ButtonStyle.Danger),
            new ButtonBuilder().setCustomId("adivinar_color_negro").setLabel("⚫ Negro").setStyle(ButtonStyle.Primary),
        );
        await interaction.reply({ embeds: [embed], components: [row] });
    },

    async handleButton(client, interaction) {
        const userId = interaction.user.id;

        // Botones de la pantalla antigua de confirmar (mensajes de antes del cambio).
        if (interaction.customId === "adivinar_confirmar_apuesta" || interaction.customId === "adivinar_cancelar") {
            await interaction.update({ ...casino.buildPickApuesta(userId, "adivinar"), content: "" });
            return;
        }

        // El resto del juego sigue igual que antes...
        const partida = partidas.get(userId);
        if (!partida) {
            await interaction.reply({
                content: "No tienes una partida activa. Empieza una desde el casino.",
                flags: MessageFlags.Ephemeral,
            });
            return;
        }
        partida.ultimaAccion = Date.now();

        // Ronda 1: Color
        if (interaction.customId.startsWith("adivinar_color_") && partida.ronda === 1) {
            const eleccion = interaction.customId.replace("adivinar_color_", "");
            const carta = partida.cartas[0];
            const esRojo = carta.palo === "♥" || carta.palo === "♦";
            const acierto = (eleccion === "rojo" && esRojo) || (eleccion === "negro" && !esRojo);

            if (acierto) {
                partida.ronda = 2;
                partida.acumulado = partida.apuesta * 2; // x2
                const carta2 = partida.baraja.pop();
                partida.cartas.push(carta2);

                const embed = new EmbedBuilder()
                    .setTitle("🃏 Adivinar la carta — Ronda 2/4: Mayor o Menor")
                    .setDescription(
                        `✅ **¡Correcto!** La carta era **${carta.valor}${carta.palo}**\n\n` +
                            `💰 **Acumulado:** \`${partida.acumulado}\` monedas\n\n` +
                            `¿La siguiente carta será **🔼 mayor** o **🔽 menor** que **${carta.valor}${carta.palo}**?`,
                    )
                    .setColor(0x3498db)
                    .setThumbnail("https://cdn-icons-png.flaticon.com/512/616/616494.png")
                    .setFooter({ text: "Elige mayor o menor" });

                const row = new ActionRowBuilder().addComponents(
                    new ButtonBuilder().setCustomId("adivinar_mayor").setLabel("🔼 Mayor").setStyle(ButtonStyle.Success),
                    new ButtonBuilder().setCustomId("adivinar_menor").setLabel("🔽 Menor").setStyle(ButtonStyle.Danger),
                );

                await interaction.update({ embeds: [embed], components: [row] });
            } else {
                // Antes se apuntaba con resultado 0 (como un empate) y 0 en el historial: las
                // estadísticas y rankings del casino no veían estas derrotas.
                procesarPerdida(userId, "adivinar", partida.apuesta, "Adivinar: perdió en la ronda 1", {
                    guildId: partida.guildId,
                    cartas: partida.cartas,
                    ronda: 1,
                    fallo: true,
                });
                terminarPartida(userId);
                const embed = new EmbedBuilder()
                    .setTitle("❌ Fin del juego")
                    .setDescription(`🃏 **Carta final:** ${carta.valor}${carta.palo}\n\n` + "😢 **¡Incorrecto! Pierdes tu apuesta.")
                    .setColor(0xe74c3c)
                    .setThumbnail("https://cdn-icons-png.flaticon.com/512/1828/1828843.png")
                    .setFooter({ text: "Adivinar la carta" });
                await interaction.update({ embeds: [embed], components: [casino.filaFinJuego("adivinar", partida.apuesta)] });
            }
            return;
        }

        // Ronda 2: Mayor o Menor
        if ((interaction.customId === "adivinar_mayor" || interaction.customId === "adivinar_menor") && partida.ronda === 2) {
            const carta1 = partida.cartas[0];
            const carta2 = partida.cartas[1];
            const valorCarta1 = getValorNumerico(carta1.valor);
            const valorCarta2 = getValorNumerico(carta2.valor);

            const acierto =
                (interaction.customId === "adivinar_mayor" && valorCarta2 > valorCarta1) ||
                (interaction.customId === "adivinar_menor" && valorCarta2 < valorCarta1);

            if (acierto) {
                partida.ronda = 3;
                partida.acumulado = Math.floor(partida.acumulado * 1.5); // x3 en total
                const carta3 = partida.baraja.pop();
                partida.cartas.push(carta3);

                const embed = new EmbedBuilder()
                    .setTitle("🃏 Adivinar la carta — Ronda 3/4: Dentro o Fuera")
                    .setDescription(
                        `🃏 **Cartas anteriores:** ${carta1.valor}${carta1.palo}, ${carta2.valor}${carta2.palo}\n\n` +
                            `✅ **¡Correcto!** La carta era **${carta2.valor}${carta2.palo}**\n\n` +
                            `💰 **Acumulado:** \`${partida.acumulado}\` monedas\n\n` +
                            "¿La siguiente carta estará **🟩 dentro** (entre ambas, inclusive) o **🟥 fuera**?\n\n" +
                            "O puedes retirarte y cobrar tu ganancia actual.",
                    )
                    .setColor(0xf1c40f)
                    .setThumbnail("https://cdn-icons-png.flaticon.com/512/616/616495.png")
                    .setFooter({ text: "Elige dentro, fuera o retirarte" });

                const row = new ActionRowBuilder().addComponents(
                    new ButtonBuilder().setCustomId("adivinar_dentro").setLabel("🟩 Dentro").setStyle(ButtonStyle.Success),
                    new ButtonBuilder().setCustomId("adivinar_fuera").setLabel("🟥 Fuera").setStyle(ButtonStyle.Danger),
                    new ButtonBuilder().setCustomId("adivinar_retirarse_3").setLabel("💸 Retirarse").setStyle(ButtonStyle.Secondary),
                );

                await interaction.update({ embeds: [embed], components: [row] });
            } else {
                // Antes se apuntaba con resultado 0 (como un empate) y 0 en el historial: las
                // estadísticas y rankings del casino no veían estas derrotas.
                procesarPerdida(userId, "adivinar", partida.apuesta, "Adivinar: perdió en la ronda 2", {
                    guildId: partida.guildId,
                    cartas: partida.cartas,
                    ronda: 2,
                    fallo: true,
                });
                terminarPartida(userId);
                const embed = new EmbedBuilder()
                    .setTitle("❌ Fin del juego")
                    .setDescription(`🃏 **Carta final:** ${carta2.valor}${carta2.palo}\n\n` + "😢 **¡Incorrecto! Pierdes tu apuesta.")
                    .setColor(0xe74c3c)
                    .setThumbnail("https://cdn-icons-png.flaticon.com/512/1828/1828843.png")
                    .setFooter({ text: "Adivinar la carta" });
                await interaction.update({ embeds: [embed], components: [casino.filaFinJuego("adivinar", partida.apuesta)] });
            }
            return;
        }

        // Ronda 3: Retirarse (solo a partir de ronda 3)
        if (interaction.customId === "adivinar_retirarse_3" && partida.ronda === 3) {
            await handleRetiro(interaction, partida, 3);
            return;
        }

        // Ronda 3: Dentro o Fuera
        if ((interaction.customId === "adivinar_dentro" || interaction.customId === "adivinar_fuera") && partida.ronda === 3) {
            const [carta1, carta2, carta3] = partida.cartas;
            const v1 = getValorNumerico(carta1.valor);
            const v2 = getValorNumerico(carta2.valor);
            const v3 = getValorNumerico(carta3.valor);

            const min = Math.min(v1, v2);
            const max = Math.max(v1, v2);

            const esDentro = v3 >= min && v3 <= max;
            const acierto =
                (interaction.customId === "adivinar_dentro" && esDentro) || (interaction.customId === "adivinar_fuera" && !esDentro);

            if (acierto) {
                partida.ronda = 4;
                partida.acumulado = Math.floor(partida.acumulado * 1.33); // x4 en total
                const carta4 = partida.baraja.pop();
                partida.cartas.push(carta4);

                const embed = new EmbedBuilder()
                    .setTitle("🃏 Adivinar la carta — Ronda 4/4: Palo")
                    .setDescription(
                        `🃏 **Cartas anteriores:** ${carta1.valor}${carta1.palo}, ${carta2.valor}${carta2.palo}, ${carta3.valor}${carta3.palo}\n\n` +
                            `✅ **¡Correcto!** La carta era **${carta3.valor}${carta3.palo}**\n\n` +
                            `💰 **Acumulado:** \`${partida.acumulado}\` monedas\n\n` +
                            "¿De qué palo será la siguiente carta?\n\n" +
                            "O puedes retirarte y cobrar tu ganancia actual.\n\n" +
                            "♠ Espadas | ♣ Tréboles | ♥ Corazones | ♦ Diamantes",
                    )
                    .setColor(0x8e44ad)
                    .setThumbnail("https://cdn-icons-png.flaticon.com/512/616/616496.png")
                    .setFooter({ text: "Elige un palo o retírate" });

                const row = new ActionRowBuilder().addComponents(
                    new ButtonBuilder().setCustomId("adivinar_palo_♠").setLabel("♠ Espadas").setStyle(ButtonStyle.Primary),
                    new ButtonBuilder().setCustomId("adivinar_palo_♣").setLabel("♣ Tréboles").setStyle(ButtonStyle.Primary),
                    new ButtonBuilder().setCustomId("adivinar_palo_♥").setLabel("♥ Corazones").setStyle(ButtonStyle.Danger),
                    new ButtonBuilder().setCustomId("adivinar_palo_♦").setLabel("♦ Diamantes").setStyle(ButtonStyle.Danger),
                    new ButtonBuilder().setCustomId("adivinar_retirarse_4").setLabel("💸 Retirarse").setStyle(ButtonStyle.Secondary),
                );

                await interaction.update({ embeds: [embed], components: [row] });
            } else {
                // Antes se apuntaba con resultado 0 (como un empate) y 0 en el historial: las
                // estadísticas y rankings del casino no veían estas derrotas.
                procesarPerdida(userId, "adivinar", partida.apuesta, "Adivinar: perdió en la ronda 3", {
                    guildId: partida.guildId,
                    cartas: partida.cartas,
                    ronda: 3,
                    fallo: true,
                });
                terminarPartida(userId);
                const embed = new EmbedBuilder()
                    .setTitle("❌ Fin del juego")
                    .setDescription(`🃏 **Carta final:** ${carta3.valor}${carta3.palo}\n\n` + "😢 **¡Incorrecto! Pierdes tu apuesta.")
                    .setColor(0xe74c3c)
                    .setThumbnail("https://cdn-icons-png.flaticon.com/512/1828/1828843.png")
                    .setFooter({ text: "Adivinar la carta" });
                await interaction.update({ embeds: [embed], components: [casino.filaFinJuego("adivinar", partida.apuesta)] });
            }
            return;
        }

        // Ronda 4: Retirarse
        if (interaction.customId === "adivinar_retirarse_4" && partida.ronda === 4) {
            await handleRetiro(interaction, partida, 4);
            return;
        }

        // Ronda 4: Palo
        if (interaction.customId.startsWith("adivinar_palo_") && partida.ronda === 4) {
            const paloElegido = interaction.customId.replace("adivinar_palo_", "");
            const carta4 = partida.cartas[3];
            let embed;
            let ganancia = 0;
            let resultadoTexto = "";
            let exito = false;
            if (carta4.palo === paloElegido) {
                const premio = applyRtp(interaction.guildId, "adivinar", partida.apuesta, partida.acumulado * 5); // x20 en total
                partida.acumulado = premio; // el premio final sustituye al acumulado, o procesarGanancia pagaría solo x4
                ganancia = premio - partida.apuesta; // Solo la ganancia neta, ya que la apuesta ya fue descontada
                resultadoTexto = `🎊 **¡FELICIDADES!** Has acertado el palo.\n\n🃏 **Carta final:** ${carta4.valor}${carta4.palo}\n\n💰 **Premio:** \`${premio}\` monedas`;
                exito = true;
                embed = new EmbedBuilder()
                    .setTitle("🎉 ¡Victoria! — Fin del juego")
                    .setDescription(resultadoTexto)
                    .setColor(0x2ecc40)
                    .setThumbnail("https://cdn-icons-png.flaticon.com/512/616/616496.png")
                    .setFooter({ text: "Adivinar la carta" });
            } else {
                ganancia = 0; // Ya se descontó la apuesta al entrar
                resultadoTexto = `🃏 **Carta final:** ${carta4.valor}${carta4.palo}\n\n😢 **¡Incorrecto! Pierdes tu apuesta.**`;
                embed = new EmbedBuilder()
                    .setTitle("❌ Fin del juego")
                    .setDescription(resultadoTexto)
                    .setColor(0xe74c3c)
                    .setThumbnail("https://cdn-icons-png.flaticon.com/512/1828/1828843.png")
                    .setFooter({ text: "Adivinar la carta" });
            }

            // --- PROCESAMIENTO DE RESULTADO ---
            const userId = interaction.user.id;

            // Procesar ganancia o pérdida
            let exitoTransaccion = false;
            if (exito && ganancia > 0) {
                // Jugador ganó - pagar ganancia
                exitoTransaccion = procesarGanancia(
                    userId,
                    "adivinar",
                    partida.apuesta,
                    partida.acumulado,
                    `Adivinar: completó todas las rondas y ganó ${ganancia} monedas`,
                    {
                        cartas: partida.cartas,
                        paloElegido,
                        exito,
                    },
                );
            } else {
                // Jugador perdió - registrar pérdida (ya se descontó la apuesta al inicio)
                exitoTransaccion = procesarPerdida(userId, "adivinar", partida.apuesta, `Adivinar: perdió en la ronda final`, {
                    cartas: partida.cartas,
                    paloElegido,
                    exito,
                });
            }

            if (!exitoTransaccion) {
                await interaction.update({
                    content: "❌ Error procesando el resultado. Contacta un administrador.",
                    embeds: [],
                    components: [],
                });
                return;
            }

            terminarPartida(interaction.user.id);
            await interaction.update({ embeds: [embed], components: [casino.filaFinJuego("adivinar", partida.apuesta)] });
            return;
        }
    },

    limpiarAbandonadas,
};

// Utilidad para comparar valores de cartas
function getValorNumerico(valor) {
    if (typeof valor === "number") return valor;
    if (valor === "A") return 14;
    if (valor === "K") return 13;
    if (valor === "Q") return 12;
    if (valor === "J") return 11;
    return parseInt(valor);
}

// Handler para retirarse en cualquier ronda (solo permitido a partir de ronda 3)
async function handleRetiro(interaction, partida, ronda) {
    if (ronda < 3) {
        await interaction.reply({ content: "Solo puedes retirarse a partir de la ronda 3.", flags: MessageFlags.Ephemeral });
        return;
    }

    const userId = interaction.user.id;
    let ganancia = partida.acumulado - partida.apuesta; // Solo la ganancia neta

    // Procesar ganancia del retiro
    let exito = false;
    if (ganancia > 0) {
        partida.acumulado = applyRtp(interaction.guildId, "adivinar", partida.apuesta, partida.acumulado);
        ganancia = partida.acumulado - partida.apuesta;
        exito = procesarGanancia(
            userId,
            "adivinar",
            partida.apuesta,
            partida.acumulado,
            `Adivinar: se retiró en ronda ${ronda} y ganó ${ganancia} monedas`,
            {
                cartas: partida.cartas,
                retirado: true,
                ronda,
            },
        );
    } else {
        // En caso de empate exacto (muy raro)
        exito = procesarGanancia(
            userId,
            "adivinar",
            partida.apuesta,
            partida.apuesta,
            `Adivinar: se retiró en ronda ${ronda} sin ganancias`,
            {
                cartas: partida.cartas,
                retirado: true,
                ronda,
            },
        );
    }

    if (!exito) {
        await interaction.reply({ content: "❌ Error procesando el retiro. Contacta un administrador.", flags: MessageFlags.Ephemeral });
        return;
    }

    terminarPartida(interaction.user.id);

    const embed = new EmbedBuilder()
        .setTitle("🟢 Te has retirado")
        .setDescription(`Has decidido retirarte tras la ronda ${ronda - 1}.\n\n` + `💰 **Ganancia:** \`${ganancia}\` monedas`)
        .setColor(0x27ae60)
        .setThumbnail("https://cdn-icons-png.flaticon.com/512/616/616492.png");

    await interaction.update({ embeds: [embed], components: [casino.filaFinJuego("adivinar", partida.apuesta)] });
}
