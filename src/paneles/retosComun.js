// Piezas que comparten las pantallas de retos (retos*.js): formatos de texto, colores, el botón de volver y la mano de
// un blackjack. Solo construyen mensajes; las reglas están en systems/retos.

const { ButtonBuilder, ButtonStyle } = require("discord.js");
const retos = require("../systems/retos");

const ts = (ms, estilo = "R") => `<t:${Math.floor(ms / 1000)}:${estilo}>`;
const corto = (texto, max) => (texto.length > max ? `${texto.slice(0, max - 1)}…` : texto);
// Discord corta los campos en 1.024 caracteres.
const campo = (texto) => (texto.length > 1024 ? `${texto.slice(0, 1020)}…` : texto);
/** Quién es alguien en un reto: su mención o, si es el Duende (F-DU-03), "🧙 el Duende" (no es un usuario de Discord). */
const persona = (id) => (id === retos.DUENDE ? "🧙 **el Duende**" : `<@${id}>`);
const menciones = (ids, max = 15) =>
    ids
        .slice(0, max)
        .map((id) => `<@${id}>`)
        .join(", ") + (ids.length > max ? ` y ${ids.length - max} más` : "");

const COLOR = { pendiente: 0xf39c12, en_juego: 0x3498db, abierta: 0x9b59b6, cerrada: 0x8e44ad, resuelto: 0x27ae60, devuelto: 0x95a5a6 };
const VOLVER = () => new ButtonBuilder().setCustomId("juegos_retos").setLabel("◀ Retos").setStyle(ButtonStyle.Secondary);

/** Las manos de un blackjack de `userId`: sus cartas y el valor (con el que cuenta). */
function manoTexto(reto, userId) {
    const mano = reto.datos?.manos?.[userId] || [];
    return `${mano.map((c) => c.display).join(" ")} (**${retos.valorMano(reto, userId)}**)`;
}

module.exports = { ts, corto, campo, persona, menciones, COLOR, VOLVER, manoTexto };
