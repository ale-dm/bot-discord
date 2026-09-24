const {
    SlashCommandBuilder,
    EmbedBuilder,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    ModalBuilder,
    TextInputBuilder,
    TextInputStyle,
} = require("discord.js");
const db = require("../../core/db");
const xp = require("../../systems/xpSystem");
const casinoTx = require("../../systems/casinoTransactions");
const nivel = require("./nivel");

// ─── HELPERS CASINO ──────────────────────────────────────────────────────────
function getUserStats(userId) {
    return (
        db
            .prepare(
                `
        SELECT COUNT(*)                                              AS total,
               COALESCE(SUM(apuesta),   0)                           AS apostado,
               COALESCE(SUM(resultado), 0)                           AS ganancia,
               COALESCE(MAX(resultado), 0)                           AS mejor,
               COUNT(CASE WHEN resultado > 0 THEN 1 END)             AS wins,
               COUNT(CASE WHEN resultado < 0 THEN 1 END)             AS losses
        FROM casino WHERE userId = ?
    `,
            )
            .get(userId) || { total: 0, apostado: 0, ganancia: 0, mejor: 0, wins: 0, losses: 0 }
    );
}

function getFavoriteGame(userId) {
    const row = db
        .prepare("SELECT juego, COUNT(*) AS cnt FROM casino WHERE userId = ? GROUP BY juego ORDER BY cnt DESC LIMIT 1")
        .get(userId);
    if (!row) return null;
    const norm = row.juego === "slots" ? "tragaperras" : row.juego;
    const emojiMap = { blackjack: "🃏", tragaperras: "🎰", ruleta: "🎡", adivinar: "🔮" };
    return `${emojiMap[norm] || "🎲"} ${norm.charAt(0).toUpperCase() + norm.slice(1)} (${row.cnt})`;
}

function getLastGames(userId, n = 5) {
    return db.prepare("SELECT juego, resultado, apuesta FROM casino WHERE userId = ? ORDER BY fecha DESC LIMIT ?").all(userId, n);
}

function getSaldo(userId) {
    return casinoTx.obtenerSaldo(userId);
}

const EMOJI = { blackjack: "🃏", tragaperras: "🎰", slots: "🎰", ruleta: "🎡", adivinar: "🔮", apuestas: "⚽", quiniela: "📋" };

// ─── NAVEGACIÓN PRINCIPAL DEL PERFIL ─────────────────────────────────────────
// ownerId siempre en la posición [2] al partir el customId por "_", incluidas
// las variantes de paginación (perfil_topprev_/perfil_topnext_ sin segmento extra).
function perfilNavRow(ownerId, targetId) {
    return new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`perfil_profile_${ownerId}_${targetId}`).setLabel("👤 Perfil").setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId(`perfil_casino_${ownerId}`).setLabel("🎰 Casino").setStyle(ButtonStyle.Danger),
        new ButtonBuilder().setCustomId(`perfil_logros_${ownerId}_${targetId}`).setLabel("🏅 Logros").setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId(`perfil_top_${ownerId}_0`).setLabel("🏆 Top").setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId(`perfil_recompensas_${ownerId}`).setLabel("🎭 Recompensas").setStyle(ButtonStyle.Secondary),
    );
}

async function buildProfileHome(guild, ownerId, targetId) {
    const embed = await nivel.buildProfileEmbed(guild, targetId);
    const saldo = getSaldo(targetId);
    embed.addFields({ name: "💰 Saldo", value: `${saldo.toLocaleString("es")} monedas`, inline: true });
    return { embeds: [embed], components: [perfilNavRow(ownerId, targetId)] };
}

// ─── PANEL CASINO (juegos, stats, historial, ranking) ────────────────────────
function backToPerfilBtn(userId) {
    return new ButtonBuilder().setCustomId(`perfil_profile_${userId}_${userId}`).setLabel("◄ Perfil").setStyle(ButtonStyle.Secondary);
}

function buildHome(userId, username) {
    const stats = getUserStats(userId);
    const saldo = getSaldo(userId);
    const fav = getFavoriteGame(userId);
    const last = getLastGames(userId, 5);

    const winRate = stats.total > 0 ? ((stats.wins / stats.total) * 100).toFixed(1) : "0.0";
    const roi = stats.apostado > 0 ? ((stats.ganancia / stats.apostado) * 100).toFixed(1) : "0.0";
    const netSign = stats.ganancia >= 0 ? "+" : "";
    const roiSign = parseFloat(roi) >= 0 ? "+" : "";

    const parts = [];
    parts.push(`**💰 Saldo:** ${saldo.toLocaleString("es")} monedas`);

    if (stats.total > 0) {
        parts.push(
            "",
            "**── Tus estadísticas ──**",
            `🎮 **${stats.total}** partidas  ·  ✅ **${stats.wins}** victorias  ·  📊 WR **${winRate}%**`,
            `💸 Ganancia neta: **${netSign}${stats.ganancia.toLocaleString("es")}**  ·  ROI: **${roiSign}${roi}%**`,
            `🏆 Mejor jugada: **+${stats.mejor.toLocaleString("es")}**`,
        );
        if (fav) parts.push(`🎲 Juego favorito: ${fav}`);
    } else {
        parts.push("", "_Sin partidas todavía. ¡Elige un juego y empieza!_");
    }

    if (last.length) {
        const lines = last.map((r) => {
            const e = EMOJI[r.juego] || "🎲";
            const icon = r.resultado > 0 ? "✅" : r.resultado < 0 ? "❌" : "🟡";
            const val = r.resultado >= 0 ? `+${r.resultado}` : `${r.resultado}`;
            return `${e} ${icon} **${val}**`;
        });
        parts.push("", "**── Últimas jugadas ──**", lines.join("  ·  "));
    }

    const embed = new EmbedBuilder()
        .setTitle("🎰 Casino — Tu resumen")
        .setDescription(parts.join("\n"))
        .setColor(0xf39c12)
        .setFooter({ text: "El Duende Casino" })
        .setTimestamp();

    const row1 = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId("casino_tragaperras").setLabel("🎰 Tragaperras").setStyle(ButtonStyle.Danger),
        new ButtonBuilder().setCustomId("casino_blackjack").setLabel("🃏 Blackjack").setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId("casino_ruleta").setLabel("🎡 Ruleta").setStyle(ButtonStyle.Danger),
        new ButtonBuilder().setCustomId("casino_adivinar").setLabel("🔮 Adivinar").setStyle(ButtonStyle.Success),
    );
    const row2 = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId("casino_ranking").setLabel("🏆 Ranking").setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId("casino_historial").setLabel("📜 Historial").setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId("casino_stats").setLabel("📊 Mis Stats").setStyle(ButtonStyle.Secondary),
        backToPerfilBtn(userId),
    );

    return { embeds: [embed], components: [row1, row2] };
}

// ─── STATS DETALLADAS ─────────────────────────────────────────────────────────────
function buildStats(userId, username) {
    const stats = getUserStats(userId);
    const winRate = stats.total > 0 ? ((stats.wins / stats.total) * 100).toFixed(1) : "0.0";
    const roi = stats.apostado > 0 ? ((stats.ganancia / stats.apostado) * 100).toFixed(1) : "0.0";

    const byGame = db
        .prepare(
            `
        SELECT juego, COUNT(*) AS p, SUM(resultado) AS g,
               COUNT(CASE WHEN resultado > 0 THEN 1 END) AS w
        FROM casino WHERE userId = ? GROUP BY juego ORDER BY p DESC
    `,
        )
        .all(userId);

    const gameLines = byGame.map((r) => {
        const norm = r.juego === "slots" ? "tragaperras" : r.juego;
        const wr = r.p > 0 ? ((r.w / r.p) * 100).toFixed(0) : "0";
        const sign = r.g >= 0 ? "+" : "";
        return `${EMOJI[norm] || "🎲"} **${norm}**  ${r.p}p  ${sign}${r.g}  WR ${wr}%`;
    });

    const embed = new EmbedBuilder()
        .setTitle(`📊 Estadísticas de ${username}`)
        .addFields(
            {
                name: "Resumen global",
                value:
                    `🎮 Partidas: **${stats.total}**\n` +
                    `✅ Victorias: **${stats.wins}**  ❌ Derrotas: **${stats.losses}**\n` +
                    `📊 Win Rate: **${winRate}%**\n` +
                    `💸 Ganancia neta: **${stats.ganancia >= 0 ? "+" : ""}${stats.ganancia.toLocaleString("es")}**\n` +
                    `📈 ROI: **${roi}%**\n` +
                    `🏆 Mejor jugada: **+${stats.mejor.toLocaleString("es")}**`,
                inline: false,
            },
            {
                name: "Por juego",
                value: gameLines.length ? gameLines.join("\n") : "_Sin datos_",
                inline: false,
            },
        )
        .setColor(0x3498db)
        .setTimestamp();

    return { embeds: [embed], components: [new ActionRowBuilder().addComponents(backBtn())] };
}

// ─── HISTORIAL ───────────────────────────────────────────────────────────────
function buildHistorial(userId) {
    const rows = db
        .prepare(
            `
        SELECT juego, fecha, apuesta, resultado FROM casino
        WHERE userId = ? ORDER BY fecha DESC LIMIT 15
    `,
        )
        .all(userId);

    const lines = rows.map((r) => {
        const norm = r.juego === "slots" ? "tragaperras" : r.juego;
        const e = EMOJI[norm] || "🎲";
        const icon = r.resultado > 0 ? "✅" : r.resultado < 0 ? "❌" : "🟡";
        const val = r.resultado >= 0 ? `+${r.resultado}` : `${r.resultado}`;
        const date = new Date(r.fecha).toLocaleString("es", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
        return `${e} ${icon} **${val}** · apuesta ${r.apuesta} · \`${date}\``;
    });

    const embed = new EmbedBuilder()
        .setTitle("📜 Historial reciente")
        .setDescription(lines.length ? lines.join("\n") : "_Sin partidas todavía._")
        .setColor(0x7f8c8d)
        .setTimestamp();

    return { embeds: [embed], components: [new ActionRowBuilder().addComponents(backBtn())] };
}

// ─── RANKING CASINO ───────────────────────────────────────────────────────────
function buildRanking() {
    const ranking = db
        .prepare(
            `
        SELECT u.nombre, COUNT(c.id) AS partidas, SUM(c.resultado) AS gananciaTotal,
               COUNT(CASE WHEN c.resultado > 0 THEN 1 END) AS victorias
        FROM casino c
        JOIN usuarios u ON c.userId = u.id
        GROUP BY c.userId, u.nombre HAVING partidas >= 5
        ORDER BY gananciaTotal DESC LIMIT 10
    `,
        )
        .all();

    const medals = ["🥇", "🥈", "🥉"];
    const lines = ranking.length
        ? ranking.map((p, i) => {
              const wr = p.partidas > 0 ? ((p.victorias / p.partidas) * 100).toFixed(1) : "0.0";
              const sign = p.gananciaTotal >= 0 ? "+" : "";
              return `${medals[i] || `**${i + 1}.**`} **${p.nombre}** — ${sign}${p.gananciaTotal.toLocaleString("es")} · WR ${wr}%`;
          })
        : ["_No hay suficientes datos todavía (mín. 5 partidas)._"];

    const embed = new EmbedBuilder()
        .setTitle("🏆 Ranking del Casino")
        .setDescription("*Top 10 por ganancia neta — mín. 5 partidas*\n\n" + lines.join("\n"))
        .setColor(0xffd700)
        .setTimestamp();

    return { embeds: [embed], components: [new ActionRowBuilder().addComponents(backBtn())] };
}

// ─── NAV HELPERS CASINO ───────────────────────────────────────────────────────
function backBtn() {
    return new ButtonBuilder().setCustomId("casino_home").setLabel("◄ Casino").setStyle(ButtonStyle.Secondary);
}

module.exports = {
    componentHandlers: [
        { types: ["button"], prefixes: ["perfil_", "casino_"], method: "handleButton", acl: "perfil" },
        { types: ["modal"], ids: ["casino_ruleta_numero_modal"], method: "handleModal", acl: "perfil" },
    ],
    data: new SlashCommandBuilder()
        .setName("perfil")
        .setDescription("Tu perfil completo: nivel, racha, logros, economía y casino")
        .addUserOption((o) => o.setName("usuario").setDescription("Usuario objetivo (opcional)").setRequired(false)),

    async run(client, interaction) {
        const guild = interaction.guild;
        if (!guild) {
            await interaction.reply({ content: "Este comando solo funciona en servidores.", ephemeral: true });
            return;
        }

        xp.ensureGuildDefaults(guild.id);
        const ownerId = interaction.user.id;
        const target = interaction.options.getUser("usuario") || interaction.user;
        const payload = await buildProfileHome(guild, ownerId, target.id);
        await interaction.reply(payload);
    },

    // Handler para botones
    async handleButton(client, interaction) {
        const id = interaction.customId;
        const userId = interaction.user.id;
        const username = interaction.user.username;
        const guild = interaction.guild;

        // ── Navegación unificada del perfil (ownerId embebido en el customId)
        if (id.startsWith("perfil_")) {
            if (!guild) {
                await interaction.reply({ content: "Solo disponible en servidores.", ephemeral: true });
                return;
            }
            const parts = id.split("_");
            const ownerId = parts[2];
            if (ownerId && ownerId !== userId) {
                await interaction.reply({ content: "⛔ Solo quien abrió el panel puede usar estos botones.", ephemeral: true });
                return;
            }

            if (id.startsWith("perfil_profile_")) {
                const targetId = parts[3] || userId;
                await interaction.update(await buildProfileHome(guild, ownerId, targetId));
                return;
            }

            if (id.startsWith("perfil_casino_")) {
                await interaction.update(buildHome(userId, username));
                return;
            }

            if (id.startsWith("perfil_logros_")) {
                const targetId = parts[3] || userId;
                const member = guild.members.cache.get(targetId) || (await guild.members.fetch(targetId).catch(() => null));
                const embed = nivel.buildAchievementsEmbed(guild, targetId, member);
                await interaction.update({ embeds: [embed], components: [perfilNavRow(ownerId, targetId)] });
                return;
            }

            if (id.startsWith("perfil_recompensas_")) {
                const embed = nivel.buildRewardsEmbed(guild);
                await interaction.update({ embeds: [embed], components: [perfilNavRow(ownerId, userId)] });
                return;
            }

            if (id.startsWith("perfil_topprev_") || id.startsWith("perfil_topnext_") || id.startsWith("perfil_top_")) {
                let page = 0;
                if (id.startsWith("perfil_topprev_") || id.startsWith("perfil_topnext_")) {
                    const p = parseInt(parts[3] || "0", 10);
                    const isNext = id.startsWith("perfil_topnext_");
                    page = Math.max(0, p + (isNext ? 1 : -1));
                } else {
                    page = parseInt(parts[3] || "0", 10);
                }

                const embed = await nivel.buildTopEmbed(guild, page);
                const rows = xp.getTop(guild.id, 10, page * 10);
                const canPrev = page > 0;
                const canNext = rows.length === 10;

                const row = new ActionRowBuilder().addComponents(
                    new ButtonBuilder()
                        .setCustomId(`perfil_profile_${ownerId}_${userId}`)
                        .setLabel("👤 Perfil")
                        .setStyle(ButtonStyle.Secondary),
                    new ButtonBuilder()
                        .setCustomId(`perfil_topprev_${ownerId}_${page}`)
                        .setLabel("⏮️")
                        .setStyle(ButtonStyle.Secondary)
                        .setDisabled(!canPrev),
                    new ButtonBuilder()
                        .setCustomId(`perfil_topnext_${ownerId}_${page}`)
                        .setLabel("⏭️")
                        .setStyle(ButtonStyle.Secondary)
                        .setDisabled(!canNext),
                    new ButtonBuilder()
                        .setCustomId(`perfil_logros_${ownerId}_${userId}`)
                        .setLabel("🏅 Logros")
                        .setStyle(ButtonStyle.Secondary),
                    new ButtonBuilder().setCustomId(`perfil_casino_${ownerId}`).setLabel("🎰 Casino").setStyle(ButtonStyle.Secondary),
                );
                await interaction.update({ embeds: [embed], components: [row] });
                return;
            }

            return;
        }

        // ── Flujos existentes del panel de casino (owner-check por metadata del mensaje)
        const ownerId = interaction.message.interaction?.user?.id || interaction.message.interactionMetadata?.user?.id;
        if (ownerId && ownerId !== userId) {
            await interaction.reply({ content: "⛔ Solo quien usó el comando puede interactuar.", ephemeral: true });
            return;
        }

        // ── Home
        if (id === "casino_home" || id === "casino_refresh") {
            await interaction.update(buildHome(userId, username));
            return;
        }

        // ── Stats
        if (id === "casino_stats") {
            await interaction.update(buildStats(userId, username));
            return;
        }

        // ── Historial
        if (id === "casino_historial") {
            await interaction.update(buildHistorial(userId));
            return;
        }

        // ── Ranking
        if (id === "casino_ranking") {
            await interaction.update(buildRanking());
            return;
        }

        // ── Lanzar juegos
        if (id === "casino_tragaperras") {
            await showPickApuesta(interaction, "tragaperras");
            return;
        }
        if (id === "casino_blackjack") {
            await showPickApuesta(interaction, "blackjack");
            return;
        }
        if (id === "casino_ruleta") {
            await showPickRuleta(interaction);
            return;
        }
        if (id === "casino_adivinar") {
            const adivinar = require("../casino/adivinar");
            await adivinar.run(client, makeFakeInteraction(interaction, { apuesta: null }));
            return;
        }

        // ── Docenas sub-picker
        if (id === "casino_pick_ruleta_docenas") {
            const saldoVal = getSaldo(userId);
            const docenas = [
                { label: "1ª Docena  1-12  (×3)", value: "docena_1" },
                { label: "2ª Docena 13-24 (×3)", value: "docena_2" },
                { label: "3ª Docena 25-36 (×3)", value: "docena_3" },
            ];
            const docRow = new ActionRowBuilder().addComponents(
                ...docenas.map((d) =>
                    new ButtonBuilder().setCustomId(`casino_pick_ruleta_${d.value}`).setLabel(d.label).setStyle(ButtonStyle.Secondary),
                ),
            );
            const navRow = new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId("casino_ruleta").setLabel("◄ Tipos").setStyle(ButtonStyle.Secondary),
                backBtn(),
            );
            const embed = new EmbedBuilder()
                .setTitle("🎡 Ruleta — Docenas")
                .setDescription(`💰 Tu saldo: **${saldoVal.toLocaleString("es")}** monedas`)
                .setColor(0xe74c3c);
            await interaction.update({ embeds: [embed], components: [docRow, navRow] });
            return;
        }

        // ── Número exacto → modal
        if (id === "casino_pick_ruleta_numero") {
            const modal = new ModalBuilder().setCustomId("casino_ruleta_numero_modal").setTitle("🎡 Ruleta — Número exacto");
            const input = new TextInputBuilder()
                .setCustomId("casino_ruleta_numero_input")
                .setLabel("Número (0 – 36)")
                .setStyle(TextInputStyle.Short)
                .setMinLength(1)
                .setMaxLength(2)
                .setPlaceholder("Ej: 17")
                .setRequired(true);
            modal.addComponents(new ActionRowBuilder().addComponents(input));
            await interaction.showModal(modal);
            return;
        }

        // ── Pick tipo ruleta  → pick apuesta (casino_pick_ruleta_color_rojo, …)
        if (id.startsWith("casino_pick_ruleta_")) {
            const tipoValor = id.replace("casino_pick_ruleta_", ""); // e.g. "color_rojo"
            const [tipo, valor] = tipoValor.split("_");
            const saldoVal = getSaldo(userId);
            const montos = [50, 100, 500, 1000, 5000];
            const betRow = new ActionRowBuilder().addComponents(
                ...montos.map((m) =>
                    new ButtonBuilder()
                        .setCustomId(`casino_play_ruleta_${m}_${tipo}_${valor}`)
                        .setLabel(`${m.toLocaleString("es")} 💰`)
                        .setStyle(m <= 100 ? ButtonStyle.Secondary : m <= 500 ? ButtonStyle.Primary : ButtonStyle.Danger)
                        .setDisabled(saldoVal < m),
                ),
            );
            const navRow = new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId("casino_ruleta").setLabel("◄ Cambiar tipo").setStyle(ButtonStyle.Secondary),
                backBtn(),
            );
            const embed = new EmbedBuilder()
                .setTitle("🎡 Ruleta — Elige tu apuesta")
                .setDescription(`Tipo: **${tipo} ${valor}**\n💰 Tu saldo: **${saldoVal.toLocaleString("es")}**`)
                .setColor(0xe74c3c);
            await interaction.update({ embeds: [embed], components: [betRow, navRow] });
            return;
        }

        // ── Pick apuesta genérico  (casino_pick_{juego})
        if (id.startsWith("casino_pick_")) {
            const juego = id.replace("casino_pick_", "");
            await showPickApuesta(interaction, juego);
            return;
        }

        // ── Ejecutar juego  (casino_play_{juego}_{apuesta} | casino_play_ruleta_{apuesta}_{tipo}_{valor})
        if (id.startsWith("casino_play_")) {
            const parts = id.replace("casino_play_", "").split("_");
            const juego = parts[0];
            const apuesta = parseInt(parts[1]);

            if (juego === "tragaperras") {
                const slots = require("../casino/tragaperras");
                await slots.run(client, makeFakeInteraction(interaction, { apuesta }));
                return;
            }
            if (juego === "blackjack") {
                const blackjack = require("../casino/blackjack");
                await blackjack.run(client, makeFakeInteraction(interaction, { apuesta }));
                return;
            }
            if (juego === "ruleta") {
                // casino_play_ruleta_{apuesta}_{tipo}_{valor}
                const tipo = parts[2] || "color";
                const valor = parts[3] || "rojo";
                const ruleta = require("../casino/ruleta");
                await ruleta.run(client, makeFakeInteraction(interaction, { apuesta, tipo: `${tipo}:${valor}`, numero: null }));
                return;
            }
            if (juego === "adivinar") {
                const adivinar = require("../casino/adivinar");
                await adivinar.run(client, makeFakeInteraction(interaction, { apuesta: null }));
                return;
            }
        }
    },

    async handleModal(client, interaction) {
        if (interaction.customId !== "casino_ruleta_numero_modal") return;
        const userId = interaction.user.id;
        const raw = interaction.fields.getTextInputValue("casino_ruleta_numero_input").trim();
        const n = parseInt(raw);

        if (isNaN(n) || n < 0 || n > 36) {
            await interaction.reply({ content: "❌ El número debe estar entre **0** y **36**.", ephemeral: true });
            return;
        }

        const saldoVal = getSaldo(userId);
        const montos = [50, 100, 500, 1000, 5000];
        const betRow = new ActionRowBuilder().addComponents(
            ...montos.map((m) =>
                new ButtonBuilder()
                    .setCustomId(`casino_play_ruleta_${m}_numero_${n}`)
                    .setLabel(`${m.toLocaleString("es")} 💰`)
                    .setStyle(m <= 100 ? ButtonStyle.Secondary : m <= 500 ? ButtonStyle.Primary : ButtonStyle.Danger)
                    .setDisabled(saldoVal < m),
            ),
        );
        const navRow = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId("casino_ruleta").setLabel("◄ Cambiar tipo").setStyle(ButtonStyle.Secondary),
            backBtn(),
        );
        const embed = new EmbedBuilder()
            .setTitle("🎡 Ruleta — Número exacto")
            .setDescription(`Número: **${n}** (×36)\n💰 Tu saldo: **${saldoVal.toLocaleString("es")}**`)
            .setColor(0xe74c3c);

        await interaction.deferUpdate();
        await interaction.editReply({ embeds: [embed], components: [betRow, navRow] });
    },
};

// ── Bet picker ────────────────────────────────────────────────────────────────

async function showPickApuesta(interaction, juego) {
    const userId = interaction.user.id;
    const emojiMap = { blackjack: "🃏", tragaperras: "🎰", ruleta: "🎡", adivinar: "🔮" };
    const emoji = emojiMap[juego] || "🎲";
    const saldoVal = getSaldo(userId);
    const montos = [50, 100, 500, 1000, 5000];

    const betRow = new ActionRowBuilder().addComponents(
        ...montos.map((m) =>
            new ButtonBuilder()
                .setCustomId(`casino_play_${juego}_${m}`)
                .setLabel(`${m.toLocaleString("es")} 💰`)
                .setStyle(m <= 100 ? ButtonStyle.Secondary : m <= 500 ? ButtonStyle.Primary : ButtonStyle.Danger)
                .setDisabled(saldoVal < m),
        ),
    );
    const navRow = new ActionRowBuilder().addComponents(backBtn());

    const embed = new EmbedBuilder()
        .setTitle(`${emoji} ${juego.charAt(0).toUpperCase() + juego.slice(1)} — Elige tu apuesta`)
        .setDescription(`💰 Tu saldo: **${saldoVal.toLocaleString("es")}** monedas\n\nPulsa la cantidad que quieres apostar:`)
        .setColor(0xf39c12);

    await interaction.update({ embeds: [embed], components: [betRow, navRow] });
}

async function showPickRuleta(interaction) {
    const userId = interaction.user.id;
    const saldoVal = getSaldo(userId);

    const tipos = [
        { label: "🔴 Rojo (×2)", value: "color_rojo" },
        { label: "⚫ Negro (×2)", value: "color_negro" },
        { label: "Par (×2)", value: "paridad_par" },
        { label: "Impar (×2)", value: "paridad_impar" },
        { label: "Bajo 1-18 (×2)", value: "mitad_bajo" },
        { label: "Alto 19-36 (×2)", value: "mitad_alto" },
        { label: "🎲 Docenas (×3)", value: "docenas" },
        { label: "🔢 Número exacto (×36)", value: "numero" },
    ];

    const mkBtn = (t) => new ButtonBuilder().setCustomId(`casino_pick_ruleta_${t.value}`).setLabel(t.label).setStyle(ButtonStyle.Secondary);

    const tipoRow1 = new ActionRowBuilder().addComponents(tipos.slice(0, 4).map(mkBtn));
    const tipoRow2 = new ActionRowBuilder().addComponents(tipos.slice(4).map(mkBtn));
    const navRow = new ActionRowBuilder().addComponents(backBtn());

    const embed = new EmbedBuilder()
        .setTitle("🎡 Ruleta — Elige tipo de apuesta")
        .setDescription(`💰 Tu saldo: **${saldoVal.toLocaleString("es")}** monedas\n\nSelecciona el tipo antes de elegir cantidad:`)
        .setColor(0xe74c3c);

    await interaction.update({ embeds: [embed], components: [tipoRow1, tipoRow2, navRow] });
}

// ── Fake interaction ──────────────────────────────────────────────────────────
// Adapta reply/deferReply a update/deferUpdate para que los juegos
// editen el mensaje del panel en lugar de crear uno nuevo.

function makeFakeInteraction(interaction, optionsMap) {
    let replied = false;
    return {
        ...interaction,
        options: {
            getInteger: (name) => (optionsMap[name] !== undefined ? optionsMap[name] : null),
            getString: (name) => (optionsMap[name] !== undefined ? optionsMap[name] : null),
            getBoolean: (name) => (optionsMap[name] !== undefined ? optionsMap[name] : null),
        },
        reply: async (payload) => {
            if (!replied) {
                replied = true;
                return interaction.update(payload);
            }
            return interaction.followUp({ ...payload, ephemeral: true });
        },
        editReply: async (payload) => interaction.editReply(payload),
        deferReply: async () => interaction.deferUpdate(),
        followUp: async (payload) => interaction.followUp(payload),
    };
}
