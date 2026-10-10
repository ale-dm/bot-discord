const { EmbedBuilder, MessageFlags } = require("discord.js");
const { registrarUsuario, descontarApuesta, obtenerSaldo } = require("../../systems/casinoTransactions");
const { SIMBOLOS, calcularGanancia, obtenerJackpot, liquidarGiro } = require("../../systems/casino/tragaperras");
const { logWarn } = require("../../core/logger");
const casino = require("../../paneles/casino");

// Estados de las partidas (para animación)
const partidasActivas = new Map();

// Al acabar (y, desactivada, mientras gira): 🔄 Repetir · 🎲 Otra apuesta · 📊 Stats · ◀ Casino.
function crearBotonesResultado(apuesta, disabled = false) {
    return casino.filaFinJuego("tragaperras", apuesta, { desactivada: disabled });
}

/**
 * Crear embed de animación mejorado
 */
function crearEmbedAnimacion(frame, apuesta, jackpot, usuario) {
    const frames = [
        ["🍒", "🍋", "🍊"],
        ["🍇", "🔔", "💎"],
        ["⭐", "7️⃣", "⭐"],
    ];

    const frameActual = frames[frame % frames.length];
    const dots = ".".repeat((frame % 3) + 1);

    return new EmbedBuilder()
        .setTitle("🎰 TRAGAPERRAS 🎰")
        .setDescription(
            `**${usuario}** está jugando${dots}\n\n` +
                `🎰 ${frameActual[0]} • ${frameActual[1]} • ${frameActual[2]} 🎰\n\n` +
                `💰 Apuesta: **${apuesta}** monedas\n` +
                `🏆 Jackpot: **${jackpot.toLocaleString()}** monedas\n` +
                `⏳ Girando los carretes${dots}`,
        )
        .setColor(0xf39c12)
        .setFooter({ text: "¡Buena suerte!" });
}

// Color, título y banner según el tipo de premio. Un doble que no da ganancia es "recuperas la apuesta".
function estiloResultado(resultado, resultadoNeto) {
    if (resultado.tipo === "jackpot") {
        return {
            color: 0xf1c40f, // Oro
            titulo: "🎰 ¡¡¡JACKPOT!!! 🎰",
            banner: `\n🎉🎊🎉🎊🎉🎊🎉🎊🎉\n**¡¡¡GANASTE EL JACKPOT!!!**\n🎉🎊🎉🎊🎉🎊🎉🎊🎉\n\n`,
        };
    }
    if (resultado.tipo === "triple") {
        return { color: 0x2ecc71, titulo: "🎊 ¡TRIPLE!", banner: `\n✨ **¡COMBINACIÓN PERFECTA!** ✨\n\n` };
    }
    if (resultado.tipo === "doble" && resultadoNeto > 0) {
        return { color: 0x3498db, titulo: "🎉 ¡DOBLE!", banner: "" }; // Azul
    }
    if (resultado.tipo === "doble") {
        return { color: 0x95a5a6, titulo: "🔁 RECUPERAS APUESTA", banner: "" }; // Gris
    }
    return { color: 0xe74c3c, titulo: "😢 SIN PREMIO", banner: "" };
}

function textoPie(tipo, resultadoNeto) {
    if (tipo === "jackpot") return "¡FELICIDADES! ¡Ganaste el JACKPOT! 🎉";
    if (tipo === "triple") return "¡Excelente! ¡Sigue así! 🌟";
    if (tipo === "doble") return resultadoNeto > 0 ? "¡Bien! ¡Sigue probando! 💪" : "Al menos recuperaste la apuesta 👌";
    return "¡Prueba de nuevo!";
}

/**
 * Crear embed de resultado mejorado
 */
function crearEmbedResultado(carretes, resultado, apuesta, jackpot, usuario, saldoFinal) {
    const [s1, s2, s3] = carretes;
    const resultadoNeto = resultado.ganancia - apuesta;
    const { color, titulo, banner } = estiloResultado(resultado, resultadoNeto);

    const gananciaTexto = resultadoNeto >= 0 ? `+${resultadoNeto.toLocaleString()}` : `-${apuesta}`;

    const gananciaIcon = resultadoNeto >= 0 ? "✅" : "❌";

    let descripcion =
        banner +
        `🎰 ${s1} • ${s2} • ${s3} 🎰\n` +
        `${resultado.mensaje}\n\n` +
        `━━━━━━━━━━━━━━━━━━━━━\n` +
        `💵 **Apuesta:** ${apuesta.toLocaleString()} monedas\n` +
        `${gananciaIcon} **Resultado:** ${gananciaTexto} monedas`;

    if (resultado.multiplicador !== "JACKPOT") {
        descripcion += ` **(${resultado.multiplicador})**\n`;
    } else {
        descripcion += `\n`;
    }

    descripcion += `💰 **Saldo:** ${saldoFinal.toLocaleString()} monedas\n` + `━━━━━━━━━━━━━━━━━━━━━\n\n`;

    if (resultado.tipo !== "jackpot") {
        descripcion += `🏆 Jackpot: **${jackpot.toLocaleString()}** monedas`;
    } else {
        descripcion += `🏆 Jackpot reiniciado: **${jackpot.toLocaleString()}** monedas`;
    }

    return new EmbedBuilder()
        .setTitle(titulo)
        .setDescription(descripcion)
        .setColor(color)
        .setAuthor({ name: `Jugador: ${usuario}` })
        .setFooter({ text: textoPie(resultado.tipo, resultadoNeto) })
        .setTimestamp();
}

/**
 * Crear embed de ayuda
 */
function crearEmbedAyuda() {
    const simbolosInfo = Object.entries(SIMBOLOS)
        .sort((a, b) => b[1].valor - a[1].valor)
        .map(([simbolo, info]) => `${simbolo} **${info.nombre}** → x${info.valor}`)
        .join("\n");

    return new EmbedBuilder()
        .setTitle("🎰 CÓMO JUGAR A LAS TRAGAPERRAS")
        .setDescription(
            "**¡Gira los carretes y gana premios!**\n\n" +
                "**SÍMBOLOS Y MULTIPLICADORES:**\n" +
                "```\n" +
                simbolosInfo +
                "\n" +
                "```\n\n" +
                "**TIPOS DE PREMIO:**\n" +
                "🎊 **Triple** → Multiplica tu apuesta por el valor completo\n" +
                "🎉 **Doble** → Gana 1/3 del valor del símbolo (**mínimo x1**)\n" +
                "💰 **JACKPOT** → ¡Tres 7️⃣ = Todo el jackpot acumulado!\n\n" +
                "**JACKPOT PROGRESIVO:**\n" +
                "• El 10% de cada apuesta se suma al jackpot\n" +
                "• Todos los jugadores contribuyen\n" +
                "• ¡El premio crece constantemente!\n\n" +
                "**LÍMITES DE APUESTA:**\n" +
                "• Mínimo: 50 monedas\n" +
                "• Máximo: 5,000 monedas",
        )
        .setColor(0x9b59b6)
        .setThumbnail("https://em-content.zobj.net/thumbs/160/google/350/slot-machine_1f3b0.png")
        .setFooter({ text: "¡Buena suerte y juega responsablemente! 🍀" });
}

module.exports = {
    componentHandlers: [{ types: ["button"], prefixes: ["tragaperras_"], method: "handleButton", acl: "juegos" }],

    async run(client, interaction) {
        const apuesta = interaction.options.getInteger("apuesta");
        const userId = interaction.user.id;
        const username = interaction.user.username;

        // Sin apuesta, el selector de importes del casino (como desde el panel), con el jackpot.
        if (!apuesta) {
            const panel = casino.buildPickApuesta(userId, "tragaperras");
            panel.embeds[0].setDescription(
                `${panel.embeds[0].data.description}\n\n🏆 Jackpot actual: **${obtenerJackpot().toLocaleString("es")}** monedas (tres 7️⃣)`,
            );
            await interaction.reply(panel);
            return;
        }

        // Iniciar juego con apuesta específica
        await this.jugar(interaction, apuesta, userId, username);
    },

    async jugar(interaction, apuesta, userId, username, yaDiferido = false) {
        if (partidasActivas.has(userId)) {
            if (!yaDiferido) {
                await interaction.reply({
                    content: "⏳ Ya tienes una tragaperras en curso. Espera a que termine.",
                    flags: MessageFlags.Ephemeral,
                });
            }
            return;
        }
        partidasActivas.set(userId, Date.now());

        try {
            registrarUsuario(userId, username, interaction.user.tag);

            // Se cobra antes de tocar el mensaje: si no se puede (saldo, límite, espera), el aviso sale aparte
            // y el panel sigue ahí para cambiar la apuesta. Antes lo sustituía un texto sin botones.
            const descuento = descontarApuesta(userId, apuesta, interaction.guildId);
            if (!descuento.exito) {
                const aviso = { content: descuento.mensaje, flags: MessageFlags.Ephemeral };
                await (yaDiferido ? interaction.followUp(aviso) : interaction.reply(aviso));
                return;
            }
            if (!yaDiferido) {
                await interaction.deferReply();
            }

            const jackpot = obtenerJackpot();
            await animarGiro(interaction, apuesta, jackpot, username);

            const { carretes, resultado, nuevoJackpot } = liquidarGiro(userId, interaction.guildId, username, apuesta);
            const saldoFinal = obtenerSaldo(userId);
            await mostrarResultado(interaction, { carretes, resultado, apuesta, nuevoJackpot, username, saldoFinal });
        } finally {
            partidasActivas.delete(userId);
        }
    },

    async handleButton(client, interaction) {
        const userId = interaction.user.id;
        const username = interaction.user.username;

        if (interaction.customId.startsWith("tragaperras_repetir_")) {
            const apuesta = parseInt(interaction.customId.replace("tragaperras_repetir_", ""));
            if (partidasActivas.has(userId)) {
                await interaction.reply({
                    content: "⏳ Ya estás girando una tragaperras. Espera un momento.",
                    flags: MessageFlags.Ephemeral,
                });
                return;
            }
            await interaction.deferUpdate();
            await this.jugar(interaction, apuesta, userId, username, true);
            return;
        }

        // Botones de jugar con cantidad específica
        if (interaction.customId.startsWith("tragaperras_jugar_")) {
            const apuesta = parseInt(interaction.customId.replace("tragaperras_jugar_", ""));
            if (partidasActivas.has(userId)) {
                await interaction.reply({
                    content: "⏳ Ya estás girando una tragaperras. Espera un momento.",
                    flags: MessageFlags.Ephemeral,
                });
                return;
            }
            await interaction.deferUpdate();
            await this.jugar(interaction, apuesta, userId, username, true);
            return;
        }

        // Botón de ayuda
        if (interaction.customId === "tragaperras_ayuda") {
            const embedAyuda = crearEmbedAyuda();
            await interaction.reply({ embeds: [embedAyuda], flags: MessageFlags.Ephemeral });
            return;
        }

        // Botón de estadísticas de mensajes antiguos: las del casino, solo de la tragaperras.
        if (interaction.customId === "tragaperras_stats") {
            await interaction.reply({ ...casino.buildStats(userId, username, "tragaperras"), flags: MessageFlags.Ephemeral });
            return;
        }
    },
};

module.exports.__test = {
    calcularGanancia,
};

// Animación de los carretes: un frame inicial, dos más y una pausa antes del resultado. Si falla, el giro sigue igual.
async function animarGiro(interaction, apuesta, jackpot, username) {
    try {
        // Frame inicial de animación
        await interaction.editReply({
            embeds: [crearEmbedAnimacion(0, apuesta, jackpot, username)],
            components: [crearBotonesResultado(apuesta, true)],
        });

        // Animación rápida (solo 2 frames más)
        for (let i = 1; i <= 2; i++) {
            await new Promise((resolve) => setTimeout(resolve, 350));
            await interaction.editReply({
                embeds: [crearEmbedAnimacion(i, apuesta, jackpot, username)],
                components: [crearBotonesResultado(apuesta, true)],
            });
        }

        // Pequeña pausa antes del resultado
        await new Promise((resolve) => setTimeout(resolve, 300));
    } catch (error) {
        logWarn("[TRAGAPERRAS] Error en animación:", error.message);
    }
}

// Muestra el resultado con sus botones; si el mensaje ya no admite botones, se reintenta sin ellos.
async function mostrarResultado(interaction, { carretes, resultado, apuesta, nuevoJackpot, username, saldoFinal }) {
    const embedResultado = crearEmbedResultado(carretes, resultado, apuesta, nuevoJackpot, username, saldoFinal);

    const row = crearBotonesResultado(apuesta, false);

    try {
        await interaction.editReply({ embeds: [embedResultado], components: [row] });
    } catch (error) {
        logWarn("[TRAGAPERRAS] Resultado ya liquidado; falló mostrarlo con botones, se reintenta sin ellos:", error.message);
        await interaction.editReply({ embeds: [embedResultado], components: [] });
    }
}
