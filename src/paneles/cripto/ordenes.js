// Pantallas de /cripto para las órdenes de TTCL (alertas #298, stop-loss #341, compra recurrente #351) y para vender por monedas (#365).
// Solo mensajes; las reglas están en systems/cripto (ordenes, ventaPorMonedas). Los botones criptoord_* los atiende src/perfil/criptoOrdenes.
const {
    EmbedBuilder,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    StringSelectMenuBuilder,
    ModalBuilder,
    TextInputBuilder,
    TextInputStyle,
} = require("discord.js");
const guildSettings = require("../../systems/guildSettings");
const mercado = require("../../systems/cripto/mercado");
const ordenes = require("../../systems/cripto/ordenes");
const ventaPorMonedas = require("../../systems/cripto/ventaPorMonedas");
const { pantalla, fmtMonedas, avisoTexto } = require("./comun");

const fila = (...c) => new ActionRowBuilder().addComponents(...c);
const boton = (id, label, estilo = ButtonStyle.Secondary) => new ButtonBuilder().setCustomId(id).setLabel(label).setStyle(estilo);

function modal(id, titulo, campos) {
    return new ModalBuilder()
        .setCustomId(id)
        .setTitle(titulo)
        .addComponents(
            ...campos.map((c) =>
                new ActionRowBuilder().addComponents(
                    new TextInputBuilder()
                        .setCustomId(c.id)
                        .setLabel(c.label)
                        .setStyle(TextInputStyle.Short)
                        .setPlaceholder(c.placeholder || "")
                        .setRequired(true)
                        .setMaxLength(14),
                ),
            ),
        );
}

const modalAlerta = () =>
    modal("criptoord_modal_alerta", "🔔 Alerta de precio", [
        { id: "precio", label: "Precio objetivo (monedas por TTCL)", placeholder: "120" },
    ]);
const modalStopLoss = () =>
    modal("criptoord_modal_stoploss", "🛡️ Stop-loss", [{ id: "precio", label: "Vender todo si baja hasta (monedas)", placeholder: "80" }]);
const modalRecurrente = () =>
    modal("criptoord_modal_recurrente", "🔁 Compra recurrente", [
        { id: "monedas", label: "Monedas por compra", placeholder: "5000" },
        { id: "horas", label: "Cada cuántas horas (mínimo 1)", placeholder: "24" },
    ]);
const modalVentaMonedas = () =>
    modal("criptoord_modal_vender", "💸 Vender por monedas", [
        { id: "monedas", label: "Monedas netas que quieres recibir", placeholder: "2500" },
    ]);

const TIPOS = { alerta: "🔔 Alerta", stoploss: "🛡️ Stop-loss", recurrente: "🔁 Compra recurrente" };

function textoOrden(o) {
    if (o.tipo === "alerta") return `${TIPOS.alerta}: cuando ${o.sobre ? "suba hasta" : "baje hasta"} **${mercado.formatCoins(o.precio)}**`;
    if (o.tipo === "stoploss") return `${TIPOS.stoploss}: vender todo si baja hasta **${mercado.formatCoins(o.precio)}**`;
    return `${TIPOS.recurrente}: **${fmtMonedas(o.monedas)}** cada ${o.periodo_min / 60} h · próxima <t:${Math.floor(o.proxima / 1000)}:R>`;
}

/** Mis alertas, stop-loss y compras recurrentes, con un menú para cancelar una y los botones para crear. */
function pantallaOrdenes(userId, aviso = null) {
    const lista = ordenes.activasDe(userId);
    const embed = new EmbedBuilder()
        .setTitle("🔔 Mis órdenes de TTCL")
        .setDescription(
            `${avisoTexto(aviso)}**Precio actual:** ${mercado.formatCoins(mercado.getTtclPrecio())} monedas por TTCL\n\n` +
                (lista.length ? lista.map((o) => `• ${textoOrden(o)}`).join("\n") : "No tienes ninguna orden activa.") +
                `\n\nHasta ${ordenes.MAX_POR_TIPO} de cada tipo. Una alerta avisa por DM una sola vez; el stop-loss vende toda tu posición; la compra recurrente se salta el ciclo si no tienes efectivo.`,
        )
        .setColor(0x9b59b6);
    const filas = [
        fila(
            boton("criptoord_nueva_alerta", "🔔 Nueva alerta", ButtonStyle.Primary),
            boton("criptoord_nueva_stoploss", "🛡️ Nuevo stop-loss", ButtonStyle.Primary),
            boton("criptoord_nueva_recurrente", "🔁 Compra recurrente", ButtonStyle.Primary),
        ),
    ];
    if (lista.length) {
        filas.push(
            fila(
                new StringSelectMenuBuilder()
                    .setCustomId("criptoord_cancelar")
                    .setPlaceholder("Cancelar una orden")
                    .addOptions(
                        lista.map((o) => ({
                            label: textoOrden(o)
                                .replace(/\*\*|<t:\d+:R>/g, "")
                                .slice(0, 100),
                            value: String(o.id),
                        })),
                    ),
            ),
        );
    }
    return pantalla({ embeds: [embed], filas, actual: "mercado" });
}

/** Vista previa de una compra recurrente antes de programarla (con lo que daría ahora una compra así). */
function pantallaConfirmarRecurrente(userId, guildId, monedas, horas) {
    const fee = Number(guildSettings.getSettings(guildId).cripto.fee_buy_pct || 0);
    const cot = mercado.cotizarCompra(monedas, fee);
    const embed = new EmbedBuilder()
        .setTitle("🔁 Confirmar compra recurrente")
        .setDescription(
            `Comprarás **${fmtMonedas(monedas)}** de ${mercado.TTCL.emoji} TTCL cada **${horas} h**.\n\n` +
                `**Si fuera ahora:** pagarías ${fmtMonedas(cot.coste)} (comisión ${fmtMonedas(cot.fee)}) y recibirías ${mercado.formatCryptoAmt(cot.ttcl)} TTCL a ${mercado.formatCoins(cot.precioMedio)} de media.\n` +
                `Cada ciclo usa las reglas de una compra normal (límites, cooldown y comisión). Sin efectivo en ese momento, se salta y te aviso por DM. No saca dinero del banco.`,
        )
        .setColor(0x2ecc71);
    return pantalla({
        embeds: [embed],
        filas: [
            fila(
                boton(`criptoord_rec_ok_${monedas}_${horas}`, "✅ Programar", ButtonStyle.Success),
                boton("criptoord_ordenes", "Cancelar"),
            ),
        ],
        actual: "comprar",
    });
}

/** Vista previa de vender por monedas: lo que se vende para recibir (como mucho) lo pedido. Sin tocar nada. */
function pantallaConfirmarVentaMonedas(userId, guildId, neto) {
    const cfg = guildSettings.getSettings(guildId).cripto;
    const tenencia = mercado.getUserCarteras(userId).find((r) => r.cripto === mercado.TTCL.simbolo)?.cantidad || 0;
    const q = ventaPorMonedas.cotizarPorMonedas(tenencia, neto, Number(cfg.fee_sell_pct || 0));
    const embed = new EmbedBuilder().setTitle("💸 Confirmar venta por monedas").setColor(q.ok ? 0xe67e22 : 0xe74c3c);
    if (!q.ok) {
        embed.setDescription(`Querías recibir **${fmtMonedas(neto)}** netas.\n\n❌ ${q.motivo}\nNo se vende nada.`);
        return pantalla({ embeds: [embed], filas: [fila(boton("criptoord_vender", "✏️ Otra cantidad"))], actual: "vender" });
    }
    embed.setDescription(
        `Para recibir **${fmtMonedas(neto)}** netas vendes **${mercado.formatCryptoAmt(q.ttcl)} TTCL**.\n\n` +
            `**Recibes:** ${fmtMonedas(q.cot.neto)} (bruto ${fmtMonedas(q.cot.brutas)} − comisión ${fmtMonedas(q.cot.fee)})\n` +
            `**Precio del mercado:** ${mercado.formatCoins(q.cot.precioAntes)} → ${mercado.formatCoins(q.cot.precioDespues)}\n` +
            `Se redondea hacia abajo: nunca recibes más de lo que pides. Los límites y la comisión son los de una venta normal.`,
    );
    return pantalla({
        embeds: [embed],
        filas: [fila(boton(`criptoord_vender_ok_${neto}`, "✅ Confirmar venta", ButtonStyle.Danger))],
        actual: "vender",
    });
}

module.exports = {
    modalAlerta,
    modalStopLoss,
    modalRecurrente,
    modalVentaMonedas,
    pantallaOrdenes,
    pantallaConfirmarRecurrente,
    pantallaConfirmarVentaMonedas,
};
