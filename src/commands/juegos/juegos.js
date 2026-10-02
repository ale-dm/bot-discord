// /juegos: todo lo que es apostar monedas, en pestañas: 🎰 Casino · ⚽ Apuestas · ⚔️ Retos · 📋 Mis jugadas ·
// 📊 Stats. Sustituye a /blackjack, /ruleta, /tragaperras, /adivinar, /ppt, /apuestas, /quiniela y /misapuestas: su
// lógica sigue en src/juegos (sin comando), y aquí se reparten los botones del casino (casino_*) y las
// pestañas (juegos_*). Los paneles están en src/paneles.
const { SlashCommandBuilder, MessageFlags } = require("discord.js");
const casino = require("../../paneles/casino");
const { buildMisJugadas } = require("../../paneles/misJugadas");
const { buildStatsJuegos } = require("../../paneles/juegos");
const { buildRetos } = require("../../paneles/retos");
const apuestas = require("../../juegos/apuestas/apuestas");

module.exports = {
    componentHandlers: [
        { types: ["button"], prefixes: ["casino_", "juegos_"], method: "handleButton", acl: "juegos" },
        { types: ["modal"], ids: ["casino_ruleta_numero_modal"], method: "handleModal", acl: "juegos" },
    ],
    data: new SlashCommandBuilder()
        .setName("juegos")
        .setDescription("Casino, apuestas deportivas, quiniela y retos: juega, mira tus jugadas y tus estadísticas")
        .addStringOption((o) =>
            o
                .setName("seccion")
                .setDescription("Por dónde empezar")
                .addChoices(
                    { name: "🎰 Casino", value: "casino" },
                    { name: "⚽ Apuestas", value: "apuestas" },
                    { name: "⚔️ Retos", value: "retos" },
                    { name: "📋 Mis jugadas", value: "jugadas" },
                    { name: "📊 Stats", value: "stats" },
                )
                .setRequired(false),
        ),

    async run(client, interaction) {
        const userId = interaction.user.id;
        const seccion = interaction.options.getString("seccion") || "casino";
        if (seccion === "apuestas") {
            await apuestas.run(client, interaction, 1, "laliga");
            return;
        }
        const payload =
            seccion === "jugadas"
                ? buildMisJugadas(userId, "activas")
                : seccion === "stats"
                  ? buildStatsJuegos(userId, interaction.user.username)
                  : seccion === "retos"
                    ? buildRetos(userId)
                    : casino.buildHome(userId);
        await interaction.reply(payload);
    },

    async handleButton(client, interaction) {
        // Solo quien abrió el panel (por la metadata del mensaje).
        const ownerId = interaction.message.interaction?.user?.id || interaction.message.interactionMetadata?.user?.id;
        if (ownerId && ownerId !== interaction.user.id) {
            await interaction.reply({ content: "⛔ Solo quien usó el comando puede interactuar.", flags: MessageFlags.Ephemeral });
            return;
        }
        const id = interaction.customId;
        if (id === "juegos_casino") {
            await interaction.update(casino.buildHome(interaction.user.id));
            return;
        }
        if (id === "juegos_jugadas") {
            await interaction.update(buildMisJugadas(interaction.user.id, "activas"));
            return;
        }
        if (id === "juegos_stats") {
            await interaction.update(buildStatsJuegos(interaction.user.id, interaction.user.username));
            return;
        }
        if (id === "juegos_retos") {
            await interaction.update(buildRetos(interaction.user.id));
            return;
        }
        // juegos_apuestas_{competición}: la lista de partidos de esa competición.
        if (id.startsWith("juegos_apuestas_")) {
            await apuestas.run(client, interaction, 1, id.replace("juegos_apuestas_", "") || "laliga");
            return;
        }
        await botonCasino(client, interaction);
    },

    // Número exacto de la ruleta (formulario) → importe.
    async handleModal(client, interaction) {
        const n = parseInt(interaction.fields.getTextInputValue("casino_ruleta_numero_input").trim());
        if (isNaN(n) || n < 0 || n > 36) {
            await interaction.reply({ content: "❌ El número debe estar entre **0** y **36**.", flags: MessageFlags.Ephemeral });
            return;
        }
        await interaction.deferUpdate();
        await interaction.editReply(casino.buildPickMontoRuleta(interaction.user.id, "numero", n));
    },
};

// Pantallas del casino que no juegan (sin tocar dinero): customId → panel.
const PANTALLAS_CASINO = {
    casino_home: (i) => casino.buildHome(i.user.id),
    casino_refresh: (i) => casino.buildHome(i.user.id),
    casino_stats: (i) => casino.buildStats(i.user.id, i.user.username),
    casino_historial: (i) => casino.buildHistorial(i.user.id),
    casino_ranking: () => casino.buildRanking(),
    // Botones de mensajes antiguos: cada juego pasa por su selector de importes.
    casino_tragaperras: (i) => casino.buildPickApuesta(i.user.id, "tragaperras"),
    casino_blackjack: (i) => casino.buildPickApuesta(i.user.id, "blackjack"),
    casino_adivinar: (i) => casino.buildPickApuesta(i.user.id, "adivinar"),
    casino_ruleta: (i) => casino.buildPickRuleta(i.user.id),
    casino_pick_ruleta_docenas: (i) => casino.buildPickDocenas(i.user.id),
};

// Cómo se juega cada uno desde un botón casino_play_{juego}_{apuesta}[_...]: el módulo del juego y las
// opciones con las que se llama a su run() (como si fuera el comando).
const JUEGOS = {
    tragaperras: { modulo: "../../juegos/casino/tragaperras", opciones: (apuesta) => ({ apuesta }) },
    blackjack: { modulo: "../../juegos/casino/blackjack", opciones: (apuesta) => ({ apuesta }) },
    adivinar: { modulo: "../../juegos/casino/adivinar", opciones: (apuesta) => ({ apuesta }) },
    // casino_play_ruleta_{apuesta}_{tipo}_{valor}
    ruleta: {
        modulo: "../../juegos/casino/ruleta",
        opciones: (apuesta, [tipo = "color", valor = "rojo"]) => ({ apuesta, tipo: `${tipo}:${valor}`, numero: null }),
    },
    // casino_play_ppt_{apuesta}_{jugada}
    ppt: { modulo: "../../juegos/casino/ppt", opciones: (apuesta, [jugada]) => ({ cantidad: apuesta, jugada }) },
};

async function botonCasino(client, interaction) {
    const id = interaction.customId;
    const userId = interaction.user.id;

    if (PANTALLAS_CASINO[id]) {
        await interaction.update(PANTALLAS_CASINO[id](interaction));
        return;
    }
    // Stats de un juego (botón 📊 al acabar una partida).
    if (id.startsWith("casino_stats_")) {
        await interaction.update(casino.buildStats(userId, interaction.user.username, id.replace("casino_stats_", "")));
        return;
    }
    if (id === "casino_pick_ruleta_numero") {
        await interaction.showModal(casino.modalNumeroRuleta());
        return;
    }
    // Tipo de ruleta elegido (casino_pick_ruleta_color_rojo, …) → importe.
    if (id.startsWith("casino_pick_ruleta_")) {
        const [tipo, valor] = id.replace("casino_pick_ruleta_", "").split("_");
        await interaction.update(casino.buildPickMontoRuleta(userId, tipo, valor));
        return;
    }
    if (id.startsWith("casino_pick_")) {
        await interaction.update(casino.buildPickApuesta(userId, id.replace("casino_pick_", "")));
        return;
    }

    if (id.startsWith("casino_play_")) {
        const [juego, apuestaTxt, ...resto] = id.replace("casino_play_", "").split("_");
        const apuesta = parseInt(apuestaTxt);
        // En ppt, con el importe elegido falta la jugada.
        if (juego === "ppt" && !resto.length) {
            await interaction.update(casino.buildPickJugadaPpt(userId, apuesta));
            return;
        }
        const def = JUEGOS[juego];
        if (def) await require(def.modulo).run(client, makeFakeInteraction(interaction, def.opciones(apuesta, resto)));
    }
}

// Adapta reply/deferReply a update/deferUpdate para que los juegos editen el mensaje del panel en
// lugar de crear uno nuevo. Al editar se quitan los flags: lo privado no se puede cambiar al editar
// (antes era `ephemeral: true`, que update() ignoraba; los flags sí llegan a Discord).
// Un aviso privado sin embeds ("no te llega el saldo"...) no sustituye al panel: va aparte, solo para ti,
// para que puedas cambiar la apuesta sin volver a empezar.
function makeFakeInteraction(interaction, optionsMap) {
    let replied = false;
    const opcion = (name) => (optionsMap[name] !== undefined ? optionsMap[name] : null);
    const esAviso = (p) => Boolean(p.flags) && !p.embeds?.length;
    return {
        ...interaction,
        options: { getInteger: opcion, getString: opcion, getBoolean: opcion },
        reply: async (payload) => {
            if (!replied && esAviso(payload)) {
                replied = true;
                return interaction.reply({ ...payload, flags: MessageFlags.Ephemeral });
            }
            if (!replied) {
                replied = true;
                const { flags: _flags, ...edicion } = payload;
                return interaction.update(edicion);
            }
            return interaction.followUp({ ...payload, flags: MessageFlags.Ephemeral });
        },
        editReply: async (payload) => interaction.editReply(payload),
        deferReply: async () => interaction.deferUpdate(),
        followUp: async (payload) => interaction.followUp(payload),
    };
}
