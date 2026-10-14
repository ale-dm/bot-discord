// 🎬 El mensaje de una sesión de cine: qué, cuándo (en la hora de cada uno) y quién se ha apuntado, con los botones. Si tiene varias
// películas propuestas (#393), una fila de botones para votarlas; 🎯 Sugerir (#399) propone películas para el grupo.
const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require("discord.js");
const cine = require("../systems/cine");
const votos = require("../systems/cine/votos");

const corto = (texto, max) => (String(texto).length > max ? `${String(texto).slice(0, max - 1)}…` : String(texto));

function pantallaSesion(id) {
    const s = cine.sesion(id);
    const personas = cine.asistentes(id);
    const opciones = votos.opciones(id);
    const unix = Math.floor(new Date(s.inicio).getTime() / 1000);
    const lineas = [
        `**Cuándo:** <t:${unix}:F> (<t:${unix}:R>)${s.serie_id ? " · 🔁 cada semana" : ""}`,
        `**Convoca:** <@${s.organizador}>`,
    ];
    if (opciones.length) {
        lineas.push("", "**Votad la película** (se puede votar más de una; pulsar otra vez quita el voto):");
        lineas.push(...opciones.map((o) => `${o.idx + 1}. ${o.titulo} — **${o.votos}** ${o.votos === 1 ? "voto" : "votos"}`));
    }
    lineas.push("", `**Apuntados (${personas.length}):** ${personas.length ? personas.map((u) => `<@${u}>`).join(" ") : "nadie todavía"}`);
    const embed = new EmbedBuilder()
        .setTitle(s.cancelada ? `🎬 ~~${s.peli}~~ (cancelada)` : opciones.length ? "🎬 Sesión de cine" : `🎬 ${s.peli}`)
        .setDescription(lineas.join("\n"))
        .setColor(s.cancelada ? 0x95a5a6 : 0xe67e22)
        .setFooter({ text: `Te avisamos ${cine.AVISO_MIN} minutos antes a quien se haya apuntado.` });

    if (s.cancelada) return { content: "", embeds: [embed], components: [], allowedMentions: { parse: [] } };
    const fila = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`cine_apuntarse_${id}`).setLabel("🙋 Me apunto").setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId(`cine_salirse_${id}`).setLabel("🚪 Me salgo").setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId(`cine_sugerir_${id}`).setLabel("🎯 Sugerir").setStyle(ButtonStyle.Primary),
        new ButtonBuilder()
            .setCustomId(`cine_cancelar_${id}`)
            .setLabel(s.serie_id ? "🛑 Cancelar y parar la serie" : "🛑 Cancelar sesión")
            .setStyle(ButtonStyle.Danger),
    );
    const filas = [fila];
    if (opciones.length && !s.recordatorio) {
        filas.unshift(
            new ActionRowBuilder().addComponents(
                opciones.map((o) =>
                    new ButtonBuilder()
                        .setCustomId(`cine_votar_${id}_${o.idx}`)
                        .setLabel(`🗳️ ${o.idx + 1}. ${corto(o.titulo, 40)}`)
                        .setStyle(ButtonStyle.Primary),
                ),
            ),
        );
    }
    return { content: "", embeds: [embed], components: filas, allowedMentions: { parse: [] } };
}

/** 🎯 Las películas que ninguno de los apuntados con Plex vinculado ha visto, con 📥 para pedirlas en Seerr (privado). */
function pantallaSugerencias(r) {
    const embed = new EmbedBuilder().setTitle("🎯 Para la sesión").setColor(0x9b59b6);
    if (!r.ok) return { content: "", embeds: [embed.setDescription(r.motivo)], components: [] };
    if (!r.sugerencias.length) {
        return { content: "", embeds: [embed.setDescription("No encuentro nada nuevo que no hayáis visto ya. 🤷")], components: [] };
    }
    embed
        .setDescription(
            r.sugerencias
                .map(
                    (s, i) =>
                        `${i + 1}. **${s.titulo}**${s.anyo ? ` (${s.anyo})` : ""} · ${s.mediaType === "movie" ? "Película" : "Serie"}\n   Porque visteis ${s.porque.slice(0, 2).join(", ")}`,
                )
                .join("\n"),
        )
        .setFooter({
            text: `Calculado con ${r.personas} ${r.personas === 1 ? "persona" : "personas"} con Plex vinculado. Quien no lo tiene queda fuera. 📥 lo pide en Seerr a tu nombre.`,
        });
    const fila = new ActionRowBuilder().addComponents(
        r.sugerencias.map((s) =>
            new ButtonBuilder()
                .setCustomId(`recomendar_pedir_${s.mediaType}_${s.tmdbId}`)
                .setLabel(`📥 ${corto(s.titulo, 30)}`)
                .setStyle(ButtonStyle.Success),
        ),
    );
    return { content: "", embeds: [embed], components: [fila] };
}

module.exports = { pantallaSesion, pantallaSugerencias };
