const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags } = require("discord.js");
const { registrarUsuario, descontarApuesta } = require("../../systems/casinoTransactions");
const {
    crearBaraja,
    getValorNumerico,
    aciertaColor,
    aciertaMayorMenor,
    aciertaDentroFuera,
    acumuladoAlEntrarRonda,
    registrarPerdida,
    registrarAbandono,
    cobrarPalo,
    cobrarRetiro,
} = require("../../systems/casino/adivinar");
const activeGames = require("../../systems/activeGames");
const { hayPartidaEnCurso } = require("./partidaEnCurso");
const casino = require("../../paneles/casino");
const { createLogger } = require("../../core/logger");

const log = createLogger("Adivinar");

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
    registrarAbandono(userId, partida);
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
        if (await hayPartidaEnCurso(interaction, previa, "Adivinar", () => abandonarPartida(userId, previa))) return;

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

        // Cada ronda tiene sus botones: se atiende el primero que encaja con el botón y la ronda en curso.
        const accion = ACCIONES_RONDA.find(([encaja]) => encaja(interaction.customId, partida));
        if (accion) await accion[1](interaction, partida);
    },

    limpiarAbandonadas,
};

// Partida perdida en una ronda: se registra la pérdida y se enseña la carta que tocaba.
async function perderPartida(interaction, partida, ronda, carta) {
    registrarPerdida(interaction.user.id, partida, ronda);
    terminarPartida(interaction.user.id);
    const embed = new EmbedBuilder()
        .setTitle("❌ Fin del juego")
        .setDescription(`🃏 **Carta final:** ${carta.valor}${carta.palo}\n\n` + "😢 **¡Incorrecto! Pierdes tu apuesta.**")
        .setColor(0xe74c3c)
        .setThumbnail("https://cdn-icons-png.flaticon.com/512/1828/1828843.png")
        .setFooter({ text: "Adivinar la carta" });
    await interaction.update({ embeds: [embed], components: [casino.filaFinJuego("adivinar", partida.apuesta)] });
}

// Ronda 1: Color
async function rondaColor(interaction, partida) {
    const eleccion = interaction.customId.replace("adivinar_color_", "");
    const carta = partida.cartas[0];

    if (!aciertaColor(eleccion, carta)) {
        // Antes se apuntaba con resultado 0 (como un empate) y 0 en el historial: las
        // estadísticas y rankings del casino no veían estas derrotas.
        await perderPartida(interaction, partida, 1, carta);
        return;
    }

    partida.ronda = 2;
    partida.acumulado = acumuladoAlEntrarRonda(2, partida.apuesta, partida.acumulado);
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
}

// Ronda 2: Mayor o Menor
async function rondaMayorMenor(interaction, partida) {
    const carta1 = partida.cartas[0];
    const carta2 = partida.cartas[1];
    const eleccion = interaction.customId.replace("adivinar_", "");
    const acierto = aciertaMayorMenor(eleccion, getValorNumerico(carta1.valor), getValorNumerico(carta2.valor));

    if (!acierto) {
        // Antes se apuntaba con resultado 0 (como un empate) y 0 en el historial: las
        // estadísticas y rankings del casino no veían estas derrotas.
        await perderPartida(interaction, partida, 2, carta2);
        return;
    }

    partida.ronda = 3;
    partida.acumulado = acumuladoAlEntrarRonda(3, partida.apuesta, partida.acumulado);
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
}

// Ronda 3: Dentro o Fuera
async function rondaDentroFuera(interaction, partida) {
    const [carta1, carta2, carta3] = partida.cartas;
    const eleccion = interaction.customId.replace("adivinar_", "");
    const acierto = aciertaDentroFuera(
        eleccion,
        getValorNumerico(carta1.valor),
        getValorNumerico(carta2.valor),
        getValorNumerico(carta3.valor),
    );

    if (!acierto) {
        // Antes se apuntaba con resultado 0 (como un empate) y 0 en el historial: las
        // estadísticas y rankings del casino no veían estas derrotas.
        await perderPartida(interaction, partida, 3, carta3);
        return;
    }

    partida.ronda = 4;
    partida.acumulado = acumuladoAlEntrarRonda(4, partida.apuesta, partida.acumulado);
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
}

// Ronda 4: Palo. Acertar paga ×20 (con el RTP del servidor); fallar pierde la apuesta.
async function rondaPalo(interaction, partida) {
    const paloElegido = interaction.customId.replace("adivinar_palo_", "");
    const carta4 = partida.cartas[3];
    const acierta = carta4.palo === paloElegido;
    const userId = interaction.user.id;

    if (!cobrarPalo(userId, interaction.guildId, partida, paloElegido, acierta)) {
        await interaction.update({
            content: "❌ Error procesando el resultado. Contacta un administrador.",
            embeds: [],
            components: [],
        });
        return;
    }

    terminarPartida(userId);
    await interaction.update({
        embeds: [embedPalo(acierta, carta4, partida.acumulado)],
        components: [casino.filaFinJuego("adivinar", partida.apuesta)],
    });
}

// El resultado de la ronda final: el premio si se acertó el palo, o la carta que tocaba si no.
function embedPalo(acierta, carta4, premio) {
    if (acierta) {
        return new EmbedBuilder()
            .setTitle("🎉 ¡Victoria! — Fin del juego")
            .setDescription(
                `🎊 **¡FELICIDADES!** Has acertado el palo.\n\n🃏 **Carta final:** ${carta4.valor}${carta4.palo}\n\n💰 **Premio:** \`${premio}\` monedas`,
            )
            .setColor(0x2ecc40)
            .setThumbnail("https://cdn-icons-png.flaticon.com/512/616/616496.png")
            .setFooter({ text: "Adivinar la carta" });
    }
    return new EmbedBuilder()
        .setTitle("❌ Fin del juego")
        .setDescription(`🃏 **Carta final:** ${carta4.valor}${carta4.palo}\n\n😢 **¡Incorrecto! Pierdes tu apuesta.**`)
        .setColor(0xe74c3c)
        .setThumbnail("https://cdn-icons-png.flaticon.com/512/1828/1828843.png")
        .setFooter({ text: "Adivinar la carta" });
}

// Botones de cada ronda, en orden: el primero que encaja con el botón y la ronda en curso se atiende (ver handleButton).
const ACCIONES_RONDA = [
    [(id, p) => id.startsWith("adivinar_color_") && p.ronda === 1, rondaColor],
    [(id, p) => (id === "adivinar_mayor" || id === "adivinar_menor") && p.ronda === 2, rondaMayorMenor],
    [(id, p) => id === "adivinar_retirarse_3" && p.ronda === 3, (interaction, partida) => handleRetiro(interaction, partida, 3)],
    [(id, p) => (id === "adivinar_dentro" || id === "adivinar_fuera") && p.ronda === 3, rondaDentroFuera],
    [(id, p) => id === "adivinar_retirarse_4" && p.ronda === 4, (interaction, partida) => handleRetiro(interaction, partida, 4)],
    [(id, p) => id.startsWith("adivinar_palo_") && p.ronda === 4, rondaPalo],
];

// Handler para retirarse en cualquier ronda (solo permitido a partir de ronda 3)
async function handleRetiro(interaction, partida, ronda) {
    if (ronda < 3) {
        await interaction.reply({ content: "Solo puedes retirarse a partir de la ronda 3.", flags: MessageFlags.Ephemeral });
        return;
    }

    const { exito, ganancia } = cobrarRetiro(interaction.user.id, interaction.guildId, partida, ronda);
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
