// Pestañas 🛒 Comprar y 💸 Vender de /cripto. Cada operación pasa antes por una pantalla de confirmación con la vista
// previa (lo que pagas o recibes, la comisión y cómo se mueve el precio); solo al confirmar se ejecuta.
const {
    EmbedBuilder,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    ModalBuilder,
    TextInputBuilder,
    TextInputStyle,
} = require("discord.js");
const guildSettings = require("../../systems/guildSettings");
const mercado = require("../../systems/cripto/mercado");
const dinero = require("../../systems/dinero");
const { botonSacar } = require("../economia");
const { pantalla, fmtMonedas, avisoTexto } = require("./comun");

const IMPORTES_COMPRA = [1000, 5000, 10000, 50000, 100000];
const PORCENTAJES_VENTA = [25, 50, 100];

function limitesCompra(guildId) {
    const cfg = guildSettings.getSettings(guildId).cripto;
    const min = Math.max(1, Number(cfg.min_buy || 1));
    const max = Math.max(min, Number(cfg.max_buy || min));
    return { min, max, fee: Number(cfg.fee_buy_pct || 0) };
}

function limitesVenta(guildId) {
    const cfg = guildSettings.getSettings(guildId).cripto;
    const min = Math.max(1, Number(cfg.min_sell || 1));
    const max = Math.max(min, Number(cfg.max_sell || min));
    return { min, max, fee: Number(cfg.fee_sell_pct || 0) };
}

/** Lo que tiene de TTCL alguien (0 si no tiene). */
function tenenciaTtcl(userId) {
    return mercado.getUserCarteras(userId).find((r) => r.cripto === mercado.TTCL.simbolo)?.cantidad || 0;
}

// ─── COMPRAR ──────────────────────────────────────────────────────────────────

function pantallaComprar(userId, guildId, aviso = null) {
    const { min, max, fee } = limitesCompra(guildId);
    const saldo = mercado.getUserSaldo(userId);

    const embed = new EmbedBuilder()
        .setTitle(`🛒 Comprar ${mercado.TTCL.emoji} $TTCL`)
        .setDescription(
            `${avisoTexto(aviso)}**Precio actual:** ${mercado.formatCoins(mercado.getTtclPrecio())} monedas por TTCL\n` +
                `**Tu efectivo:** ${fmtMonedas(saldo)}\n` +
                `**Límites:** de ${fmtMonedas(min)} a ${fmtMonedas(max)} · comisión ${fee} % (se queda en el pool)\n\n` +
                `Elige cuánto invertir. Verás una vista previa antes de confirmar.`,
        )
        .setColor(0x2ecc71);

    const importes = new ActionRowBuilder().addComponents(
        IMPORTES_COMPRA.map((m) =>
            new ButtonBuilder().setCustomId(`cripto_comprar_ver_${m}`).setLabel(fmtMonedas(m)).setStyle(ButtonStyle.Success),
        ),
    );
    const otros = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId("cripto_comprar_modal").setLabel("✏️ Otra cantidad").setStyle(ButtonStyle.Primary),
    );
    if (dinero.banco(userId) > 0) otros.addComponents(botonSacar("cripto_tab_comprar"));

    return pantalla({ embeds: [embed], filas: [importes, otros], actual: "comprar" });
}

/** Vista previa de una compra: lo que pagas, lo que recibes y cómo se mueve el precio. Sin tocar nada. */
function pantallaConfirmarCompra(userId, guildId, monedas) {
    const { min, max, fee } = limitesCompra(guildId);
    const cot = mercado.cotizarCompra(monedas, fee);
    const saldo = mercado.getUserSaldo(userId);

    let bloqueo = null;
    if (monedas < min || monedas > max) bloqueo = `La compra debe estar entre ${fmtMonedas(min)} y ${fmtMonedas(max)}.`;
    else if (cot.coste > saldo) bloqueo = "No te llega el efectivo. Saca dinero del banco o baja la cantidad.";

    const embed = new EmbedBuilder()
        .setTitle("🛒 Confirmar compra")
        .setDescription(
            `Vas a invertir **${fmtMonedas(monedas)}** en ${mercado.TTCL.emoji} $TTCL.\n\n` +
                `**Pagas:** ${fmtMonedas(cot.coste)} (${fmtMonedas(monedas)} + comisión ${fmtMonedas(cot.fee)})\n` +
                `**Recibes:** ${mercado.formatCryptoAmt(cot.ttcl)} TTCL\n` +
                `**Precio medio:** ${mercado.formatCoins(cot.precioMedio)} monedas por TTCL\n` +
                `**Precio del mercado:** ${mercado.formatCoins(cot.precioAntes)} → ${mercado.formatCoins(cot.precioDespues)}\n\n` +
                `**Tu efectivo:** ${fmtMonedas(saldo)}` +
                (bloqueo ? `\n\n❌ ${bloqueo}` : ""),
        )
        .setColor(bloqueo ? 0xe74c3c : 0x2ecc71)
        .setFooter({ text: "Comprar sube el precio. Para cancelar, cambia de pestaña." });

    const acciones = [
        new ButtonBuilder()
            .setCustomId(`cripto_comprar_ok_${monedas}`)
            .setLabel("✅ Confirmar compra")
            .setStyle(ButtonStyle.Success)
            .setDisabled(Boolean(bloqueo)),
    ];
    if (bloqueo && cot.coste > saldo && dinero.banco(userId) > 0) acciones.push(botonSacar(`cripto_comprar_ver_${monedas}`));

    return pantalla({ embeds: [embed], filas: [new ActionRowBuilder().addComponents(acciones)], actual: "comprar" });
}

/** Modal para escribir otra cantidad. */
function modalCompra() {
    return new ModalBuilder()
        .setCustomId("cripto_modal_comprar")
        .setTitle("Comprar $TTCL")
        .addComponents(
            new ActionRowBuilder().addComponents(
                new TextInputBuilder()
                    .setCustomId("monedas")
                    .setLabel("Monedas a invertir")
                    .setStyle(TextInputStyle.Short)
                    .setPlaceholder("Número entero, p. ej. 2500")
                    .setRequired(true)
                    .setMaxLength(12),
            ),
        );
}

// ─── VENDER ───────────────────────────────────────────────────────────────────

function pantallaVender(userId, guildId, aviso = null) {
    const { min, max, fee } = limitesVenta(guildId);
    const tenencia = tenenciaTtcl(userId);
    const embed = new EmbedBuilder().setTitle(`💸 Vender ${mercado.TTCL.emoji} $TTCL`).setColor(0xe74c3c);

    if (!(tenencia > 0)) {
        embed.setDescription(`${avisoTexto(aviso)}No tienes $TTCL que vender. Cómpralo en la pestaña 🛒 Comprar.`);
        return pantalla({ embeds: [embed], actual: "vender" });
    }

    const precio = mercado.getTtclPrecio();
    embed.setDescription(
        `${avisoTexto(aviso)}**Tienes:** ${mercado.formatCryptoAmt(tenencia)} TTCL ≈ ${fmtMonedas(tenencia * precio)} (antes de comisión)\n` +
            `**Precio actual:** ${mercado.formatCoins(precio)} monedas por TTCL\n` +
            `**Límites:** de ${fmtMonedas(min)} a ${fmtMonedas(max)} por venta · comisión ${fee} % (se queda en el pool)\n` +
            `**Impuestos:** ninguno en las ventas de cripto.\n\n` +
            `Elige qué parte vender. Verás una vista previa antes de confirmar.`,
    );

    const porcentajes = new ActionRowBuilder().addComponents(
        PORCENTAJES_VENTA.map((p) =>
            new ButtonBuilder()
                .setCustomId(`cripto_vender_ver_${p}`)
                .setLabel(`${p} %`)
                .setStyle(p === 100 ? ButtonStyle.Danger : ButtonStyle.Primary),
        ),
    );
    return pantalla({ embeds: [embed], filas: [porcentajes], actual: "vender" });
}

/** Vista previa de una venta: lo que recibes, la comisión y cómo se mueve el precio. Sin tocar nada. */
function pantallaConfirmarVenta(userId, guildId, pct) {
    const { min, max, fee } = limitesVenta(guildId);
    const tenencia = tenenciaTtcl(userId);
    if (!(tenencia > 0)) return pantallaVender(userId, guildId, "No tienes $TTCL que vender.");

    const ttcl = tenencia * (pct / 100);
    const cot = mercado.cotizarVenta(ttcl, fee);

    const bloqueo =
        cot.brutas < min || cot.brutas > max
            ? `La venta debe estar entre ${fmtMonedas(min)} y ${fmtMonedas(max)} (antes de comisión).`
            : null;

    const embed = new EmbedBuilder()
        .setTitle("💸 Confirmar venta")
        .setDescription(
            `Vas a vender **${mercado.formatCryptoAmt(ttcl)} TTCL** (${pct} % de lo que tienes).\n\n` +
                `**Recibes:** ${fmtMonedas(cot.neto)} (bruto ${fmtMonedas(cot.brutas)} − comisión ${fmtMonedas(cot.fee)})\n` +
                `**Precio medio:** ${mercado.formatCoins(cot.precioMedio)} monedas por TTCL\n` +
                `**Precio del mercado:** ${mercado.formatCoins(cot.precioAntes)} → ${mercado.formatCoins(cot.precioDespues)}\n` +
                `**Impuestos:** ninguno\n` +
                (bloqueo ? `\n❌ ${bloqueo}` : ""),
        )
        .setColor(bloqueo ? 0xe74c3c : 0xe67e22)
        .setFooter({ text: "Vender baja el precio. Para cancelar, cambia de pestaña." });

    const acciones = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId(`cripto_vender_ok_${pct}`)
            .setLabel("✅ Confirmar venta")
            .setStyle(ButtonStyle.Danger)
            .setDisabled(Boolean(bloqueo)),
    );
    return pantalla({ embeds: [embed], filas: [acciones], actual: "vender" });
}

// ─── AVISOS DEL RESULTADO ─────────────────────────────────────────────────────

/** Línea que se muestra en la pestaña de Comprar tras una compra (o su error). */
function avisoCompra(r) {
    return r.ok
        ? `✅ Compraste ${mercado.formatCryptoAmt(r.cantidad)} TTCL por ${fmtMonedas(r.costeTotal)} (comisión ${fmtMonedas(r.fee)}).`
        : `❌ ${r.msg}`;
}

/** Línea que se muestra en la pestaña de Vender tras una venta (o su error). */
function avisoVenta(r) {
    return r.ok
        ? `✅ Vendiste ${mercado.formatCryptoAmt(r.cantidad)} TTCL por ${fmtMonedas(r.monedas)} (comisión ${fmtMonedas(r.fee)}).`
        : `❌ ${r.msg}`;
}

module.exports = {
    IMPORTES_COMPRA,
    PORCENTAJES_VENTA,
    pantallaComprar,
    pantallaConfirmarCompra,
    modalCompra,
    pantallaVender,
    pantallaConfirmarVenta,
    avisoCompra,
    avisoVenta,
};
