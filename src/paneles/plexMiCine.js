// 📊 Mi cine (#574): tus estadísticas de cine en /plex → ⭐ Reseñas. Solo el payload; las cifras las calcula
// systems/plexResenas/miCine. Es privado (la pantalla de /plex es efímera).
const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require("discord.js");
const { estrellasTexto } = require("../systems/plexResenas/base");

const COLOR = 0xe5a00d;

const num = (n) => String(n).replace(".", ",");
const veces = (n, uno, varios) => `${n} ${n === 1 ? uno : varios}`;
const tituloDe = (r) => `**${r.titulo}**${r.anio ? ` (${r.anio})` : ""}`;
const fmtH = (h) => `${num(Number(h).toFixed(1))} h`;

/** Tu media frente a la del servidor (solo reseñas públicas). */
function comparacionMedia(media, servidor) {
    if (media === null || servidor.media === null) return "";
    const diferencia = Math.round((media - servidor.media) * 10) / 10;
    const comparacion =
        diferencia === 0 ? "igual que" : `${num(Math.abs(diferencia))} ★ ${diferencia > 0 ? "más alto que" : "más bajo que"}`;
    return `\nPuntúas ${comparacion} la media del servidor (**${num(servidor.media)} ★**, ${veces(servidor.votos, "reseña pública", "reseñas públicas")}).`;
}

function campoResenas({ resenas: r, servidor }) {
    if (!r.total) return "Todavía no has escrito reseñas. Cuando termines una película te llega un DM para puntuarla.";
    const lineas = [
        `**${r.total}** ${r.total === 1 ? "reseña" : "reseñas"}: ${veces(r.peliculas, "película", "películas")} y ${veces(r.series, "serie o temporada", "series o temporadas")}.`,
        `Media que das: **${num(r.media)} ★**${comparacionMedia(r.media, servidor)}`,
    ];
    if (r.mejor) lineas.push(`👍 Tu mejor película: ${tituloDe(r.mejor)} ${estrellasTexto(r.mejor.nota)}${r.mejor.meGusta ? " ❤️" : ""}`);
    if (r.peor) lineas.push(`👎 Tu peor película: ${tituloDe(r.peor)} ${estrellasTexto(r.peor.nota)}`);
    return lineas.join("\n");
}

function campoGustos({ genero, decada }) {
    if (!genero && !decada) return "Todavía no hay fichas de lo que has visto (se completan con la sincronización de Plex).";
    const lineas = [];
    if (genero) lineas.push(`Género: **${genero.nombre}** (${veces(genero.n, "título", "títulos")})`);
    if (decada) lineas.push(`Década: **${decada.decada}–${decada.decada + 9}** (${veces(decada.n, "título", "títulos")})`);
    return lineas.join("\n");
}

function campoRacha({ actual, mejor, servidor }) {
    const lineas = [`Ahora: **${veces(actual, "día", "días")}** seguidos · tu mejor: **${veces(mejor, "día", "días")}**`];
    if (servidor.media !== null)
        lineas.push(
            `Media del servidor: **${num(servidor.media)} días** de mejor racha (${veces(servidor.personas, "persona", "personas")}).`,
        );
    return lineas.join("\n");
}

function campoAnio(a, vinculado) {
    const lineas = [
        a.resenas
            ? `📝 **${a.resenas}** ${a.resenas === 1 ? "reseña" : "reseñas"} · media **${num(a.media)} ★**${a.mejor ? ` · la mejor: ${tituloDe(a.mejor)}` : ""}`
            : "📝 Este año todavía no has escrito reseñas.",
    ];
    if (vinculado) {
        lineas.push(
            a.horas > 0
                ? `🍿 **${fmtH(a.horas)}** de Plex: ${veces(a.peliculas, "película", "películas")} y ${veces(a.episodios, "episodio", "episodios")}.`
                : "🍿 Este año todavía no has visto nada en Plex.",
        );
        if (a.series.length)
            lineas.push(`📺 Tus series: ${a.series.map((s, i) => `${i + 1}. ${s.nombre} (${fmtH(s.horas)})`).join(" · ")}`);
        if (a.racha) lineas.push(`🔥 Mejor racha del año: **${veces(a.racha, "día", "días")}** seguidos.`);
    }
    return lineas.join("\n");
}

/** La pantalla 📊 Mi cine con las cifras de systems/plexResenas/miCine.calcular. */
function pantallaMiCine(datos) {
    const campos = [{ name: "📝 Tus reseñas", value: campoResenas(datos) }];
    if (datos.vinculado) {
        campos.push({ name: "🎭 Lo que más ves", value: campoGustos(datos.gustos) });
        campos.push({ name: "🔥 Racha de días seguidos viendo algo", value: campoRacha(datos.racha) });
    } else {
        campos.push({
            name: "🔗 Plex",
            value: "Tu cuenta de Plex no está vinculada: lo que ves (géneros, décadas, rachas y horas) sale cuando un admin la vincule.",
        });
    }
    campos.push({ name: `📅 Tu ${datos.anio.anio} hasta hoy`, value: campoAnio(datos.anio, datos.vinculado) });
    const embed = new EmbedBuilder()
        .setTitle("📊 Mi cine")
        .setColor(COLOR)
        .addFields(campos.map((c) => ({ ...c, value: c.value.slice(0, 1024) })))
        .setFooter({ text: "Solo lo ves tú. Sale de tus reseñas, tu historial de Plex y sus fichas." });
    const botones = [new ButtonBuilder().setCustomId("plex_resenas_mias").setLabel("⬅️ Reseñas").setStyle(ButtonStyle.Secondary)];
    if (datos.vinculado && datos.anio.series.length)
        botones.push(
            new ButtonBuilder().setCustomId("plex_resenas_cine_imagen").setLabel("🖼️ Imagen del año").setStyle(ButtonStyle.Primary),
        );
    return { content: "", embeds: [embed], components: [new ActionRowBuilder().addComponents(botones)], allowedMentions: { parse: [] } };
}

module.exports = { pantallaMiCine };
