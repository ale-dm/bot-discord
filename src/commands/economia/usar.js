const { SlashCommandBuilder, EmbedBuilder, MessageFlags } = require("discord.js");
const db = require("../../core/db");
const dinero = require("../../systems/dinero");
const { createLogger } = require("../../core/logger");

const log = createLogger("Objetos");

/**
 * Aplica el efecto de un objeto al usuario que lo usa.
 * Devuelve { ok, mensaje } donde mensaje describe qué pasó.
 */
async function aplicarEfecto(obj, userId, member, guild) {
    const tipo = (obj.tipo || "").toLowerCase();
    const efecto = obj.efecto || "";

    // --- ROL: asignar rol de Discord ---
    if (tipo === "rol") {
        // Buscar por rolId (ID de Discord) o por nombre del objeto
        let role = obj.rolId ? guild.roles.cache.get(obj.rolId) : null;
        if (!role) role = guild.roles.cache.find((r) => r.name.toLowerCase() === obj.nombre.toLowerCase());
        if (!role) return { ok: false, mensaje: "❌ No se encontró el rol de Discord correspondiente." };

        if (member.roles.cache.has(role.id)) {
            return { ok: false, mensaje: `❌ Ya tienes el rol **${role.name}**.` };
        }
        await member.roles.add(role);
        return { ok: true, mensaje: `🎭 Se te ha asignado el rol **${role.name}**.` };
    }

    // --- CONSUMIBLE: efecto definido en campo "efecto" ---
    // Formato: "monedas:500" | "xp:100" | "mensaje:Texto personalizado"
    if (tipo === "consumible") {
        if (efecto.startsWith("monedas:")) {
            const cantidad = parseInt(efecto.split(":")[1]) || 0;
            // Al 💵 efectivo (systems/dinero; crea la cuenta si no la tenía).
            dinero.pagar(userId, cantidad);
            dinero.apuntar(userId, "objeto", `Efecto consumible: ${obj.nombre}`, cantidad);
            return { ok: true, mensaje: `🪙 ¡Has recibido **${cantidad} monedas**!` };
        }
        if (efecto.startsWith("mensaje:")) {
            const texto = efecto.slice("mensaje:".length);
            return { ok: true, mensaje: `✨ ${texto}` };
        }
        // Sin efecto definido — al menos consume el objeto
        return { ok: true, mensaje: `✅ Has usado **${obj.nombre}**.` };
    }

    return { ok: false, mensaje: "⚠️ Este objeto no tiene un efecto definido." };
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName("usar")
        .setDescription("Usa un objeto de tu inventario")
        .addIntegerOption((opt) => opt.setName("id").setDescription("ID del objeto a usar").setRequired(true)),

    async run(client, interaction) {
        const objetoId = interaction.options.getInteger("id");
        const userId = interaction.user.id;
        db.prepare(`INSERT OR IGNORE INTO usuarios (id, nombre, tag, fechaRegistro) VALUES (?, ?, ?, ?)`).run(
            userId,
            interaction.user.username,
            interaction.user.tag,
            new Date().toISOString(),
        );

        const obj = db
            .prepare(
                `
            SELECT objeto.*, inventario.id as inventarioId
            FROM inventario
            JOIN objeto ON inventario.itemId = objeto.id
            WHERE inventario.userId = ? AND objeto.id = ?
            ORDER BY inventario.id ASC LIMIT 1
        `,
            )
            .get(userId, objetoId);

        if (!obj) {
            const replyFn =
                interaction.replied || interaction.deferred ? interaction.editReply.bind(interaction) : interaction.reply.bind(interaction);
            await replyFn({ content: "❌ No tienes ese objeto en tu inventario.", flags: MessageFlags.Ephemeral });
            return;
        }

        const tipo = (obj.tipo || "").toLowerCase();
        const esConsumible = tipo === "consumible";

        // Para consumibles eliminamos ANTES de aplicar (evita doble uso)
        if (esConsumible) {
            db.prepare("DELETE FROM inventario WHERE id = ?").run(obj.inventarioId);
        }

        // Si el efecto lanza (p. ej. sin permiso para dar el rol), antes el consumible ya
        // borrado se perdía: ahora cuenta como fallo y se devuelve al inventario.
        let ok;
        let mensaje;
        try {
            ({ ok, mensaje } = await aplicarEfecto(obj, userId, interaction.member, interaction.guild));
        } catch (e) {
            log.error(`Error aplicando el efecto de "${obj.nombre}" (#${obj.id}) para ${userId}:`, e);
            ok = false;
            mensaje = "⚠️ Ha fallado al aplicar el efecto. No has perdido el objeto.";
        }
        log.info(
            `${interaction.user.tag} (${userId}) usó "${obj.nombre}" (#${obj.id}, ${tipo || "sin tipo"}): ${ok ? "ok" : "falló"} · ${mensaje}`,
        );

        // Si el consumible falló, devolvemos el objeto
        if (esConsumible && !ok) {
            db.prepare("INSERT INTO inventario (userId, itemId, fecha) VALUES (?, ?, ?)").run(userId, obj.id, new Date().toISOString());
        }

        const embed = new EmbedBuilder()
            .setTitle(ok ? "✅ Objeto usado" : "❌ No se pudo usar")
            .setDescription(`**${obj.nombre}**\n\n${mensaje}`)
            .setColor(ok ? 0x2ecc40 : 0xe74c3c);
        if (obj.imagen) embed.setThumbnail(obj.imagen);

        const replyFn =
            interaction.replied || interaction.deferred ? interaction.editReply.bind(interaction) : interaction.reply.bind(interaction);
        await replyFn({ embeds: [embed], flags: MessageFlags.Ephemeral });
    },
};
