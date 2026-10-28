// 🤝 Pantallas de /prestamo (#520): tus préstamos dados y recibidos, la ficha de uno con sus acciones (aceptar, rechazar,
// cancelar la propuesta o pagar), el DM de una propuesta y el formulario de pagar una parte. Solo payloads; las reglas están
// en systems/prestamosJugadores.js.
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
const prestamos = require("../systems/prestamosJugadores");
const { fmtNumero } = require("../core/formato");
const { paginaDeLista, filaPaginas } = require("./menuPaginado");

const COLOR = 0x16a085;
const ESTADO = {
    propuesto: "📨 propuesto",
    activo: "🟢 activo",
    deuda: "🔴 en deuda",
    devuelto: "✅ devuelto",
    rechazado: "❌ rechazado",
    cancelado: "✖️ cancelado",
    caducado: "⌛ caducado",
};

const ts = (ms, estilo = "R") => `<t:${Math.floor(ms / 1000)}:${estilo}>`;
const boton = (id, etiqueta, estilo = ButtonStyle.Secondary) => new ButtonBuilder().setCustomId(id).setLabel(etiqueta).setStyle(estilo);

/** «#3 · 1.000 🪙 al 10 % · 🟢 activo · vence en 3 días» desde el punto de vista de `userId`. */
function linea(p, userId) {
    const otro = p.prestamista === String(userId) ? `a <@${p.prestatario}>` : `de <@${p.prestamista}>`;
    const plazo = p.vence_en ? ` · vence ${ts(p.vence_en)}` : ` · ${p.plazo_dias} días`;
    const falta = ["activo", "deuda"].includes(p.estado) ? ` · faltan **${fmtNumero(p.falta)}**` : "";
    return `**#${p.id}** ${otro} · ${fmtNumero(p.cantidad)} 🪙 al ${p.interes_pct} % · ${ESTADO[p.estado]}${plazo}${falta}`;
}

/** Tus préstamos vivos, con un desplegable para abrir uno. */
function pantallaPrestamos(userId, aviso = "", pagina = 0) {
    const { dados, recibidos } = prestamos.deUsuario(userId);
    const embed = new EmbedBuilder()
        .setTitle("🤝 Préstamos entre jugadores")
        .setColor(COLOR)
        .setDescription(
            (aviso ? `${aviso}\n\n` : "") +
                "Propón uno con `/prestamo proponer`. El dinero va de banco a banco y, al vencer, el bot cobra solo (banco y luego " +
                "efectivo); lo que no llegue queda como deuda.",
        )
        .addFields(
            { name: `📥 Recibidos (${recibidos.length})`, value: recibidos.map((p) => linea(p, userId)).join("\n") || "Ninguno." },
            { name: `📤 Dados (${dados.length})`, value: dados.map((p) => linea(p, userId)).join("\n") || "Ninguno." },
        );
    const todos = [...recibidos, ...dados];
    const p = paginaDeLista(todos, pagina);
    const filas = [];
    if (p.items.length) {
        filas.push(
            new ActionRowBuilder().addComponents(
                new StringSelectMenuBuilder()
                    .setCustomId("prest_sel")
                    .setPlaceholder("Abre un préstamo")
                    .addOptions(
                        p.items.map((x) => ({
                            label: `#${x.id} · ${fmtNumero(x.cantidad)} 🪙 · ${x.prestamista === String(userId) ? "dado" : "recibido"}`,
                            value: String(x.id),
                            description: ESTADO[x.estado],
                        })),
                    ),
            ),
        );
    }
    const paginas = filaPaginas("prest_pag_", p);
    if (paginas) filas.push(paginas);
    return { content: "", embeds: [embed], components: filas, allowedMentions: { parse: [] } };
}

/** Los botones de lo que puede hacer `userId` con este préstamo. */
function acciones(p, userId) {
    const soyDeudor = p.prestatario === String(userId);
    if (p.estado === "propuesto") {
        return soyDeudor
            ? [
                  boton(`prest_aceptar_${p.id}`, "✅ Aceptar", ButtonStyle.Success),
                  boton(`prest_rechazar_${p.id}`, "❌ Rechazar", ButtonStyle.Danger),
              ]
            : [boton(`prest_cancelar_${p.id}`, "✖️ Cancelar propuesta", ButtonStyle.Danger)];
    }
    if (soyDeudor && ["activo", "deuda"].includes(p.estado)) {
        return [
            boton(`prest_pagartodo_${p.id}`, `💸 Pagar todo (${fmtNumero(p.falta)})`, ButtonStyle.Success),
            boton(`prest_pagarparte_${p.id}`, "💰 Pagar una parte"),
        ];
    }
    return [];
}

/** La ficha de un préstamo. */
function pantallaPrestamo(userId, id, aviso = "") {
    const p = prestamos.obtener(id);
    if (!p || (p.prestamista !== String(userId) && p.prestatario !== String(userId)))
        return pantallaPrestamos(userId, "❌ Ese préstamo no es tuyo.");
    const embed = new EmbedBuilder()
        .setTitle(`🤝 Préstamo #${p.id}`)
        .setColor(COLOR)
        .setDescription(
            (aviso ? `${aviso}\n\n` : "") +
                `De <@${p.prestamista}> a <@${p.prestatario}> · ${ESTADO[p.estado]}\n` +
                `Prestado **${fmtNumero(p.cantidad)}** 🪙 al **${p.interes_pct} %** → se devuelven **${fmtNumero(p.total)}** 🪙\n` +
                `Pagado **${fmtNumero(p.pagado)}** 🪙 · falta **${fmtNumero(p.falta)}** 🪙\n` +
                (p.vence_en
                    ? `Vence ${ts(p.vence_en, "f")} (${ts(p.vence_en)})`
                    : `Plazo: ${p.plazo_dias} días desde que se acepte (la propuesta caduca a las 24 h)`),
        );
    const fila = new ActionRowBuilder().addComponents(...acciones(p, userId), boton("prest_inicio", "⬅️ Volver"));
    return { content: "", embeds: [embed], components: [fila], allowedMentions: { parse: [] } };
}

/** El DM que recibe quien puede aceptar la propuesta. */
function dmPropuesta(p) {
    const embed = new EmbedBuilder()
        .setTitle("🤝 Te ofrecen un préstamo")
        .setColor(COLOR)
        .setDescription(
            `<@${p.prestamista}> te presta **${fmtNumero(p.cantidad)}** 🪙 a tu banco.\n` +
                `Devolverás **${fmtNumero(p.total)}** 🪙 (${p.interes_pct} % de interés) en **${p.plazo_dias}** días. ` +
                "Al vencer, el bot te lo cobra solo del banco y del efectivo; lo que no llegue queda como deuda.\n" +
                "La propuesta caduca en 24 horas.",
        );
    return {
        embeds: [embed],
        components: [new ActionRowBuilder().addComponents(...acciones(p, p.prestatario))],
        allowedMentions: { parse: [] },
    };
}

/** El formulario de pagar una parte. */
function modalPagar(p) {
    return new ModalBuilder()
        .setCustomId(`prest_modal_pagar_${p.id}`)
        .setTitle(`💰 Pagar el préstamo #${p.id}`)
        .addComponents(
            new ActionRowBuilder().addComponents(
                new TextInputBuilder()
                    .setCustomId("cantidad")
                    .setLabel(`Cuánto pagas ahora (falta ${fmtNumero(p.falta)})`)
                    .setStyle(TextInputStyle.Short)
                    .setMaxLength(9)
                    .setRequired(true),
            ),
        );
}

module.exports = { pantallaPrestamos, pantallaPrestamo, dmPropuesta, modalPagar, linea };
