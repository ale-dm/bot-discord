// 💸 Lo que se ve del cash-out en 📋 Mis jugadas (#529): el menú con lo que se puede retirar ahora y su valor, y la pantalla de
// confirmar con el valor bloqueado 60 segundos. Los botones los atiende paneles/misJugadas; las reglas, systems/apuestas/cashout.
const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder } = require("discord.js");
const cashout = require("../systems/apuestas/cashout");
const mercados = require("../systems/apuestas/mercados");
const { paginaDeLista } = require("./menuPaginado");

const monedas = (n) => `${Number(n).toLocaleString("es")} 🪙`;

function opcion(o) {
    if (o.tipo === "c") {
        return {
            label: `🧩 Combinada de ${o.combinada.patas} partidos`,
            description: `${monedas(o.combinada.cantidad)} @${o.combinada.cuota} → retirar por ${monedas(o.valor)}`.slice(0, 100),
            value: `c${o.id}`,
        };
    }
    const a = o.apuesta;
    return {
        label: `${a.home_team} vs ${a.away_team}`.slice(0, 100),
        description: `${mercados.textoEleccion(a)} · ${monedas(a.cantidad)} @${a.cuota} → ${monedas(o.valor)}`.slice(0, 100),
        value: `a${o.id}`,
    };
}

/** El menú de retirar (una fila), o ninguna si no hay nada que se pueda retirar ahora. */
function filasCashout(userId, ahora = Date.now()) {
    const lista = cashout.retirables(userId, ahora);
    if (!lista.length) return [];
    return [
        new ActionRowBuilder().addComponents(
            new StringSelectMenuBuilder()
                .setCustomId(`misapuestas_cashsel_${userId}`)
                .setPlaceholder(`💸 Retirar ya (cash-out, margen del ${cashout.MARGEN_PCT} %)`)
                .addOptions(paginaDeLista(lista).items.map(opcion)),
        ),
    ];
}

/** ¿Seguro? El valor bloqueado, hasta cuándo y qué se retira. */
function buildConfirmarCashout(userId, o, aviso = "") {
    const que =
        o.tipo === "c"
            ? `🧩 Combinada de **${o.combinada.patas}** partidos · ${monedas(o.combinada.cantidad)} @${o.combinada.cuota}`
            : `**${o.apuesta.home_team}** vs **${o.apuesta.away_team}**\n🎯 ${mercados.textoEleccion(o.apuesta)} · ${monedas(o.apuesta.cantidad)} @${o.apuesta.cuota}`;
    const embed = new EmbedBuilder()
        .setTitle("💸 ¿Retirar ahora?")
        .setDescription(
            (aviso ? `${aviso}\n\n` : "") +
                `${que}\n\nTe doy **${monedas(o.valor)}** al efectivo y la apuesta deja de contar. El valor sale de las cuotas de ` +
                `ahora menos un ${cashout.MARGEN_PCT} % de margen y está bloqueado hasta <t:${Math.floor(o.expira / 1000)}:T>. Si ` +
                `la cuota se mueve más de un ${cashout.MOVIMIENTO_MAX_PCT} %, se recalcula.`,
        )
        .setColor(0x2ecc71);
    const fila = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId(`misapuestas_cashok_${o.token}_${userId}`)
            .setLabel(`💸 Sí, retirar por ${o.valor.toLocaleString("es")}`.slice(0, 80))
            .setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId(`misapuestas_activas_${userId}`).setLabel("◀ No, volver").setStyle(ButtonStyle.Secondary),
    );
    return { content: "", embeds: [embed], components: [fila] };
}

module.exports = { filasCashout, buildConfirmarCashout };
