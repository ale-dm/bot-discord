// Pestaña 🧾 Historial de /cripto: tus compras y ventas de TTCL, de la más reciente a la más antigua, por páginas.
const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require("discord.js");
const mercado = require("../../systems/cripto/mercado");
const { pantalla, fmtMonedas, fechaMadrid } = require("./comun");

const POR_PAGINA = 8;

function lineaHistorial(f) {
    const icono = f.tipo === "compra" ? "🟢 Compra" : "🔴 Venta";
    return `${icono} · ${mercado.formatCryptoAmt(f.cantidad)} TTCL · ${fmtMonedas(f.monedas)} · ${mercado.formatCoins(f.precio)}/u · ${fechaMadrid(f.timestamp)}`;
}

async function pantallaHistorial(userId, pagina = 0) {
    const total = mercado.totalHistorialTtcl(userId);
    const paginas = Math.max(1, Math.ceil(total / POR_PAGINA));
    const p = Math.min(Math.max(0, pagina), paginas - 1);

    const embed = new EmbedBuilder().setTitle("🧾 Historial de $TTCL").setColor(0x3498db);
    if (!total) {
        embed.setDescription("Todavía no has comprado ni vendido $TTCL.");
        return pantalla({ embeds: [embed], actual: "historial" });
    }

    const filas = mercado.historialTtcl(userId, POR_PAGINA, p * POR_PAGINA);
    embed.setDescription(filas.map(lineaHistorial).join("\n"));
    embed.setFooter({ text: `Página ${p + 1} de ${paginas} · ${total} operaciones` });

    const paginar = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId(`cripto_hist_${p - 1}`)
            .setLabel("◀ Más recientes")
            .setStyle(ButtonStyle.Secondary)
            .setDisabled(p <= 0),
        new ButtonBuilder()
            .setCustomId(`cripto_hist_${p + 1}`)
            .setLabel("Más antiguas ▶")
            .setStyle(ButtonStyle.Secondary)
            .setDisabled(p >= paginas - 1),
    );
    return pantalla({ embeds: [embed], filas: [paginar], actual: "historial" });
}

module.exports = { pantallaHistorial, POR_PAGINA };
