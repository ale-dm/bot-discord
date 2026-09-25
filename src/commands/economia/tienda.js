// /tienda: en pestañas, 🛒 Catálogo (ver y comprar), 🎒 Inventario (tus objetos, con Usar; antes /inventario y
// /usar) y 🧾 Mis compras; más la gestión (admins). Los datos y el cobro están en
// systems/tienda y los mensajes en paneles/tienda.
const { SlashCommandBuilder, PermissionFlagsBits, MessageFlags } = require("discord.js");
const db = require("../../core/db");
const guildSettings = require("../../systems/guildSettings");
const achievements = require("../../systems/achievementsSystem");
const adminAudit = require("../../systems/adminAudit");
const tienda = require("../../systems/tienda");
const paneles = require("../../paneles/tienda");
const { createLogger } = require("../../core/logger");

const log = createLogger("Tienda");

const purchaseLocks = new Map();
const esAdmin = (interaction) => interaction.member.permissions.has(PermissionFlagsBits.Administrator);
const privado = (payload) => ({ ...(typeof payload === "string" ? { content: payload } : payload), flags: MessageFlags.Ephemeral });
const sustituir = (content) => ({ content, embeds: [], components: [] });

// Objetos de tipo rol: se da el rol (por rolId o, si no, por nombre). Devuelve la línea para el mensaje.
async function entregarRol(interaction, item) {
    if ((item.tipo || "").toLowerCase() !== "rol") return "";
    try {
        let role = item.rolId ? interaction.guild.roles.cache.get(item.rolId) : null;
        if (!role) role = interaction.guild.roles.cache.find((r) => r.name.toLowerCase() === item.nombre.toLowerCase());
        if (!role) {
            log.warn(
                `Objeto de tipo rol "${item.nombre}" comprado por ${interaction.user.id}, pero no existe el rol (rolId=${item.rolId || "-"})`,
            );
        }
        if (role && !interaction.member.roles.cache.has(role.id)) {
            await interaction.member.roles.add(role);
            return `\n🎭 Rol **${role.name}** asignado automáticamente.`;
        }
    } catch (e) {
        log.warn(`Compra de "${item.nombre}" cobrada pero no se pudo asignar el rol a ${interaction.user.id}: ${e.message}`);
        return "\n⚠️ No se pudo asignar el rol (permisos insuficientes).";
    }
    return "";
}

// Aviso público de la compra en el canal configurado (o el antiguo de la tabla config).
async function anunciarCompra(interaction, item, tiendaCfg) {
    const legacyCanal = db.prepare("SELECT valor FROM config WHERE clave = 'tienda_canal_notif'").get()?.valor;
    const notifChannelId = tiendaCfg.notif_channel_id || legacyCanal;
    if (!notifChannelId) return;
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

async function comprar(interaction, tiendaCfg) {
    const userId = interaction.user.id;
    const lockKey = `${interaction.guildId}:${userId}`;
    if (purchaseLocks.has(lockKey)) {
        await interaction.update(sustituir("⏳ Ya estás procesando una compra, espera un momento."));
        return;
    }
    purchaseLocks.set(lockKey, Date.now());
    try {
        const item = tienda.itemTienda(parseInt(interaction.customId.replace("tienda_comprar_", "")));
        if (!item) {
            await interaction.update(sustituir("❌ Objeto no encontrado."));
            return;
        }
        const check = tienda.comprobarCompra(interaction.guildId, userId, item, tiendaCfg);
        if (!check.ok) {
            await interaction.update(sustituir(check.mensaje));
            return;
        }
        // Resta saldo y registra compra, todo o nada: si algo falla a mitad no se
        // cobra sin entregar el objeto (ni se gasta stock sin cobrar).
        if (!tienda.cobrarCompra(userId, item, interaction.user.tag)) {
            await interaction.update(
                sustituir("❌ No se pudo completar la compra (saldo o stock insuficiente). No se te ha cobrado nada."),
            );
            return;
        }
        log.info(
            `${interaction.user.tag} (${userId}) compró "${item.nombre}" (tienda #${item.tiendaId}) por ${item.precio}${item.stock !== null ? ` · stock restante ${item.stock - 1}` : ""}`,
        );

        const rolMsg = await entregarRol(interaction, item);
        await anunciarCompra(interaction, item, tiendaCfg);
        await interaction.update(paneles.buildCompraRealizada(item, rolMsg, tienda.saldoDe(userId)));
        await achievements.applyEvent(interaction.guild, userId, "tienda_buy_count", 1);
        await achievements.applyEvent(interaction.guild, userId, "tienda_spent", Number(item.precio || 0));
    } finally {
        purchaseLocks.delete(lockKey);
    }
}

// Subcomandos de admin: config, añadir, eliminar, editar.
async function subcomandoAdmin(interaction, sub) {
    if (sub === "config") {
        const canal = interaction.options.getChannel("canal");
        guildSettings.setSetting(interaction.guildId, "tienda.notif_channel_id", canal ? canal.id : "");
        adminAudit.logAdminAction({
            guildId: interaction.guildId,
            actorId: interaction.user.id,
            action: "tienda.config.notif_channel",
            details: { channelId: canal ? canal.id : null },
        });
        if (canal) {
            db.prepare("INSERT OR REPLACE INTO config (clave, valor) VALUES ('tienda_canal_notif', ?)").run(canal.id);
            await interaction.reply(privado(`✅ Canal de notificaciones de compras configurado: <#${canal.id}>`));
        } else {
            db.prepare("DELETE FROM config WHERE clave = 'tienda_canal_notif'").run();
            await interaction.reply(privado("✅ Notificaciones de compras desactivadas."));
        }
        return;
    }

    if (sub === "añadir") {
        const objetoId = interaction.options.getInteger("objeto_id");
        const precio = interaction.options.getInteger("precio");
        const stock = interaction.options.getInteger("stock");
        const obj = db.prepare("SELECT nombre FROM objeto WHERE id = ?").get(objetoId);
        if (!obj) {
            await interaction.reply(privado("❌ No existe un objeto con ese ID en el catálogo."));
            return;
        }
        db.prepare("INSERT INTO tienda (objetoId, precio, stock) VALUES (?, ?, ?)").run(objetoId, precio, stock ?? null);
        adminAudit.logAdminAction({
            guildId: interaction.guildId,
            actorId: interaction.user.id,
            action: "tienda.item.add",
            details: { objetoId, nombre: obj.nombre, precio, stock },
        });
        await interaction.reply(
            privado(
                `✅ Objeto **${obj.nombre}** añadido a la tienda por ${precio} monedas${stock ? ` (stock: ${stock})` : " (stock ilimitado)"}.`,
            ),
        );
        return;
    }

    if (sub === "eliminar") {
        const id = interaction.options.getInteger("id");
        const item = db
            .prepare("SELECT tienda.id, objeto.nombre FROM tienda JOIN objeto ON tienda.objetoId = objeto.id WHERE tienda.id = ?")
            .get(id);
        if (!item) {
            await interaction.reply(privado("❌ No existe un objeto con ese ID en la tienda."));
            return;
        }
        db.prepare("DELETE FROM tienda WHERE id = ?").run(id);
        adminAudit.logAdminAction({
            guildId: interaction.guildId,
            actorId: interaction.user.id,
            action: "tienda.item.remove",
            details: { tiendaId: id, nombre: item.nombre },
        });
        await interaction.reply(privado(`🗑️ Objeto **${item.nombre}** eliminado de la tienda.`));
        return;
    }

    if (sub === "editar") {
        const id = interaction.options.getInteger("id");
        const precio = interaction.options.getInteger("precio");
        const stock = interaction.options.getInteger("stock");
        const item = db.prepare("SELECT * FROM tienda WHERE id = ?").get(id);
        if (!item) {
            await interaction.reply(privado("❌ No existe un objeto con ese ID en la tienda."));
            return;
        }
        db.prepare("UPDATE tienda SET precio = ?, stock = ? WHERE id = ?").run(precio ?? item.precio, stock ?? item.stock, id);
        adminAudit.logAdminAction({
            guildId: interaction.guildId,
            actorId: interaction.user.id,
            action: "tienda.item.edit",
            details: { tiendaId: id, antes: { precio: item.precio, stock: item.stock }, precio, stock },
        });
        await interaction.reply(privado(`✏️ Objeto #${id} actualizado correctamente.`));
    }
}

module.exports = {
    componentHandlers: [
        // inv_: botones de mensajes de /inventario (ya no existe), que llevan a la pestaña Inventario.
        { types: ["button"], prefixes: ["tienda_", "historial_", "inv_"], method: "handleButton", acl: "tienda" },
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
        .addSubcommand((sub) => sub.setName("historial").setDescription("Tus compras en la tienda"))
        .addSubcommand((sub) =>
            sub
                .setName("inventario")
                .setDescription("Tus objetos, con un botón para usar cada uno")
                .addStringOption((opt) => opt.setName("categoria").setDescription("Filtrar por categoría").setRequired(false))
                .addStringOption((opt) => opt.setName("rareza").setDescription("Filtrar por rareza").setRequired(false)),
        )
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
        const admin = esAdmin(interaction);
        const adminSubs = ["config", "añadir", "editar", "eliminar"];
        if (!tiendaCfg.enabled && !(admin && adminSubs.includes(sub))) {
            await interaction.reply(privado("⛔ La tienda está deshabilitada en este servidor."));
            return;
        }
        db.prepare(
            `
            INSERT OR IGNORE INTO usuarios (id, nombre, tag, fechaRegistro)
            VALUES (?, ?, ?, ?)
        `,
        ).run(interaction.user.id, interaction.user.username, interaction.user.tag, new Date().toISOString());

        if (sub === "ver") {
            try {
                const items = tienda.itemsTienda({
                    busqueda: interaction.options.getString("busqueda"),
                    soloDisponibles: interaction.options.getBoolean("solo_disponibles"),
                    categoria: interaction.options.getString("categoria"),
                    rareza: interaction.options.getString("rareza"),
                });
                if (!items.length) {
                    await interaction.reply(privado("🛒 No se encontraron objetos en la tienda con esos filtros."));
                    return;
                }
                await interaction.reply(privado(paneles.buildTiendaPage(items, 1, admin)));
            } catch (err) {
                log.error("Error mostrando la tienda:", err);
                await interaction.reply(privado("❌ Error al mostrar la tienda."));
            }
            return;
        }

        // Pestaña 🧾 Mis compras (también están en /perfil → Economía → Movimientos, filtro Tienda).
        if (sub === "historial") {
            await interaction.reply(paneles.buildHistorialCompras(tienda.historialCompras(interaction.user.id), 1));
            return;
        }

        // Pestaña 🎒 Inventario (antes /inventario).
        if (sub === "inventario") {
            const filtros = { categoria: interaction.options.getString("categoria"), rareza: interaction.options.getString("rareza") };
            await interaction.reply(paneles.buildInventario(interaction.user.id, 1, null, filtros));
            return;
        }

        if (!admin) {
            await interaction.reply(
                privado(
                    sub === "config"
                        ? "Solo los administradores pueden configurar la tienda."
                        : "Solo los administradores pueden usar este subcomando.",
                ),
            );
            return;
        }
        await subcomandoAdmin(interaction, sub);
    },

    async handleButton(client, interaction) {
        const id = interaction.customId;
        // Solo quien abrió el panel (el catálogo, el inventario y las compras son de cada uno).
        const ownerId = interaction.message?.interaction?.user?.id || interaction.message?.interactionMetadata?.user?.id;
        if (ownerId && ownerId !== interaction.user.id) {
            await interaction.reply(privado("⛔ Solo quien abrió la tienda puede usar estos botones."));
            return;
        }
        try {
            const tiendaCfg = guildSettings.getSettings(interaction.guildId).tienda;
            if (!tiendaCfg.enabled) {
                await interaction.reply(privado("⛔ La tienda está deshabilitada en este servidor."));
                return;
            }

            if (id.startsWith("tienda_confirmar_")) {
                const item = tienda.itemTienda(parseInt(id.replace("tienda_confirmar_", "")));
                if (!item) {
                    await interaction.update(sustituir("❌ Objeto no encontrado."));
                    return;
                }
                await interaction.update(
                    paneles.buildConfirmacion(item, tienda.saldoDe(interaction.user.id), tiendaCfg, interaction.user.id),
                );
                return;
            }

            if (id.startsWith("tienda_comprar_")) {
                await comprar(interaction, tiendaCfg);
                return;
            }

            // Volver a la tienda, cancelar o cambiar de página.
            if (id.startsWith("tienda_volver_") || id === "tienda_cancelar" || id.startsWith("tienda_page_")) {
                const pagina = id === "tienda_cancelar" ? 1 : parseInt(id.replace(/^tienda_(volver|page)_/, "")) || 1;
                const items = tienda.itemsTienda();
                if (!items.length) {
                    await interaction.update({ content: "🛒 La tienda está vacía.", embeds: [], components: [] });
                    return;
                }
                await interaction.update(paneles.buildTiendaPage(items, pagina, esAdmin(interaction)));
                return;
            }

            // 🎒 Inventario: tienda_inv_{página}, o inv_* de mensajes de /inventario.
            if (id.startsWith("tienda_inv_") || id.startsWith("inv_prev_") || id.startsWith("inv_next_")) {
                const [, accion, paginaTxt] = id.split("_");
                const pagina = (parseInt(paginaTxt, 10) || 1) + (accion === "next" ? 1 : accion === "prev" ? -1 : 0);
                await interaction.update(paneles.buildInventario(interaction.user.id, pagina));
                return;
            }
            // Usar un objeto (tienda_usar_{objeto}_{página}, o inv_usar_… de mensajes de /inventario).
            if (id.startsWith("tienda_usar_") || id.startsWith("inv_usar_")) {
                const [, , objetoTxt, paginaTxt] = id.split("_");
                const r = await require("../../systems/objetos").usarObjeto(
                    interaction.user.id,
                    parseInt(objetoTxt, 10),
                    interaction.member,
                    interaction.guild,
                    interaction.user.tag,
                );
                const aviso = `${r.ok ? "✅" : "❌"} ${r.obj ? `**${r.obj.nombre}**: ` : ""}${r.mensaje}`;
                await interaction.update(paneles.buildInventario(interaction.user.id, parseInt(paginaTxt, 10) || 1, aviso));
                return;
            }

            // 🧾 Mis compras: historial_{ver|prev|next}_{página}.
            if (interaction.isButton() && id.startsWith("historial_")) {
                const [, accion, paginaStr] = id.split("_");
                const pagina = parseInt(paginaStr) + (accion === "next" ? 1 : accion === "prev" ? -1 : 0);
                await interaction.update(paneles.buildHistorialCompras(tienda.historialCompras(interaction.user.id), pagina));
            }
        } catch (err) {
            purchaseLocks.delete(`${interaction.guildId}:${interaction.user.id}`);
            log.error(`Error en el botón ${id} de la tienda:`, err);
            try {
                await interaction.update(sustituir("❌ Error al procesar la acción de la tienda."));
            } catch {
                try {
                    await interaction.editReply(sustituir("❌ Error al procesar la acción de la tienda."));
                } catch (e) {
                    log.debug(`Tampoco se pudo avisar del error de la tienda: ${e.message}`);
                }
            }
        }
    },
};
