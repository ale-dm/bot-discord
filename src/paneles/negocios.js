// Pestaña 🏪 Negocios de /perfil → 💰 Economía: comprar y vender negocios (con dinero del banco) y depositar dinero
// negro para limpiarlo. Los datos, en systems/negocios; los botones dinero_negocio* los atiende src/perfil/dinero.
const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder } = require("discord.js");
const dinero = require("../systems/dinero");
const negocios = require("../systems/negocios");
const { fmtNumero } = require("../core/formato");

function buildNegocios(userId, aviso = null) {
    const e = negocios.estado(userId);
    const lineas = e.negocios.length
        ? e.negocios.map(
              (n) => `${n.emoji} **${n.nombre}** · +${fmtNumero(n.ingresoDia)} 🪙/día · blanquea ${fmtNumero(n.blanqueoDia)}/día`,
          )
        : "Todavía no tienes ningún negocio.";

    const embed = new EmbedBuilder()
        .setTitle("🏪 Negocios")
        .setDescription(
            (aviso ? `${aviso}\n\n` : "") +
                "Los negocios se compran con dinero del **banco**. Cada uno blanquea una cantidad al día y da un ingreso diario " +
                "en efectivo. El dinero negro que depositas se limpia en **24 h**, repartido a lo largo del día, y al terminar pasa " +
                "al efectivo pagando impuesto como cualquier ingreso.\n\n" +
                lineas,
        )
        .addFields(
            { name: "🥷 Dinero negro", value: `**${fmtNumero(dinero.negro(userId))}** 🪙`, inline: true },
            { name: "🏦 Banco", value: `**${fmtNumero(dinero.banco(userId))}** 🪙`, inline: true },
            { name: "🧼 En limpieza", value: `**${fmtNumero(e.enLimpieza)}** 🪙`, inline: true },
            {
                name: "📅 Capacidad de hoy",
                value: `Usada **${fmtNumero(e.usadoHoy)}** de **${fmtNumero(e.capacidad)}** 🪙 · quedan **${fmtNumero(e.disponibleHoy)}**\n(se reinicia a las 00:00, hora de Madrid)`,
            },
        )
        .setColor(0x16a085)
        .setTimestamp();

    const opciones = Object.entries(negocios.CATALOGO).map(([tipo, c]) => {
        const suyo = e.negocios.find((n) => n.tipo === tipo);
        return suyo
            ? {
                  label: `Vender ${c.emoji} ${c.nombre}`.slice(0, 100),
                  description: `Recuperas ${fmtNumero(Math.floor((suyo.pagado * negocios.VENTA_PCT) / 100))} 🪙 en el banco`,
                  value: `vender_${tipo}`,
              }
            : {
                  label: `Comprar ${c.emoji} ${c.nombre}`.slice(0, 100),
                  description: `${fmtNumero(c.precio)} 🪙 del banco · blanquea ${fmtNumero(c.blanqueoDia)}/día`.slice(0, 100),
                  value: `comprar_${tipo}`,
              };
    });
    const menu = new StringSelectMenuBuilder()
        .setCustomId("dinero_negocio_elegir")
        .setPlaceholder("Comprar o vender un negocio")
        .addOptions(opciones);

    const depositar = new ButtonBuilder()
        .setCustomId("dinero_negocio_depositar")
        .setLabel("🧼 Depositar dinero negro")
        .setStyle(ButtonStyle.Primary)
        .setDisabled(!e.negocios.length || dinero.negro(userId) <= 0);
    const volver = new ButtonBuilder().setCustomId("dinero_panel").setLabel("◀ Economía").setStyle(ButtonStyle.Secondary);

    return {
        content: "",
        embeds: [embed],
        components: [new ActionRowBuilder().addComponents(menu), new ActionRowBuilder().addComponents(depositar, volver)],
    };
}

module.exports = { buildNegocios };
