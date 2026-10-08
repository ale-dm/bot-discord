// 🧙 Lo que el Duende propone desde el chat (F-DU-03, #14): un piedra-papel-tijera, una apuesta a un partido o un
// préstamo. Sale debajo de su respuesta con ✅ Acepto / ❌ No, y no se mueve dinero hasta que la persona acepta (los
// botones duende_* los atiende juegos/retos/duende). La propuesta va entera en el id de los botones, sin tabla: quién,
// qué, cuánto y hasta cuándo vale (CADUCA_MS).
const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require("discord.js");
const retos = require("../systems/retos");
const prestamos = require("../systems/prestamos");
const { ladoTexto, contrarioTexto } = require("./retos");

/** Lo que vale una propuesta sin aceptar. */
const CADUCA_MS = 10 * 60 * 1000;
const COLOR = 0x8e44ad;

const fmt = (n) => Number(n || 0).toLocaleString("es");
const ts = (ms, estilo = "R") => `<t:${Math.floor(ms / 1000)}:${estilo}>`;

/** duende_{acepto|no}_{ppt|partido|prestamo}_{userId}_{cantidad}_{caduca, en s y base 36}[_{eleccion}_{matchId}] */
function idBoton(accion, p) {
    const base = `duende_${accion}_${p.tipo}_${p.userId}_${p.cantidad}_${Math.floor(p.caduca / 1000).toString(36)}`;
    return p.tipo === "partido" ? `${base}_${p.eleccion}_${p.matchId}` : base;
}

/** La propuesta de un id de botón, o null si no lo es. */
function leerPropuesta(customId) {
    const m = String(customId).match(/^duende_(acepto|no)_(ppt|partido|prestamo)_([^_]+)_(\d+)_([0-9a-z]+)(?:_(home|draw|away)_(.+))?$/);
    if (!m) return null;
    const [, accion, tipo, userId, cantidad, caduca, eleccion, matchId] = m;
    if ((tipo === "partido") !== Boolean(matchId)) return null;
    return {
        accion,
        tipo,
        userId,
        cantidad: Number(cantidad),
        caduca: parseInt(caduca, 36) * 1000,
        ...(matchId ? { eleccion, matchId } : {}),
    };
}

function textoPartido(p) {
    const partido = retos.partidoDe(p.matchId);
    if (!partido) return `<@${p.userId}> apuesta **${fmt(p.cantidad)}** 🪙 a un partido contra el Duende.`;
    return (
        `<@${p.userId}> apuesta **${fmt(p.cantidad)}** 🪙 a que **${ladoTexto(partido, p.eleccion)}** en ` +
        `**${partido.home_team} vs ${partido.away_team}** (${ts(Date.parse(partido.start_time), "f")}).\n` +
        `🧙 El Duende va con lo contrario: **${contrarioTexto(partido, p.eleccion)}**. El que acierte se lleva **${fmt(p.cantidad * 2)}** 🪙.`
    );
}

/**
 * El mensaje con la propuesta y sus botones. `p`: { tipo, userId, cantidad[, matchId, eleccion][, caduca] }; sin
 * `caduca`, vale CADUCA_MS desde ahora.
 */
function mensajePropuesta(p, ahora = Date.now()) {
    const propuesta = { ...p, caduca: p.caduca || ahora + CADUCA_MS };
    const embed = new EmbedBuilder()
        .setColor(COLOR)
        .setFooter({ text: "No se mueve dinero hasta que aceptes · la propuesta caduca a los 10 minutos" });
    if (propuesta.tipo === "ppt") {
        embed
            .setTitle("🧙 El Duende te reta a 🪨 Piedra, papel o tijera")
            .setDescription(
                `<@${propuesta.userId}>, **${fmt(propuesta.cantidad)}** 🪙 cada uno: el que gane se lleva **${fmt(propuesta.cantidad * 2)}** 🪙.\n` +
                    "Si aceptas, eliges tu jugada; el Duende ya tiene la suya.",
            );
    } else if (propuesta.tipo === "partido") {
        embed.setTitle("🧙 Apuesta contra el Duende").setDescription(textoPartido(propuesta));
    } else {
        const total = prestamos.totalDe(propuesta.cantidad);
        embed
            .setTitle(`🧙 El Duende te presta ${fmt(propuesta.cantidad)} 🪙`)
            .setDescription(
                `<@${propuesta.userId}>, devuelves **${fmt(total)}** 🪙 (un ${prestamos.INTERES} % más) en ${prestamos.PLAZO_DIAS} días, o antes ` +
                    "cuando quieras desde `/perfil` → 💰 Economía.\n" +
                    "Si no, al vencer se cobra solo del efectivo y del banco. Lo que falte queda como deuda: se va cobrando de lo " +
                    "que ganes, y hasta saldarla no hay otro préstamo ni apuestas con el Duende.",
            );
    }
    const fila = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(idBoton("acepto", propuesta)).setLabel("✅ Acepto").setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId(idBoton("no", propuesta)).setLabel("❌ No").setStyle(ButtonStyle.Secondary),
    );
    return { embeds: [embed], components: [fila], allowedMentions: { users: [] } };
}

/** La propuesta cerrada sin aceptar: `motivo` "no" (la rechazó) o "caducada". */
function mensajeCerrada(p, motivo) {
    const embed = new EmbedBuilder()
        .setColor(0x95a5a6)
        .setTitle("🧙 Propuesta del Duende")
        .setDescription(
            motivo === "caducada"
                ? "⌛ Esta propuesta ha caducado: pídesela otra vez al Duende."
                : `❌ <@${p.userId}> ha dicho que no. No se ha movido dinero.`,
        );
    return { embeds: [embed], components: [], allowedMentions: { users: [] } };
}

/** El préstamo recién aceptado (sustituye a la propuesta). */
function mensajePrestamo(prestamo) {
    const embed = new EmbedBuilder()
        .setColor(0x27ae60)
        .setTitle(`🧙 Préstamo del Duende: ${fmt(prestamo.cantidad)} 🪙`)
        .setDescription(
            `<@${prestamo.userId}> tiene **${fmt(prestamo.cantidad)}** 🪙 más en el efectivo.\n` +
                `Devuelve **${fmt(prestamo.total)}** 🪙 antes del ${ts(prestamo.vence_en, "f")} (${ts(prestamo.vence_en)}), desde ` +
                "`/perfil` → 💰 Economía → 🧙 Devolver.",
        );
    return { embeds: [embed], components: [], allowedMentions: { users: [] } };
}

module.exports = { CADUCA_MS, idBoton, leerPropuesta, mensajePropuesta, mensajeCerrada, mensajePrestamo };
