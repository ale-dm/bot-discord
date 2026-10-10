const {
    EmbedBuilder,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    StringSelectMenuBuilder,
    ModalBuilder,
    TextInputBuilder,
    TextInputStyle,
    MessageFlags,
} = require("discord.js");
const dinero = require("../../systems/dinero");
const marcadorExacto = require("../../systems/apuestas/marcador");
const mercados = require("../../systems/apuestas/mercados");
const directo = require("../../systems/apuestas/directo");
const limites = require("../../systems/apuestas/limites");
const { logInfo, logError, logWarn } = require("../../core/logger");
const { DEPORTES, sincronizarPartidos } = require("../../services/oddsApi");
const { buildMisJugadas, filaTrasApostar } = require("../../paneles/misJugadas");
const { pantallaLiga } = require("../../paneles/liga");
const { filaPestanas } = require("../../paneles/pestanasJuegos");
const { trozos } = require("../../paneles/filas");
const { CacheLimitada } = require("../../core/cacheLimitada");
const {
    cuotaDeEleccion,
    cobrarApuesta,
    partidosDePagina,
    yaApostadoApuesta,
    PARTIDOS_POR_PAGINA,
    partidoPorMatch,
} = require("../../systems/apuestas/apostar");

const MAX_BET_AMOUNT = Number(process.env.MAX_BET_AMOUNT || 1000);
const MIN_BET_AMOUNT = Number(process.env.MIN_BET_AMOUNT || 10);
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

        const embed = new EmbedBuilder()
            .setTitle(`⚽ ${partido.home_team} vs ${partido.away_team}`)
            .setDescription(
                `¿A qué resultado quieres apostar?\n\n` +
                    `🏠 **${partido.home_team}**: cuota \`${partido.cuota_home}\`\n` +
                    `🤝 **Empate**: cuota \`${partido.cuota_draw}\`\n` +
                    `🚩 **${partido.away_team}**: cuota \`${partido.cuota_away}\`\n` +
                    `🎯 **Marcador exacto**: premio fijo de \`×${marcadorExacto.PREMIO}\` lo apostado\n` +
                    mercados
                        .botonesDisponibles(partido)
                        .map((b) => `${b.etiqueta}: cuota \`${mercados.cuotaDe(partido, b.eleccion)}\`\n`)
                        .join("") +
                    "\nPulsa un botón para elegir tu apuesta.",
            )
            .setColor(0xf1c40f);

        if (badgeHome && badgeAway) {
            embed.setThumbnail(badgeHome).setImage(badgeAway);
        } else if (badgeHome) {
            embed.setThumbnail(badgeHome);
        } else if (badgeAway) {
            embed.setThumbnail(badgeAway);
        }

        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId(`apuesta_home_${match_id}`).setLabel(`🏠 ${partido.home_team}`).setStyle(ButtonStyle.Success),
            new ButtonBuilder().setCustomId(`apuesta_draw_${match_id}`).setLabel("🤝 Empate").setStyle(ButtonStyle.Primary),
            new ButtonBuilder().setCustomId(`apuesta_away_${match_id}`).setLabel(`🚩 ${partido.away_team}`).setStyle(ButtonStyle.Danger),
            new ButtonBuilder()
                .setCustomId(`apuesta_exacto_${match_id}`)
                .setLabel(`🎯 Marcador exacto (×${marcadorExacto.PREMIO})`)
                .setStyle(ButtonStyle.Secondary),
        );

        // Mercados de goles y de hándicap, si la API dio su cuota para este partido (una fila aparte).
        const filas = [row];
        const botonesMercado = mercados
            .botonesDisponibles(partido)
            .map((b) =>
                new ButtonBuilder()
                    .setCustomId(`apuesta_mercado_${b.eleccion}_${match_id}`)
                    .setLabel(b.etiqueta.slice(0, 80))
                    .setStyle(ButtonStyle.Secondary),
            );
        if (botonesMercado.length) filas.push(new ActionRowBuilder().addComponents(botonesMercado));
        // 🧩 Sumar a mi combinada: el mismo partido con la elección que se quiera (una pata por partido).
        const opciones = [
            partido.cuota_home && { value: "home", label: `🏠 ${partido.home_team} · cuota ${partido.cuota_home}` },
            partido.cuota_draw && { value: "draw", label: `🤝 Empate · cuota ${partido.cuota_draw}` },
            partido.cuota_away && { value: "away", label: `🚩 ${partido.away_team} · cuota ${partido.cuota_away}` },
            ...mercados.botonesDisponibles(partido).map((b) => ({
                value: b.eleccion,
                label: `${b.etiqueta} · cuota ${mercados.cuotaDe(partido, b.eleccion)}`,
            })),
        ].filter(Boolean);
        if (opciones.length) {
            filas.push(
                new ActionRowBuilder().addComponents(
                    new StringSelectMenuBuilder()
                        .setCustomId(`combinada_sumar_${match_id}`)
                        .setPlaceholder("🧩 Sumar a mi combinada…")
                        .addOptions(opciones.map((o) => ({ ...o, label: o.label.slice(0, 100) }))),
                ),
            );
        }

        await interaction.reply({ embeds: [embed], components: filas });
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

        let match, eleccion, cuota;

        if (interaction.customId.startsWith("apuesta_home_")) {
            const match_id = interaction.customId.replace("apuesta_home_", "");
            match = partidoPorMatch(match_id);
            eleccion = "home";
            cuota = match?.cuota_home;
        } else if (interaction.customId.startsWith("apuesta_draw_")) {
            const match_id = interaction.customId.replace("apuesta_draw_", "");
            match = partidoPorMatch(match_id);
            eleccion = "draw";
            cuota = match?.cuota_draw;
        } else if (interaction.customId.startsWith("apuesta_away_")) {
            const match_id = interaction.customId.replace("apuesta_away_", "");
            match = partidoPorMatch(match_id);
            eleccion = "away";
            cuota = match?.cuota_away;
        } else if (interaction.customId.startsWith("apuesta_mercado_")) {
            // 🥅 Mercados de goles (#9) y de hándicap (#10): apuesta_mercado_{mas|menos|casa|fuera}_{match_id}.
            const resto = interaction.customId.replace("apuesta_mercado_", "");
            const corte = resto.indexOf("_");
            eleccion = resto.slice(0, corte);
            const match_id = resto.slice(corte + 1);
            match = partidoPorMatch(match_id);
            if (!mercados.esMercado(eleccion)) return;
            cuota = match ? mercados.cuotaDe(match, eleccion) : null;
        } else if (interaction.customId.startsWith("apuesta_exacto_")) {
            // 🎯 Marcador exacto (F-AP-10): sin cuota de la API, premio fijo.
            const match_id = interaction.customId.replace("apuesta_exacto_", "");
            match = partidoPorMatch(match_id);
            eleccion = "exacto";
            cuota = marcadorExacto.PREMIO;
        } else {
            return;
        }

        if (!match || !cuota) {
            const errorEmbed = new EmbedBuilder()
                .setColor(0xe74c3c)
                .setTitle("❌ Error")
                .setDescription("No se pudo encontrar el partido o la cuota.");
            await interaction.reply({ embeds: [errorEmbed], flags: MessageFlags.Ephemeral });
            return;
        }

        // Mostrar modal para pedir cantidad a apostar
        const modal = new ModalBuilder().setCustomId(`apuestas_modal_${eleccion}_${match.match_id}`).setTitle("¿Cuánto quieres apostar?");

        const cantidadInput = new TextInputBuilder()
            .setCustomId("cantidad")
            .setLabel(`Cantidad a apostar (${MIN_BET_AMOUNT}-${MAX_BET_AMOUNT})`)
            .setStyle(TextInputStyle.Short)
            .setMinLength(1)
            .setMaxLength(7)
            .setPlaceholder("Ejemplo: 100")
            .setRequired(true);

        if (eleccion === "exacto") {
            const goles = (id, equipo) =>
                new ActionRowBuilder().addComponents(
                    new TextInputBuilder()
                        .setCustomId(id)
                        .setLabel(`Goles de ${equipo}`.slice(0, 45))
                        .setStyle(TextInputStyle.Short)
                        .setMinLength(1)
                        .setMaxLength(2)
                        .setPlaceholder("0")
                        .setRequired(true),
                );
            modal.setTitle(`🎯 Marcador exacto (×${marcadorExacto.PREMIO})`);
            modal.addComponents(goles("goles_local", match.home_team), goles("goles_visitante", match.away_team));
        }
        modal.addComponents(new ActionRowBuilder().addComponents(cantidadInput));

        await interaction.showModal(modal);
    },

    // Handler para el modal de cantidad
    async handleModal(client, interaction) {
        if (!interaction.customId.startsWith("apuestas_modal_")) return;

        const parts = interaction.customId.split("_");
        let eleccion = parts[2];
        const match_id = parts.slice(3).join("_");
        const cantidadStr = interaction.fields.getTextInputValue("cantidad");
        const cantidad = parseInt(cantidadStr, 10);

        if (eleccion === "exacto") {
            const eleccionExacta = await eleccionMarcadorExacto(interaction);
            if (eleccionExacta === null) return;
            eleccion = eleccionExacta;
        }

        // Antes solo se comprobaba un mínimo fijo de 10: el máximo de MAX_BET_AMOUNT no se aplicaba.
        if (isNaN(cantidad) || cantidad < MIN_BET_AMOUNT || cantidad > MAX_BET_AMOUNT) {
            await avisoError(interaction, "❌ Error", `La cantidad debe estar entre ${MIN_BET_AMOUNT} y ${MAX_BET_AMOUNT} monedas.`);
            return;
        }

        const userId = interaction.user.id;
        // Quien aún no tiene cuenta empieza con el saldo inicial (como en el casino); antes le salía
        // "saldo insuficiente" hasta que usara otro comando que le creara la cuenta.
        // Se apuesta con el 💵 efectivo + 🥷 dinero negro (systems/dinero, F-EC-06b: se gasta igual).
        if (dinero.saldoGastable(userId) < cantidad) {
            await sinEfectivo(interaction);
            return;
        }

        const match = partidoPorMatch(match_id);
        if (!match) {
            await avisoError(interaction, "❌ Error", "No se encontró el partido seleccionado.");
            return;
        }

        // El formulario se puede abrir desde un mensaje antiguo: sin esta comprobación se podía
        // apostar a un partido ya empezado (o terminado) sabiendo cómo iba.
        if (!directo.abiertoParaApostar(match)) {
            logInfo(
                `[Apuestas] Apuesta rechazada de ${interaction.user.tag}: ${match.home_team} vs ${match.away_team} ya empezó (${match.start_time}, ${match.estado})`,
            );
            await avisoError(
                interaction,
                "⏱️ Apuestas cerradas",
                `**${match.home_team}** vs **${match.away_team}** ya ha empezado: no se admiten más apuestas.`,
            );
            return;
        }

        // La línea de la apuesta queda guardada: si la API la cambia después, esta apuesta se liquida con la suya.
        const cuota = cuotaDeEleccion(eleccion, match);
        const linea = mercados.esMercado(eleccion) ? mercados.lineaDe(match, eleccion) : null;

        if (!cuota || cuota < 1) {
            await avisoError(interaction, "❌ Error", "La cuota para este resultado no es válida.");
            return;
        }

        // Prevención de apuestas duplicadas
        const yaApostado = yaApostadoApuesta(userId, match_id, eleccion);

        if (yaApostado) {
            await avisoError(
                interaction,
                "❌ Ya has apostado",
                marcadorExacto.marcadorDe(eleccion)
                    ? "Ya tienes una apuesta a ese marcador en este partido."
                    : "Ya tienes una apuesta activa para este partido y resultado.",
            );
            return;
        }

        // 🚦 Tope diario y máximo por partido del servidor (F-AP-09). Justo antes de cobrar y sin await por medio: dos
        // formularios a la vez no pueden pasarse del límite entre los dos.
        const limite = limites.comprobar(interaction.guildId, userId, cantidad, { matchId: match_id });
        if (limite) {
            logInfo(`[Apuestas] Apuesta de ${interaction.user.tag} (${cantidad}) rechazada por los límites: ${limite}`);
            await avisoError(interaction, "🚦 Límite de apuestas", limite);
            return;
        }

        if (!cobrarApuesta({ userId, match_id, match, eleccion, cantidad, cuota, linea })) {
            await sinEfectivo(interaction);
            return;
        }
        logInfo(
            `[Apuestas] ${interaction.user.tag} (${userId}) apostó ${cantidad} a "${eleccion}" en ${match.home_team} vs ${match.away_team} (cuota ${cuota})`,
        );

        await confirmarApuesta(interaction, { userId, match, eleccion, linea, cantidad, cuota });
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
    const golesLocal = marcadorExacto.golesValidos(interaction.fields.getTextInputValue("goles_local"));
    const golesVisitante = marcadorExacto.golesValidos(interaction.fields.getTextInputValue("goles_visitante"));
    if (golesLocal === null || golesVisitante === null) {
        await avisoError(interaction, "❌ Error", `Los goles tienen que ser números enteros de 0 a ${marcadorExacto.MAX_GOLES}.`);
        return null;
    }
    return marcadorExacto.eleccion(golesLocal, golesVisitante);
}

async function confirmarApuesta(interaction, { userId, match, eleccion, linea, cantidad, cuota }) {
    const saldoActual = dinero.efectivo(userId);
    const resultadoTxt = marcadorExacto.marcadorDe(eleccion)
        ? `Marcador exacto ${match.home_team} ${marcadorExacto.marcadorDe(eleccion)} ${match.away_team}`
        : mercados.textoEleccion({ eleccion, linea, home_team: match.home_team, away_team: match.away_team });
    const embed = new EmbedBuilder()
        .setTitle("✅ ¡Apuesta registrada!")
        .setDescription(
            `**Partido:** ${match.home_team} vs ${match.away_team}\n` +
                `**Opción:** ${resultadoTxt}\n` +
                `**Cantidad:** \`${cantidad}\` monedas\n` +
                `**Cuota:** \`${cuota}\`\n\n` +
                `💵 **Tu efectivo:** \`${saldoActual}\` monedas\n\n` +
                "¡Suerte!",
        )
        .setColor(0x27ae60);

    await interaction.reply({
        embeds: [embed],
        components: [filaTrasApostar(userId, { deporte: match.deporte || "laliga" })],
    });
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

// Las filas del listado: el selector de partido, la paginación, las competiciones (la actual resaltada, con su
// quiniela y la liga y la combinada; cada fila admite 5 botones) y las pestañas.
function componentesListado({ interaction, deporteSeleccionado, partidos, page, offset, totalPartidos }) {
    // Prepara el select menu para elegir partido (máximo 25 opciones por Discord)
    const options = partidos.map((p) => ({
        label: `🏠 ${p.home_team} vs 🚩 ${p.away_team}`,
        description: `🗓️ ${new Date(p.start_time).toLocaleString("es-ES")} | Cuotas: ${p.cuota_home} / ${p.cuota_draw} / ${p.cuota_away}`,
        value: p.match_id,
    }));

    const select = new StringSelectMenuBuilder()
        .setCustomId("apuestas_select_partido")
        .setPlaceholder("Elige un partido para apostar")
        .addOptions(options);

    const row = new ActionRowBuilder().addComponents(select);

    // Botones de paginación
    const rowBtns = new ActionRowBuilder();
    if (page > 1)
        rowBtns.addComponents(
            new ButtonBuilder()
                .setCustomId(`apuestas_pagina_${deporteSeleccionado}_${page - 1}`)
                .setLabel("⬅️ Anterior")
                .setStyle(ButtonStyle.Secondary),
        );
    if (offset + PARTIDOS_POR_PAGINA < totalPartidos)
        rowBtns.addComponents(
            new ButtonBuilder()
                .setCustomId(`apuestas_pagina_${deporteSeleccionado}_${page + 1}`)
                .setLabel("Siguiente ➡️")
                .setStyle(ButtonStyle.Secondary),
        );

    // Competiciones (la actual resaltada), la quiniela de esa competición y la liga. Cada fila admite 5 botones,
    // así que con más competiciones salen en varias filas.
    const botonesCompeticion = [
        ...Object.entries(DEPORTES).map(([key, d]) =>
            new ButtonBuilder()
                .setCustomId(`apuestas_pagina_${key}_1`)
                .setLabel(`${d.emoji} ${d.name}`.slice(0, 80))
                .setStyle(key === deporteSeleccionado ? ButtonStyle.Primary : ButtonStyle.Secondary),
        ),
        new ButtonBuilder().setCustomId(`quiniela_refrescar_${deporteSeleccionado}`).setLabel("🧾 Quiniela").setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId("liga_ver").setLabel("🏅 Liga").setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId("combinada_abrir").setLabel("🧩 Combinada").setStyle(ButtonStyle.Secondary),
    ];
    const filasCompeticion = trozos(botonesCompeticion).map((grupo) => new ActionRowBuilder().addComponents(...grupo));

    return [row, ...(rowBtns.components.length > 0 ? [rowBtns] : []), ...filasCompeticion, filaPestanas(interaction.user.id, "apuestas")];
}
