const { EmbedBuilder, MessageFlags } = require("discord.js");
const marcadorExacto = require("../../systems/apuestas/marcador");
const formulario = require("../../systems/apuestas/formularioApuesta");
const { logInfo, logError, logWarn } = require("../../core/logger");
const { DEPORTES, sincronizarPartidos } = require("../../services/oddsApi");
const { buildMisJugadas } = require("../../paneles/misJugadas");
const { pantallaLiga } = require("../../paneles/liga");
const { CacheLimitada } = require("../../core/cacheLimitada");
const { partidosDePagina, partidoPorMatch } = require("../../systems/apuestas/apostar");
const { embedPartido, filasPartido, modalApuesta, confirmarApuesta } = require("./partido");
const { componentesListado } = require("./listado");
const { importeElegido } = require("../../paneles/importes");

const { MIN_BET_AMOUNT, MAX_BET_AMOUNT } = formulario;
// --- Utilidad para obtener el escudo del equipo ---
const cacheEscudos = new CacheLimitada({ max: 1000 }); // equipo -> url (o null si no tiene)
async function getTeamBadge(teamName) {
    if (cacheEscudos.has(teamName)) return cacheEscudos.get(teamName);
    try {
        const res = await fetch(`https://www.thesportsdb.com/api/v1/json/3/searchteams.php?t=${encodeURIComponent(teamName)}`, {
            signal: AbortSignal.timeout(5000),
        });
        const data = await res.json();
        const url = data.teams?.[0]?.strTeamBadge || null;
        cacheEscudos.set(teamName, url);
        return url;
    } catch (e) {
        logWarn(`[Apuestas] No se pudo obtener el escudo de "${teamName}": ${e && e.message}`);
    }
    return null;
}

module.exports = {
    componentHandlers: [
        { types: ["stringSelect"], ids: ["apuestas_select_partido"], method: "handleSelectMenu", acl: "juegos" },
        {
            types: ["button"],
            ids: ["ver_mis_apuestas"],
            prefixes: ["apuestas_", "apuesta_home_", "apuesta_draw_", "apuesta_away_", "apuesta_exacto_", "apuesta_mercado_"],
            method: "handleButton",
            acl: "juegos",
        },
        { types: ["button"], ids: ["liga_ver"], method: "handleLiga", acl: "juegos" },
        { types: ["modal"], prefixes: ["apuestas_modal_"], method: "handleModal", acl: "juegos" },
    ],

    // Pestaña ⚽ Apuestas de /juegos (antes el comando /apuestas). Desde un botón (página, competición,
    // pestaña) la respuesta sustituye al mensaje; desde /juegos seccion:apuestas es una respuesta nueva.
    async run(client, interaction, page = 1, deporteForzado = null) {
        const deporteSeleccionado = deporteForzado || interaction.options?.getString?.("deporte") || "laliga";
        const deporte = DEPORTES[deporteSeleccionado];

        if (!deporte) {
            await interaction.reply({ content: "❌ Deporte no válido.", flags: MessageFlags.Ephemeral });
            return;
        }

        logInfo(`[APUESTAS] Usuario consultando ${deporte.name}, página ${page}`);

        // 1. Obtener partidos y cuotas de la API. Si no hay, ya se ha avisado.
        if (!(await hayPartidosEnLaApi(interaction, deporteSeleccionado, deporte))) return;

        const { partidos, offset, totalPartidos } = partidosDePagina(deporteSeleccionado, page);
        if (partidos.length === 0) {
            await interaction.reply({ content: "No hay partidos disponibles para apostar ahora mismo.", flags: MessageFlags.Ephemeral });
            return;
        }

        const components = componentesListado({ interaction, deporteSeleccionado, partidos, page, offset, totalPartidos });
        const embed = new EmbedBuilder()
            .setTitle(`${deporte.emoji} Apuestas deportivas — ${deporte.name}`)
            .setDescription(
                `Elige un partido para ver cuotas y apostar tus monedas virtuales.\n` +
                    `Las cuotas pueden variar según el partido.\n\n` +
                    `📊 **${partidos.length}** partidos disponibles`,
            )
            .setColor(0x3498db);

        if (deporteForzado && interaction.isButton?.()) await interaction.update({ embeds: [embed], components });
        else await interaction.reply({ embeds: [embed], components });
    },

    // Handler para el select menu
    // 🏅 Liga: la clasificación de la temporada (paneles/liga), desde el botón de ⚽ Apuestas.
    async handleLiga(client, interaction) {
        return interaction.update(pantallaLiga(interaction.guildId, interaction.user.id));
    },

    async handleSelectMenu(client, interaction) {
        if (interaction.customId !== "apuestas_select_partido") return;

        const match_id = interaction.values[0];
        const partido = partidoPorMatch(match_id);
        if (!partido) {
            await interaction.reply({ content: "No se encontró el partido seleccionado.", flags: MessageFlags.Ephemeral });
            return;
        }

        const badgeHome = await getTeamBadge(partido.home_team);
        const badgeAway = await getTeamBadge(partido.away_team);
        await interaction.reply({ embeds: [embedPartido(partido, badgeHome, badgeAway)], components: filasPartido(partido, match_id) });
    },

    // Handler para los botones de apuesta y paginación
    async handleButton(client, interaction) {
        // --- Botón para ver apuestas activas ---
        if (interaction.customId === "ver_mis_apuestas") {
            // En el mismo mensaje (antes abría uno nuevo): desde Mis jugadas se vuelve con "⚽ Apostar a partidos".
            await interaction.update(buildMisJugadas(interaction.user.id, "activas"));
            return;
        }

        // --- Paginación ---
        if (interaction.customId.startsWith("apuestas_pagina_")) {
            const parts = interaction.customId.replace("apuestas_pagina_", "").split("_");
            const deporte = parts[0];
            const page = parseInt(parts[1], 10) || 1;
            // Antes se pasaba una copia {...interaction}: la copia no tiene los métodos de la clase
            // (reply, update...) y el botón fallaba siempre con "interaction.reply is not a function".
            await this.run(client, interaction, page, deporte);
            return;
        }

        const boton = formulario.eleccionDeBoton(interaction.customId);
        if (!boton) return;
        const match = partidoPorMatch(boton.matchId);
        const cuota = formulario.cuotaDeBoton(boton.eleccion, match);
        if (!match || !cuota) {
            await avisoError(interaction, "❌ Error", "No se pudo encontrar el partido o la cuota.");
            return;
        }

        // Mostrar modal para pedir cantidad a apostar
        await interaction.showModal(modalApuesta(boton.eleccion, match));
    },

    // Handler para el modal de cantidad
    async handleModal(client, interaction) {
        if (!interaction.customId.startsWith("apuestas_modal_")) return;

        const parts = interaction.customId.split("_");
        let eleccion = parts[2];
        const match_id = parts.slice(3).join("_");
        const cantidad = importeElegido(interaction.fields);

        if (eleccion === "exacto") {
            const eleccionExacta = await eleccionMarcadorExacto(interaction);
            if (eleccionExacta === null) return;
            eleccion = eleccionExacta;
        }

        const apuesta = formulario.apostarAPartido({
            userId: interaction.user.id,
            guildId: interaction.guildId,
            matchId: match_id,
            eleccion,
            cantidad,
        });
        if (apuesta.motivo) {
            await avisarRechazo(interaction, apuesta, cantidad);
            return;
        }

        const { userId, match, cuota } = apuesta;
        logInfo(
            `[Apuestas] ${interaction.user.tag} (${userId}) apostó ${cantidad} a "${eleccion}" en ${match.home_team} vs ${match.away_team} (cuota ${cuota})`,
        );
        await confirmarApuesta(interaction, apuesta);
    },
};

// Aviso de error en privado, con el mismo formato en todas las comprobaciones de la apuesta.
function avisoError(interaction, titulo, descripcion) {
    const errorEmbed = new EmbedBuilder().setColor(0xe74c3c).setTitle(titulo).setDescription(descripcion);
    return interaction.reply({ embeds: [errorEmbed], flags: MessageFlags.Ephemeral });
}

function sinEfectivo(interaction) {
    return avisoError(interaction, "❌ No te llega el efectivo", "Saca dinero del banco (💵 Sacar) para hacer esta apuesta.");
}

// 🎯 Marcador exacto (F-AP-10): los goles de cada equipo; la elección se guarda como "exacto_2-1". Null si los goles no
// son válidos (ya se ha avisado).
async function eleccionMarcadorExacto(interaction) {
    const eleccion = formulario.eleccionExacta(
        interaction.fields.getTextInputValue("goles_local"),
        interaction.fields.getTextInputValue("goles_visitante"),
    );
    if (eleccion === null) {
        await avisoError(interaction, "❌ Error", `Los goles tienen que ser números enteros de 0 a ${marcadorExacto.MAX_GOLES}.`);
    }
    return eleccion;
}

// El aviso de una apuesta que no se ha cobrado (y su log, si lo tiene). Los motivos los decide systems/apuestas.
function avisarRechazo(interaction, { motivo, match, eleccion, limite }, cantidad) {
    switch (motivo) {
        case "cantidad":
            return avisoError(interaction, "❌ Error", `La cantidad debe estar entre ${MIN_BET_AMOUNT} y ${MAX_BET_AMOUNT} monedas.`);
        case "sinEfectivo":
            return sinEfectivo(interaction);
        case "sinPartido":
            return avisoError(interaction, "❌ Error", "No se encontró el partido seleccionado.");
        case "cerrado":
            // El formulario se puede abrir desde un mensaje antiguo: sin la comprobación se apostaba a partidos ya empezados.
            logInfo(
                `[Apuestas] Apuesta rechazada de ${interaction.user.tag}: ${match.home_team} vs ${match.away_team} ya empezó (${match.start_time}, ${match.estado})`,
            );
            return avisoError(
                interaction,
                "⏱️ Apuestas cerradas",
                `**${match.home_team}** vs **${match.away_team}** ya ha empezado: no se admiten más apuestas.`,
            );
        case "cuota":
            return avisoError(interaction, "❌ Error", "La cuota para este resultado no es válida.");
        case "duplicada":
            return avisoError(
                interaction,
                "❌ Ya has apostado",
                marcadorExacto.marcadorDe(eleccion)
                    ? "Ya tienes una apuesta a ese marcador en este partido."
                    : "Ya tienes una apuesta activa para este partido y resultado.",
            );
        case "limite":
            logInfo(`[Apuestas] Apuesta de ${interaction.user.tag} (${cantidad}) rechazada por los límites: ${limite}`);
            return avisoError(interaction, "🚦 Límite de apuestas", limite);
    }
}

// Pide a la API los partidos y cuotas del deporte. False si no hay ninguno o falla (ya se ha avisado).
async function hayPartidosEnLaApi(interaction, deporteSeleccionado, deporte) {
    try {
        const data = await sincronizarPartidos(deporteSeleccionado);
        logInfo(`[APUESTAS] API devolvió ${data.length || 0} partidos para ${deporte.name}`);
        if (!Array.isArray(data) || data.length === 0) {
            await interaction.reply({
                content: `❌ No hay partidos disponibles para ${deporte.name} ahora mismo.`,
                flags: MessageFlags.Ephemeral,
            });
            return false;
        }
        return true;
    } catch (e) {
        logError(`[APUESTAS] Error consultando la Odds API para ${deporte.name}:`, e);
        await interaction.reply({ content: "❌ No se pudo obtener la información de la API.", flags: MessageFlags.Ephemeral });
        return false;
    }
}
