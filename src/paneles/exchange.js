// 🔁 Lo que se ve del exchange (#533): el libro de un partido, los formularios de ir a favor y en contra, las confirmaciones
// con lo que se gana, la comisión y lo que se arriesga, y «Mis órdenes» con el menú para cancelar lo no cruzado.
const {
    EmbedBuilder,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    ModalBuilder,
    LabelBuilder,
    StringSelectMenuBuilder,
    TextInputBuilder,
    TextInputStyle,
} = require("discord.js");
const exchange = require("../systems/apuestas/exchange");
const { paginaDeLista } = require("./menuPaginado");
const { fmtNumero } = require("../core/formato");

const COLOR = 0x16a085;
const MAX_NIVELES = 5;
const ESTADO = {
    abierta: "⏳ sin cruzar",
    parcial: "🟡 en parte",
    casada: "🤝 cruzada",
    cancelada: "🚫 cancelada",
    liquidada: "✔️ liquidada",
};

const nombreEleccion = (p, e) => (e === "home" ? p.home_team : e === "away" ? p.away_team : "Empate");

/** El libro de un partido, con la cuota de la casa de referencia. */
function vistaLibro(p, aviso = "") {
    const libro = exchange.libro(p.match_id);
    const casa = { home: p.cuota_home, draw: p.cuota_draw, away: p.cuota_away };
    const lineas = exchange.ELECCIONES.map((e) => {
        const niveles = libro[e].slice(0, MAX_NIVELES).map((n) => `\`${n.cuota}\` · ${fmtNumero(n.disponible)} 🪙`);
        return `**${nombreEleccion(p, e)}** (casa ${casa[e] ?? "—"})\n${niveles.join(" | ") || "_sin órdenes_"}`;
    });
    const embed = new EmbedBuilder()
        .setTitle(`🔁 Exchange · ${p.home_team} vs ${p.away_team}`)
        .setDescription(
            (aviso ? `${aviso}\n\n` : "") +
                `${lineas.join("\n\n")}\n\n` +
                "**➕ A favor**: publicas tu cuota y esperas a que alguien la cruce. **🤝 En contra**: cruzas las del libro (la más " +
                `baja primero) y arriesgas lo apostado × (cuota − 1). Quien gana paga un **${exchange.COMISION_PCT} %** de su ganancia ` +
                "neta. Lo que no se cruce se devuelve al empezar el partido.",
        )
        .setColor(COLOR);
    const fila = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`exchange_publicar_${p.match_id}`).setLabel("➕ A favor").setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId(`exchange_casar_${p.match_id}`).setLabel("🤝 En contra").setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId("exchange_mias").setLabel("📋 Mis órdenes").setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId(`exchange_ver_${p.match_id}`).setLabel("🔄 Actualizar").setStyle(ButtonStyle.Secondary),
    );
    return { content: "", embeds: [embed], components: [fila] };
}

const campoTexto = (id, etiqueta, ejemplo) =>
    new LabelBuilder()
        .setLabel(etiqueta)
        .setTextInputComponent(
            new TextInputBuilder().setCustomId(id).setStyle(TextInputStyle.Short).setPlaceholder(ejemplo).setRequired(true),
        );

/** El formulario de ir a favor (`publicar`) o en contra (`casar`). */
function formulario(tipo, p) {
    const contra = tipo === "casar";
    return new ModalBuilder()
        .setCustomId(`exchange_modal_${tipo}_${p.match_id}`)
        .setTitle(contra ? "🤝 Ir en contra" : "➕ Ir a favor")
        .addLabelComponents(
            new LabelBuilder()
                .setLabel(contra ? "¿En contra de qué resultado?" : "¿A favor de qué resultado?")
                .setStringSelectMenuComponent(
                    new StringSelectMenuBuilder()
                        .setCustomId("eleccion")
                        .setRequired(true)
                        .addOptions(exchange.ELECCIONES.map((e) => ({ label: nombreEleccion(p, e).slice(0, 100), value: e }))),
                ),
            campoTexto("cuota", contra ? "Cuota máxima que aceptas" : `Tu cuota (${exchange.MIN_CUOTA} a ${exchange.MAX_CUOTA})`, "2,10"),
            campoTexto("cantidad", contra ? "Cuánto de la apuesta a favor cubres" : "Cuánto apuestas", "100"),
        );
}

const filaConfirmar = (id, etiqueta, matchId) =>
    new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(id).setLabel(etiqueta).setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId(`exchange_ver_${matchId}`).setLabel("◀ Volver al libro").setStyle(ButtonStyle.Secondary),
    );

/** ¿Seguro? Ir a favor: lo que cobras si gana (menos la comisión) y lo que pierdes si no. */
function confirmarPublicar(p, eleccion, cuota, cantidad) {
    const neto = Math.round(cantidad * (cuota - 1));
    const com = exchange.comision(neto);
    const embed = new EmbedBuilder()
        .setTitle("➕ ¿Publicar esta orden?")
        .setDescription(
            `A favor de **${nombreEleccion(p, eleccion)}** @\`${cuota}\` con **${fmtNumero(cantidad)}** 🪙.\n` +
                `✅ Si gana y te cruzan entera: cobras **${fmtNumero(cantidad + neto - com)}** 🪙 (comisión de ${fmtNumero(com)}).\n` +
                `❌ Si no gana: pierdes lo cruzado. Lo que nadie cruce se devuelve al empezar el partido o al cancelarla.`,
        )
        .setColor(COLOR);
    return {
        content: "",
        embeds: [embed],
        components: [
            filaConfirmar(`exchange_okpub_${p.match_id}_${eleccion}_${Math.round(cuota * 100)}_${cantidad}`, "➕ Publicar", p.match_id),
        ],
    };
}

/** ¿Seguro? Ir en contra: qué se cruzaría, el riesgo y lo que se cobra si no gana (menos la comisión). */
function confirmarCasar(p, eleccion, cuotaMax, cantidad, plan) {
    const com = exchange.comision(plan.cubierto);
    const embed = new EmbedBuilder()
        .setTitle("🤝 ¿Ir en contra?")
        .setDescription(
            `En contra de **${nombreEleccion(p, eleccion)}** hasta @\`${cuotaMax}\`.\n` +
                `Se cruzarían **${fmtNumero(plan.cubierto)}** de ${fmtNumero(cantidad)} 🪙 (${plan.cruces.map((c) => `${fmtNumero(c.cantidad)} @${c.cuota}`).join(", ")}).\n` +
                `💰 Arriesgas **${fmtNumero(plan.riesgo)}** 🪙.\n` +
                `✅ Si no gana: cobras **${fmtNumero(plan.riesgo + plan.cubierto - com)}** 🪙 (comisión de ${fmtNumero(com)}).\n❌ Si gana: pierdes el riesgo.`,
        )
        .setColor(COLOR);
    return {
        content: "",
        embeds: [embed],
        components: [
            filaConfirmar(`exchange_okcas_${p.match_id}_${eleccion}_${Math.round(cuotaMax * 100)}_${cantidad}`, "🤝 Cruzar", p.match_id),
        ],
    };
}

/** «Mis órdenes»: las publicadas (con lo cruzado) y las cruzadas en contra, y el menú para cancelar lo no cruzado. */
function vistaMias(userId, aviso = "") {
    const { ordenes, enContra } = exchange.deUsuario(userId);
    const lineaOrden = (o) =>
        `**#${o.id}** ${o.home_team ?? "?"} vs ${o.away_team ?? "?"} · a favor de ${exchange.NOMBRE[o.eleccion]} @${o.cuota} · ` +
        `${fmtNumero(o.casado)}/${fmtNumero(o.cantidad)} cruzado · ${ESTADO[o.estado]}`;
    const lineaCruce = (c) =>
        `${c.home_team ?? "?"} vs ${c.away_team ?? "?"} · en contra de ${exchange.NOMBRE[c.eleccion]} @${c.cuota} · riesgo ${fmtNumero(c.riesgo)} · ` +
        (c.estado === "abierto"
            ? "⏳ en juego"
            : c.estado === "anulado"
              ? "↩️ devuelto"
              : c.ganador_id === String(userId)
                ? `🏆 +${fmtNumero(c.pago)}`
                : "❌ perdido");
    const embed = new EmbedBuilder()
        .setTitle("📋 Mis órdenes del exchange")
        .setDescription(aviso || null)
        .addFields(
            { name: "➕ A favor", value: (ordenes.map(lineaOrden).join("\n") || "Ninguna.").slice(0, 1024) },
            { name: "🤝 En contra", value: (enContra.map(lineaCruce).join("\n") || "Ninguna.").slice(0, 1024) },
        )
        .setColor(COLOR);
    const cancelables = ordenes.filter((o) => exchange.ABIERTAS.includes(o.estado));
    const filas = [];
    if (cancelables.length) {
        filas.push(
            new ActionRowBuilder().addComponents(
                new StringSelectMenuBuilder()
                    .setCustomId("exchange_cancelar")
                    .setPlaceholder("🚫 Cancelar lo no cruzado de una orden")
                    .addOptions(
                        paginaDeLista(cancelables).items.map((o) => ({
                            label: `#${o.id} · ${o.home_team ?? "?"} vs ${o.away_team ?? "?"}`.slice(0, 100),
                            description: `${fmtNumero(o.cantidad - o.casado - o.devuelto)} 🪙 sin cruzar @${o.cuota}`.slice(0, 100),
                            value: String(o.id),
                        })),
                    ),
            ),
        );
    }
    return { content: "", embeds: [embed], components: filas, allowedMentions: { parse: [] } };
}

module.exports = { vistaLibro, formulario, confirmarPublicar, confirmarCasar, vistaMias };
