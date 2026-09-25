const {
    SlashCommandBuilder,
    EmbedBuilder,
    PermissionFlagsBits,
    ActionRowBuilder,
    StringSelectMenuBuilder,
    MessageFlags,
} = require("discord.js");
const db = require("../../core/db");

module.exports = {
    componentHandlers: [{ types: ["stringSelect"], ids: ["panel_select"], method: "handleSelect" }],
    data: new SlashCommandBuilder()
        .setName("panel")
        .setDescription("Panel de administración del banco (solo admins)")
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

    async run(client, interaction) {
        if (!interaction.member.permissions.has("Administrator")) {
            await interaction.reply({ content: "No tienes permisos para usar el panel.", flags: MessageFlags.Ephemeral });
            return;
        }

        // Muestra el panel principal por defecto
        await mostrarPanel(interaction, "banco");
    },

    async handleSelect(client, interaction) {
        if (!interaction.isStringSelectMenu() || !interaction.customId.startsWith("panel_select")) return;
        const categoria = interaction.values[0];
        await mostrarPanel(interaction, categoria, true);
    },
};

// Función para mostrar el panel según la categoría
async function mostrarPanel(interaction, categoria, isUpdate = false) {
    const embed = new EmbedBuilder().setTitle("🛠️ Panel de Administración").setColor(0x2e8b57).setTimestamp();

    if (categoria === "banco") {
        const totalUsuariosBanco = db.prepare("SELECT COUNT(*) as total FROM banco").get()?.total || 0;
        const totalBanco = db.prepare("SELECT SUM(saldo) as total FROM banco").get()?.total || 0;
        const totalEnMano = db.prepare("SELECT SUM(enMano) as total FROM banco").get()?.total || 0;
        const movimientos = db.prepare("SELECT COUNT(*) as total FROM historial").get()?.total || 0;
        embed
            .setDescription("**Estadísticas bancarias:**")
            .addFields(
                { name: "Usuarios en banco", value: `${totalUsuariosBanco}`, inline: true },
                { name: "Total en banco", value: `${totalBanco} monedas`, inline: true },
                { name: "Total en mano", value: `${totalEnMano} monedas`, inline: true },
                { name: "Movimientos registrados", value: `${movimientos}`, inline: true },
            );
    }

    if (categoria === "usuarios") {
        const totalUsuarios = db.prepare("SELECT COUNT(*) as total FROM usuarios").get()?.total || 0;
        const sinInventario =
            db.prepare(`SELECT COUNT(*) as total FROM usuarios WHERE id NOT IN (SELECT userId FROM inventario)`).get()?.total || 0;
        const saldoCero = db.prepare(`SELECT COUNT(*) as total FROM banco WHERE saldo = 0`).get()?.total || 0;
        const inactivos =
            db
                .prepare(
                    `
            SELECT COUNT(DISTINCT banco.userId) as total
            FROM banco
            LEFT JOIN historial ON banco.userId = historial.userId
            WHERE historial.fecha IS NULL OR historial.fecha < date('now', '-30 days')
        `,
                )
                .get()?.total || 0;
        embed
            .setDescription("**Estadísticas de usuarios:**")
            .addFields(
                { name: "Usuarios registrados", value: `${totalUsuarios}`, inline: true },
                { name: "🕒 Inactivos (+30 días)", value: `${inactivos}`, inline: true },
                { name: "📦 Sin inventario", value: `${sinInventario}`, inline: true },
                { name: "💸 Saldo 0", value: `${saldoCero}`, inline: true },
            );
    }

    if (categoria === "objetos") {
        const totalObjetosCatalogo = db.prepare("SELECT COUNT(*) as total FROM objeto").get()?.total || 0;
        const totalObjetosInventario = db.prepare("SELECT COUNT(*) as total FROM inventario").get()?.total || 0;
        const nuncaUsados = db
            .prepare(
                `
            SELECT nombre FROM objeto
            WHERE id NOT IN (
                SELECT objeto.id
                FROM historial
                JOIN objeto ON historial.descripcion LIKE '%' || objeto.nombre || '%'
                WHERE historial.cantidad < 0
            )
            LIMIT 5
        `,
            )
            .all();
        embed
            .setDescription("**Estadísticas de objetos:**")
            .addFields(
                { name: "Objetos distintos", value: `${totalObjetosCatalogo}`, inline: true },
                { name: "Objetos en circulación", value: `${totalObjetosInventario}`, inline: true },
            );
        if (nuncaUsados.length) {
            embed.addFields({
                name: "🆕 Objetos nunca usados",
                value: nuncaUsados.map((o) => `• ${o.nombre}`).join("\n"),
                inline: false,
            });
        }
    }

    if (categoria === "ranking") {
        const topBanco = db
            .prepare(
                `
            SELECT usuarios.nombre, banco.saldo
            FROM banco
            LEFT JOIN usuarios ON banco.userId = usuarios.id
            ORDER BY saldo DESC LIMIT 5
        `,
            )
            .all();
        const topObjetos = db
            .prepare(
                `
            SELECT usuarios.nombre, COUNT(*) as cantidad
            FROM inventario
            LEFT JOIN usuarios ON inventario.userId = usuarios.id
            GROUP BY inventario.userId
            ORDER BY cantidad DESC LIMIT 5
        `,
            )
            .all();
        const topConsumidos = db
            .prepare(
                `
            SELECT objeto.nombre, COUNT(*) as veces
            FROM historial
            JOIN objeto ON historial.descripcion LIKE '%' || objeto.nombre || '%'
            WHERE historial.cantidad < 0
            GROUP BY objeto.id
            ORDER BY veces DESC LIMIT 5
        `,
            )
            .all();

        embed.setDescription("**Rankings:**");
        if (topBanco.length) {
            embed.addFields({
                name: "🏆 Top 5 usuarios con más monedas",
                value: topBanco.map((u, i) => `${i + 1}. ${u.nombre || "Desconocido"} — ${u.saldo} monedas`).join("\n"),
                inline: false,
            });
        }
        if (topObjetos.length) {
            embed.addFields({
                name: "🎒 Top 5 usuarios con más objetos",
                value: topObjetos.map((u, i) => `${i + 1}. ${u.nombre || "Desconocido"} — ${u.cantidad} objetos`).join("\n"),
                inline: false,
            });
        }
        if (topConsumidos.length) {
            embed.addFields({
                name: "🔥 Top 5 objetos más consumidos/comprados",
                value: topConsumidos.map((o, i) => `${i + 1}. ${o.nombre} — ${o.veces} veces`).join("\n"),
                inline: false,
            });
        }
    }

    // NUEVO: Actividad reciente
    if (categoria === "actividad") {
        const ultimos = db
            .prepare(
                `
            SELECT historial.fecha, historial.descripcion, historial.cantidad, usuarios.nombre
            FROM historial
            LEFT JOIN usuarios ON historial.userId = usuarios.id
            ORDER BY historial.fecha DESC
            LIMIT 5
        `,
            )
            .all();
        embed.setDescription("**Últimos movimientos globales:**");
        if (ultimos.length) {
            embed.addFields({
                name: "Movimientos recientes",
                value: ultimos
                    .map(
                        (m) =>
                            `• [${new Date(m.fecha).toLocaleString("es-ES")}] ${m.nombre || "Desconocido"}: ${m.descripcion} (${m.cantidad > 0 ? "+" : ""}${m.cantidad})`,
                    )
                    .join("\n"),
                inline: false,
            });
        } else {
            embed.addFields({ name: "Movimientos recientes", value: "Sin movimientos.", inline: false });
        }
    }

    // Select menu para cambiar de categoría
    const select = new StringSelectMenuBuilder()
        .setCustomId("panel_select")
        .setPlaceholder("Selecciona una categoría")
        .addOptions([
            { label: "Banco", value: "banco", emoji: "🏦" },
            { label: "Usuarios", value: "usuarios", emoji: "👥" },
            { label: "Objetos", value: "objetos", emoji: "📦" },
            { label: "Ranking", value: "ranking", emoji: "🏆" },
            { label: "Actividad reciente", value: "actividad", emoji: "📊" },
        ]);
    const row = new ActionRowBuilder().addComponents(select);

    if (isUpdate) {
        await interaction.update({ embeds: [embed], components: [row] });
    } else {
        await interaction.reply({ embeds: [embed], components: [row], flags: MessageFlags.Ephemeral });
    }
}
