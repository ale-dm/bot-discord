// Pantallas extra de /plex: 📡 lo que se reproduce ahora (#385), 🗓️ estrenos de la semana (#299), 🏆 campeones del ranking semanal (#389) y
// 📥 mis peticiones pendientes de Seerr (#410). Solo embeds y botones; los datos, en systems/plexExtras y plexCampeones.
const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder } = require("discord.js");
const campeones = require("../systems/plexCampeones");
const { duracion } = require("../systems/plexRankingSemanal");
const { aFecha } = require("../core/zonaMadrid");
const { paginaDeLista } = require("./menuPaginado");

const volver = () =>
    new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId("plex_inicio").setLabel("◀ Plex").setStyle(ButtonStyle.Secondary));
const corto = (texto, max) => (String(texto).length > max ? `${String(texto).slice(0, max - 1)}…` : String(texto));
const fechaCorta = (dia) => aFecha(dia).toLocaleDateString("es-ES", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });

const ESTADOS = { playing: "▶️", paused: "⏸️", buffering: "⏳" };

/** 📡 Lo que se está viendo ahora en Plex (privado). Las cuentas sin vincular salen como «alguien». */
function pantallaAhora(resultado) {
    const embed = new EmbedBuilder().setTitle("📡 Viéndose ahora en Plex").setColor(0xe5a00d);
    if (!resultado.ok) return { content: "", embeds: [embed.setDescription(`❌ ${resultado.motivo}`)], components: [] };
    if (!resultado.sesiones.length)
        return { content: "", embeds: [embed.setDescription("Nadie está viendo Plex ahora mismo. 😴")], components: [] };
    const lineas = resultado.sesiones.map(
        (s) =>
            `${ESTADOS[s.estado] || "▶️"} ${s.discordUserId ? `<@${s.discordUserId}>` : "alguien"} — **${corto(s.titulo, 80)}** (${Math.round(s.progreso)} %)`,
    );
    return { content: "", embeds: [embed.setDescription(lineas.join("\n"))], components: [], allowedMentions: { parse: [] } };
}

/** 🗓️ Los estrenos de los próximos 7 días, con 📥 para pedirlos (el mismo flujo y cupo que las recomendaciones). */
function pantallaEstrenos(resultado) {
    const embed = new EmbedBuilder().setTitle("🗓️ Estrenos de la semana").setColor(0x9b59b6);
    if (!resultado.ok) return { content: "", embeds: [embed.setDescription(`❌ ${resultado.motivo}`)], components: [volver()] };
    if (!resultado.estrenos.length) {
        return { content: "", embeds: [embed.setDescription("No hay estrenos anunciados para esta semana. 🤷")], components: [volver()] };
    }
    embed.setDescription(
        resultado.estrenos
            .map(
                (e) =>
                    `**${corto(e.titulo, 80)}** · ${e.mediaType === "movie" ? "Película" : "Serie"} · ${fechaCorta(e.fecha)}${e.estadoCodigo >= 4 ? " · ✅ ya en Plex" : ""}`,
            )
            .join("\n"),
    );
    const poster = resultado.estrenos.find((e) => e.poster)?.poster;
    if (poster) embed.setThumbnail(poster);
    embed.setFooter({ text: "📥 lo pide en Seerr (cuenta para tu cupo diario). Fuente: Seerr." });
    const pedibles = resultado.estrenos.filter((e) => e.estadoCodigo < 4);
    const filas = [];
    if (pedibles.length) {
        filas.push(
            new ActionRowBuilder().addComponents(
                pedibles.map((e) =>
                    new ButtonBuilder()
                        .setCustomId(`recomendar_pedir_${e.mediaType}_${e.tmdbId}`)
                        .setLabel(`📥 ${corto(e.titulo, 30)}`)
                        .setStyle(ButtonStyle.Success),
                ),
            ),
        );
    }
    return { content: "", embeds: [embed], components: [...filas, volver()] };
}

/** 🏆 Los campeones de las últimas 10 semanas del ranking semanal y cuántas semanas ha ganado cada uno. */
function pantallaCampeones(guildId) {
    const semanas = campeones.ultimas(guildId, 10);
    const embed = new EmbedBuilder().setTitle("🏆 Campeones del ranking semanal").setColor(0xe5a00d);
    if (!semanas.length) {
        return {
            content: "",
            embeds: [embed.setDescription("Todavía no hay campeones guardados: se guardan desde la próxima publicación del ranking.")],
            components: [volver()],
        };
    }
    const lineas = semanas.map((s) => `📅 Semana del ${fechaCorta(s.semana)} — <@${s.discordUserId}> (**${duracion(s.segundos)}**)`);
    const tabla = campeones
        .victorias(guildId, 10)
        .map((v, i) => `${i + 1}. <@${v.discordUserId}> — **${v.victorias}** ${v.victorias === 1 ? "semana" : "semanas"}`);
    embed.addFields({ name: "Últimas semanas", value: lineas.join("\n") }, { name: "Más victorias", value: tabla.join("\n") });
    return { content: "", embeds: [embed], components: [volver()], allowedMentions: { parse: [] } };
}

/** 📥 Mis peticiones pendientes de aprobación, con un menú para cancelar una. */
function pantallaPedidos(resultado, aviso = null) {
    const embed = new EmbedBuilder().setTitle("📥 Mis peticiones pendientes").setColor(0x3498db);
    const prefijo = aviso ? `${aviso}\n\n` : "";
    if (!resultado.ok) return { content: "", embeds: [embed.setDescription(`${prefijo}❌ ${resultado.motivo}`)], components: [volver()] };
    if (!resultado.pedidos.length) {
        return {
            content: "",
            embeds: [embed.setDescription(`${prefijo}No tienes ninguna petición pendiente de aprobar.`)],
            components: [volver()],
        };
    }
    embed.setDescription(
        `${prefijo}${resultado.pedidos.map((p) => `• **${corto(p.titulo, 80)}** (${p.mediaType === "movie" ? "película" : "serie"})`).join("\n")}\n\nSolo se pueden cancelar las que aún no ha aprobado un admin.`,
    );
    const menu = new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder()
            .setCustomId("plexx_cancelar")
            .setPlaceholder("Cancelar una petición")
            .addOptions(paginaDeLista(resultado.pedidos).items.map((p) => ({ label: corto(p.titulo, 100), value: String(p.id) }))),
    );
    return { content: "", embeds: [embed], components: [menu, volver()] };
}

module.exports = { pantallaAhora, pantallaEstrenos, pantallaCampeones, pantallaPedidos };
