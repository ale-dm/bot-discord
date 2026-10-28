// 🎱 El mensaje de una sala de bingo (#528): quién está dentro, la entrada y el bote mientras se espera; la última bola y las
// cantadas mientras se juega; y quién ha cantado bingo al final. También el cartón de cada jugador con lo ya marcado. Solo
// construye mensajes; las reglas están en systems/bingo.js.
const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require("discord.js");
const bingo = require("../systems/bingo");
const { fmtNumero } = require("../core/formato");

const COLOR = 0xe84393;
const ts = (ms, estilo = "R") => `<t:${Math.floor(ms / 1000)}:${estilo}>`;

/** «B-7», «N-42»… */
const nombreBola = (n) => `${bingo.COLUMNAS[Math.floor((n - 1) / 15)]}-${n}`;

/** El cartón en una cuadrícula de texto: los números cantados entre corchetes y el centro libre con una estrella. */
function cartonTexto(carton, cantadas = new Set()) {
    const cabecera = bingo.COLUMNAS.map((c) => ` ${c}  `).join("");
    const filas = [0, 1, 2, 3, 4].map((f) =>
        carton
            .map((col) => {
                const n = col[f];
                if (n === bingo.LIBRE) return "[★] ";
                const t = String(n).padStart(2, " ");
                return cantadas.has(n) ? `[${t}]` : ` ${t} `;
            })
            .join(""),
    );
    return `\`\`\`\n${cabecera}\n${filas.join("\n")}\n\`\`\``;
}

const boton = (id, etiqueta, estilo = ButtonStyle.Secondary, desactivado = false) =>
    new ButtonBuilder().setCustomId(id).setLabel(etiqueta).setStyle(estilo).setDisabled(desactivado);

function descripcion(p, cantadas, ganadores) {
    const lista = bingo.jugadores(p.id);
    const quienes = lista.map((j) => `<@${j.userId}>`).join(" · ") || "Nadie.";
    if (p.estado === "esperando") {
        return (
            `🎟️ Entrada **${fmtNumero(p.entrada)}** 🪙 · 💰 Bote **${fmtNumero(p.bote)}** 🪙 · ${lista.length}/${bingo.MAX_JUGADORES} jugadores\n` +
            `Empieza ${ts(p.cierra_espera)} o cuando se llene (hacen falta ${bingo.MIN_JUGADORES}). Gana quien complete el cartón entero; ` +
            `el bot marca solo.\n\n${quienes}`
        );
    }
    if (p.estado === "jugando") {
        const salidas = p.bolas.slice(0, cantadas);
        const ultima = salidas[salidas.length - 1];
        return (
            `💰 Bote **${fmtNumero(p.bote)}** 🪙 · ${quienes}\n\n` +
            (ultima
                ? `🎱 **${nombreBola(ultima)}** · van ${cantadas} de ${bingo.BOLAS}\n${salidas.slice(-12, -1).reverse().map(nombreBola).join(" · ")}`
                : "🎱 ¡Que empiece el canto!")
        );
    }
    if (p.estado === "terminada") {
        const g = (ganadores || bingo.jugadores(p.id).filter((j) => j.premio > 0)).map(
            (x) => `<@${x.userId}> · **${fmtNumero(x.premio)}** 🪙`,
        );
        return `🎉 **¡BINGO!** con la bola ${nombreBola(p.bolas[p.bola_ganadora - 1])} (la ${p.bola_ganadora}.ª)\n${g.join("\n")}`;
    }
    return `✖️ Sala cancelada: hacían falta al menos ${bingo.MIN_JUGADORES} jugadores. Se ha devuelto la entrada.`;
}

/** El mensaje de la sala. `cantadas`: cuántas bolas han salido ya (mientras se juega). */
function mensajeSala(p, cantadas = 0, ganadores = null) {
    const embed = new EmbedBuilder()
        .setTitle(`🎱 Bingo #${p.id}`)
        .setColor(COLOR)
        .setDescription(descripcion(p, cantadas, ganadores));
    const filas = [];
    if (p.estado === "esperando") {
        filas.push(
            new ActionRowBuilder().addComponents(
                boton(`bingo_entrar_${p.id}`, `🎟️ Entrar (${fmtNumero(p.entrada)} 🪙)`, ButtonStyle.Success),
                boton(`bingo_empezar_${p.id}`, "▶️ Empezar ya", ButtonStyle.Primary),
                boton(`bingo_carton_${p.id}`, "🎫 Mi cartón"),
            ),
        );
    } else if (p.estado === "jugando") {
        filas.push(new ActionRowBuilder().addComponents(boton(`bingo_carton_${p.id}`, "🎫 Mi cartón")));
    }
    return { content: "", embeds: [embed], components: filas, allowedMentions: { parse: [] } };
}

module.exports = { mensajeSala, cartonTexto, nombreBola };
