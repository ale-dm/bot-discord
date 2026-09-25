// /perfil: nivel, racha, logros, top y recompensas. El botón 🎰 Casino abre la pestaña Casino de /juegos
// en el mismo mensaje (sus botones los atiende /juegos). Los mensajes del perfil están en /nivel.
const { SlashCommandBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags } = require("discord.js");
const xp = require("../../systems/xpSystem");
const casino = require("../../paneles/casino");
const nivel = require("./nivel");

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
    const saldo = casino.getSaldo(targetId);
    embed.addFields({ name: "💰 Saldo", value: `${saldo.toLocaleString("es")} monedas`, inline: true });
    return { embeds: [embed], components: [perfilNavRow(ownerId, targetId)] };
}

module.exports = {
    componentHandlers: [{ types: ["button"], prefixes: ["perfil_"], method: "handleButton", acl: "perfil" }],
    data: new SlashCommandBuilder()
        .setName("perfil")
        .setDescription("Tu perfil completo: nivel, racha, logros, economía y casino")
        .addUserOption((o) => o.setName("usuario").setDescription("Usuario objetivo (opcional)").setRequired(false)),

    async run(client, interaction) {
        const guild = interaction.guild;
        if (!guild) {
            await interaction.reply({ content: "Este comando solo funciona en servidores.", flags: MessageFlags.Ephemeral });
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
        const guild = interaction.guild;

        // ── Navegación unificada del perfil (ownerId embebido en el customId)
        if (id.startsWith("perfil_")) {
            if (!guild) {
                await interaction.reply({ content: "Solo disponible en servidores.", flags: MessageFlags.Ephemeral });
                return;
            }
            const parts = id.split("_");
            const ownerId = parts[2];
            if (ownerId && ownerId !== userId) {
                await interaction.reply({
                    content: "⛔ Solo quien abrió el panel puede usar estos botones.",
                    flags: MessageFlags.Ephemeral,
                });
                return;
            }

            if (id.startsWith("perfil_profile_")) {
                const targetId = parts[3] || userId;
                await interaction.update(await buildProfileHome(guild, ownerId, targetId));
                return;
            }

            if (id.startsWith("perfil_casino_")) {
                await interaction.update(casino.buildHome(userId));
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
    },
};
