const { SlashCommandBuilder, EmbedBuilder } = require("discord.js");
const { logInfo, logError, logDebug } = require("../../core/logger");
const db = require("../../core/db");

const COOLDOWN_SECONDS = 10;
const LIMITE_MAX = 1_000_000;
const cooldowns = {};

// Añade una entrada al historial del usuario. Antes borraba todo menos los 10 últimos
// movimientos de esa persona, pero el historial es de toda la economía (casino, cripto,
// apuestas, tienda): cada depósito borraba datos de los que salen el ganado/perdido de /nivel
// y el historial de compras de la tienda. /banco historial ya muestra solo los 10 últimos.
function addHistorial(userId, descripcion, cantidad) {
    db.prepare("INSERT INTO historial (userId, fecha, descripcion, cantidad) VALUES (?, ?, ?, ?)").run(
        userId,
        new Date().toISOString(),
        descripcion,
        cantidad,
    );
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName("banco")
        .setDescription("Gestiona tu banco virtual.")
        .addSubcommand((sub) => sub.setName("saldo").setDescription("Consulta tu saldo actual."))
        .addSubcommand((sub) =>
            sub
                .setName("depositar")
                .setDescription("Deposita monedas en tu cuenta bancaria desde tu dinero en mano.")
                .addIntegerOption((opt) => opt.setName("cantidad").setDescription("Cantidad a depositar").setRequired(true)),
        )
        .addSubcommand((sub) =>
            sub
                .setName("retirar")
                .setDescription("Retira monedas de tu cuenta bancaria a tu dinero en mano.")
                .addIntegerOption((opt) => opt.setName("cantidad").setDescription("Cantidad a retirar").setRequired(true)),
        )
        .addSubcommand((sub) =>
            sub
                .setName("transferir")
                .setDescription("Transfiere monedas a otro usuario desde tu dinero en mano.")
                .addUserOption((opt) => opt.setName("usuario").setDescription("Usuario destinatario").setRequired(true))
                .addIntegerOption((opt) => opt.setName("cantidad").setDescription("Cantidad a transferir").setRequired(true)),
        )
        .addSubcommand((sub) => sub.setName("top").setDescription("Muestra el ranking de los más ricos (en banco)."))
        .addSubcommand((sub) => sub.setName("historial").setDescription("Muestra tu historial de movimientos."))
        .addSubcommand((sub) =>
            sub.setName("historialglobal").setDescription("Muestra el historial de movimientos de todos los usuarios (solo admins)."),
        ),

    async run(client, interaction) {
        try {
            const userId = interaction.user.id;
            const nombre = interaction.user.username;
            const tag = interaction.user.tag;
            db.prepare(
                `
                INSERT OR IGNORE INTO usuarios (id, nombre, tag, fechaRegistro)
                VALUES (?, ?, ?, ?)
            `,
            ).run(userId, nombre, tag, new Date().toISOString());
            db.prepare("INSERT OR IGNORE INTO banco (userId) VALUES (?)").run(userId);

            const sub = interaction.options.getSubcommand();

            // Cooldown solo para depositar, retirar y transferir
            if (["depositar", "retirar", "transferir"].includes(sub)) {
                if (!cooldowns[userId]) cooldowns[userId] = 0;
                if (Date.now() < cooldowns[userId]) {
                    const wait = Math.ceil((cooldowns[userId] - Date.now()) / 1000);
                    return await interaction.reply({
                        content: `Debes esperar ${wait} segundos antes de volver a usar este comando.`,
                        ephemeral: true,
                    });
                }
                cooldowns[userId] = Date.now() + COOLDOWN_SECONDS * 1000;
            }

            if (sub === "saldo") {
                const row = db.prepare("SELECT saldo, enMano FROM banco WHERE userId = ?").get(userId);
                const saldo = row ? row.saldo : 1000;
                const enMano = row ? row.enMano : 0;
                const embed = new EmbedBuilder()
                    .setTitle("🏦 Banco Virtual")
                    .setDescription(`Hola, ${interaction.user.username}.`)
                    .addFields(
                        { name: "💰 En banco", value: `**${saldo} monedas**`, inline: true },
                        { name: "🪙 En mano", value: `**${enMano} monedas**`, inline: true },
                    )
                    .setColor(0xffd700)
                    .setTimestamp();
                await interaction.reply({ embeds: [embed], ephemeral: true });
                logDebug(`[Banco] ${interaction.user.tag} consultó su saldo: Banco ${saldo}, Mano ${enMano}`);
                return;
            }

            if (sub === "depositar") {
                const cantidad = interaction.options.getInteger("cantidad");
                const row = db.prepare("SELECT enMano FROM banco WHERE userId = ?").get(userId);
                if (!Number.isInteger(cantidad) || cantidad <= 0) {
                    await interaction.reply({ content: "La cantidad debe ser un número entero mayor que cero.", ephemeral: true });
                    return;
                }
                if (cantidad > LIMITE_MAX) {
                    await interaction.reply({ content: `No puedes depositar más de ${LIMITE_MAX} monedas a la vez.`, ephemeral: true });
                    return;
                }
                if (!row || row.enMano < cantidad) {
                    await interaction.reply({ content: "No tienes suficiente dinero en mano.", ephemeral: true });
                    return;
                }
                db.prepare("UPDATE banco SET enMano = enMano - ?, saldo = saldo + ? WHERE userId = ?").run(cantidad, cantidad, userId);
                addHistorial(userId, `Depósito`, cantidad);
                const nuevo = db.prepare("SELECT saldo, enMano FROM banco WHERE userId = ?").get(userId);
                await interaction.reply({
                    content: `Has depositado **${cantidad} monedas**. Banco: **${nuevo.saldo}** | En mano: **${nuevo.enMano}**`,
                    ephemeral: true,
                });
                logInfo(`[Banco] ${interaction.user.tag} depositó ${cantidad} monedas (Banco: ${nuevo.saldo}, Mano: ${nuevo.enMano})`);
                return;
            }

            if (sub === "retirar") {
                const cantidad = interaction.options.getInteger("cantidad");
                const row = db.prepare("SELECT saldo FROM banco WHERE userId = ?").get(userId);
                if (!Number.isInteger(cantidad) || cantidad <= 0) {
                    await interaction.reply({ content: "La cantidad debe ser un número entero mayor que cero.", ephemeral: true });
                    return;
                }
                if (cantidad > LIMITE_MAX) {
                    await interaction.reply({ content: `No puedes retirar más de ${LIMITE_MAX} monedas a la vez.`, ephemeral: true });
                    return;
                }
                if (!row || row.saldo < cantidad) {
                    await interaction.reply({ content: "No tienes suficiente saldo en el banco.", ephemeral: true });
                    return;
                }
                db.prepare("UPDATE banco SET saldo = saldo - ?, enMano = enMano + ? WHERE userId = ?").run(cantidad, cantidad, userId);
                addHistorial(userId, `Retirada`, -cantidad);
                const nuevo = db.prepare("SELECT saldo, enMano FROM banco WHERE userId = ?").get(userId);
                await interaction.reply({
                    content: `Has retirado **${cantidad} monedas**. Banco: **${nuevo.saldo}** | En mano: **${nuevo.enMano}**`,
                    ephemeral: true,
                });
                logInfo(`[Banco] ${interaction.user.tag} retiró ${cantidad} monedas (Banco: ${nuevo.saldo}, Mano: ${nuevo.enMano})`);
                return;
            }

            if (sub === "transferir") {
                const cantidad = interaction.options.getInteger("cantidad");
                const usuarioDestino = interaction.options.getUser("usuario");

                if (!Number.isInteger(cantidad) || cantidad <= 0) {
                    await interaction.reply({ content: "La cantidad debe ser un número entero mayor que cero.", ephemeral: true });
                    return;
                }
                if (cantidad > LIMITE_MAX) {
                    await interaction.reply({ content: `No puedes transferir más de ${LIMITE_MAX} monedas a la vez.`, ephemeral: true });
                    return;
                }
                if (usuarioDestino.id === userId) {
                    await interaction.reply({ content: "No puedes transferirte monedas a ti mismo.", ephemeral: true });
                    return;
                }
                if (usuarioDestino.bot) {
                    await interaction.reply({ content: "No puedes transferir monedas a un bot.", ephemeral: true });
                    return;
                }
                const row = db.prepare("SELECT enMano FROM banco WHERE userId = ?").get(userId);
                if (!row || row.enMano < cantidad) {
                    await interaction.reply({ content: "No tienes suficiente dinero en mano.", ephemeral: true });
                    return;
                }
                // Todo o nada: antes eran escrituras sueltas y un fallo a mitad podía quitar el dinero
                // a uno sin dárselo al otro.
                db.transaction(() => {
                    db.prepare("INSERT OR IGNORE INTO banco (userId) VALUES (?)").run(usuarioDestino.id);
                    db.prepare("UPDATE banco SET enMano = enMano - ? WHERE userId = ?").run(cantidad, userId);
                    db.prepare("UPDATE banco SET enMano = enMano + ? WHERE userId = ?").run(cantidad, usuarioDestino.id);
                    addHistorial(userId, `Transferencia a ${usuarioDestino.username}`, -cantidad);
                    addHistorial(usuarioDestino.id, `Transferencia recibida de ${interaction.user.username}`, cantidad);
                })();
                const nuevo = db.prepare("SELECT saldo, enMano FROM banco WHERE userId = ?").get(userId);
                await interaction.reply({
                    content: `Has transferido **${cantidad} monedas** a ${usuarioDestino.username}. Banco: **${nuevo.saldo}** | En mano: **${nuevo.enMano}**`,
                    ephemeral: true,
                });
                logInfo(
                    `[Banco] ${interaction.user.tag} transfirió ${cantidad} monedas a ${usuarioDestino.tag} (Banco: ${nuevo.saldo}, Mano: ${nuevo.enMano})`,
                );
                return;
            }

            if (sub === "top") {
                // Top 5 usuarios con más saldo en banco
                const top = db.prepare("SELECT userId, saldo FROM banco ORDER BY saldo DESC LIMIT 5").all();
                const lines = top.map((row, i) => `**${i + 1}.** <@${row.userId}> — ${row.saldo} monedas`).join("\n");
                const embed = new EmbedBuilder()
                    .setTitle("🏆 Ranking de los más ricos (en banco)")
                    .setDescription(lines || "No hay datos aún.")
                    .setColor(0xffd700)
                    .setTimestamp();
                await interaction.reply({ embeds: [embed], ephemeral: false });
                logDebug(`[Banco] Ranking consultado.`);
                return;
            }

            if (sub === "historial") {
                const historial = db
                    .prepare("SELECT fecha, descripcion, cantidad FROM historial WHERE userId = ? ORDER BY fecha DESC LIMIT 10")
                    .all(userId);
                if (historial.length === 0) {
                    await interaction.reply({ content: "No tienes movimientos en tu historial.", ephemeral: true });
                    return;
                }
                const lines = historial
                    .map(
                        (h) =>
                            `• [${new Date(h.fecha).toLocaleString("es-ES")}] ${h.descripcion}: **${h.cantidad > 0 ? "+" : ""}${h.cantidad} monedas**`,
                    )
                    .join("\n");
                const embed = new EmbedBuilder()
                    .setTitle("📜 Historial de movimientos")
                    .setDescription(lines)
                    .setColor(0xffd700)
                    .setTimestamp();
                await interaction.reply({ embeds: [embed], ephemeral: true });
                logDebug(`[Banco] ${interaction.user.tag} consultó su historial.`);
                return;
            }

            if (sub === "historialglobal") {
                // Solo admins pueden usarlo
                if (!interaction.member.permissions.has("Administrator")) {
                    await interaction.reply({ content: "No tienes permisos para ver el historial global.", ephemeral: true });
                    return;
                }
                const historial = db
                    .prepare("SELECT userId, fecha, descripcion, cantidad FROM historial ORDER BY fecha DESC LIMIT 20")
                    .all();
                if (historial.length === 0) {
                    await interaction.reply({ content: "No hay movimientos en el historial global.", ephemeral: true });
                    return;
                }
                const lines = historial
                    .map(
                        (h) =>
                            `• [${new Date(h.fecha).toLocaleString("es-ES")}] <@${h.userId}> — ${h.descripcion}: **${h.cantidad > 0 ? "+" : ""}${h.cantidad} monedas**`,
                    )
                    .join("\n");
                const embed = new EmbedBuilder()
                    .setTitle("📜 Historial global de movimientos")
                    .setDescription(lines)
                    .setColor(0xff5555)
                    .setTimestamp();
                await interaction.reply({ embeds: [embed], ephemeral: true });
                logInfo(`[Banco] ${interaction.user.tag} consultó el historial global.`);
                return;
            }
        } catch (err) {
            logError("[Banco] Error general:", err);
            try {
                await interaction.reply({ content: "Hubo un error al gestionar tu banco.", ephemeral: true });
            } catch (e) {
                logDebug(`[Banco] No se pudo avisar del error: ${e.message}`);
            }
        }
    },
};
