// /plex → 📺 Series (seguir series y que avise por DM de los episodios nuevos, #465) y 📝 Quiero ver (la lista personal
// que avisa cuando un título llega a Plex, #466). La lógica está en systems/plexAvisos.js.
const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder } = require("discord.js");
const plexAvisos = require("../systems/plexAvisos");
const plexLinks = require("../systems/plexLinks");

const ETIQUETA_TIPO = { movie: "Película", tv: "Serie" };
const cortar = (t, n = 100) => (String(t).length > n ? `${String(t).slice(0, n - 1)}…` : String(t));

const filaVolver = (...extra) =>
    new ActionRowBuilder().addComponents(
        ...extra,
        new ButtonBuilder().setCustomId("plex_inicio").setLabel("◀ Plex").setStyle(ButtonStyle.Secondary),
    );

function pantallaSeries(guildId, userId, aviso = "") {
    const seguidas = plexAvisos.seguidas(guildId, userId);
    const vinculado = Boolean(plexLinks.getLinkByDiscordId(guildId, String(userId)));
    const candidatas = plexAvisos.seriesParaSeguir(guildId, userId);
    const lista = seguidas.length ? seguidas.map((s) => `• **${s.titulo}**`).join("\n") : "Todavía no sigues ninguna serie.";
    const embed = new EmbedBuilder()
        .setTitle("📺 Series que sigues")
        .setColor(0xe5a00d)
        .setDescription(
            "Cuando entre en Plex un episodio nuevo de una serie que sigues, te aviso por DM.\n\n" +
                `${lista}` +
                (vinculado ? "" : "\n\n⚠️ Para elegir series necesitas tu cuenta de Plex vinculada (salen las que has visto)."),
        )
        .setFooter({ text: `${seguidas.length} de ${plexAvisos.MAX_SEGUIDAS} series` });
    const filas = [];
    if (candidatas.length && seguidas.length < plexAvisos.MAX_SEGUIDAS) {
        filas.push(
            new ActionRowBuilder().addComponents(
                new StringSelectMenuBuilder()
                    .setCustomId("plex_sel_seguir")
                    .setPlaceholder("➕ Seguir una serie que has visto")
                    .addOptions(candidatas.map((s) => ({ label: cortar(s.titulo), value: String(s.serie_key) }))),
            ),
        );
    }
    if (seguidas.length) {
        filas.push(
            new ActionRowBuilder().addComponents(
                new StringSelectMenuBuilder()
                    .setCustomId("plex_sel_dejar")
                    .setPlaceholder("➖ Dejar de seguir una serie")
                    .addOptions(seguidas.map((s) => ({ label: cortar(s.titulo), value: String(s.serie_key) }))),
            ),
        );
    }
    filas.push(filaVolver());
    return { content: aviso, embeds: [embed], components: filas };
}

function pantallaQuieroVer(guildId, userId, aviso = "") {
    const lista = plexAvisos.quieroVer(guildId, userId);
    const lineas = lista.map((t) => {
        const tipo = ETIQUETA_TIPO[t.media_type] || t.media_type;
        return t.disponible_en ? `✅ **${t.titulo}** · ${tipo} · ya está en Plex` : `⏳ **${t.titulo}** · ${tipo}`;
    });
    const llegados = lista.filter((t) => t.disponible_en).length;
    const embed = new EmbedBuilder()
        .setTitle("📝 Quiero ver")
        .setColor(0x9b59b6)
        .setDescription(
            "Apunta lo que quieres ver aunque aún no esté en Plex: cuando llegue, te aviso por DM (una vez).\n\n" +
                (lineas.length ? lineas.join("\n") : "Tu lista está vacía. Pulsa ➕ Añadir, o ➕ en 🎯 Para ti."),
        )
        .setFooter({
            text: `${lista.length} de ${plexAvisos.MAX_QUIERO_VER} títulos${llegados ? ` · ${llegados} ya en Plex` : ""}`,
        });
    const filas = [];
    if (lista.length) {
        filas.push(
            new ActionRowBuilder().addComponents(
                new StringSelectMenuBuilder()
                    .setCustomId("plex_sel_quitar")
                    .setPlaceholder("➖ Quitar de la lista")
                    .addOptions(
                        lista.map((t) => ({
                            label: cortar(t.titulo),
                            description: t.disponible_en ? "Ya está en Plex" : ETIQUETA_TIPO[t.media_type],
                            value: `${t.media_type}_${t.tmdb_id}`,
                        })),
                    ),
            ),
        );
    }
    const anadir = new ButtonBuilder()
        .setCustomId("plex_quiero_anadir")
        .setLabel("➕ Añadir")
        .setStyle(ButtonStyle.Success)
        .setDisabled(lista.length >= plexAvisos.MAX_QUIERO_VER);
    filas.push(filaVolver(anadir));
    return { content: aviso, embeds: [embed], components: filas };
}

/** Los resultados de buscar un título para añadirlo a «quiero ver» (como mucho 5, los de Seerr). */
function pantallaResultados(resultados, buscado) {
    if (!resultados.length) {
        return {
            content: `No encuentro nada que se llame «${cortar(buscado, 80)}». Prueba con otro título.`,
            embeds: [],
            components: [filaVolver(new ButtonBuilder().setCustomId("plex_quiero").setLabel("📝 Mi lista").setStyle(ButtonStyle.Primary))],
        };
    }
    const menu = new StringSelectMenuBuilder()
        .setCustomId("plex_sel_anadir")
        .setPlaceholder("Cuál quieres añadir")
        .addOptions(
            resultados.map((r) => ({
                label: cortar(`${r.titulo}${r.anyo ? ` (${r.anyo})` : ""}`),
                description: `${ETIQUETA_TIPO[r.mediaType]}${r.estadoCodigo === 5 ? " · ya está en Plex" : ""}`,
                value: `${r.mediaType}_${r.tmdbId}`,
            })),
        );
    return {
        content: `Resultados para «${cortar(buscado, 80)}»:`,
        embeds: [],
        components: [
            new ActionRowBuilder().addComponents(menu),
            filaVolver(new ButtonBuilder().setCustomId("plex_quiero").setLabel("📝 Mi lista").setStyle(ButtonStyle.Primary)),
        ],
    };
}

module.exports = { pantallaSeries, pantallaQuieroVer, pantallaResultados };
