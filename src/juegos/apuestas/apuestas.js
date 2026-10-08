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
const db = require("../../core/db");
const dinero = require("../../systems/dinero");
const marcadorExacto = require("../../systems/apuestas/marcador");
const limites = require("../../systems/apuestas/limites");
const { logInfo, logError, logWarn } = require("../../core/logger");
const { DEPORTES, sincronizarPartidos } = require("../../services/oddsApi");
const { buildMisJugadas, filaTrasApostar } = require("../../paneles/misJugadas");
const { filaPestanas } = require("../../paneles/pestanasJuegos");

const MAX_BET_AMOUNT = Number(process.env.MAX_BET_AMOUNT || 1000);
const MIN_BET_AMOUNT = Number(process.env.MIN_BET_AMOUNT || 10);
// --- Utilidad para obtener el escudo del equipo ---
const cacheEscudos = new Map(); // equipo -> url (o null si no tiene)
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
            prefixes: ["apuestas_", "apuesta_home_", "apuesta_draw_", "apuesta_away_", "apuesta_exacto_"],
            method: "handleButton",
            acl: "juegos",
        },
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

        // 1. Obtener partidos y cuotas de la API
        try {
            const data = await sincronizarPartidos(deporteSeleccionado);
            logInfo(`[APUESTAS] API devolvió ${data.length || 0} partidos para ${deporte.name}`);
            if (!Array.isArray(data) || data.length === 0) {
                await interaction.reply({
                    content: `❌ No hay partidos disponibles para ${deporte.name} ahora mismo.`,
                    flags: MessageFlags.Ephemeral,
                });
                return;
            }
        } catch (e) {
            logError(`[APUESTAS] Error consultando la Odds API para ${deporte.name}:`, e);
            await interaction.reply({ content: "❌ No se pudo obtener la información de la API.", flags: MessageFlags.Ephemeral });
            return;
        }

        // --- Paginación ---
        const partidosPorPagina = 25;
        const offset = (page - 1) * partidosPorPagina;
        const ahora = new Date().toISOString();
        const partidos = db
            .prepare(
                `
            SELECT * FROM apuestas_partidos
            WHERE estado = 'abierto'
                AND deporte = ?
                AND cuota_home IS NOT NULL
                AND cuota_draw IS NOT NULL
                AND cuota_away IS NOT NULL
                AND start_time > ?
            ORDER BY start_time
            LIMIT ? OFFSET ?
        `,
            )
            .all(deporteSeleccionado, ahora, partidosPorPagina, offset);

        logInfo(`[APUESTAS] Consultando partidos desde ${ahora}, encontrados: ${partidos.length}`);

        if (partidos.length === 0) {
            await interaction.reply({ content: "No hay partidos disponibles para apostar ahora mismo.", flags: MessageFlags.Ephemeral });
            return;
        }

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
        const totalPartidos = db
            .prepare(
                `
            SELECT COUNT(*) as total FROM apuestas_partidos
            WHERE estado = 'abierto'
                AND deporte = ?
                AND cuota_home IS NOT NULL
                AND cuota_draw IS NOT NULL
                AND cuota_away IS NOT NULL
                AND start_time > ?
        `,
            )
            .get(deporteSeleccionado, ahora).total;

        const rowBtns = new ActionRowBuilder();
        if (page > 1)
            rowBtns.addComponents(
                new ButtonBuilder()
                    .setCustomId(`apuestas_pagina_${deporteSeleccionado}_${page - 1}`)
                    .setLabel("⬅️ Anterior")
                    .setStyle(ButtonStyle.Secondary),
            );
        if (offset + partidosPorPagina < totalPartidos)
            rowBtns.addComponents(
                new ButtonBuilder()
                    .setCustomId(`apuestas_pagina_${deporteSeleccionado}_${page + 1}`)
                    .setLabel("Siguiente ➡️")
                    .setStyle(ButtonStyle.Secondary),
            );

        // Competición (la actual resaltada) y la quiniela de esa competición.
        const rowCompeticiones = new ActionRowBuilder().addComponents(
            ...Object.entries(DEPORTES).map(([key, d]) =>
                new ButtonBuilder()
                    .setCustomId(`apuestas_pagina_${key}_1`)
                    .setLabel(`${d.emoji} ${d.name}`.slice(0, 80))
                    .setStyle(key === deporteSeleccionado ? ButtonStyle.Primary : ButtonStyle.Secondary),
            ),
            new ButtonBuilder()
                .setCustomId(`quiniela_refrescar_${deporteSeleccionado}`)
                .setLabel("🧾 Quiniela")
                .setStyle(ButtonStyle.Success),
            new ButtonBuilder().setCustomId("liga_ver").setLabel("🏅 Liga").setStyle(ButtonStyle.Secondary),
        );

        const components = [
            row,
            ...(rowBtns.components.length > 0 ? [rowBtns] : []),
            rowCompeticiones,
            filaPestanas(interaction.user.id, "apuestas"),
        ];

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
    async handleSelectMenu(client, interaction) {
        if (interaction.customId !== "apuestas_select_partido") return;

        const match_id = interaction.values[0];
        const partido = db.prepare("SELECT * FROM apuestas_partidos WHERE match_id = ?").get(match_id);
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
                    `🎯 **Marcador exacto**: premio fijo de \`×${marcadorExacto.PREMIO}\` lo apostado\n\n` +
                    "Pulsa un botón para elegir tu apuesta.",
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

        await interaction.reply({ embeds: [embed], components: [row] });
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
            match = db.prepare("SELECT * FROM apuestas_partidos WHERE match_id = ?").get(match_id);
            eleccion = "home";
            cuota = match?.cuota_home;
        } else if (interaction.customId.startsWith("apuesta_draw_")) {
            const match_id = interaction.customId.replace("apuesta_draw_", "");
            match = db.prepare("SELECT * FROM apuestas_partidos WHERE match_id = ?").get(match_id);
            eleccion = "draw";
            cuota = match?.cuota_draw;
        } else if (interaction.customId.startsWith("apuesta_away_")) {
            const match_id = interaction.customId.replace("apuesta_away_", "");
            match = db.prepare("SELECT * FROM apuestas_partidos WHERE match_id = ?").get(match_id);
            eleccion = "away";
            cuota = match?.cuota_away;
        } else if (interaction.customId.startsWith("apuesta_exacto_")) {
            // 🎯 Marcador exacto (F-AP-10): sin cuota de la API, premio fijo.
            const match_id = interaction.customId.replace("apuesta_exacto_", "");
            match = db.prepare("SELECT * FROM apuestas_partidos WHERE match_id = ?").get(match_id);
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

        // 🎯 Marcador exacto (F-AP-10): los goles de cada equipo; la elección se guarda como "exacto_2-1".
        if (eleccion === "exacto") {
            const golesLocal = marcadorExacto.golesValidos(interaction.fields.getTextInputValue("goles_local"));
            const golesVisitante = marcadorExacto.golesValidos(interaction.fields.getTextInputValue("goles_visitante"));
            if (golesLocal === null || golesVisitante === null) {
                const errorEmbed = new EmbedBuilder()
                    .setColor(0xe74c3c)
                    .setTitle("❌ Error")
                    .setDescription(`Los goles tienen que ser números enteros de 0 a ${marcadorExacto.MAX_GOLES}.`);
                await interaction.reply({ embeds: [errorEmbed], flags: MessageFlags.Ephemeral });
                return;
            }
            eleccion = marcadorExacto.eleccion(golesLocal, golesVisitante);
        }

        // Antes solo se comprobaba un mínimo fijo de 10: el máximo de MAX_BET_AMOUNT no se aplicaba.
        if (isNaN(cantidad) || cantidad < MIN_BET_AMOUNT || cantidad > MAX_BET_AMOUNT) {
            const errorEmbed = new EmbedBuilder()
                .setColor(0xe74c3c)
                .setTitle("❌ Error")
                .setDescription(`La cantidad debe estar entre ${MIN_BET_AMOUNT} y ${MAX_BET_AMOUNT} monedas.`);
            await interaction.reply({ embeds: [errorEmbed], flags: MessageFlags.Ephemeral });
            return;
        }

        const userId = interaction.user.id;
        // Quien aún no tiene cuenta empieza con el saldo inicial (como en el casino); antes le salía
        // "saldo insuficiente" hasta que usara otro comando que le creara la cuenta.
        // Se apuesta con el 💵 efectivo + 🥷 dinero negro (systems/dinero, F-EC-06b: se gasta igual).
        if (dinero.saldoGastable(userId) < cantidad) {
            const errorEmbed = new EmbedBuilder()
                .setColor(0xe74c3c)
                .setTitle("❌ No te llega el efectivo")
                .setDescription("Saca dinero del banco (💵 Sacar) para hacer esta apuesta.");
            await interaction.reply({ embeds: [errorEmbed], flags: MessageFlags.Ephemeral });
            return;
        }

        const match = db.prepare("SELECT * FROM apuestas_partidos WHERE match_id = ?").get(match_id);
        if (!match) {
            const errorEmbed = new EmbedBuilder()
                .setColor(0xe74c3c)
                .setTitle("❌ Error")
                .setDescription("No se encontró el partido seleccionado.");
            await interaction.reply({ embeds: [errorEmbed], flags: MessageFlags.Ephemeral });
            return;
        }

        // El formulario se puede abrir desde un mensaje antiguo: sin esta comprobación se podía
        // apostar a un partido ya empezado (o terminado) sabiendo cómo iba.
        if (match.estado !== "abierto" || !(match.start_time > new Date().toISOString())) {
            logInfo(
                `[Apuestas] Apuesta rechazada de ${interaction.user.tag}: ${match.home_team} vs ${match.away_team} ya empezó (${match.start_time}, ${match.estado})`,
            );
            const errorEmbed = new EmbedBuilder()
                .setColor(0xe74c3c)
                .setTitle("⏱️ Apuestas cerradas")
                .setDescription(`**${match.home_team}** vs **${match.away_team}** ya ha empezado: no se admiten más apuestas.`);
            await interaction.reply({ embeds: [errorEmbed], flags: MessageFlags.Ephemeral });
            return;
        }

        let cuota = null;
        if (eleccion === "home") cuota = match.cuota_home;
        else if (eleccion === "draw") cuota = match.cuota_draw;
        else if (eleccion === "away") cuota = match.cuota_away;
        else if (marcadorExacto.marcadorDe(eleccion)) cuota = marcadorExacto.PREMIO;

        if (!cuota || cuota < 1) {
            const errorEmbed = new EmbedBuilder()
                .setColor(0xe74c3c)
                .setTitle("❌ Error")
                .setDescription("La cuota para este resultado no es válida.");
            await interaction.reply({ embeds: [errorEmbed], flags: MessageFlags.Ephemeral });
            return;
        }

        // Prevención de apuestas duplicadas
        const yaApostado = db
            .prepare(
                `
            SELECT 1 FROM apuestas_usuario WHERE user_id = ? AND match_id = ? AND eleccion = ?
        `,
            )
            .get(userId, match_id, eleccion);

        if (yaApostado) {
            const errorEmbed = new EmbedBuilder()
                .setColor(0xe74c3c)
                .setTitle("❌ Ya has apostado")
                .setDescription(
                    marcadorExacto.marcadorDe(eleccion)
                        ? "Ya tienes una apuesta a ese marcador en este partido."
                        : "Ya tienes una apuesta activa para este partido y resultado.",
                );
            await interaction.reply({ embeds: [errorEmbed], flags: MessageFlags.Ephemeral });
            return;
        }

        // 🚦 Tope diario y máximo por partido del servidor (F-AP-09). Justo antes de cobrar y sin await por medio: dos
        // formularios a la vez no pueden pasarse del límite entre los dos.
        const limite = limites.comprobar(interaction.guildId, userId, cantidad, { matchId: match_id });
        if (limite) {
            logInfo(`[Apuestas] Apuesta de ${interaction.user.tag} (${cantidad}) rechazada por los límites: ${limite}`);
            const errorEmbed = new EmbedBuilder().setColor(0xe74c3c).setTitle("🚦 Límite de apuestas").setDescription(limite);
            await interaction.reply({ embeds: [errorEmbed], flags: MessageFlags.Ephemeral });
            return;
        }

        // Descontar saldo y registrar la apuesta, todo o nada (antes eran dos escrituras sueltas:
        // si fallaba la segunda, se cobraba una apuesta que no existía).
        const cobrada = db.transaction(() => {
            if (!dinero.cobrarCombinado(userId, cantidad)) return false;
            db.prepare(
                `
                INSERT INTO apuestas_usuario (user_id, match_id, eleccion, cantidad, cuota)
                VALUES (?, ?, ?, ?, ?)
            `,
            ).run(userId, match_id, eleccion, cantidad, cuota);
            // Antes solo se apuntaba el premio al ganar: en /banco historial no aparecía lo apostado
            // y el "ganado/perdido" de /nivel contaba el premio entero como ganancia.
            dinero.apuntar(userId, "apuestas", `Apuesta: ${match.home_team} vs ${match.away_team}`, -cantidad);
            return true;
        })();
        if (!cobrada) {
            const errorEmbed = new EmbedBuilder()
                .setColor(0xe74c3c)
                .setTitle("❌ No te llega el efectivo")
                .setDescription("Saca dinero del banco (💵 Sacar) para hacer esta apuesta.");
            await interaction.reply({ embeds: [errorEmbed], flags: MessageFlags.Ephemeral });
            return;
        }
        logInfo(
            `[Apuestas] ${interaction.user.tag} (${userId}) apostó ${cantidad} a "${eleccion}" en ${match.home_team} vs ${match.away_team} (cuota ${cuota})`,
        );

        const saldoActual = dinero.efectivo(userId);
        const resultadoTxt = marcadorExacto.marcadorDe(eleccion)
            ? `Marcador exacto ${match.home_team} ${marcadorExacto.marcadorDe(eleccion)} ${match.away_team}`
            : eleccion === "home"
              ? match.home_team
              : eleccion === "draw"
                ? "Empate"
                : match.away_team;
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
    },
};
