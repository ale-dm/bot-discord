const { SlashCommandBuilder, EmbedBuilder, PermissionFlagsBits, MessageFlags } = require("discord.js");
const db = require("../../core/db");
const cripto = require("../../systems/cripto/mercado");
const { createLogger } = require("../../core/logger");

const log = createLogger("Cripto");

module.exports = {
    data: new SlashCommandBuilder().setName("ttcl-diagnostico").setDescription("🔍 [Admin] Verifica estado del sistema TTCL"),

    async run(client, interaction) {
        // Antes: has("ADMINISTRATOR") (nombre de discord.js 13), que en la 14 lanza RangeError y el
        // comando fallaba siempre, también para los admins.
        if (!interaction.memberPermissions?.has(PermissionFlagsBits.Administrator)) {
            await interaction.reply({ content: "❌ Solo administradores.", flags: MessageFlags.Ephemeral });
            return;
        }

        const guildId = interaction.guildId;

        try {
            // Datos actuales
            const circulacion = db.prepare("SELECT circulacion FROM cripto_ttcl WHERE id = 1").get()?.circulacion || 0;
            const precioActual = cripto.getTtclPrecio(guildId);

            // Último registro en gráfica
            const ultimoRegistro = db.prepare("SELECT precio, timestamp FROM cripto_ttcl_precios ORDER BY timestamp DESC LIMIT 1").get();

            // Cantidad de puntos en gráfica
            const totalPuntos = db.prepare("SELECT COUNT(*) as total FROM cripto_ttcl_precios").get()?.total || 0;

            // Registros últimas 24h
            const hace24h = Date.now() - 24 * 3600 * 1000;
            const puntos24h = db.prepare("SELECT COUNT(*) as total FROM cripto_ttcl_precios WHERE timestamp >= ?").get(hace24h)?.total || 0;

            // Carteras por usuario
            const totalHolders =
                db.prepare("SELECT COUNT(DISTINCT userId) as total FROM cripto_carteras WHERE cripto = 'TTCL' AND cantidad > 0").get()
                    ?.total || 0;

            const totalTtcl =
                db.prepare("SELECT COALESCE(SUM(cantidad), 0) as total FROM cripto_carteras WHERE cripto = 'TTCL'").get()?.total || 0;

            const embed = new EmbedBuilder()
                .setTitle("🔍 Diagnóstico TTCL")
                .setColor(0x9b59b6)
                .addFields(
                    { name: "💰 Precio actual", value: `${Number(precioActual).toFixed(2)} monedas`, inline: true },
                    { name: "🔄 Circulación", value: `${Number(circulacion).toFixed(2)} / 1M`, inline: true },
                    { name: "📊 Puntos gráfica", value: `${totalPuntos} registros (${puntos24h} en 24h)`, inline: true },
                    {
                        name: "⏱️ Último registro",
                        value: ultimoRegistro ? `<t:${Math.floor(ultimoRegistro.timestamp / 1000)}:R>` : "Sin registros",
                        inline: true,
                    },
                    { name: "👥 Holders", value: `${totalHolders} usuarios con TTCL`, inline: true },
                    { name: "💎 TTCL en carteras", value: `${Number(totalTtcl).toFixed(2)} total`, inline: true },
                    { name: "⏰ Próxima actualización", value: "Cada 10 minutos automáticas", inline: false },
                )
                .setFooter({ text: "Ticker automático ejecutándose" })
                .setTimestamp();

            await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
        } catch (e) {
            log.error("Error en /ttcl-diagnostico:", e);
            await interaction.reply({ content: `❌ Error: ${e.message}`, flags: MessageFlags.Ephemeral });
        }
    },
};
