// Menús de selección con más de 25 elementos: Discord no admite más de 25 opciones por menú, así que la lista se reparte en
// páginas con una fila ◀ / ▶ y un contador («1–25 de 40»), en vez de cortarla en silencio.
const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require("discord.js");

const MAX_OPCIONES = 25;

/** La página `pagina` de `lista` (ajustada a las que existen), con lo necesario para pintar el contador. */
function paginaDeLista(lista, pagina = 0) {
    const total = lista.length;
    const paginas = Math.max(1, Math.ceil(total / MAX_OPCIONES));
    const p = Math.min(Math.max(0, Number(pagina) || 0), paginas - 1);
    const desde = p * MAX_OPCIONES;
    const items = lista.slice(desde, desde + MAX_OPCIONES);
    return { items, pagina: p, paginas, total, desde: desde + 1, hasta: desde + items.length };
}

/**
 * La fila ◀ / contador / ▶, o null si todo cabe en una página. Los botones llevan `${prefijo}<página>`, y el contador
 * (desactivado) `${prefijo}info`; quien usa el menú enruta `${prefijo}\d+` a la página pedida.
 */
function filaPaginas(prefijo, { pagina, paginas, total, desde, hasta }) {
    if (paginas <= 1) return null;
    return new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId(`${prefijo}${pagina - 1}`)
            .setLabel("◀")
            .setStyle(ButtonStyle.Secondary)
            .setDisabled(pagina <= 0),
        new ButtonBuilder()
            .setCustomId(`${prefijo}info`)
            .setLabel(`Mostrando ${desde}–${hasta} de ${total}`)
            .setStyle(ButtonStyle.Secondary)
            .setDisabled(true),
        new ButtonBuilder()
            .setCustomId(`${prefijo}${pagina + 1}`)
            .setLabel("▶")
            .setStyle(ButtonStyle.Secondary)
            .setDisabled(pagina >= paginas - 1),
    );
}

/** El número de página de un customId `${prefijo}<n>`, o null si no es un botón de página de ese prefijo. */
function paginaDeId(prefijo, customId) {
    if (!customId.startsWith(prefijo)) return null;
    const resto = customId.slice(prefijo.length);
    return /^\d+$/.test(resto) ? Number(resto) : null;
}

module.exports = { MAX_OPCIONES, paginaDeLista, filaPaginas, paginaDeId };
