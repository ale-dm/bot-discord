const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require("discord.js");
const achievements = require("../../systems/achievementsSystem");

function progressBar(progress, target) {
    const ratio = target > 0 ? Math.max(0, Math.min(1, progress / target)) : 0;
    const filled = Math.round(ratio * 10);
    return `${"█".repeat(filled)}${"░".repeat(10 - filled)} ${Math.floor(ratio * 100)}%`;
}

function buildLogrosPayload(guildId, userId, page = 0, includeHidden = false) {
    const list = achievements.listUserAchievements(guildId, userId, { includeHidden });
    const summary = achievements.getSummary(guildId, userId);

    const pageSize = 6;
    const maxPage = Math.max(0, Math.ceil(list.length / pageSize) - 1);
    const safePage = Math.max(0, Math.min(maxPage, Number(page) || 0));
    const start = safePage * pageSize;
    const slice = list.slice(start, start + pageSize);

    const desc = slice.length
        ? slice
              .map((a) => {
                  if (a.hidden && !a.completed && !includeHidden) return "❓ **Logro secreto**";
                  const status = a.completed ? (a.claimable ? "🎁" : "✅") : "⏳";
                  const p = Math.min(a.progress, a.target);
                  return `${status} **${a.name}** (${a.category})\n${a.desc}\n${progressBar(p, a.target)}\n`;
              })
              .join("\n")
        : "No hay logros en esta vista.";

    const embed = new EmbedBuilder()
        .setTitle("🏅 Tus Logros")
        .setDescription(desc)
        .addFields(
            { name: "Completados", value: `${summary.completed}/${summary.total} (${summary.completionPct}%)`, inline: true },
            { name: "Pendientes de reclamar", value: String(summary.claimable), inline: true },
            { name: "Página", value: `${safePage + 1}/${maxPage + 1}`, inline: true },
        )
        .setColor(0xf1c40f)
        .setTimestamp();

    const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId(`logros_page_${safePage - 1}`)
            .setLabel("◀")
            .setStyle(ButtonStyle.Secondary)
            .setDisabled(safePage <= 0),
        new ButtonBuilder().setCustomId("logros_refresh").setLabel("🔄 Refrescar").setStyle(ButtonStyle.Primary),
        new ButtonBuilder()
            .setCustomId(`logros_page_${safePage + 1}`)
            .setLabel("▶")
            .setStyle(ButtonStyle.Secondary)
            .setDisabled(safePage >= maxPage),
        new ButtonBuilder().setCustomId("logros_claim_all").setLabel("🎁 Reclamar todo").setStyle(ButtonStyle.Success),
        new ButtonBuilder()
            .setCustomId("logros_toggle_hidden")
            .setLabel(includeHidden ? "🙈 Ocultar secretos" : "👁️ Ver secretos")
            .setStyle(ButtonStyle.Secondary),
    );

    return { embeds: [embed], components: [row], meta: { page: safePage, includeHidden } };
}

module.exports = {
    componentHandlers: [{ types: ["button"], prefixes: ["logros_"], method: "handleButton" }],
    data: new SlashCommandBuilder()
        .setName("logros")
        .setDescription("Ver y reclamar logros")
        .addSubcommand((sub) => sub.setName("ver").setDescription("Ver tus logros"))
        .addSubcommand((sub) =>
            sub
                .setName("reclamar")
                .setDescription("Reclamar recompensa de un logro")
                .addStringOption((o) => o.setName("id").setDescription("ID del logro").setRequired(true)),
        )
        .addSubcommand((sub) => sub.setName("reclamar_todo").setDescription("Reclamar todas las recompensas pendientes"))
        .addSubcommand((sub) => sub.setName("top").setDescription("Ranking de logros completados")),

    async run(client, interaction) {
        const sub = interaction.options.getSubcommand();
        const guildId = interaction.guildId;
        const userId = interaction.user.id;

        if (sub === "ver") {
            const payload = buildLogrosPayload(guildId, userId, 0, false);
            await interaction.reply({ embeds: payload.embeds, components: payload.components, ephemeral: true });
            return;
        }

        if (sub === "reclamar") {
            const id = interaction.options.getString("id").trim();
            const result = achievements.claimAchievement(guildId, userId, id);
            if (!result.ok) {
                await interaction.reply({ content: `❌ ${result.msg}`, ephemeral: true });
                return;
            }
            await interaction.reply({
                content: `✅ Reclamaste **${result.achievement.name}** y ganaste **${result.reward} 🪙**.`,
                ephemeral: true,
            });
            return;
        }

        if (sub === "reclamar_todo") {
            const result = achievements.claimAll(guildId, userId);
            if (!result.ok) {
                await interaction.reply({ content: `❌ ${result.msg}`, ephemeral: true });
                return;
            }
            await interaction.reply({ content: `✅ Reclamaste **${result.count}** logros por **${result.reward} 🪙**.`, ephemeral: true });
            return;
        }

        if (sub === "top") {
            const top = achievements.getTopUsers(guildId, 10);
            const lines = top.length
                ? top.map((u, i) => `${i + 1}. <@${u.userId}> — **${u.completed}** completados (${u.claimed} reclamados)`).join("\n")
                : "Sin datos todavía.";
            const embed = new EmbedBuilder().setTitle("🏆 Top Logros").setDescription(lines).setColor(0xf39c12).setTimestamp();
            await interaction.reply({ embeds: [embed], ephemeral: true });
        }
    },

    async handleButton(client, interaction) {
        const ownerId = interaction.message.interaction?.user?.id || interaction.message.interactionMetadata?.user?.id;
        if (ownerId && ownerId !== interaction.user.id) {
            await interaction.reply({ content: "⛔ Solo quien abrió el panel puede usar estos botones.", ephemeral: true });
            return;
        }

        const id = interaction.customId;
        const guildId = interaction.guildId;
        const userId = interaction.user.id;

        const includeHidden =
            interaction.message.components?.[0]?.components?.some(
                (c) => c.customId === "logros_toggle_hidden" && String(c.label || "").includes("Ocultar"),
            ) || false;

        if (id === "logros_refresh") {
            const payload = buildLogrosPayload(guildId, userId, 0, includeHidden);
            await interaction.update({ embeds: payload.embeds, components: payload.components });
            return;
        }

        if (id.startsWith("logros_page_")) {
            const page = parseInt(id.replace("logros_page_", ""), 10);
            const payload = buildLogrosPayload(guildId, userId, Number.isFinite(page) ? page : 0, includeHidden);
            await interaction.update({ embeds: payload.embeds, components: payload.components });
            return;
        }

        if (id === "logros_claim_all") {
            const claim = achievements.claimAll(guildId, userId);
            const payload = buildLogrosPayload(guildId, userId, 0, includeHidden);
            const msg = claim.ok ? `✅ Reclamaste ${claim.count} logros por ${claim.reward} 🪙.` : `❌ ${claim.msg}`;
            await interaction.update({ content: msg, embeds: payload.embeds, components: payload.components });
            return;
        }

        if (id === "logros_toggle_hidden") {
            const payload = buildLogrosPayload(guildId, userId, 0, !includeHidden);
            await interaction.update({ embeds: payload.embeds, components: payload.components });
            return;
        }
    },
};
