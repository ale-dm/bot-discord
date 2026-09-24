const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require("discord.js");
const db = require("../../core/db");
const {
    registrarUsuario,
    descontarApuesta,
    procesarGanancia,
    procesarPerdida,
    obtenerSaldo,
    applyRtp,
} = require("../../systems/casinoTransactions");
const { logInfo, logError, logWarn } = require("../../core/logger");

// Símbolos y sus valores
const SIMBOLOS = {
    "🍒": { valor: 2, peso: 30, nombre: "Cereza" }, // Común
    "🍋": { valor: 3, peso: 25, nombre: "Limón" }, // Común
    "🍊": { valor: 4, peso: 20, nombre: "Naranja" }, // Común
    "🍇": { valor: 5, peso: 15, nombre: "Uvas" }, // Poco común
    "🔔": { valor: 8, peso: 10, nombre: "Campana" }, // Raro
    "💎": { valor: 15, peso: 5, nombre: "Diamante" }, // Muy raro
    "⭐": { valor: 25, peso: 3, nombre: "Estrella" }, // Épico
    "7️⃣": { valor: 50, peso: 2, nombre: "Siete" }, // Legendario (JACKPOT!)
};

// Estados de las partidas (para animación)
const partidasActivas = new Map();

/**
 * Obtener símbolo aleatorio basado en pesos
 */
function obtenerSimboloAleatorio() {
    const simbolos = Object.keys(SIMBOLOS);
    const pesoTotal = Object.values(SIMBOLOS).reduce((sum, s) => sum + s.peso, 0);
    let random = Math.random() * pesoTotal;

    for (const simbolo of simbolos) {
        random -= SIMBOLOS[simbolo].peso;
        if (random <= 0) return simbolo;
    }

    return simbolos[0]; // Fallback
}

/**
 * Girar los carretes
 */
function girarCarretes() {
    return [obtenerSimboloAleatorio(), obtenerSimboloAleatorio(), obtenerSimboloAleatorio()];
}

function crearBotonesMenu(disabled = false) {
    return new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId("tragaperras_jugar_50")
            .setLabel("50 monedas")
            .setEmoji("💵")
            .setStyle(ButtonStyle.Success)
            .setDisabled(disabled),
        new ButtonBuilder()
            .setCustomId("tragaperras_jugar_100")
            .setLabel("100 monedas")
            .setEmoji("💰")
            .setStyle(ButtonStyle.Success)
            .setDisabled(disabled),
        new ButtonBuilder()
            .setCustomId("tragaperras_jugar_500")
            .setLabel("500 monedas")
            .setEmoji("💎")
            .setStyle(ButtonStyle.Primary)
            .setDisabled(disabled),
        new ButtonBuilder()
            .setCustomId("tragaperras_ayuda")
            .setLabel("Ayuda")
            .setEmoji("❓")
            .setStyle(ButtonStyle.Secondary)
            .setDisabled(disabled),
        new ButtonBuilder()
            .setCustomId("tragaperras_stats")
            .setLabel("Stats")
            .setEmoji("📊")
            .setStyle(ButtonStyle.Secondary)
            .setDisabled(disabled),
    );
}

function crearBotonesResultado(apuesta, disabled = false) {
    return new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId(`tragaperras_repetir_${apuesta}`)
            .setLabel(`Jugar (${apuesta})`)
            .setEmoji("🔄")
            .setStyle(ButtonStyle.Primary)
            .setDisabled(disabled),
        new ButtonBuilder().setCustomId("tragaperras_jugar_50").setLabel("50").setStyle(ButtonStyle.Success).setDisabled(disabled),
        new ButtonBuilder().setCustomId("tragaperras_jugar_100").setLabel("100").setStyle(ButtonStyle.Success).setDisabled(disabled),
        new ButtonBuilder().setCustomId("tragaperras_jugar_500").setLabel("500").setStyle(ButtonStyle.Success).setDisabled(disabled),
        new ButtonBuilder()
            .setCustomId("tragaperras_stats")
            .setLabel("Stats")
            .setEmoji("📊")
            .setStyle(ButtonStyle.Secondary)
            .setDisabled(disabled),
    );
}

/**
 * Calcular ganancia basada en los resultados
 */
function calcularGanancia(carretes, apuesta, jackpotOverride = null) {
    const [s1, s2, s3] = carretes;

    // JACKPOT: 3 sietes
    if (s1 === "7️⃣" && s2 === "7️⃣" && s3 === "7️⃣") {
        const jackpot = jackpotOverride ?? obtenerJackpot();
        return {
            multiplicador: "JACKPOT",
            ganancia: jackpot,
            tipo: "jackpot",
            mensaje: `🎰💰 ¡¡¡JACKPOT!!! 💰🎰`,
        };
    }

    // Tres iguales
    if (s1 === s2 && s2 === s3) {
        const multi = SIMBOLOS[s1].valor;
        return {
            multiplicador: `x${multi}`,
            ganancia: apuesta * multi,
            tipo: "triple",
            mensaje: `🎊 ¡TRIPLE ${SIMBOLOS[s1].nombre.toUpperCase()}! 🎊`,
        };
    }

    // Dos iguales
    if (s1 === s2 || s2 === s3 || s1 === s3) {
        const simboloRepetido = s1 === s2 ? s1 : s2 === s3 ? s2 : s1;
        const multi = Math.max(1, Math.ceil(SIMBOLOS[simboloRepetido].valor / 3));
        return {
            multiplicador: `x${multi}`,
            ganancia: apuesta * multi,
            tipo: "doble",
            mensaje: `🎉 ¡Doble ${SIMBOLOS[simboloRepetido].nombre}! 🎉`,
        };
    }

    // Sin premio
    return {
        multiplicador: "x0",
        ganancia: 0,
        tipo: "perdida",
        mensaje: "😢 Sin premio esta vez...",
    };
}

/**
 * Obtener jackpot actual
 */
function obtenerJackpot() {
    const result = db.prepare("SELECT cantidad FROM slots_jackpot WHERE id = 1").get();
    return result ? result.cantidad : 10000;
}

/**
 * Incrementar jackpot
 */
function incrementarJackpot(cantidad) {
    db.prepare("UPDATE slots_jackpot SET cantidad = cantidad + ? WHERE id = 1").run(cantidad);
}

/**
 * Resetear jackpot después de ganarlo
 */
function resetearJackpot() {
    db.prepare("UPDATE slots_jackpot SET cantidad = 10000 WHERE id = 1").run();
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

/**
 * Crear embed de resultado mejorado
 */
function crearEmbedResultado(carretes, resultado, apuesta, jackpot, usuario, saldoFinal) {
    const [s1, s2, s3] = carretes;
    const resultadoNeto = resultado.ganancia - apuesta;

    let color = 0xe74c3c; // Rojo por defecto (perdida)
    let titulo = "😢 SIN PREMIO";
    let banner = "";

    if (resultado.tipo === "jackpot") {
        color = 0xf1c40f; // Oro
        titulo = "🎰 ¡¡¡JACKPOT!!! 🎰";
        banner = `\n🎉🎊🎉🎊🎉🎊🎉🎊🎉\n**¡¡¡GANASTE EL JACKPOT!!!**\n🎉🎊🎉🎊🎉🎊🎉🎊🎉\n\n`;
    } else if (resultado.tipo === "triple") {
        color = 0x2ecc71; // Verde
        titulo = "🎊 ¡TRIPLE!";
        banner = `\n✨ **¡COMBINACIÓN PERFECTA!** ✨\n\n`;
    } else if (resultado.tipo === "doble") {
        if (resultadoNeto > 0) {
            color = 0x3498db; // Azul
            titulo = "🎉 ¡DOBLE!";
        } else {
            color = 0x95a5a6; // Gris
            titulo = "🔁 RECUPERAS APUESTA";
        }
    }

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

    let footerText = "¡Prueba de nuevo!";
    if (resultado.tipo === "jackpot") {
        footerText = "¡FELICIDADES! ¡Ganaste el JACKPOT! 🎉";
    } else if (resultado.tipo === "triple") {
        footerText = "¡Excelente! ¡Sigue así! 🌟";
    } else if (resultado.tipo === "doble") {
        footerText = resultadoNeto > 0 ? "¡Bien! ¡Sigue probando! 💪" : "Al menos recuperaste la apuesta 👌";
    }

    return new EmbedBuilder()
        .setTitle(titulo)
        .setDescription(descripcion)
        .setColor(color)
        .setAuthor({ name: `Jugador: ${usuario}` })
        .setFooter({ text: footerText })
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

/**
 * Crear embed de estadísticas
 */
function crearEmbedEstadisticas(userId, username) {
    try {
        const stats = db
            .prepare(
                `
            SELECT 
                COUNT(*) as partidas,
                SUM(apuesta) as totalApostado,
                SUM(resultado) as gananciaTotal,
                MAX(resultado) as mejorGanancia,
                COUNT(CASE WHEN resultado > 0 THEN 1 END) as victorias,
                COUNT(CASE WHEN resultado < 0 THEN 1 END) as derrotas
            FROM casino 
            WHERE userId = ? AND juego = 'tragaperras'
        `,
            )
            .get(userId);

        if (!stats || stats.partidas === 0) {
            return new EmbedBuilder()
                .setTitle("📊 ESTADÍSTICAS")
                .setDescription(`**${username}** aún no ha jugado.\n\n` + `¡Empieza ahora y haz historia! 🎰`)
                .setColor(0x95a5a6)
                .setThumbnail("https://em-content.zobj.net/thumbs/160/google/350/slot-machine_1f3b0.png");
        }

        const winRate = ((stats.victorias / stats.partidas) * 100).toFixed(1);
        const roi = stats.totalApostado > 0 ? ((stats.gananciaTotal / stats.totalApostado) * 100).toFixed(1) : "0.0";

        const roiIcon = parseFloat(roi) > 0 ? "📈" : "📉";

        return new EmbedBuilder()
            .setTitle("📊 ESTADÍSTICAS DE TRAGAPERRAS")
            .setDescription(
                `**Jugador:** ${username}\n\n` +
                    `**RESUMEN:**\n` +
                    `🎰 Partidas: **${stats.partidas}**\n` +
                    `💰 Total apostado: **${stats.totalApostado?.toLocaleString() || 0}**\n` +
                    `💸 Ganancia neta: **${stats.gananciaTotal >= 0 ? "+" : ""}${stats.gananciaTotal?.toLocaleString() || 0}**\n` +
                    `${roiIcon} ROI: **${roi}%**\n\n` +
                    `**RENDIMIENTO:**\n` +
                    `✅ Victorias: **${stats.victorias || 0}**\n` +
                    `❌ Derrotas: **${stats.derrotas || 0}**\n` +
                    `📊 Ratio: **${winRate}%**\n\n` +
                    `🏆 Mejor ganancia: **${stats.mejorGanancia?.toLocaleString() || 0}** monedas`,
            )
            .setColor(0x3498db)
            .setThumbnail("https://em-content.zobj.net/thumbs/160/google/350/slot-machine_1f3b0.png")
            .setFooter({ text: "¡Sigue jugando para mejorar!" })
            .setTimestamp();
    } catch (error) {
        logError("[TRAGAPERRAS] Error obteniendo estadísticas:", error);
        return new EmbedBuilder().setTitle("📊 ESTADÍSTICAS").setDescription("❌ Error al cargar estadísticas").setColor(0xe74c3c);
    }
}

module.exports = {
    componentHandlers: [{ types: ["button"], prefixes: ["tragaperras_"], method: "handleButton" }],
    data: new SlashCommandBuilder()
        .setName("tragaperras")
        .setDescription("🎰 Juega a la tragaperras con jackpot progresivo")
        .addIntegerOption((option) =>
            option
                .setName("apuesta")
                .setDescription("Cantidad a apostar (min: 50, max: 5000)")
                .setRequired(false)
                .setMinValue(50)
                .setMaxValue(5000),
        ),

    async run(client, interaction) {
        const apuesta = interaction.options.getInteger("apuesta");
        const userId = interaction.user.id;
        const username = interaction.user.username;

        // Si no hay apuesta, mostrar menú principal
        if (!apuesta) {
            const jackpot = obtenerJackpot();
            const saldo = obtenerSaldo(userId);

            const embed = new EmbedBuilder()
                .setTitle("🎰 TRAGAPERRAS 🎰")
                .setDescription(
                    `**¡Bienvenido ${username}!**\n\n` +
                        `💰 **Tu saldo:** ${saldo.toLocaleString()} monedas\n` +
                        `🏆 **Jackpot actual:** ${jackpot.toLocaleString()} monedas\n\n` +
                        `Gira los carretes y gana grandes premios.\n` +
                        `¡Tres 7️⃣ ganan el JACKPOT completo!\n\n` +
                        `💡 _El 10% de cada apuesta aumenta el jackpot_`,
                )
                .setColor(0xf1c40f)
                .setThumbnail("https://em-content.zobj.net/thumbs/160/google/350/slot-machine_1f3b0.png")
                .setFooter({ text: "¡Buena suerte! 🍀" });

            const row = crearBotonesMenu(false);

            await interaction.reply({ embeds: [embed], components: [row] });
            return;
        }

        // Iniciar juego con apuesta específica
        await this.jugar(interaction, apuesta, userId, username);
    },

    async jugar(interaction, apuesta, userId, username, yaDiferido = false) {
        if (partidasActivas.has(userId)) {
            if (!yaDiferido) {
                await interaction.reply({ content: "⏳ Ya tienes una tragaperras en curso. Espera a que termine.", ephemeral: true });
            }
            return;
        }
        partidasActivas.set(userId, Date.now());

        try {
            if (!yaDiferido) {
                await interaction.deferReply();
            }

            // Registrar usuario
            registrarUsuario(userId, username, interaction.user.tag);

            // Validar y descontar apuesta
            const descuento = descontarApuesta(userId, apuesta, interaction.guildId);
            if (!descuento.exito) {
                await interaction.editReply({
                    content: descuento.mensaje,
                    embeds: [],
                    components: [],
                });
                return;
            }

            const jackpot = obtenerJackpot();

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

            // Girar carretes y calcular resultado
            const carretes = girarCarretes();
            const resultado = calcularGanancia(carretes, apuesta);

            // Incrementar jackpot con el 10% de la apuesta
            const contribucionJackpot = Math.floor(apuesta * 0.1);
            incrementarJackpot(contribucionJackpot);

            let gananciaReal = 0;
            let nuevoJackpot = obtenerJackpot();

            // Procesar resultado
            if (resultado.tipo === "jackpot") {
                gananciaReal = applyRtp(interaction.guildId, "tragaperras", apuesta, resultado.ganancia);
                resultado.ganancia = gananciaReal; // mantener el embed de resultado en sync con lo realmente acreditado
                const exito = procesarGanancia(
                    userId,
                    "tragaperras",
                    apuesta,
                    gananciaReal,
                    `🎰 JACKPOT en Tragaperras (+${gananciaReal})`,
                    {
                        carretes,
                        tipo: "JACKPOT",
                        multiplicador: "JACKPOT",
                        jackpot: resultado.ganancia,
                    },
                );

                if (exito) {
                    resetearJackpot();
                    nuevoJackpot = obtenerJackpot();
                    logInfo(`[TRAGAPERRAS] ¡¡¡JACKPOT!!! Usuario ${username} ganó ${gananciaReal} monedas`);
                }
            } else if (resultado.ganancia > 0) {
                gananciaReal = applyRtp(interaction.guildId, "tragaperras", apuesta, resultado.ganancia);
                resultado.ganancia = gananciaReal; // mantener el embed de resultado en sync con lo realmente acreditado
                const exito = procesarGanancia(
                    userId,
                    "tragaperras",
                    apuesta,
                    gananciaReal,
                    `🎰 Victoria en Tragaperras (+${gananciaReal - apuesta})`,
                    {
                        carretes,
                        tipo: resultado.tipo,
                        multiplicador: resultado.multiplicador,
                    },
                );

                if (exito) {
                    logInfo(`[TRAGAPERRAS] Usuario ${username} ganó ${gananciaReal} (${resultado.multiplicador})`);
                }
            } else {
                // Pérdida (ya se descontó la apuesta)
                procesarPerdida(userId, "tragaperras", apuesta, `🎰 Pérdida en Tragaperras (-${apuesta})`, {
                    carretes,
                    tipo: "perdida",
                    multiplicador: "x0",
                });

                logInfo(`[TRAGAPERRAS] Usuario ${username} perdió ${apuesta}`);
            }

            const saldoFinal = obtenerSaldo(userId);

            // Mostrar resultado
            const embedResultado = crearEmbedResultado(carretes, resultado, apuesta, nuevoJackpot, username, saldoFinal);

            const row = crearBotonesResultado(apuesta, false);

            try {
                await interaction.editReply({ embeds: [embedResultado], components: [row] });
            } catch (error) {
                logWarn("[TRAGAPERRAS] Resultado ya liquidado; falló mostrarlo con botones, se reintenta sin ellos:", error.message);
                await interaction.editReply({ embeds: [embedResultado], components: [] });
            }
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
                await interaction.reply({ content: "⏳ Ya estás girando una tragaperras. Espera un momento.", ephemeral: true });
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
                await interaction.reply({ content: "⏳ Ya estás girando una tragaperras. Espera un momento.", ephemeral: true });
                return;
            }
            await interaction.deferUpdate();
            await this.jugar(interaction, apuesta, userId, username, true);
            return;
        }

        // Botón de ayuda
        if (interaction.customId === "tragaperras_ayuda") {
            const embedAyuda = crearEmbedAyuda();
            await interaction.reply({ embeds: [embedAyuda], ephemeral: true });
            return;
        }

        // Botón de estadísticas
        if (interaction.customId === "tragaperras_stats") {
            const embedStats = crearEmbedEstadisticas(userId, username);
            await interaction.reply({ embeds: [embedStats], ephemeral: true });
            return;
        }
    },
};

module.exports.__test = {
    calcularGanancia,
};
