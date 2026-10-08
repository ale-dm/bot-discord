// Piezas comunes de /cripto: la fila de pestañas, el formato de cada pantalla y los formatos de texto.
const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require("discord.js");

const PESTANAS = [
    { id: "mercado", label: "📈 Mercado", customId: "cripto_tab_mercado" },
    { id: "comprar", label: "🛒 Comprar", customId: "cripto_tab_comprar" },
    { id: "vender", label: "💸 Vender", customId: "cripto_tab_vender" },
    { id: "cartera", label: "💼 Cartera", customId: "cripto_tab_cartera" },
    { id: "historial", label: "🧾 Historial", customId: "cripto_tab_historial" },
];

function filaPestanas(actual) {
    return new ActionRowBuilder().addComponents(
        PESTANAS.map((p) =>
            new ButtonBuilder()
                .setCustomId(p.customId)
                .setLabel(p.label)
                .setStyle(p.id === actual ? ButtonStyle.Primary : ButtonStyle.Secondary),
        ),
    );
}

/**
 * Una pantalla completa: embeds, sus filas de botones (como mucho 4, la de pestañas va debajo) y, si hay, imágenes.
 * Siempre quita las imágenes de la pantalla anterior (attachments vacío), para que no se queden pegadas al cambiar de pestaña.
 */
function pantalla({ embeds, filas = [], actual, files = [] }) {
    return { content: "", embeds, components: [...filas, filaPestanas(actual)], files, attachments: [] };
}

const fmtMonedas = (n) => `${Math.round(n).toLocaleString("es")} monedas`;

/** Fecha y hora de Madrid, corta (para el historial y los eventos). */
function fechaMadrid(t) {
    return new Date(t).toLocaleString("es-ES", {
        timeZone: "Europe/Madrid",
        day: "2-digit",
        month: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
    });
}

/** Línea de aviso al principio de una pestaña (resultado de una operación). Vacía si no hay aviso. */
const avisoTexto = (aviso) => (aviso ? `${aviso}\n\n` : "");

module.exports = { PESTANAS, filaPestanas, pantalla, fmtMonedas, fechaMadrid, avisoTexto };
