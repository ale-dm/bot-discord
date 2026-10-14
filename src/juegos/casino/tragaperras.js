const { EmbedBuilder, MessageFlags, ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder } = require("discord.js");
const { registrarUsuario, descontarApuesta, obtenerSaldo } = require("../../systems/casinoTransactions");
const { SIMBOLOS, TIRADAS_AUTO, calcularGanancia, obtenerJackpot, liquidarGiro, jugarSerie } = require("../../systems/casino/tragaperras");
const { logWarn } = require("../../core/logger");
const casino = require("../../paneles/casino");

// Estados de las partidas (para animación)
const partidasActivas = new Map();
// Series automáticas en marcha (#354): userId -> { parar }. El botón ⏹️ Parar pone `parar` y la serie lo mira antes de cada tirada.
const seriesAuto = new Map();

// Al acabar (y, desactivada, mientras gira): 🔄 Repetir · 🎲 Otra apuesta · 📊 Stats · ◀ Casino.
function crearBotonesResultado(apuesta, disabled = false, userId = null) {
    return casino.filaFinJuego("tragaperras", apuesta, { desactivada: disabled, userId });
}

// 🔁 El desplegable de la serie automática: las mismas tiradas con la apuesta del resultado.
function crearSelectorAuto(apuesta, disabled = false) {
    return new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder()
            .setCustomId(`tragaperras_auto_${apuesta}`)
            .setPlaceholder(`🔁 Tirada automática (${apuesta} monedas por tirada)`)
            .setDisabled(disabled)
            .addOptions(
                TIRADAS_AUTO.map((n) => ({ label: `🔁 Auto x${n}`, value: String(n), description: `${n} tiradas seguidas de ${apuesta}` })),
            ),
    );
}

const filaParar = () =>
    new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId("tragaperras_parar").setLabel("⏹️ Parar").setStyle(ButtonStyle.Danger),
    );

const signo = (n) => `${n >= 0 ? "+" : "-"}${Math.abs(n).toLocaleString("es")}`;

// Cómo acabó la serie, en una línea.
function textoFinSerie(r) {
    if (r.jackpot) return "🏆 ¡JACKPOT! La serie se detuvo y el premio ya está en tu efectivo.";
    if (r.parada) return "⏹️ Parada a petición.";
    if (r.motivo) return `⚠️ La serie se cortó: ${r.motivo}`;
    return "✅ Serie completa.";
}

/** El resumen de una serie automática (en curso o terminada): tiradas, lo apostado y ganado, y el neto. */
function crearEmbedSerie(r, usuario, saldo, enCurso) {
    const neto = r.ganado - r.apostado;
    return new EmbedBuilder()
        .setTitle(enCurso ? "🎰 Tirada automática en marcha…" : "🎰 Tirada automática - Resumen")
        .setColor(enCurso ? 0xf39c12 : neto >= 0 ? 0x2ecc71 : 0xe74c3c)
        .setAuthor({ name: `Jugador: ${usuario}` })
        .setDescription(
            `🔁 **Tiradas:** ${r.hechas} de ${r.tiradas} (${r.apuesta.toLocaleString("es")} monedas cada una)\n` +
                `💵 **Apostado:** ${r.apostado.toLocaleString("es")} monedas\n` +
                `💰 **Ganado:** ${r.ganado.toLocaleString("es")} monedas\n` +
                `${neto >= 0 ? "✅" : "❌"} **Neto:** ${signo(neto)} monedas\n` +
                `🎯 **Con premio:** ${r.aciertos} · **Mejor ganancia:** ${r.mejor.toLocaleString("es")}\n` +
                (enCurso ? "" : `\n${textoFinSerie(r)}\n💰 **Saldo:** ${saldo.toLocaleString("es")} monedas`),
        );
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
                `🏆 Jackpot: **${jackpot.toLocaleString("es")}** monedas\n` +
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

    const gananciaTexto = resultadoNeto >= 0 ? `+${resultadoNeto.toLocaleString("es")}` : `-${apuesta}`;

    const gananciaIcon = resultadoNeto >= 0 ? "✅" : "❌";

    let descripcion =
        banner +
        `🎰 ${s1} • ${s2} • ${s3} 🎰\n` +
        `${resultado.mensaje}\n\n` +
        `━━━━━━━━━━━━━━━━━━━━━\n` +
        `💵 **Apuesta:** ${apuesta.toLocaleString("es")} monedas\n` +
        `${gananciaIcon} **Resultado:** ${gananciaTexto} monedas`;

    if (resultado.multiplicador !== "JACKPOT") {
        descripcion += ` **(${resultado.multiplicador})**\n`;
    } else {
        descripcion += `\n`;
    }

    descripcion += `💰 **Saldo:** ${saldoFinal.toLocaleString("es")} monedas\n` + `━━━━━━━━━━━━━━━━━━━━━\n\n`;

    if (resultado.tipo !== "jackpot") {
        descripcion += `🏆 Jackpot: **${jackpot.toLocaleString("es")}** monedas`;
    } else {
        descripcion += `🏆 Jackpot reiniciado: **${jackpot.toLocaleString("es")}** monedas`;
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
    componentHandlers: [{ types: ["button", "stringSelect"], prefixes: ["tragaperras_"], method: "handleButton", acl: "juegos" }],

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
            const descuento = descontarApuesta(userId, apuesta, interaction.guildId, "tragaperras");
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

    // 🔁 Serie automática (#354): varias tiradas seguidas con la misma apuesta, con un solo resumen al final.
    async jugarAuto(interaction, apuesta, tiradas, userId, username) {
        partidasActivas.set(userId, Date.now());
        const control = { parar: false };
        seriesAuto.set(userId, control);
        const editar = (embed, components) =>
            interaction
                .editReply({ embeds: [embed], components })
                .catch((e) => logWarn("[TRAGAPERRAS] No se pudo editar la serie:", e.message));
        try {
            registrarUsuario(userId, username, interaction.user.tag);
            const resumen = await jugarSerie(
                { userId, guildId: interaction.guildId, username, apuesta, tiradas },
                {
                    debeParar: () => control.parar,
                    // Una edición cada tres tiradas: Discord limita las ediciones de un mismo mensaje.
                    alProgreso: (r) => (r.hechas % 3 === 0 ? editar(crearEmbedSerie(r, username, 0, true), [filaParar()]) : null),
                },
            );
            if (resumen.hechas === 0) {
                const motivo = resumen.motivo || "No se ha hecho ninguna tirada.";
                await interaction.followUp({ content: motivo, flags: MessageFlags.Ephemeral });
                return;
            }
            const saldo = obtenerSaldo(userId);
            await editar(crearEmbedSerie(resumen, username, saldo, false), [
                crearBotonesResultado(apuesta, false, userId),
                crearSelectorAuto(apuesta),
            ]);
        } finally {
            seriesAuto.delete(userId);
            partidasActivas.delete(userId);
        }
    },

    async handleButton(client, interaction) {
        const userId = interaction.user.id;
        const username = interaction.user.username;
        const id = interaction.customId;

        if (id === "tragaperras_parar") {
            const serie = seriesAuto.get(userId);
            if (serie) serie.parar = true;
            await interaction.deferUpdate();
            return;
        }

        // 🔁 Repetir y 🎲 jugar con una cantidad, o una serie automática: se gira de uno en uno por persona.
        const girar = /^tragaperras_(repetir|jugar|auto)_(\d+)$/.exec(id);
        if (girar) {
            const apuesta = parseInt(girar[2]);
            const tiradas = girar[1] === "auto" ? parseInt(interaction.values?.[0]) : 1;
            if (girar[1] === "auto" && (!TIRADAS_AUTO.includes(tiradas) || !(apuesta > 0))) return;
            if (partidasActivas.has(userId)) {
                await interaction.reply({
                    content: "⏳ Ya estás girando una tragaperras. Espera un momento.",
                    flags: MessageFlags.Ephemeral,
                });
                return;
            }
            await interaction.deferUpdate();
            if (girar[1] === "auto") await this.jugarAuto(interaction, apuesta, tiradas, userId, username);
            else await this.jugar(interaction, apuesta, userId, username, true);
            return;
        }

        // Botón de ayuda
        if (id === "tragaperras_ayuda") {
            await interaction.reply({ embeds: [crearEmbedAyuda()], flags: MessageFlags.Ephemeral });
            return;
        }

        // Botón de estadísticas de mensajes antiguos: las del casino, solo de la tragaperras.
        if (id === "tragaperras_stats") {
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

    const row = crearBotonesResultado(apuesta, false, interaction.user?.id);

    try {
        await interaction.editReply({ embeds: [embedResultado], components: [row, crearSelectorAuto(apuesta)] });
    } catch (error) {
        logWarn("[TRAGAPERRAS] Resultado ya liquidado; falló mostrarlo con botones, se reintenta sin ellos:", error.message);
        await interaction.editReply({ embeds: [embedResultado], components: [] });
    }
}
