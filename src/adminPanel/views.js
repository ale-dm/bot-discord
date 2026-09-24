const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require("discord.js");
const db = require("../core/db");
const xp = require("../systems/xpSystem");
const { fmt } = require("./common");

function buildMainRows() {
    const row1 = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId("paneladmin_bank_modificar").setLabel("✏️ Modificar saldo").setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId("paneladmin_bank_resetear").setLabel("🔄 Resetear usuario").setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId("paneladmin_bank_borrarhistorial").setLabel("🗑️ Borrar historial").setStyle(ButtonStyle.Danger),
        new ButtonBuilder().setCustomId("paneladmin_bank_historialglobal").setLabel("📜 Historial global").setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId("paneladmin_bank_buscarusuario").setLabel("🔎 Buscar usuario").setStyle(ButtonStyle.Primary),
    );
    const row2 = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId("paneladmin_levels_home").setLabel("📈 Niveles / XP").setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId("paneladmin_cfg_home").setLabel("⚙️ Config Global").setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId("paneladmin_audit").setLabel("🧾 Auditoría").setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId("paneladmin_plex_home").setLabel("🎬 Plex").setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId("paneladmin_seerr_home").setLabel("🍿 Seerr").setStyle(ButtonStyle.Secondary),
    );
    return [row1, row2];
}

function buildMainEmbed(client) {
    const totalUsuarios = db.prepare("SELECT COUNT(*) as total FROM banco").get().total || 0;
    const totalBanco = db.prepare("SELECT SUM(saldo) as total FROM banco").get().total || 0;
    const totalEnMano = db.prepare("SELECT SUM(enMano) as total FROM banco").get().total || 0;
    const movimientos = db.prepare("SELECT COUNT(*) as total FROM historial").get().total || 0;

    return new EmbedBuilder()
        .setTitle("🛠️ Panel Admin")
        .setDescription(
            "Resumen general del sistema.\n\n" +
                "• Banco: saldo, reseteos, historial y búsqueda.\n" +
                "• Niveles: configuración XP, recompensas por rol, usuarios e ignorados.\n" +
                "• Config Global: Duende IA, Cripto, Casino, Tienda y ACL de comandos.",
        )
        .addFields(
            { name: "👥 Usuarios banco", value: fmt(totalUsuarios), inline: true },
            { name: "🏦 Total banco", value: `${fmt(totalBanco)} monedas`, inline: true },
            { name: "🪙 Total en mano", value: `${fmt(totalEnMano)} monedas`, inline: true },
            { name: "📜 Movimientos", value: fmt(movimientos), inline: true },
        )
        .setColor(0x3498db)
        .setFooter({ text: "Solo admins", iconURL: client.user.displayAvatarURL() })
        .setTimestamp();
}

function buildXpHome(guildId) {
    const cfg = xp.getAllConfig(guildId);
    const rewards = xp.getRewards(guildId);
    const ignored = xp.getIgnoredChannels(guildId);

    return new EmbedBuilder()
        .setTitle("📈 Panel Niveles / XP")
        .setDescription("Configura aquí todo lo de niveles.")
        .addFields(
            { name: "📝 XP mensaje", value: `${cfg.xp_message_base} (+max ${cfg.xp_message_len_bonus_max})`, inline: true },
            { name: "🎙️ XP voz/min", value: `${cfg.xp_voice_per_min}`, inline: true },
            { name: "⚡ Multiplicador", value: `x${cfg.xp_multiplier}`, inline: true },
            { name: "⏱️ Cooldown", value: `${cfg.xp_message_cooldown_sec}s`, inline: true },
            { name: "🎭 Recompensas", value: `${rewards.length}`, inline: true },
            { name: "🚫 Ignorados", value: `${ignored.length}`, inline: true },
            {
                name: "📢 Anuncios",
                value: cfg.xp_announce_channel_id ? `<#${cfg.xp_announce_channel_id}>` : "No configurado",
                inline: true,
            },
            {
                name: "🧮 Fórmula",
                value: `${cfg.xp_formula_base} × (N+1)^${cfg.xp_formula_exp} × ${cfg.xp_level_cost_multiplier} × ${cfg.xp_level_requirement_multiplier}`,
                inline: true,
            },
            {
                name: "🔥 Racha",
                value:
                    cfg.streak_enabled === "0"
                        ? "Desactivada"
                        : `+${cfg.streak_bonus_pct_per_day}%/día (máx +${cfg.streak_bonus_cap_pct}%)`,
                inline: true,
            },
        )
        .setColor(0x6c5ce7)
        .setTimestamp();
}

function levelsHomeRows() {
    const row1 = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId("paneladmin_levels_config").setLabel("⚙️ Config").setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId("paneladmin_levels_rewards").setLabel("🎭 Recompensas").setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId("paneladmin_levels_users").setLabel("👤 Usuarios").setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId("paneladmin_levels_ignored").setLabel("🚫 Ignorados").setStyle(ButtonStyle.Secondary),
    );
    const row2 = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId("paneladmin_levels_home").setLabel("🔄 Refrescar").setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId("paneladmin_home").setLabel("◀ Panel principal").setStyle(ButtonStyle.Secondary),
    );
    return [row1, row2];
}

module.exports = { buildMainRows, buildMainEmbed, buildXpHome, levelsHomeRows };
