// /blackjack: cobra y paga, y lleva el flujo de la partida. Las reglas de cada jugada están en systems/blackjack;
// los textos, embeds y botones, en ./blackjackVista; separar, en ./blackjackSplit, y lo común de la mesa, en ./blackjackMesa.
const { EmbedBuilder, MessageFlags } = require("discord.js");
const { registrarUsuario, descontarApuesta } = require("../../systems/casinoTransactions");
const activeGames = require("../../systems/activeGames");
const { hayPartidaEnCurso } = require("./partidaEnCurso");
const bj = require("../../systems/blackjack");
const { textoConsejo } = require("../../systems/blackjackEstrategia");
const {
    liquidarMano,
    cobrarPasada,
    cobrarAbandono,
    cobrarRendicion,
    cobrarSeguro,
    liquidarSeguro,
} = require("../../systems/blackjackCobros");
const casino = require("../../paneles/casino");
const { createLogger } = require("../../core/logger");
const {
    COLOR,
    ERROR_RESULTADO,
    cartas,
    filaFin,
    TEXTO_RESULTADO,
    embedAyuda,
    filasJuego,
    embedJugando,
    embedSeguro,
    filaSeguro,
} = require("./blackjackVista");
const { partidasBJ, terminarPartida, cobrarExtra, responderNatural } = require("./blackjackMesa");
const { botonSeparar, botonSplit } = require("./blackjackSplit");

const log = createLogger("Blackjack");

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

// Doblar: cobra lo extra, pide una carta y se planta.
async function botonDoblar(interaction, state) {
    if (!state.puedeDoblar) {
        await interaction.reply({ content: "No puedes doblar ahora.", flags: MessageFlags.Ephemeral });
        return;
    }
    if (!(await cobrarExtra(interaction, state))) return;
    await responderFinal(interaction, state, bj.doblar(state), { accion: "doblar", titulo: "🃏 Blackjack - Resultado (Doblar)" });
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

// Seguro (#333): con un as visible, antes de mirar si el crupier tiene blackjack. Si lo tiene, paga 2 a 1 y la mano se liquida como
// siempre; si no, se pierde y la partida sigue.
async function botonSeguro(interaction, state, userId, acepta) {
    if (!state.seguroPendiente) {
        await interaction.reply({ content: "No hay ningún seguro que decidir.", flags: MessageFlags.Ephemeral });
        return;
    }
    const seguro = acepta ? bj.costeSeguro(state) : 0;
    if (acepta) {
        const cobro = cobrarSeguro(userId, interaction.guildId, state);
        if (!cobro.exito) {
            await interaction.reply({ content: cobro.mensaje, flags: MessageFlags.Ephemeral });
            return;
        }
    }
    state.seguroPendiente = false;
    const natural = bj.naturales(state);
    let nota = "";
    if (seguro) {
        const { neto } = liquidarSeguro(userId, interaction.guildId, seguro, Boolean(natural));
        nota = natural
            ? `El crupier tiene blackjack: el seguro paga 2 a 1 (+${neto}).`
            : `El crupier no tiene blackjack: pierdes el seguro (${neto}).`;
    }
    if (natural) {
        await responderNatural(interaction, state, natural, { editar: true, nota });
        return;
    }
    await interaction.update({ embeds: [embedJugando(state, undefined, nota)], components: filasJuego(state) });
}

// Rendirse (#337): solo en la primera decisión; se recupera la mitad de la apuesta y el crupier no juega.
async function botonRendirse(interaction, state, userId) {
    const devuelto = bj.rendirse(state);
    if (devuelto === null) {
        await interaction.reply({
            content: "Ya no puedes rendirte: solo vale en la primera decisión de la mano.",
            flags: MessageFlags.Ephemeral,
        });
        return;
    }
    // Si el cobro falla, la partida termina igual: si no, el jugador queda bloqueado con una mano en memoria.
    const cobrado = cobrarRendicion(userId, state, devuelto);
    terminarPartida(userId);
    if (!cobrado) {
        await interaction.reply({ content: ERROR_RESULTADO, flags: MessageFlags.Ephemeral });
        return;
    }
    const embed = new EmbedBuilder()
        .setTitle("🏳️ Blackjack - Te rindes")
        .setDescription(
            `Tus cartas: ${cartas(state.userHand)}\nCartas del crupier: ${cartas(state.botHand)}\n\n` +
                `Recuperas la mitad de la apuesta: \`${devuelto}\` de ${state.apuesta} monedas.`,
        )
        .setColor(COLOR.empate);
    await interaction.update({ embeds: [embed], components: [filaFin(state)] });
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
        const resultado = descontarApuesta(userId, apuesta, interaction.guildId, "blackjack");
        if (!resultado.exito) {
            await interaction.reply({ content: resultado.mensaje, flags: MessageFlags.Ephemeral });
            return;
        }
        activeGames.registrar(userId, "blackjack", interaction.guildId, apuesta);

        const state = bj.nuevaPartida({ apuesta, guildId: interaction.guildId, saldoRestante: resultado.saldoRestante });
        state.apuestaBase = apuesta;
        state.userId = userId;
        partidasBJ[userId] = state;

        // Con un as visible, el seguro se decide antes de mirar si el crupier tiene blackjack.
        if (state.seguroPendiente) {
            await interaction.reply({ embeds: [embedSeguro(state)], components: [filaSeguro(state)] });
            return;
        }
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
        if (id === "bj_tip") {
            await interaction.reply({ content: textoConsejo(state), flags: MessageFlags.Ephemeral });
            return;
        }
        if (id === "bj_insure" || id === "bj_noinsure") return botonSeguro(interaction, state, userId, id === "bj_insure");
        if (state.seguroPendiente) {
            await interaction.reply({ content: "Decide primero si quieres el seguro.", flags: MessageFlags.Ephemeral });
            return;
        }
        if (id === "bj_surrender") return botonRendirse(interaction, state, userId);
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
