// ⭐ Pantalla de reseñas de /plex (#567): las listas (mías, últimas, mejores) y la ficha de un título. Solo payloads.
const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require("discord.js");
const plexResenas = require("../systems/plexResenas");
const guildSettings = require("../systems/guildSettings");

const COLOR = 0xe5a00d;
const POR_PAGINA = 5;
const VISTAS = ["mias", "ultimas", "mejores"];
const TITULO_VISTA = { mias: "📝 Mis reseñas", ultimas: "🆕 Últimas", mejores: "🏆 Mejor valoradas" };

const recorte = (t, n = 60) => (String(t || "").length > n ? `${String(t).slice(0, n - 1)}…` : String(t || ""));
const num = (n) => String(n).replace(".", ",");
const cabe = (prefijo, clave) => `${prefijo}${clave}`.length <= 100;

/** Las reseñas de la vista, sin paginar. */
function itemsDe(guildId, userId, vista) {
    if (vista === "mias") return plexResenas.deUsuario(guildId, userId, { limite: 50 });
    if (vista === "ultimas") return plexResenas.ultimas(guildId, { limite: 50 });
    const min = Number(guildSettings.getSettings(guildId).plex.resenas_min_votos) || 3;
    return plexResenas.mejores(guildId, { minVotos: min, limite: 50 });
}

/** Una línea por reseña. */
function linea(item, vista) {
    const titulo = `**${item.titulo}**${item.anio ? ` (${item.anio})` : ""}`;
    if (vista === "mejores") return `${num(item.media)} ★ (${item.votos}) — ${titulo}`;
    const autor = vista === "ultimas" ? ` — <@${item.userId}>` : "";
    const texto = item.texto ? ` — ${item.spoilers ? `||${recorte(item.texto, 50)}||` : recorte(item.texto, 50)}` : "";
    return `${plexResenas.estrellasTexto(item.nota)} ${titulo}${autor}${texto}`;
}

/** La fila de vistas, el interruptor de privacidad y 📊 Mi cine (#574): 5 botones, el máximo de una fila. */
function filaVistas(vista, oculto) {
    const estilo = (v) => (v === vista ? ButtonStyle.Primary : ButtonStyle.Secondary);
    return new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId("plex_resenas_mias").setLabel("📝 Mías").setStyle(estilo("mias")),
        new ButtonBuilder().setCustomId("plex_resenas_ultimas").setLabel("🆕 Últimas").setStyle(estilo("ultimas")),
        new ButtonBuilder().setCustomId("plex_resenas_mejores").setLabel("🏆 Mejores").setStyle(estilo("mejores")),
        new ButtonBuilder()
            .setCustomId("plex_resenas_ocultar")
            .setLabel(oculto ? "👁️ Enseñar" : "🙈 Ocultar")
            .setStyle(oculto ? ButtonStyle.Danger : ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId("plex_resenas_cine").setLabel("📊 Mi cine").setStyle(ButtonStyle.Secondary),
    );
}

/** La pantalla de una lista (mías, últimas o mejores). */
function pantallaResenas(guildId, userId, vista = "mias", pagina = 0, aviso = "") {
    const v = VISTAS.includes(vista) ? vista : "mias";
    const items = itemsDe(guildId, userId, v);
    const total = Math.max(1, Math.ceil(items.length / POR_PAGINA));
    const p = Math.max(0, Math.min(total - 1, Number(pagina) || 0));
    const trozo = items.slice(p * POR_PAGINA, (p + 1) * POR_PAGINA);
    const lineas = trozo.map((i) => linea(i, v));
    const embed = new EmbedBuilder()
        .setTitle(`⭐ Reseñas · ${TITULO_VISTA[v]}`)
        .setColor(COLOR)
        .setDescription(
            (aviso ? `${aviso}\n\n` : "") +
                (lineas.length
                    ? lineas.join("\n")
                    : "Todavía no hay reseñas aquí. Cuando termines una película te llega un DM para puntuarla.") +
                (items.length > POR_PAGINA ? `\n\nPágina ${p + 1} de ${total}` : ""),
        )
        .setFooter({ text: "Pulsa Ver para abrir la ficha de un título." });
    const filas = [filaVistas(v, plexResenas.oculto(guildId, userId))];
    const ver = trozo
        .filter((i) => cabe("plex_resenas_ver_", i.clave))
        .map((i) =>
            new ButtonBuilder().setCustomId(`plex_resenas_ver_${i.clave}`).setLabel(recorte(i.titulo, 20)).setStyle(ButtonStyle.Secondary),
        );
    if (ver.length) filas.push(new ActionRowBuilder().addComponents(ver));
    const nav = [];
    if (total > 1) {
        nav.push(
            new ButtonBuilder()
                .setCustomId(`plex_resenas_pag_${v}_${p - 1}`)
                .setLabel("◀")
                .setStyle(ButtonStyle.Secondary)
                .setDisabled(p === 0),
            new ButtonBuilder()
                .setCustomId(`plex_resenas_pag_${v}_${p + 1}`)
                .setLabel("▶")
                .setStyle(ButtonStyle.Secondary)
                .setDisabled(p >= total - 1),
        );
    }
    nav.push(new ButtonBuilder().setCustomId("plex_resenas_inicio").setLabel("⬅️ Plex").setStyle(ButtonStyle.Secondary));
    filas.push(new ActionRowBuilder().addComponents(nav));
    return { content: "", embeds: [embed], components: filas };
}

/** La ficha de un título: media, votos, histograma, reseñas y tus acciones. */
function pantallaTitulo(guildId, userId, clave, aviso = "") {
    const t = plexResenas.titulo(guildId, clave);
    const mia = plexResenas.de(guildId, userId, clave);
    const primero = t.resenas[0];
    const titulo = mia?.titulo || primero?.titulo || clave;
    const anio = mia?.anio || primero?.anio || null;
    const hist = t.histograma
        .filter((h) => h.votos > 0)
        .map((h) => `${plexResenas.estrellasTexto(h.nota)} ${h.votos}`)
        .join(" · ");
    const resenas = t.resenas.slice(0, 10).map((r) => {
        const texto = r.texto ? ` — ${r.spoilers ? `||${r.texto}||` : r.texto}` : "";
        return `${plexResenas.estrellasTexto(r.nota)} <@${r.userId}>${r.meGusta ? " ❤️" : ""}${texto}`;
    });
    const embed = new EmbedBuilder()
        .setTitle(`⭐ ${titulo}${anio ? ` (${anio})` : ""}`)
        .setColor(COLOR)
        .setDescription(
            (aviso ? `${aviso}\n\n` : "") +
                (t.votos ? `**${num(t.media)} ★** · ${t.votos} ${t.votos === 1 ? "voto" : "votos"}\n${hist}` : "Todavía no hay votos.") +
                (mia
                    ? `\n\n**Tu nota:** ${plexResenas.estrellasTexto(mia.nota)}${mia.meGusta ? " ❤️" : ""}${mia.texto ? `\n> ${mia.spoilers ? `||${mia.texto}||` : mia.texto}` : ""}`
                    : "") +
                (resenas.length ? `\n\n${resenas.join("\n")}` : ""),
        );
    const botones = [];
    if (cabe("plex_resenas_puntuar_", clave)) {
        botones.push(
            new ButtonBuilder()
                .setCustomId(`plex_resenas_puntuar_${clave}`)
                .setLabel(mia ? "✏️ Editar" : "⭐ Puntuar")
                .setStyle(ButtonStyle.Primary),
        );
    }
    if (mia || esAdmin(guildId, userId)) {
        botones.push(new ButtonBuilder().setCustomId(`plex_resenas_borrar_${clave}`).setLabel("🗑️ Borrar").setStyle(ButtonStyle.Danger));
    }
    if (!mia && cabe("plex_resenas_reportar_", clave)) {
        botones.push(
            new ButtonBuilder().setCustomId(`plex_resenas_reportar_${clave}`).setLabel("🚩 Reportar").setStyle(ButtonStyle.Secondary),
        );
    }
    const filas = [];
    if (botones.length) filas.push(new ActionRowBuilder().addComponents(botones));
    filas.push(
        new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId("plex_resenas_mias").setLabel("⬅️ Volver").setStyle(ButtonStyle.Secondary),
        ),
    );
    return { content: "", embeds: [embed], components: filas };
}

/** ¿Es uno de los admins de las alertas? (para dejarle borrar reseñas ajenas) */
function esAdmin(guildId, userId) {
    const ids = String(guildSettings.getSettings(guildId).alertas.admin_ids || "")
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
    return ids.includes(String(userId));
}

module.exports = { pantallaResenas, pantallaTitulo, esAdmin };
