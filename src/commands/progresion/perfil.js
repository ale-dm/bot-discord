// /perfil [usuario] [seccion]: todo lo tuyo (o de otra persona, que también se ve entero) en pestañas:
// 👤 Perfil · 💰 Economía · 🎲 Juegos · 🏅 Logros · 🏆 Rankings (y 🍿 Plex, desde 👤 Perfil: una fila de botones no
// admite una sexta pestaña). Sustituye a /nivel, /logros y /banco.
// Las acciones (ingresar, sacar, transferir, reclamar logros) solo salen en tu propio perfil. Los ids llevan
// quién mira (owner, posición [2]) y de quién es el perfil (target). Las pantallas están en src/paneles.
const { SlashCommandBuilder, MessageFlags } = require("discord.js");
const xp = require("../../systems/xpSystem");
const achievements = require("../../systems/achievementsSystem");
const perfil = require("../../paneles/perfil");
const economia = require("../../paneles/economia");

async function nombreDe(interaction, userId) {
    if (userId === interaction.user.id) return interaction.user.username;
    const member = interaction.guild?.members?.cache?.get(userId) || (await interaction.guild?.members?.fetch?.(userId).catch(() => null));
    return member?.user?.username || (await interaction.client?.users?.fetch?.(userId).catch(() => null))?.username || userId;
}

// La pantalla de una pestaña. `extra`: página, secretos y filtro (logros), o tipo y página (rankings).
async function pantalla(interaction, seccion, ownerId, targetId, extra = {}) {
    const guild = interaction.guild;
    switch (seccion) {
        case "eco":
            return economia.buildEconomia({
                viewerId: ownerId,
                targetId,
                nombre: await nombreDe(interaction, targetId),
                guildId: guild.id,
            });
        case "juegos":
            return require("../../paneles/casino").buildHome(ownerId, guild.id);
        case "logros":
            return perfil.buildLogros(guild.id, ownerId, targetId, extra.page || 0, Boolean(extra.secretos), extra.filtro);
        case "rankings":
            return perfil.buildRankings(guild, ownerId, targetId, extra.tipo || "nivel", extra.page || 0);
        case "recompensas":
            return perfil.buildRecompensas(guild, ownerId, targetId);
        case "plex":
            return perfil.buildPlex(guild, ownerId, targetId);
        default:
            return perfil.buildPerfil(guild, ownerId, targetId);
    }
}

// Botones de mensajes de antes (del /perfil anterior, de /nivel y de /logros): a su pestaña nueva.
function traducirAntiguo(id, userId) {
    const p = id.split("_");
    if (id.startsWith("nivel_")) {
        if (id.startsWith("nivel_top")) return { seccion: "rankings", target: userId };
        if (id.startsWith("nivel_logros_")) return { seccion: "logros", target: p[3] || userId };
        if (id.startsWith("nivel_eco_")) return { seccion: "eco", target: p[3] || userId };
        if (id.startsWith("nivel_rewards_")) return { seccion: "recompensas", target: userId };
        return { seccion: "perfil", target: p[3] || userId };
    }
    if (id.startsWith("logros_")) return { seccion: "logros", target: userId };
    if (id.startsWith("perfil_profile_")) return { seccion: "perfil", target: p[3] || userId };
    if (id.startsWith("perfil_casino_")) return { seccion: "juegos", target: userId };
    if (id.startsWith("perfil_top")) return { seccion: "rankings", target: userId, extra: { tipo: "nivel", page: 0 } };
    if (id.startsWith("perfil_recompensas_") && p.length === 3) return { seccion: "recompensas", target: p[2] };
    if (id.startsWith("perfil_logros_") && p.length === 4) return { seccion: "logros", target: p[3] };
    return null;
}

module.exports = {
    componentHandlers: [
        { types: ["button"], prefixes: ["perfil_", "nivel_", "logros_"], method: "handleButton", acl: "perfil" },
        {
            types: ["stringSelect"],
            prefixes: ["perfil_ranksel_", "perfil_reclamar_", "perfil_logrosfiltro_", "logros_"],
            method: "handleSelect",
            acl: "perfil",
        },
    ],
    data: new SlashCommandBuilder()
        .setName("perfil")
        .setDescription("Tu perfil (o el de otra persona): nivel, economía, juegos, logros y rankings")
        .addUserOption((o) => o.setName("usuario").setDescription("De quién (por defecto, el tuyo)").setRequired(false))
        .addStringOption((o) =>
            o
                .setName("seccion")
                .setDescription("Por dónde empezar")
                .addChoices(
                    { name: "👤 Perfil", value: "perfil" },
                    { name: "💰 Economía", value: "eco" },
                    { name: "🏅 Logros", value: "logros" },
                    { name: "🏆 Rankings", value: "rankings" },
                    { name: "🍿 Plex", value: "plex" },
                )
                .setRequired(false),
        ),

    async run(client, interaction) {
        if (!interaction.guild) {
            await interaction.reply({ content: "Este comando solo funciona en servidores.", flags: MessageFlags.Ephemeral });
            return;
        }
        xp.ensureGuildDefaults(interaction.guild.id);
        require("../../systems/casinoTransactions").registrarUsuario(interaction.user.id, interaction.user.username, interaction.user.tag);
        const target = interaction.options.getUser("usuario") || interaction.user;
        const seccion = interaction.options.getString("seccion") || "perfil";
        await interaction.reply(await pantalla(interaction, seccion, interaction.user.id, target.id));
    },

    async handleButton(client, interaction) {
        const id = interaction.customId;
        const userId = interaction.user.id;
        if (!interaction.guild) {
            await interaction.reply({ content: "Solo disponible en servidores.", flags: MessageFlags.Ephemeral });
            return;
        }
        // Quién abrió el panel: en los ids nuevos va en [2]; en los antiguos, la metadata del mensaje.
        const parts = id.split("_");
        const antiguo = traducirAntiguo(id, userId);
        const ownerId = antiguo
            ? interaction.message?.interaction?.user?.id || interaction.message?.interactionMetadata?.user?.id || userId
            : parts[2];
        if (ownerId && ownerId !== userId) {
            await interaction.reply({ content: "⛔ Solo quien abrió el panel puede usar estos botones.", flags: MessageFlags.Ephemeral });
            return;
        }
        if (antiguo) {
            await interaction.update(await pantalla(interaction, antiguo.seccion, userId, antiguo.target, antiguo.extra));
            return;
        }

        const [, accion, , targetId] = parts;
        // perfil_plexoculto_{o}_{t}_{1|0}: ocultar (1) o enseñar (0) tus logros de Plex.
        if (accion === "plexoculto") {
            const ocultar = parts[4] === "1";
            require("../../systems/plexTrofeos").setOculto(interaction.guildId, userId, ocultar);
            const payload = perfil.buildLogros(interaction.guildId, userId, userId);
            await interaction.update({
                ...payload,
                content: ocultar
                    ? "🙈 Tus logros de Plex ya no se anuncian ni los ven los demás en tu perfil."
                    : "🍿 Tus logros de Plex vuelven a anunciarse y a verse en tu perfil.",
            });
            return;
        }
        // perfil_reclamartodo_{o}_{t}_{filtro}: el filtro se mantiene (los mensajes de antes no lo llevan).
        if (accion === "reclamartodo") {
            const r = achievements.claimAll(interaction.guildId, userId);
            const payload = perfil.buildLogros(interaction.guildId, userId, userId, 0, false, parts[4]);
            await interaction.update({ ...payload, content: r.ok ? `✅ Reclamaste ${r.count} logros por ${r.reward} 🪙.` : `❌ ${r.msg}` });
            return;
        }
        // perfil_logros_{o}_{t}_{página}_{secretos}[_{filtro}] · perfil_rank_{o}_{t}_{tipo}_{página} · perfil_plex_{o}_{t}
        const extra =
            accion === "logros"
                ? {
                      page: Math.max(0, parseInt(parts[4], 10) || 0),
                      secretos: parts[5] === "1",
                      filtro: parts[6] && parts[6] !== "tab" ? parts[6] : "todos",
                  }
                : accion === "rank"
                  ? { tipo: parts[4], page: Math.max(0, parseInt(parts[5], 10) || 0) }
                  : {};
        const seccion = { ver: "perfil", rank: "rankings" }[accion] || accion;
        await interaction.update(await pantalla(interaction, seccion, userId, targetId, extra));
    },

    async handleSelect(client, interaction) {
        const userId = interaction.user.id;
        const id = interaction.customId;
        const parts = id.split("_");
        const ownerId = id.startsWith("logros_") ? userId : parts[2];
        if (ownerId !== userId) {
            await interaction.reply({ content: "⛔ Solo quien abrió el panel puede usar estos botones.", flags: MessageFlags.Ephemeral });
            return;
        }
        if (id.startsWith("perfil_ranksel_")) {
            await interaction.update(await pantalla(interaction, "rankings", userId, parts[3], { tipo: interaction.values[0] }));
            return;
        }
        // perfil_logrosfiltro_{o}_{t}_{secretos}: qué logros ver (vuelve a la página 1).
        if (id.startsWith("perfil_logrosfiltro_")) {
            await interaction.update(
                await pantalla(interaction, "logros", userId, parts[3], {
                    page: 0,
                    secretos: parts[4] === "1",
                    filtro: interaction.values[0],
                }),
            );
            return;
        }
        // Reclamar un logro (perfil_reclamar_{o}_{t}_{filtro}, o logros_reclamar de mensajes antiguos): solo el tuyo.
        const r = achievements.claimAchievement(interaction.guildId, userId, interaction.values[0]);
        const filtro = id.startsWith("perfil_reclamar_") ? parts[4] : undefined;
        const payload = perfil.buildLogros(interaction.guildId, userId, userId, 0, false, filtro);
        const pct = achievements.porcentajeImportacion(interaction.guildId);
        const deImportacion = r.importado && pct < 100 ? ` (📼 de la importación de Plex: el ${pct} % de las monedas)` : "";
        await interaction.update({
            ...payload,
            content: r.ok ? `✅ Reclamaste **${r.achievement.name}** y ganaste **${r.reward} 🪙**${deImportacion}.` : `❌ ${r.msg}`,
        });
    },
};
