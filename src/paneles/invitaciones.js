// 📨 La pantalla de /invitaciones (#522): tus invitados por estado, lo cobrado, el próximo hito y los 10 que más invitan. Solo
// construye el mensaje; las reglas están en systems/invitaciones.js.
const { EmbedBuilder } = require("discord.js");
const invitaciones = require("../systems/invitaciones");
const { fmtNumero } = require("../core/formato");

const ESTADO = { pendiente: "⏳", madurada: "✅", invalida: "🚫", salio: "🚪" };

function pantallaInvitaciones(guildId, userId) {
    const r = invitaciones.resumen(guildId, userId);
    const top = invitaciones.ranking(guildId);
    const ultimos = r.filas.slice(0, 10).map((f) => `${ESTADO[f.estado]} <@${f.invitadoId}>${f.motivo ? ` (${f.motivo})` : ""}`);
    const hitos = invitaciones.HITOS.map((h) => `${h.invitados} (${fmtNumero(h.premio)})`).join(", ");
    const embed = new EmbedBuilder()
        .setTitle("📨 Tus invitaciones")
        .setColor(0x3498db)
        .setDescription(
            `Invita con un enlace tuyo (no el del servidor). Cuando tu invitado lleve **${invitaciones.DIAS_MADURAR} días** y llegue al ` +
                `**nivel ${invitaciones.NIVEL_MADURAR}**, cobras **${fmtNumero(invitaciones.RECOMPENSA)}** 🪙, y hay premios extra al llegar a ` +
                `${hitos} invitados. Las cuentas nuevas, las invitaciones cruzadas y quien sale y vuelve no cuentan.`,
        )
        .addFields(
            {
                name: "Resumen",
                value:
                    `✅ ${r.maduradas} madurados · ⏳ ${r.pendientes} pendientes · 🚪 ${r.salieron} se fueron · 🚫 ${r.invalidas} no cuentan\n` +
                    `💰 Cobrado: **${fmtNumero(r.cobrado)}** 🪙` +
                    (r.proximoHito ? ` · próximo hito: ${r.proximoHito.invitados} (${fmtNumero(r.proximoHito.premio)} 🪙)` : ""),
            },
            { name: "Tus últimos invitados", value: ultimos.join("\n") || "Todavía nadie." },
            {
                name: "🏆 Los que más invitan",
                value: top.map((t, n) => `${n + 1}. <@${t.userId}> · ${t.invitados}`).join("\n") || "Nadie todavía.",
            },
        );
    return { embeds: [embed], allowedMentions: { parse: [] } };
}

module.exports = { pantallaInvitaciones };
