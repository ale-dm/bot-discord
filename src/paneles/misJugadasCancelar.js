// 🧩 Lo que se ve al cancelar desde 📋 Mis jugadas: el menú con las apuestas a partidos (F-AP-05), las combinadas (#296) y las alertas de
// cuota (#345) que se pueden quitar, y las pantallas de confirmar. Los botones los atiende paneles/misJugadas; las reglas, systems/apuestas.
const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder } = require("discord.js");
const cancelar = require("../systems/apuestas/cancelar");
const cancelarCombinada = require("../systems/apuestas/cancelarCombinada");
const alertasCuota = require("../systems/apuestas/alertasCuota");
const mercados = require("../systems/apuestas/mercados");
const { paginaDeLista, filaPaginas } = require("./menuPaginado");

const eleccionTexto = (a) => mercados.textoEleccion(a);

/** La opción del menú de cancelar de una apuesta suelta (valor = su id), una combinada (valor = «c» y su id) o una alerta (valor = «n» y su id). */
function opcionCancelar(a) {
    if (a.objetivo !== undefined) {
        return {
            label: `🔔 ${a.home_team} vs ${a.away_team}`.slice(0, 100),
            description: `Alerta de cuota: ${a.textoEleccion} ${a.direccion === "arriba" ? "≥" : "≤"} ${a.objetivo}`.slice(0, 100),
            value: `n${a.id}`,
        };
    }
    if (a.patas) {
        return {
            label: `🧩 Combinada de ${a.patas.length} partidos`,
            description: `${a.cantidad} 🪙 → te devuelvo ${a.cantidad} 🪙, sin comisión`,
            value: `c${a.id}`,
        };
    }
    return {
        label: `${a.home_team} vs ${a.away_team}`.slice(0, 100),
        description: `${eleccionTexto(a)} · ${a.cantidad} 🪙 → te devuelvo ${a.devolucion} 🪙`.slice(0, 100),
        value: String(a.id),
    };
}

/**
 * ↩️ Menú para cancelar una apuesta a un partido (F-AP-05) o una combinada (#296) que aún no han empezado, por páginas de 25: las
 * filas que hay que añadir (el menú y, si no caben todas, ◀ / ▶), o ninguna si no hay nada cancelable.
 */
function filasCancelar(userId, pagina = 0) {
    const pag = paginaDeLista(
        [...cancelar.cancelables(userId), ...cancelarCombinada.cancelables(userId), ...alertasCuota.activasDe(userId)],
        pagina,
    );
    if (!pag.total) return [];
    const paginas = filaPaginas(`misapuestas_cancelpag_${userId}_`, pag);
    const menu = new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder()
            .setCustomId(`misapuestas_cancelarsel_${userId}`)
            .setPlaceholder(`↩️ Cancelar una apuesta (comisión del ${cancelar.COMISION_PCT} %), una combinada o una alerta`)
            .addOptions(pag.items.map(opcionCancelar)),
    );
    return paginas ? [menu, paginas] : [menu];
}

/** ¿Seguro? Antes de cancelar una apuesta: qué se devuelve y cuánto se queda de comisión. */
function buildConfirmarCancelar(userId, a) {
    const unix = Math.floor(Date.parse(a.start_time) / 1000);
    const embed = new EmbedBuilder()
        .setTitle("↩️ ¿Cancelar esta apuesta?")
        .setDescription(
            `**${a.home_team}** vs **${a.away_team}** · empieza <t:${unix}:R>
` +
                `🎯 ${eleccionTexto(a)} · ${a.cantidad.toLocaleString("es")} 🪙 @${a.cuota}

` +
                `Te devuelvo **${a.devolucion.toLocaleString("es")}** 🪙 al efectivo: lo apostado menos **${a.comision.toLocaleString("es")}** 🪙 ` +
                `de comisión (el ${cancelar.COMISION_PCT} %).`,
        )
        .setColor(0xe67e22);
    const fila = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId(`misapuestas_cancelarok_${a.id}_${userId}`)
            .setLabel("↩️ Sí, cancélala")
            .setStyle(ButtonStyle.Danger),
        new ButtonBuilder().setCustomId(`misapuestas_activas_${userId}`).setLabel("◀ No, volver").setStyle(ButtonStyle.Secondary),
    );
    return { content: "", embeds: [embed], components: [fila] };
}

/** ¿Seguro? Antes de cancelar una combinada: cada partido y que se devuelve entera, sin comisión. */
function buildConfirmarCancelarCombinada(userId, c) {
    const unix = Math.floor(Date.parse(c.primerInicio) / 1000);
    const embed = new EmbedBuilder()
        .setTitle("↩️ ¿Cancelar esta combinada?")
        .setDescription(
            `**${c.patas.length} partidos** · ${c.cantidad.toLocaleString("es")} 🪙 @${c.cuota} · el primero empieza <t:${unix}:R>\n` +
                `${c.patas.map((p) => `• ${p.home_team} vs ${p.away_team} · ${eleccionTexto(p)}`).join("\n")}\n\n` +
                `Te devuelvo la apuesta **entera**: **${c.cantidad.toLocaleString("es")}** 🪙 al efectivo, sin comisión.`,
        )
        .setColor(0xe67e22);
    const fila = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId(`misapuestas_cancelarokc_${c.id}_${userId}`)
            .setLabel("↩️ Sí, cancélala")
            .setStyle(ButtonStyle.Danger),
        new ButtonBuilder().setCustomId(`misapuestas_activas_${userId}`).setLabel("◀ No, volver").setStyle(ButtonStyle.Secondary),
    );
    return { content: "", embeds: [embed], components: [fila] };
}

module.exports = { filasCancelar, buildConfirmarCancelar, buildConfirmarCancelarCombinada };
