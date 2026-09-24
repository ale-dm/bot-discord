const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, PermissionFlagsBits } = require("discord.js");
const db = require("../../core/db");
const guildSettings = require("../../systems/guildSettings");
const achievements = require("../../systems/achievementsSystem");
const adminAudit = require("../../systems/adminAudit");
const { cobrarCompra } = require("../../systems/tienda");
const { createLogger } = require("../../core/logger");

const log = createLogger("Tienda");

const ITEMS_POR_PAGINA = 4; // máximo 4 items/página: 4 botones comprar + 1 fila paginación = 5 rows
const purchaseLocks = new Map();

/**
 * Construye el embed + botones de una página de la tienda.
 */
function buildTiendaPage(items, pagina, isAdmin) {
    const totalPaginas = Math.ceil(items.length / ITEMS_POR_PAGINA);
    if (pagina < 1) pagina = 1;
    if (pagina > totalPaginas) pagina = totalPaginas;

    const inicio = (pagina - 1) * ITEMS_POR_PAGINA;
    const pageItems = items.slice(inicio, inicio + ITEMS_POR_PAGINA);

    const embed = new EmbedBuilder()
        .setTitle("🛒 Tienda del Servidor")
        .setDescription("Compra objetos con tus monedas del banco. Pulsa un botón para comprar.")
        .setColor(colorPorRareza(pageItems[0]?.rareza))
        .setFooter({ text: `Página ${pagina} de ${totalPaginas} — ${items.length} objetos en total` });

    if (pageItems[0]?.imagen) embed.setThumbnail(pageItems[0].imagen);

    pageItems.forEach((item) => {
        let name = `${emojiPorTipo(item.tipo)} ${isAdmin ? `[#${item.tiendaId}] ` : ""}${item.nombre} — ${item.precio} 🪙`;
        if (item.unico) name = "🟢 " + name;
        if (item.stock !== null) name += ` (Stock: ${item.stock})`;
        let value = item.descripcion ? item.descripcion.slice(0, 300) : "Sin descripción";
        if (item.tipo) value += `\nTipo: ${item.tipo}`;
        if (item.rareza) value += `  •  Rareza: ${item.rareza}`;
        if (item.stock !== null && item.stock > 0 && item.stock <= 3) value += "  \n⚠️ ¡Últimas unidades!";
        if (item.stock !== null && item.stock === 0) value += "  \n❌ Agotado";
        if (item.rolId || (item.tipo || "").toLowerCase() === "rol") value += "\n🎭 Asigna rol automáticamente al comprar";
        embed.addFields({ name: name.slice(0, 256), value: value.slice(0, 1024), inline: false });
    });

    // Fila botones compra (1 por item)
    const rows = [];
    const compraRow = new ActionRowBuilder();
    pageItems.forEach((item) => {
        const agotado = item.stock !== null && item.stock === 0;
        compraRow.addComponents(
            new ButtonBuilder()
                .setCustomId(`tienda_confirmar_${item.tiendaId}`)
                .setLabel(agotado ? `${item.nombre} (agotado)` : `🛒 ${item.nombre}`)
                .setStyle(agotado ? ButtonStyle.Danger : ButtonStyle.Primary)
                .setDisabled(agotado),
        );
    });
    rows.push(compraRow);

    // Fila paginación
    const navRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId(`tienda_page_${pagina - 1}`)
            .setLabel("◀ Anterior")
            .setStyle(ButtonStyle.Secondary)
            .setDisabled(pagina <= 1),
        new ButtonBuilder()
            .setCustomId(`tienda_page_${pagina + 1}`)
            .setLabel("Siguiente ▶")
            .setStyle(ButtonStyle.Secondary)
            .setDisabled(pagina >= totalPaginas),
    );
    rows.push(navRow);

    return { embeds: [embed], components: rows };
}

// Función para color según rareza
function colorPorRareza(rareza) {
    switch ((rareza || "").toLowerCase()) {
        case "legendario":
            return 0xf1c40f;
        case "épico":
            return 0x9b59b6;
        case "raro":
            return 0x3498db;
        case "común":
            return 0x95a5a6;
        default:
            return 0x2980b9;
    }
}

// Función para emoji según tipo
function emojiPorTipo(tipo) {
    switch ((tipo || "").toLowerCase()) {
        case "rol":
            return "🎭";
        case "consumible":
            return "🎟️";
        case "arma":
            return "⚔️";
        case "armadura":
            return "🛡️";
        case "moneda":
            return "🪙";
        default:
            return "📦";
    }
}

module.exports = {
    componentHandlers: [
        { types: ["button"], prefixes: ["tienda_"], method: "handleButton", acl: "tienda" },
        { types: ["button"], prefixes: ["historial_"], method: "handleButton" },
    ],
    data: new SlashCommandBuilder()
        .setName("tienda")
        .setDescription("Consulta y compra objetos en la tienda del servidor")
        .addSubcommand((sub) =>
            sub
                .setName("ver")
                .setDescription("Ver los objetos disponibles en la tienda")
                .addStringOption((opt) => opt.setName("busqueda").setDescription("Buscar por nombre o tipo").setRequired(false))
                .addBooleanOption((opt) =>
                    opt.setName("solo_disponibles").setDescription("Solo mostrar objetos con stock").setRequired(false),
                )
                .addStringOption((opt) => opt.setName("categoria").setDescription("Filtrar por categoría").setRequired(false))
                .addStringOption((opt) => opt.setName("rareza").setDescription("Filtrar por rareza").setRequired(false)),
        )
        .addSubcommand((sub) =>
            sub
                .setName("añadir")
                .setDescription("Añade un objeto del catálogo a la tienda (solo admins)")
                .addIntegerOption((opt) => opt.setName("objeto_id").setDescription("ID del objeto del catálogo").setRequired(true))
                .addIntegerOption((opt) => opt.setName("precio").setDescription("Precio en monedas").setRequired(true))
                .addIntegerOption((opt) => opt.setName("stock").setDescription("Stock (opcional, vacío = ilimitado)").setRequired(false)),
        )
        .addSubcommand((sub) =>
            sub
                .setName("eliminar")
                .setDescription("Elimina un objeto de la tienda (solo admins)")
                .addIntegerOption((opt) => opt.setName("id").setDescription("ID del objeto en la tienda").setRequired(true)),
        )
        .addSubcommand((sub) =>
            sub
                .setName("editar")
                .setDescription("Edita un objeto de la tienda (solo admins)")
                .addIntegerOption((opt) => opt.setName("id").setDescription("ID del objeto en la tienda").setRequired(true))
                .addIntegerOption((opt) => opt.setName("precio").setDescription("Nuevo precio (opcional)").setRequired(false))
                .addIntegerOption((opt) => opt.setName("stock").setDescription("Nuevo stock (opcional)").setRequired(false)),
        )
        .addSubcommand((sub) => sub.setName("historial").setDescription("Muestra tu historial de compras en la tienda"))
        .addSubcommand((sub) =>
            sub
                .setName("config")
                .setDescription("Configura el canal de notificaciones de compras (solo admins)")
                .addChannelOption((opt) =>
                    opt.setName("canal").setDescription("Canal donde se anuncian las compras (vacío para desactivar)").setRequired(false),
                ),
        ),

    async run(client, interaction) {
        const sub = interaction.options.getSubcommand();
        const tiendaCfg = guildSettings.getSettings(interaction.guildId).tienda;
        const isAdmin = interaction.member.permissions.has(PermissionFlagsBits.Administrator);
        const adminSubs = ["config", "añadir", "editar", "eliminar"];
        if (!tiendaCfg.enabled && !(isAdmin && adminSubs.includes(sub))) {
            await interaction.reply({ content: "⛔ La tienda está deshabilitada en este servidor.", ephemeral: true });
            return;
        }
        const userId = interaction.user.id;
        const nombre = interaction.user.username;
        const tag = interaction.user.tag;
        db.prepare(
            `
            INSERT OR IGNORE INTO usuarios (id, nombre, tag, fechaRegistro)
            VALUES (?, ?, ?, ?)
        `,
        ).run(userId, nombre, tag, new Date().toISOString());
        // --- VER TIENDA ---
        if (sub === "ver") {
            try {
                const busqueda = interaction.options.getString("busqueda");
                const soloDisponibles = interaction.options.getBoolean("solo_disponibles");
                const categoria = interaction.options.getString("categoria");
                const rareza = interaction.options.getString("rareza");

                let query = `SELECT tienda.id as tiendaId, objeto.*, tienda.precio, tienda.stock FROM tienda JOIN objeto ON tienda.objetoId = objeto.id`;
                const where = [];
                const params = [];
                if (busqueda) {
                    where.push("(objeto.nombre LIKE ? OR objeto.tipo LIKE ?)");
                    params.push(`%${busqueda}%`, `%${busqueda}%`);
                }
                if (soloDisponibles) {
                    where.push("(tienda.stock IS NULL OR tienda.stock > 0)");
                }
                if (categoria) {
                    where.push("objeto.categoria = ?");
                    params.push(categoria);
                }
                if (rareza) {
                    where.push("objeto.rareza = ?");
                    params.push(rareza);
                }
                if (where.length) query += " WHERE " + where.join(" AND ");
                query += " ORDER BY tienda.id ASC";
                const items = db.prepare(query).all(...params);

                if (!items.length) {
                    await interaction.reply({ content: "🛒 No se encontraron objetos en la tienda con esos filtros.", ephemeral: true });
                    return;
                }

                await interaction.reply({
                    ...buildTiendaPage(items, 1, interaction.member.permissions.has(PermissionFlagsBits.Administrator)),
                    ephemeral: true,
                });
            } catch (err) {
                log.error("Error mostrando la tienda:", err);
                await interaction.reply({ content: "❌ Error al mostrar la tienda.", ephemeral: true });
            }
            return;
        }

        // --- HISTORIAL DE COMPRAS ---
        if (sub === "historial") {
            const historial = db
                .prepare(
                    "SELECT fecha, descripcion, cantidad FROM historial WHERE userId = ? AND cantidad < 0 AND descripcion LIKE 'Compra en tienda:%' ORDER BY fecha DESC",
                )
                .all(interaction.user.id);

            if (!historial.length) {
                await interaction.reply({ content: "No tienes compras registradas en la tienda.", ephemeral: true });
                return;
            }

            const HISTORIAL_POR_PAGINA = 5;
            const pagina = 1;
            const totalPaginas = Math.ceil(historial.length / HISTORIAL_POR_PAGINA);

            const mostrarPagina = (pag) => {
                const inicio = (pag - 1) * HISTORIAL_POR_PAGINA;
                const fin = inicio + HISTORIAL_POR_PAGINA;
                return historial.slice(inicio, fin);
            };

            let totalGastado = 0;
            mostrarPagina(pagina).forEach((h) => (totalGastado += -h.cantidad));

            const embed = new EmbedBuilder()
                .setTitle("🧾 Historial de compras")
                .setColor(0x95a5a6)
                .setFooter({ text: `Página ${pagina} de ${totalPaginas}` });

            mostrarPagina(pagina).forEach((h) => {
                const fecha = new Date(h.fecha).toLocaleString("es-ES");
                embed.addFields({
                    name: `${h.descripcion}`,
                    value: `Fecha: ${fecha}\nGastado: ${-h.cantidad} monedas`,
                    inline: false,
                });
            });

            embed.setFooter({ text: `Página ${pagina} de ${totalPaginas} | Total mostrado: ${totalGastado} monedas` });

            const row = new ActionRowBuilder().addComponents(
                new ButtonBuilder()
                    .setCustomId(`historial_prev_1`)
                    .setLabel("⬅️ Anterior")
                    .setStyle(ButtonStyle.Secondary)
                    .setDisabled(true),
                new ButtonBuilder()
                    .setCustomId(`historial_next_1`)
                    .setLabel("Siguiente ➡️")
                    .setStyle(ButtonStyle.Primary)
                    .setDisabled(totalPaginas <= 1),
            );

            await interaction.reply({ embeds: [embed], components: [row], ephemeral: true });
            return;
        }

        // --- CONFIG CANAL NOTIFICACIONES ---
        if (sub === "config") {
            if (!interaction.member.permissions.has(PermissionFlagsBits.Administrator)) {
                await interaction.reply({ content: "Solo los administradores pueden configurar la tienda.", ephemeral: true });
                return;
            }
            const canal = interaction.options.getChannel("canal");
            if (canal) {
                guildSettings.setSetting(interaction.guildId, "tienda.notif_channel_id", canal.id);
                adminAudit.logAdminAction({
                    guildId: interaction.guildId,
                    actorId: interaction.user.id,
                    action: "tienda.config.notif_channel",
                    details: { channelId: canal.id },
                });
                db.prepare("INSERT OR REPLACE INTO config (clave, valor) VALUES ('tienda_canal_notif', ?)").run(canal.id);
                await interaction.reply({ content: `✅ Canal de notificaciones de compras configurado: <#${canal.id}>`, ephemeral: true });
            } else {
                guildSettings.setSetting(interaction.guildId, "tienda.notif_channel_id", "");
                adminAudit.logAdminAction({
                    guildId: interaction.guildId,
                    actorId: interaction.user.id,
                    action: "tienda.config.notif_channel",
                    details: { channelId: null },
                });
                db.prepare("DELETE FROM config WHERE clave = 'tienda_canal_notif'").run();
                await interaction.reply({ content: "✅ Notificaciones de compras desactivadas.", ephemeral: true });
            }
            return;
        }

        // --- SOLO ADMINS ---
        if (!interaction.member.permissions.has(PermissionFlagsBits.Administrator)) {
            await interaction.reply({ content: "Solo los administradores pueden usar este subcomando.", ephemeral: true });
            return;
        }

        // --- AÑADIR OBJETO ---
        if (sub === "añadir") {
            const objetoId = interaction.options.getInteger("objeto_id");
            const precio = interaction.options.getInteger("precio");
            const stock = interaction.options.getInteger("stock");

            // Verifica que el objeto existe
            const obj = db.prepare("SELECT nombre FROM objeto WHERE id = ?").get(objetoId);
            if (!obj) {
                await interaction.reply({ content: "❌ No existe un objeto con ese ID en el catálogo.", ephemeral: true });
                return;
            }

            db.prepare("INSERT INTO tienda (objetoId, precio, stock) VALUES (?, ?, ?)").run(
                objetoId,
                precio,
                stock !== null && stock !== undefined ? stock : null,
            );
            adminAudit.logAdminAction({
                guildId: interaction.guildId,
                actorId: interaction.user.id,
                action: "tienda.item.add",
                details: { objetoId, nombre: obj.nombre, precio, stock },
            });

            await interaction.reply({
                content: `✅ Objeto **${obj.nombre}** añadido a la tienda por ${precio} monedas${stock ? ` (stock: ${stock})` : " (stock ilimitado)"}.`,
                ephemeral: true,
            });
            return;
        }

        // --- ELIMINAR OBJETO ---
        if (sub === "eliminar") {
            const id = interaction.options.getInteger("id");
            const item = db
                .prepare("SELECT tienda.id, objeto.nombre FROM tienda JOIN objeto ON tienda.objetoId = objeto.id WHERE tienda.id = ?")
                .get(id);
            if (!item) {
                await interaction.reply({ content: "❌ No existe un objeto con ese ID en la tienda.", ephemeral: true });
                return;
            }
            db.prepare("DELETE FROM tienda WHERE id = ?").run(id);
            adminAudit.logAdminAction({
                guildId: interaction.guildId,
                actorId: interaction.user.id,
                action: "tienda.item.remove",
                details: { tiendaId: id, nombre: item.nombre },
            });
            await interaction.reply({ content: `🗑️ Objeto **${item.nombre}** eliminado de la tienda.`, ephemeral: true });
            return;
        }

        // --- EDITAR OBJETO ---
        if (sub === "editar") {
            const id = interaction.options.getInteger("id");
            const precio = interaction.options.getInteger("precio");
            const stock = interaction.options.getInteger("stock");

            const item = db.prepare("SELECT * FROM tienda WHERE id = ?").get(id);
            if (!item) {
                await interaction.reply({ content: "❌ No existe un objeto con ese ID en la tienda.", ephemeral: true });
                return;
            }

            db.prepare("UPDATE tienda SET precio = ?, stock = ? WHERE id = ?").run(
                precio !== null && precio !== undefined ? precio : item.precio,
                stock !== null && stock !== undefined ? stock : item.stock,
                id,
            );
            adminAudit.logAdminAction({
                guildId: interaction.guildId,
                actorId: interaction.user.id,
                action: "tienda.item.edit",
                details: { tiendaId: id, antes: { precio: item.precio, stock: item.stock }, precio, stock },
            });

            await interaction.reply({ content: `✏️ Objeto #${id} actualizado correctamente.`, ephemeral: true });
            return;
        }
    },

    async handleButton(client, interaction) {
        try {
            const tiendaCfg = guildSettings.getSettings(interaction.guildId).tienda;
            if (!tiendaCfg.enabled) {
                await interaction.reply({ content: "⛔ La tienda está deshabilitada en este servidor.", ephemeral: true });
                return;
            }

            // Confirmación de compra
            if (interaction.customId.startsWith("tienda_confirmar_")) {
                const tiendaId = parseInt(interaction.customId.replace("tienda_confirmar_", ""));
                const item = db
                    .prepare(
                        `
                    SELECT tienda.id as tiendaId, objeto.*, tienda.precio, tienda.stock
                    FROM tienda
                    JOIN objeto ON tienda.objetoId = objeto.id
                    WHERE tienda.id = ?
                `,
                    )
                    .get(tiendaId);
                if (!item) {
                    await interaction.update({ content: "❌ Objeto no encontrado.", embeds: [], components: [], ephemeral: true });
                    return;
                }

                const datos = db.prepare("SELECT saldo FROM banco WHERE userId = ?").get(interaction.user.id);
                const saldo = datos ? datos.saldo : 0;

                const embed = new EmbedBuilder()
                    .setTitle("¿Confirmar compra?")
                    .setDescription(
                        `**${item.nombre}**\n${item.descripcion}\n\n` +
                            `💰 Precio: **${item.precio} monedas**\n` +
                            `${item.stock !== null ? `Stock disponible: ${item.stock}\n` : ""}` +
                            `Tu saldo: **${saldo} monedas**\n\n` +
                            `Política: cooldown **${Number(tiendaCfg.buy_cooldown_sec || 0)}s** · límite diario **${Number(tiendaCfg.daily_limit || 0) || "∞"}**`,
                    )
                    .setColor(0xf39c12);
                if (item.imagen) embed.setThumbnail(item.imagen);

                const row = new ActionRowBuilder().addComponents(
                    new ButtonBuilder()
                        .setCustomId(`tienda_comprar_${item.tiendaId}`)
                        .setLabel("✅ Confirmar compra")
                        .setStyle(ButtonStyle.Success),
                    new ButtonBuilder().setCustomId("tienda_cancelar").setLabel("Cancelar").setStyle(ButtonStyle.Secondary),
                );

                await interaction.update({ embeds: [embed], components: [row] });
                return;
            }

            // Realizar la compra
            if (interaction.customId.startsWith("tienda_comprar_")) {
                const lockKey = `${interaction.guildId}:${interaction.user.id}`;
                if (purchaseLocks.has(lockKey)) {
                    await interaction.update({
                        content: "⏳ Ya estás procesando una compra, espera un momento.",
                        embeds: [],
                        components: [],
                        ephemeral: true,
                    });
                    return;
                }
                purchaseLocks.set(lockKey, Date.now());

                const tiendaId = parseInt(interaction.customId.replace("tienda_comprar_", ""));
                const item = db
                    .prepare(
                        `
                    SELECT tienda.id as tiendaId, objeto.*, tienda.precio, tienda.stock, objeto.unico
                    FROM tienda
                    JOIN objeto ON tienda.objetoId = objeto.id
                    WHERE tienda.id = ?
                `,
                    )
                    .get(tiendaId);
                if (!item) {
                    purchaseLocks.delete(lockKey);
                    await interaction.update({ content: "❌ Objeto no encontrado.", embeds: [], components: [], ephemeral: true });
                    return;
                }

                // Si es único, comprobar si ya lo tiene
                if (item.unico) {
                    const yaTiene = db
                        .prepare("SELECT 1 FROM inventario WHERE userId = ? AND itemId = ?")
                        .get(interaction.user.id, item.id);
                    if (yaTiene) {
                        purchaseLocks.delete(lockKey);
                        await interaction.update({
                            content: "❌ Solo puedes comprar este objeto una vez.",
                            embeds: [],
                            components: [],
                            ephemeral: true,
                        });
                        return;
                    }
                }

                // Comprobar stock
                if (item.stock !== null && item.stock <= 0) {
                    purchaseLocks.delete(lockKey);
                    await interaction.update({ content: "❌ Este objeto está agotado.", embeds: [], components: [], ephemeral: true });
                    return;
                }

                const datos = db.prepare("SELECT saldo FROM banco WHERE userId = ?").get(interaction.user.id);
                if (!datos || datos.saldo < item.precio) {
                    purchaseLocks.delete(lockKey);
                    await interaction.update({
                        content: "❌ No tienes suficiente saldo en el banco para comprar este objeto.",
                        embeds: [],
                        components: [],
                        ephemeral: true,
                    });
                    return;
                }

                // El cupo de compras se consume solo cuando la compra es válida: una compra
                // rechazada (sin saldo, agotado, ya lo tiene) no cuenta.
                const limiter = guildSettings.checkAndConsumeLimit(interaction.guildId, "tienda_buy", interaction.user.id, {
                    cooldownSec: Number(tiendaCfg.buy_cooldown_sec || 0),
                    dailyLimit: Number(tiendaCfg.daily_limit || 0),
                });
                if (!limiter.ok) {
                    purchaseLocks.delete(lockKey);
                    if (limiter.reason === "cooldown") {
                        await interaction.update({
                            content: `⏳ Espera ${limiter.retrySeconds || 1}s antes de otra compra.`,
                            embeds: [],
                            components: [],
                            ephemeral: true,
                        });
                        return;
                    }
                    await interaction.update({
                        content: "📛 Alcanzaste el límite diario de compras en tienda.",
                        embeds: [],
                        components: [],
                        ephemeral: true,
                    });
                    return;
                }

                // Resta saldo y registra compra, todo o nada: si algo falla a mitad no se
                // cobra sin entregar el objeto (ni se gasta stock sin cobrar).
                const compraOk = cobrarCompra(interaction.user.id, item, interaction.user.tag);
                if (!compraOk) {
                    purchaseLocks.delete(lockKey);
                    await interaction.update({
                        content: "❌ No se pudo completar la compra (saldo o stock insuficiente). No se te ha cobrado nada.",
                        embeds: [],
                        components: [],
                        ephemeral: true,
                    });
                    return;
                }

                log.info(
                    `${interaction.user.tag} (${interaction.user.id}) compró "${item.nombre}" (tienda #${item.tiendaId}) por ${item.precio}${item.stock !== null ? ` · stock restante ${item.stock - 1}` : ""}`,
                );

                // Asignar rol de Discord si el objeto tiene rolId o tipo=rol
                let rolMsg = "";
                const tipo = (item.tipo || "").toLowerCase();
                if (tipo === "rol") {
                    try {
                        let role = item.rolId ? interaction.guild.roles.cache.get(item.rolId) : null;
                        if (!role) role = interaction.guild.roles.cache.find((r) => r.name.toLowerCase() === item.nombre.toLowerCase());
                        if (!role)
                            log.warn(
                                `Objeto de tipo rol "${item.nombre}" comprado por ${interaction.user.id}, pero no existe el rol (rolId=${item.rolId || "-"})`,
                            );
                        if (role && !interaction.member.roles.cache.has(role.id)) {
                            await interaction.member.roles.add(role);
                            rolMsg = `\n🎭 Rol **${role.name}** asignado automáticamente.`;
                        }
                    } catch (e) {
                        log.warn(
                            `Compra de "${item.nombre}" cobrada pero no se pudo asignar el rol a ${interaction.user.id}: ${e.message}`,
                        );
                        rolMsg = "\n⚠️ No se pudo asignar el rol (permisos insuficientes).";
                    }
                }

                // Notificación pública en canal configurado
                const legacyCanal = db.prepare("SELECT valor FROM config WHERE clave = 'tienda_canal_notif'").get()?.valor;
                const notifChannelId = tiendaCfg.notif_channel_id || legacyCanal;
                if (notifChannelId) {
                    try {
                        const canal = await interaction.guild.channels.fetch(notifChannelId);
                        if (canal?.isTextBased()) {
                            await canal.send(
                                `🛍️ **${interaction.user.displayName}** acaba de comprar **${item.nombre}** en la tienda por **${item.precio} monedas**.`,
                            );
                        }
                    } catch (e) {
                        log.warn(`No se pudo anunciar la compra en el canal ${notifChannelId}: ${e.message}`);
                    }
                }

                const saldoActual = db.prepare("SELECT saldo FROM banco WHERE userId = ?").get(interaction.user.id);
                const embed = new EmbedBuilder()
                    .setTitle("✅ ¡Compra realizada!")
                    .setDescription(
                        `Has comprado **${item.nombre}** por **${item.precio} monedas**.${rolMsg}\n\n💰 Saldo restante: **${saldoActual?.saldo ?? 0} monedas**`,
                    )
                    .setColor(0x2ecc40);
                if (item.imagen) embed.setThumbnail(item.imagen);

                const volverRow = new ActionRowBuilder().addComponents(
                    new ButtonBuilder().setCustomId("tienda_volver_1").setLabel("⬅️ Volver a la tienda").setStyle(ButtonStyle.Primary),
                );

                await interaction.update({ embeds: [embed], components: [volverRow] });
                await achievements.applyEvent(interaction.guild, interaction.user.id, "tienda_buy_count", 1);
                await achievements.applyEvent(interaction.guild, interaction.user.id, "tienda_spent", Number(item.precio || 0));
                purchaseLocks.delete(lockKey);
                return;
            }

            // Volver a la tienda o cancelar (con paginación)
            if (interaction.customId.startsWith("tienda_volver_") || interaction.customId === "tienda_cancelar") {
                const pagina = interaction.customId.startsWith("tienda_volver_")
                    ? parseInt(interaction.customId.replace("tienda_volver_", "")) || 1
                    : 1;
                const items = db
                    .prepare(
                        `SELECT tienda.id as tiendaId, objeto.*, tienda.precio, tienda.stock FROM tienda JOIN objeto ON tienda.objetoId = objeto.id ORDER BY tienda.id ASC`,
                    )
                    .all();
                if (!items.length) {
                    await interaction.update({ content: "🛒 La tienda está vacía.", embeds: [], components: [] });
                    return;
                }
                const isAdmin = interaction.member.permissions.has(PermissionFlagsBits.Administrator);
                await interaction.update(buildTiendaPage(items, pagina, isAdmin));
                return;
            }

            // Paginación de tienda
            if (interaction.customId.startsWith("tienda_page_")) {
                const pagina = parseInt(interaction.customId.replace("tienda_page_", "")) || 1;
                const items = db
                    .prepare(
                        `SELECT tienda.id as tiendaId, objeto.*, tienda.precio, tienda.stock FROM tienda JOIN objeto ON tienda.objetoId = objeto.id ORDER BY tienda.id ASC`,
                    )
                    .all();
                const isAdmin = interaction.member.permissions.has(PermissionFlagsBits.Administrator);
                await interaction.update(buildTiendaPage(items, pagina, isAdmin));
                return;
            }

            if (interaction.isButton() && interaction.customId.startsWith("historial_")) {
                const historial = db
                    .prepare(
                        "SELECT fecha, descripcion, cantidad FROM historial WHERE userId = ? AND cantidad < 0 AND descripcion LIKE 'Compra en tienda:%' ORDER BY fecha DESC",
                    )
                    .all(interaction.user.id);

                const HISTORIAL_POR_PAGINA = 5;
                const [, accion, paginaStr] = interaction.customId.split("_");
                let pagina = parseInt(paginaStr);

                if (accion === "next") pagina++;
                if (accion === "prev") pagina--;

                const totalPaginas = Math.ceil(historial.length / HISTORIAL_POR_PAGINA);
                if (pagina < 1) pagina = 1;
                if (pagina > totalPaginas) pagina = totalPaginas;

                let totalGastado = 0;
                const mostrarPagina = (pag) => {
                    const inicio = (pag - 1) * HISTORIAL_POR_PAGINA;
                    const fin = inicio + HISTORIAL_POR_PAGINA;
                    return historial.slice(inicio, fin);
                };
                mostrarPagina(pagina).forEach((h) => (totalGastado += -h.cantidad));

                const embed = new EmbedBuilder()
                    .setTitle("🧾 Historial de compras")
                    .setColor(0x95a5a6)
                    .setFooter({ text: `Página ${pagina} de ${totalPaginas} | Total mostrado: ${totalGastado} monedas` });

                mostrarPagina(pagina).forEach((h) => {
                    const fecha = new Date(h.fecha).toLocaleString("es-ES");
                    embed.addFields({
                        name: `${h.descripcion}`,
                        value: `Fecha: ${fecha}\nGastado: ${-h.cantidad} monedas`,
                        inline: false,
                    });
                });

                const row = new ActionRowBuilder().addComponents(
                    new ButtonBuilder()
                        .setCustomId(`historial_prev_${pagina}`)
                        .setLabel("⬅️ Anterior")
                        .setStyle(ButtonStyle.Secondary)
                        .setDisabled(pagina === 1),
                    new ButtonBuilder()
                        .setCustomId(`historial_next_${pagina}`)
                        .setLabel("Siguiente ➡️")
                        .setStyle(ButtonStyle.Primary)
                        .setDisabled(pagina === totalPaginas),
                );

                await interaction.update({ embeds: [embed], components: [row], ephemeral: true });
            }
        } catch (err) {
            purchaseLocks.delete(`${interaction.guildId}:${interaction.user.id}`);
            log.error(`Error en el botón ${interaction.customId} de la tienda:`, err);
            try {
                await interaction.update({
                    content: "❌ Error al procesar la acción de la tienda.",
                    embeds: [],
                    components: [],
                    ephemeral: true,
                });
            } catch {
                try {
                    await interaction.editReply({ content: "❌ Error al procesar la acción de la tienda.", embeds: [], components: [] });
                } catch (e) {
                    log.debug(`Tampoco se pudo avisar del error de la tienda: ${e.message}`);
                }
            }
        }
    },
};
