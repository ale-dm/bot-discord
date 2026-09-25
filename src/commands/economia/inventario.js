const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags } = require("discord.js");
const db = require("../../core/db");
const usar = require("./usar.js");

const OBJETOS_POR_PAGINA = 5;

// Mismos colores y emojis que la tienda.
const { colorPorRareza, emojiPorTipo } = require("../../paneles/tienda");

module.exports = {
    componentHandlers: [{ types: ["button"], prefixes: ["inv_"], method: "handleButton" }],
    data: new SlashCommandBuilder()
        .setName("inventario")
        .setDescription("Muestra los objetos de tu inventario")
        .addStringOption((opt) => opt.setName("categoria").setDescription("Filtrar por categoría").setRequired(false))
        .addStringOption((opt) => opt.setName("rareza").setDescription("Filtrar por rareza").setRequired(false)),

    async run(client, interaction) {
        const userId = interaction.user.id;
        const nombre = interaction.user.username;
        const tag = interaction.user.tag;
        db.prepare(
            `
            INSERT OR IGNORE INTO usuarios (id, nombre, tag, fechaRegistro)
            VALUES (?, ?, ?, ?)
        `,
        ).run(userId, nombre, tag, new Date().toISOString());
        const categoria = interaction.options.getString("categoria");
        const rareza = interaction.options.getString("rareza");

        // Consulta con filtros opcionales
        let query = `
            SELECT inventario.itemId, objeto.*, COUNT(*) as cantidad
            FROM inventario
            JOIN objeto ON inventario.itemId = objeto.id
            WHERE inventario.userId = ?
        `;
        const params = [userId];
        if (categoria) {
            query += " AND objeto.categoria = ?";
            params.push(categoria);
        }
        if (rareza) {
            query += " AND objeto.rareza = ?";
            params.push(rareza);
        }
        query += `
            GROUP BY inventario.itemId
            ORDER BY MAX(inventario.id) DESC
        `;
        const objetos = db.prepare(query).all(...params);

        if (!objetos.length) {
            await interaction.reply({ content: "No tienes objetos en tu inventario con esos filtros.", flags: MessageFlags.Ephemeral });
            return;
        }

        // Obtener saldo de monedas
        const banco = db.prepare("SELECT saldo FROM banco WHERE userId = ?").get(userId);
        const saldo = banco ? banco.saldo : 0;

        const pagina = 1;
        const totalPaginas = Math.ceil(objetos.length / OBJETOS_POR_PAGINA);

        const mostrarPagina = (pag) => {
            const inicio = (pag - 1) * OBJETOS_POR_PAGINA;
            const fin = inicio + OBJETOS_POR_PAGINA;
            return objetos.slice(inicio, fin);
        };

        let totalObjetos = 0;
        mostrarPagina(pagina).forEach((obj) => (totalObjetos += obj.cantidad));

        const embed = new EmbedBuilder()
            .setTitle("🎒 Tu inventario")
            .setDescription(`💰 Monedas: **${saldo}**`)
            .setColor(colorPorRareza(objetos[0]?.rareza))
            .setFooter({ text: `Página ${pagina} de ${totalPaginas} | Total objetos: ${totalObjetos}` });

        // Botones "Usar" por objeto agrupado
        const rows = [];

        mostrarPagina(pagina).forEach((obj) => {
            const name = `${obj.cantidad}x ${emojiPorTipo(obj.tipo)} ID: ${obj.id} — ${obj.nombre} ${obj.tipo ? `(${obj.tipo})` : ""}`;
            let value = obj.descripcion ? obj.descripcion.slice(0, 512) : "";
            if (obj.categoria) value += `\nCategoría: ${obj.categoria}`;
            if (obj.rareza) value += `\nRareza: ${obj.rareza}`;
            embed.addFields({ name: name.slice(0, 256), value: value.slice(0, 1024), inline: false });
            if (obj.imagen) embed.setThumbnail(obj.imagen);

            rows.push(
                new ActionRowBuilder().addComponents(
                    new ButtonBuilder()
                        .setCustomId(`inv_usar_${obj.id}_${pagina}`)
                        .setLabel(`Usar ${obj.nombre}`)
                        .setStyle(ButtonStyle.Success),
                ),
            );
        });

        // Paginación
        const paginacionRow = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId(`inv_prev_${pagina}`)
                .setLabel("⬅️ Anterior")
                .setStyle(ButtonStyle.Secondary)
                .setDisabled(pagina === 1),
            new ButtonBuilder()
                .setCustomId(`inv_next_${pagina}`)
                .setLabel("Siguiente ➡️")
                .setStyle(ButtonStyle.Primary)
                .setDisabled(pagina === totalPaginas),
        );

        rows.push(paginacionRow);

        await interaction.reply({ embeds: [embed], components: rows, flags: MessageFlags.Ephemeral });
    },

    // Handler para los botones de paginación y usar
    async handleButton(client, interaction) {
        if (!interaction.customId.startsWith("inv_")) return;

        const userId = interaction.user.id;

        // Agrupar objetos por itemId y contar cantidad
        const objetos = db
            .prepare(
                `
            SELECT inventario.itemId, objeto.*, COUNT(*) as cantidad
            FROM inventario
            JOIN objeto ON inventario.itemId = objeto.id
            WHERE inventario.userId = ?
            GROUP BY inventario.itemId
            ORDER BY MAX(inventario.id) DESC
        `,
            )
            .all(userId);

        const banco = db.prepare("SELECT saldo FROM banco WHERE userId = ?").get(userId);
        const saldo = banco ? banco.saldo : 0;

        const parts = interaction.customId.split("_");
        const accion = parts[1];

        // Botón "Usar"
        if (accion === "usar") {
            const itemId = parseInt(parts[2]);
            // Busca el primer inventarioId disponible para ese itemId
            const inv = db.prepare("SELECT id FROM inventario WHERE userId = ? AND itemId = ? ORDER BY id ASC LIMIT 1").get(userId, itemId);
            if (!inv) {
                await interaction.reply({ content: "❌ No se encontró el objeto en tu inventario.", flags: MessageFlags.Ephemeral });
                return;
            }
            // Crea un interaction "falso" con options.getInteger para usar.js
            const fakeInteraction = Object.create(interaction);
            fakeInteraction.options = {
                getInteger: () => itemId,
            };
            await usar.run(client, fakeInteraction);
            return;
        }

        // Paginación
        let pagina = parseInt(parts[2]);
        if (accion === "next") pagina++;
        if (accion === "prev") pagina--;

        const totalPaginas = Math.ceil(objetos.length / OBJETOS_POR_PAGINA);
        if (pagina < 1) pagina = 1;
        if (pagina > totalPaginas) pagina = totalPaginas;

        const mostrarPagina = (pag) => {
            const inicio = (pag - 1) * OBJETOS_POR_PAGINA;
            const fin = inicio + OBJETOS_POR_PAGINA;
            return objetos.slice(inicio, fin);
        };

        let totalObjetos = 0;
        mostrarPagina(pagina).forEach((obj) => (totalObjetos += obj.cantidad));

        const embed = new EmbedBuilder()
            .setTitle("🎒 Tu inventario")
            .setDescription(`💰 Monedas: **${saldo}**`)
            .setColor(colorPorRareza(objetos[0]?.rareza))
            .setFooter({ text: `Página ${pagina} de ${totalPaginas} | Total objetos: ${totalObjetos}` });

        const rows = [];

        mostrarPagina(pagina).forEach((obj) => {
            const name = `${obj.cantidad}x ${emojiPorTipo(obj.tipo)} ID: ${obj.id} — ${obj.nombre} ${obj.tipo ? `(${obj.tipo})` : ""}`;
            let value = obj.descripcion ? obj.descripcion.slice(0, 512) : "";
            if (obj.categoria) value += `\nCategoría: ${obj.categoria}`;
            if (obj.rareza) value += `\nRareza: ${obj.rareza}`;
            embed.addFields({ name: name.slice(0, 256), value: value.slice(0, 1024), inline: false });
            if (obj.imagen) embed.setThumbnail(obj.imagen);

            rows.push(
                new ActionRowBuilder().addComponents(
                    new ButtonBuilder()
                        .setCustomId(`inv_usar_${obj.id}_${pagina}`)
                        .setLabel(`Usar ${obj.nombre}`)
                        .setStyle(ButtonStyle.Success),
                ),
            );
        });

        const paginacionRow = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId(`inv_prev_${pagina}`)
                .setLabel("⬅️ Anterior")
                .setStyle(ButtonStyle.Secondary)
                .setDisabled(pagina === 1),
            new ButtonBuilder()
                .setCustomId(`inv_next_${pagina}`)
                .setLabel("Siguiente ➡️")
                .setStyle(ButtonStyle.Primary)
                .setDisabled(pagina === totalPaginas),
        );

        rows.push(paginacionRow);

        await interaction.update({ embeds: [embed], components: rows });
    },
};
