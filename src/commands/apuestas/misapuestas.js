const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require("discord.js");
const db = require("../../core/db");
const { logDebug } = require("../../core/logger");

module.exports = {
    componentHandlers: [{ types: ["button"], prefixes: ["misapuestas_"], method: "handleButton" }],
    data: new SlashCommandBuilder()
        .setName("misapuestas")
        .setDescription("Muestra tus apuestas deportivas")
        .addStringOption((option) =>
            option
                .setName("tipo")
                .setDescription("Tipo de apuestas a mostrar")
                .addChoices(
                    { name: "🔄 Activas (pendientes)", value: "activas" },
                    { name: "📊 Historial completo", value: "historial" },
                    { name: "📈 Estadísticas", value: "stats" },
                )
                .setRequired(false),
        ),

    async run(client, interaction) {
        const userId = interaction.user.id;
        // Desde el botón "Ver mis apuestas" de /apuestas no hay opciones: se muestran las activas.
        const tipo = interaction.options?.getString?.("tipo") || "activas";

        logDebug(`[MISAPUESTAS] Usuario ${userId} consultando ${tipo}`);

        if (tipo === "stats") {
            await mostrarEstadisticas(interaction, userId);
            return;
        }

        await mostrarApuestas(interaction, userId, tipo);
    },
};

async function mostrarEstadisticas(interaction, userId) {
    // Calcular estadísticas del usuario
    const stats = db
        .prepare(
            `
        SELECT 
            COUNT(*) as total_apuestas,
            SUM(CASE WHEN p.estado = 'finalizado' AND a.premio > 0 THEN 1 ELSE 0 END) as ganadas,
            SUM(CASE WHEN p.estado = 'finalizado' AND a.premio = 0 THEN 1 ELSE 0 END) as perdidas,
            SUM(CASE WHEN p.estado = 'abierto' THEN 1 ELSE 0 END) as pendientes,
            SUM(CASE WHEN p.estado = 'caducado' THEN 0 ELSE a.cantidad END) as total_apostado,
            SUM(CASE WHEN p.estado = 'finalizado' THEN COALESCE(a.premio, 0) ELSE 0 END) as total_ganado
        FROM apuestas_usuario a
        JOIN apuestas_partidos p ON a.match_id = p.match_id
        WHERE a.user_id = ?
    `,
        )
        .get(userId);

    if (!stats || stats.total_apuestas === 0) {
        await interaction.reply({
            content: "📊 No tienes apuestas registradas aún. ¡Usa `/apuestas` para empezar!",
            ephemeral: true,
        });
        return;
    }

    const porcentajeAcierto = stats.ganadas > 0 ? ((stats.ganadas / (stats.ganadas + stats.perdidas)) * 100).toFixed(1) : 0;
    const beneficio = stats.total_ganado - stats.total_apostado;

    const embed = new EmbedBuilder()
        .setTitle("� Tus estadísticas de apuestas")
        .setColor(beneficio >= 0 ? 0x27ae60 : 0xe74c3c)
        .addFields(
            {
                name: "🎯 Rendimiento",
                value:
                    `• **${stats.ganadas}** ganadas | **${stats.perdidas}** perdidas\n` +
                    `• **${porcentajeAcierto}%** de acierto\n` +
                    `• **${stats.pendientes}** pendientes`,
                inline: true,
            },
            {
                name: "💰 Económico",
                value:
                    `• **${stats.total_apostado}** monedas apostadas\n` +
                    `• **${stats.total_ganado}** monedas ganadas\n` +
                    `• **${beneficio >= 0 ? "+" : ""}${beneficio}** beneficio`,
                inline: true,
            },
            {
                name: "📊 Resumen",
                value: `Total de apuestas: **${stats.total_apuestas}**\n` + `Estado: ${beneficio >= 0 ? "🟢 Ganando" : "🔴 Perdiendo"}`,
                inline: false,
            },
        )
        .setTimestamp();

    await interaction.reply({ embeds: [embed] });
}

async function mostrarApuestas(interaction, userId, tipo) {
    // Construir consulta según el tipo
    let whereClause = "WHERE a.user_id = ?";
    if (tipo === "activas") {
        whereClause += " AND p.estado = 'abierto'";
    }

    const apuestas = db
        .prepare(
            `
        SELECT a.*, p.home_team, p.away_team, p.start_time, p.estado
        FROM apuestas_usuario a
        JOIN apuestas_partidos p ON a.match_id = p.match_id
        ${whereClause}
        ORDER BY p.start_time DESC
        LIMIT 10
    `,
        )
        .all(userId);

    if (!apuestas.length) {
        const mensaje =
            tipo === "activas" ? "🔄 No tienes apuestas activas. ¡Usa `/apuestas` para apostar!" : "📋 No tienes apuestas registradas.";

        await interaction.reply({
            content: mensaje,
            ephemeral: true,
        });
        return;
    }

    // Crear embed principal
    const embed = new EmbedBuilder()
        .setTitle(tipo === "activas" ? "🔄 Tus apuestas activas" : "📋 Historial de apuestas")
        .setColor(0x3498db)
        .setDescription(`Mostrando ${apuestas.length} apuesta(s)`);

    // Separar por estado para mejor organización
    const activas = apuestas.filter((a) => a.estado === "abierto");
    const finalizadas = apuestas.filter((a) => a.estado === "finalizado" || a.estado === "caducado");

    if (activas.length > 0 && tipo === "activas") {
        let valorActivas = "";
        for (const ap of activas) {
            const ganancia = Math.round(ap.cantidad * ap.cuota);
            const eleccionTexto = ap.eleccion === "home" ? ap.home_team : ap.eleccion === "draw" ? "Empate" : ap.away_team;

            valorActivas +=
                `**${ap.home_team}** vs **${ap.away_team}**\n` +
                `📅 ${new Date(ap.start_time).toLocaleString("es-ES")}\n` +
                `🎯 ${eleccionTexto} | 💰 ${ap.cantidad} → ${ganancia} monedas\n` +
                `📊 Cuota: ${ap.cuota}\n\n`;
        }
        embed.addFields({ name: "⏳ Pendientes de resultado", value: valorActivas || "Ninguna", inline: false });
    }

    if (finalizadas.length > 0 && tipo === "historial") {
        let valorFinalizadas = "";
        for (const ap of finalizadas.slice(0, 5)) {
            // Máximo 5 para no saturar
            // premio NULL: liquidada antes de que se guardara el premio (no se sabe si ganó).
            const estado =
                ap.estado === "caducado"
                    ? "↩️ Reembolsada (sin resultado)"
                    : ap.premio > 0
                      ? `🏆 Ganada (+${ap.premio})`
                      : ap.premio === 0
                        ? "❌ Perdida"
                        : "✔️ Liquidada";
            const eleccionTexto = ap.eleccion === "home" ? ap.home_team : ap.eleccion === "draw" ? "Empate" : ap.away_team;

            valorFinalizadas +=
                `**${ap.home_team}** vs **${ap.away_team}** ${estado}\n` +
                `🎯 ${eleccionTexto} | 💰 ${ap.cantidad} monedas | 📊 ${ap.cuota}\n\n`;
        }
        embed.addFields({ name: "✅ Finalizadas (últimas 5)", value: valorFinalizadas || "Ninguna", inline: false });
    }

    // Botones de navegación
    const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId(`misapuestas_activas_${userId}`)
            .setLabel("🔄 Activas")
            .setStyle(tipo === "activas" ? ButtonStyle.Primary : ButtonStyle.Secondary),
        new ButtonBuilder()
            .setCustomId(`misapuestas_historial_${userId}`)
            .setLabel("📋 Historial")
            .setStyle(tipo === "historial" ? ButtonStyle.Primary : ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId(`misapuestas_stats_${userId}`).setLabel("📈 Stats").setStyle(ButtonStyle.Success),
    );

    await interaction.reply({ embeds: [embed], components: [row] });
}

// Manejador de botones
module.exports.handleButton = async (client, interaction) => {
    const [, tipo, userId] = interaction.customId.split("_");

    // Verificar que el usuario puede usar este botón
    if (interaction.user.id !== userId) {
        await interaction.reply({
            content: "❌ Solo puedes ver tus propias apuestas.",
            ephemeral: true,
        });
        return;
    }

    if (tipo === "stats") {
        await mostrarEstadisticas(interaction, userId);
    } else {
        await mostrarApuestas(interaction, userId, tipo);
    }
};
