// /blackjack: cobra y paga, y lleva el flujo de la partida. Las reglas de cada jugada están en systems/blackjack;
// los textos, embeds y botones, en ./blackjackVista.
const { EmbedBuilder, MessageFlags } = require("discord.js");
const db = require("../../core/db");
const { registrarUsuario, descontarApuesta } = require("../../systems/casinoTransactions");
const activeGames = require("../../systems/activeGames");
const { hayPartidaEnCurso } = require("./partidaEnCurso");
const bj = require("../../systems/blackjack");
const {
    liquidarMano,
    cobrarNatural,
    cobrarPasada,
    cobrarAbandono,
    liquidarManoSplit,
    cobrarExtraBJ,
} = require("../../systems/blackjackCobros");
const casino = require("../../paneles/casino");
const { createLogger } = require("../../core/logger");
const {
    COLOR,
    ERROR_RESULTADO,
    cartas,
    filaFin,
    TEXTO_RESULTADO,
    textoManoSplit,
    embedAyuda,
    filasJuego,
    filaSplit,
    embedJugando,
    embedSiguienteMano,
    embedNatural,
    embedResumenSplit,
} = require("./blackjackVista");

const { handValue } = bj;
const log = createLogger("Blackjack");

// Partidas en curso: userId -> estado. El dinero apostado se registra además en
// activeGames para poder devolverlo si el bot se reinicia a mitad de partida.
const partidasBJ = {};

function terminarPartida(userId) {
    delete partidasBJ[userId];
    activeGames.cerrar(userId, "blackjack");
}

// Una partida sin tocar durante más de 15 min ya no se puede seguir jugando (los botones
// de Discord caducan), así que se liquida como perdida, igual que dejar la mesa en un casino.
function abandonarPartida(userId, state) {
    log.info(`Partida de ${userId} abandonada (>15 min sin tocar): se liquida como perdida (${bj.totalApostado(state)} monedas)`);
    cobrarAbandono(userId, state);
    terminarPartida(userId);
}

function limpiarAbandonadas() {
    for (const [userId, state] of Object.entries(partidasBJ)) {
        if (!state.finished && activeGames.estaAbandonada(state.ultimaAccion)) {
            abandonarPartida(userId, state);
        }
    }
}

// --- Dinero ---
const SUFIJO_TIPO = { gana: "victoria", empate: "empate", pierde: "derrota" };
const TEXTO_HISTORIAL = { gana: "ganado", empate: "empatado", pierde: "perdido" };

// Blackjack natural al repartir: se liquida y se responde en el acto.
async function responderNatural(interaction, state, tipo) {
    const userId = interaction.user.id;
    const { exito, cobro } = cobrarNatural(userId, interaction.guildId, state, tipo);
    const embed = embedNatural(tipo, state, cobro);
    // Si el cobro falla, la partida termina igual: si no, el jugador queda bloqueado con una mano en memoria.
    if (!exito) {
        terminarPartida(userId);
        await interaction.reply({ content: ERROR_RESULTADO, flags: MessageFlags.Ephemeral });
        return;
    }
    await interaction.reply({ embeds: [embed], components: [filaFin(state)] });
    terminarPartida(userId);
}

// Plantarse o doblar: el crupier ya ha jugado; se liquida y se enseña el resultado.
async function responderFinal(interaction, state, { userVal, botVal, resultado }, { accion, titulo }) {
    const userId = interaction.user.id;
    const r = liquidarMano(userId, interaction.guildId, state.apuesta, resultado, {
        descripcion: () => `Blackjack: ${accion} ${TEXTO_HISTORIAL[resultado]}`,
        detalle: {
            tipo: `${SUFIJO_TIPO[resultado]}_${accion === "doblar" ? "doblar" : "stand"}`,
            userHand: state.userHand,
            botHand: state.botHand,
        },
    });
    if (!r.exito) {
        await interaction.reply({ content: ERROR_RESULTADO, flags: MessageFlags.Ephemeral });
        return;
    }
    const embed = new EmbedBuilder()
        .setTitle(titulo)
        .setDescription(
            `Tus cartas: ${cartas(state.userHand)} (**${userVal}**)\n` +
                `Cartas del crupier: ${cartas(state.botHand)} (**${botVal}**)\n\n` +
                TEXTO_RESULTADO[resultado](r.cobro),
        )
        .setColor(COLOR[resultado]);
    await interaction.update({ embeds: [embed], components: [filaFin(state)] });
    terminarPartida(userId);
}

// Liquida cada mano del split por separado. Devuelve el recuento para el resumen, o null si un cobro falla
// (en ese caso ya se ha respondido y la partida está cerrada).
async function liquidarManosSplit(interaction, state, userId, botVal, manos) {
    let totalGanancia = 0;
    let resultadosTexto = "";
    let manosGanadas = 0;
    let manosEmpate = 0;

    for (const [i, mano] of manos.entries()) {
        const n = i + 1;
        const r = liquidarManoSplit(userId, interaction.guildId, state, mano, n, botVal);
        if (!r.exito) {
            await interaction.update({
                content: `❌ Error procesando resultado de mano ${n}. Contacta un administrador.`,
                embeds: [],
                components: [],
            });
            terminarPartida(userId);
            return null;
        }
        totalGanancia += r.cobro;
        resultadosTexto += `**Mano ${n}:** ${cartas(mano.cartas)} (**${mano.valor}**) - ${textoManoSplit(mano, botVal)}\n`;
        if (mano.resultado === "gana") manosGanadas++;
        else if (mano.resultado === "empate") manosEmpate++;
    }
    return { totalGanancia, resultadosTexto, manosGanadas, manosEmpate };
}

// Estadísticas de blackjack del jugador (para el resumen de un split).
function estadisticasBJ(userId) {
    return db
        .prepare(
            `
        SELECT
            COUNT(*) as partidas,
            SUM(CASE WHEN resultado > 0 THEN 1 ELSE 0 END) as victorias,
            SUM(CASE WHEN resultado = 0 THEN 1 ELSE 0 END) as empates,
            SUM(resultado) as gananciaTotal,
            MAX(resultado) as mejorGanancia
        FROM casino
        WHERE userId = ? AND juego = 'blackjack'
    `,
        )
        .get(userId);
}

// Fin del split: juega el crupier, se liquida cada mano por separado y se enseña el resumen.
async function evaluarSplitFinal(interaction, state, userId) {
    const { botVal, manos } = bj.resolverSplit(state);
    const liquidado = await liquidarManosSplit(interaction, state, userId, botVal, manos);
    if (!liquidado) return;

    const embed = embedResumenSplit(state, estadisticasBJ(userId), { botVal, ...liquidado });
    await interaction.update({ embeds: [embed], components: [filaFin(state)] });
    terminarPartida(userId);
}

// Cobra la apuesta extra de doblar o separar (parte de la misma jugada: sin mínimo ni cooldown).
async function cobrarExtra(interaction, state) {
    const resultado = cobrarExtraBJ(interaction.user.id, interaction.guildId, state.apuesta);
    if (!resultado.exito) {
        await interaction.reply({ content: resultado.mensaje, flags: MessageFlags.Ephemeral });
        return false;
    }
    return true;
}

// Doblar: cobra lo extra, pide una carta y se planta.
async function botonDoblar(interaction, state) {
    if (!state.puedeDoblar) {
        await interaction.reply({ content: "No puedes doblar ahora.", flags: MessageFlags.Ephemeral });
        return;
    }
    if (!(await cobrarExtra(interaction, state))) return;
    await responderFinal(interaction, state, bj.doblar(state), { accion: "doblar", titulo: "🃏 Blackjack - Resultado (Doblar)" });
}

// Separar: cobra lo extra y reparte la segunda mano (con dos ases se resuelve directamente).
async function botonSeparar(interaction, state, userId) {
    if (!state.puedeSplit) {
        await interaction.reply({ content: "No puedes separar ahora.", flags: MessageFlags.Ephemeral });
        return;
    }
    if (!(await cobrarExtra(interaction, state))) return;
    // Con dos ases solo se reparte una carta a cada mano y se resuelve directamente.
    if (bj.separar(state).sonAses) {
        await evaluarSplitFinal(interaction, state, userId);
        return;
    }
    const embed = new EmbedBuilder()
        .setTitle("🃏 Blackjack - Mano 1 (Separada)")
        .setDescription(
            `**Mano 1:** ${cartas(state.hands[0])} (**${handValue(state.hands[0])}**)\n` +
                `**Mano 2:** ${state.hands[1][0].display} + ?\n\n` +
                `Carta visible del crupier: ${state.botHand[0].display}\n\n` +
                "Juega tu primera mano.",
        )
        .setColor(COLOR.juego);
    await interaction.update({ embeds: [embed], components: [filaSplit()] });
}

// Pedir carta: si se pasa, se pierde la apuesta en el acto.
async function botonPedir(interaction, state, userId) {
    const { valor, pasado } = bj.pedir(state);
    if (!pasado) {
        await interaction.update({ embeds: [embedJugando(state, valor)], components: filasJuego({}) });
        return;
    }
    if (!cobrarPasada(userId, state)) {
        await interaction.reply({ content: ERROR_RESULTADO, flags: MessageFlags.Ephemeral });
        return;
    }
    const embed = new EmbedBuilder()
        .setTitle("🃏 Blackjack - ¡Te pasaste!")
        .setDescription(`Tus cartas: ${cartas(state.userHand)} (**${valor}**)\n` + `Perdiste la apuesta de ${state.apuesta} monedas.`)
        .setColor(COLOR.pierde);
    await interaction.update({ embeds: [embed], components: [filaFin(state)] });
    terminarPartida(userId);
}

// Pedir o plantarse en una de las dos manos del split.
async function botonSplit(interaction, state, userId, id) {
    if (!state.split) {
        await interaction.reply({ content: "No estás en modo split.", flags: MessageFlags.Ephemeral });
        return;
    }
    const pide = id === "bj_hit_split";
    const r = pide ? bj.pedirSplit(state) : bj.plantarseSplit(state);
    if (r.terminado) {
        await evaluarSplitFinal(interaction, state, userId);
    } else if (pide && !r.pasada) {
        // Sigue en la misma mano.
        const embed = new EmbedBuilder()
            .setTitle(`🃏 Blackjack - Mano ${state.currentHand + 1} (Separada)`)
            .setDescription(
                `Tus cartas: ${cartas(state.hands[state.currentHand])} (**${r.valor}**)\n` +
                    `Carta visible del crupier: ${state.botHand[0].display}\n\n` +
                    "¿Qué quieres hacer?",
            )
            .setColor(COLOR.juego);
        await interaction.update({ embeds: [embed], components: [filaSplit()] });
    } else {
        await interaction.update({
            embeds: [embedSiguienteMano(state, pide ? "¡Se pasó!" : "Plantado")],
            components: [filaSplit()],
        });
    }
}

module.exports = {
    componentHandlers: [{ types: ["button"], prefixes: ["bj_"], method: "handleButton", acl: "juegos" }],

    async run(client, interaction) {
        const userId = interaction.user.id;
        const apuesta = interaction.options.getInteger("apuesta");
        // Sin apuesta, el selector de importes del casino (como desde el panel).
        if (!apuesta) {
            await interaction.reply(casino.buildPickApuesta(userId, "blackjack"));
            return;
        }

        const previa = partidasBJ[userId];
        if (
            await hayPartidaEnCurso(interaction, previa && !previa.finished ? previa : null, "Blackjack", () =>
                abandonarPartida(userId, previa),
            )
        )
            return;

        registrarUsuario(userId, interaction.user.username, interaction.user.tag);

        // Validar y descontar apuesta de forma segura
        const resultado = descontarApuesta(userId, apuesta, interaction.guildId);
        if (!resultado.exito) {
            await interaction.reply({ content: resultado.mensaje, flags: MessageFlags.Ephemeral });
            return;
        }
        activeGames.registrar(userId, "blackjack", interaction.guildId, apuesta);

        const state = bj.nuevaPartida({ apuesta, guildId: interaction.guildId, saldoRestante: resultado.saldoRestante });
        state.apuestaBase = apuesta;
        partidasBJ[userId] = state;

        const natural = bj.naturales(state);
        if (natural) {
            await responderNatural(interaction, state, natural);
            return;
        }
        await interaction.reply({ embeds: [embedJugando(state)], components: filasJuego(state) });
    },

    // Handler para botones
    async handleButton(client, interaction) {
        const userId = interaction.user.id;
        const id = interaction.customId;
        const state = partidasBJ[userId];
        if (!state) {
            if (id === "bj_help") await interaction.reply({ embeds: [embedAyuda()], flags: MessageFlags.Ephemeral });
            return;
        }
        if (state.finished) {
            await interaction.reply({ content: "Esta partida ya terminó.", flags: MessageFlags.Ephemeral });
            return;
        }
        state.ultimaAccion = Date.now();

        if (id === "bj_help") {
            await interaction.reply({ embeds: [embedAyuda()], flags: MessageFlags.Ephemeral });
            return;
        }
        if (id === "bj_double") return botonDoblar(interaction, state);
        if (id === "bj_split") return botonSeparar(interaction, state, userId);
        if (id === "bj_hit") return botonPedir(interaction, state, userId);
        if (id === "bj_stand") {
            return responderFinal(interaction, state, bj.plantarse(state), { accion: "plantarse", titulo: "🃏 Blackjack - Resultado" });
        }
        if (id === "bj_hit_split" || id === "bj_stand_split") return botonSplit(interaction, state, userId, id);
    },

    limpiarAbandonadas,
};
