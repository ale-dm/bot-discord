// /tienda: un solo comando que abre el panel, en pestañas: 🛒 Catálogo (ver, filtrar y comprar), 🎒 Inventario (tus
// objetos, con Usar) y 🧾 Mis compras. Los filtros (categoría, rareza y búsqueda) están en el panel y se recuerdan por
// persona. La gestión (objetos, precios, stock) está en /paneladmin → 🛒 Catálogo, y la configuración (activa, límites,
// canal de avisos) en /paneladmin → Config Global → Tienda. Los datos y el cobro están en systems/tienda y los mensajes
// en paneles/tienda.
const {
    SlashCommandBuilder,
    PermissionFlagsBits,
    MessageFlags,
    ModalBuilder,
    TextInputBuilder,
    TextInputStyle,
    ActionRowBuilder,
} = require("discord.js");
const db = require("../../core/db");
const guildSettings = require("../../systems/guildSettings");
const achievements = require("../../systems/achievementsSystem");
const tienda = require("../../systems/tienda");
const paneles = require("../../paneles/tienda");
const { createLogger } = require("../../core/logger");

const log = createLogger("Tienda");

const purchaseLocks = new Map();
// Filtros del panel de cada persona (categoría, rareza y búsqueda). En memoria: si el bot se reinicia, se quitan.
const filtrosPorUsuario = new Map();
const esAdmin = (interaction) => interaction.member.permissions.has(PermissionFlagsBits.Administrator);
const privado = (payload) => ({ ...(typeof payload === "string" ? { content: payload } : payload), flags: MessageFlags.Ephemeral });
const sustituir = (content) => ({ content, embeds: [], components: [] });

const filtrosDe = (userId) => filtrosPorUsuario.get(String(userId)) || {};

// Cambia uno o varios filtros de la persona; un valor vacío lo quita.
function fijarFiltros(userId, cambios) {
    const f = { ...filtrosDe(userId), ...cambios };
    for (const k of Object.keys(f)) if (!f[k]) delete f[k];
    filtrosPorUsuario.set(String(userId), f);
    return f;
}

const vistaCatalogo = (interaction, pagina) => {
    const filtros = filtrosDe(interaction.user.id);
    return paneles.buildTiendaPage(tienda.itemsTienda(filtros), pagina, esAdmin(interaction), filtros);
};
const vistaInventario = (interaction, pagina, aviso = null) =>
    paneles.buildInventario(interaction.user.id, pagina, aviso, filtrosDe(interaction.user.id));
const vistaDePestana = (interaction, tab) => (tab === "inventario" ? vistaInventario(interaction, 1) : vistaCatalogo(interaction, 1));

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
        if (!tienda.cobrarCompra(userId, interaction.guildId, item, interaction.user.tag)) {
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

module.exports = {
    componentHandlers: [
        // inv_: botones de mensajes de /inventario (ya no existe), que llevan a la pestaña Inventario.
        { types: ["button"], prefixes: ["tienda_", "historial_", "inv_"], method: "handleButton", acl: "tienda" },
        { types: ["stringSelect"], prefixes: ["tienda_filtro_"], method: "handleSelect", acl: "tienda" },
        { types: ["modal"], prefixes: ["tienda_modal_"], method: "handleModal", acl: "tienda" },
    ],
    data: new SlashCommandBuilder()
        .setName("tienda")
        .setDescription("🛒 Tienda del servidor: catálogo, inventario y tus compras, en un panel"),
    async run(client, interaction) {
        const tiendaCfg = guildSettings.getSettings(interaction.guildId).tienda;
        if (!tiendaCfg.enabled) {
            await interaction.reply(privado("⛔ La tienda está deshabilitada en este servidor."));
            return;
        }
        db.prepare(
            `
            INSERT OR IGNORE INTO usuarios (id, nombre, tag, fechaRegistro)
            VALUES (?, ?, ?, ?)
        `,
        ).run(interaction.user.id, interaction.user.username, interaction.user.tag, new Date().toISOString());

        try {
            await interaction.reply(vistaCatalogo(interaction, 1));
        } catch (err) {
            log.error("Error mostrando la tienda:", err);
            await interaction.reply(privado("❌ Error al mostrar la tienda."));
        }
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

            // Volver al catálogo, cancelar o cambiar de página (los filtros se mantienen).
            if (id.startsWith("tienda_volver_") || id === "tienda_cancelar" || id.startsWith("tienda_page_")) {
                const pagina = id === "tienda_cancelar" ? 1 : parseInt(id.replace(/^tienda_(volver|page)_/, "")) || 1;
                await interaction.update(vistaCatalogo(interaction, pagina));
                return;
            }

            // 🎒 Inventario: tienda_inv_{página}, o inv_* de mensajes de /inventario.
            if (id.startsWith("tienda_inv_") || id.startsWith("inv_prev_") || id.startsWith("inv_next_")) {
                const [, accion, paginaTxt] = id.split("_");
                const pagina = (parseInt(paginaTxt, 10) || 1) + (accion === "next" ? 1 : accion === "prev" ? -1 : 0);
                await interaction.update(vistaInventario(interaction, pagina));
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
                await interaction.update(vistaInventario(interaction, parseInt(paginaTxt, 10) || 1, aviso));
                return;
            }

            // 🔍 Buscar por nombre o tipo: abre el formulario; quitar la búsqueda, vuelve a la lista sin ella.
            if (id.startsWith("tienda_buscar_")) {
                const tab = id.replace("tienda_buscar_", "");
                const modal = new ModalBuilder().setCustomId(`tienda_modal_buscar_${tab}`).setTitle("🔍 Buscar en la tienda");
                modal.addComponents(
                    new ActionRowBuilder().addComponents(
                        new TextInputBuilder()
                            .setCustomId("busqueda")
                            .setLabel("Nombre o tipo del objeto")
                            .setStyle(TextInputStyle.Short)
                            .setPlaceholder("espada, consumible…")
                            .setMaxLength(40)
                            .setRequired(false)
                            .setValue(filtrosDe(interaction.user.id).busqueda || ""),
                    ),
                );
                await interaction.showModal(modal);
                return;
            }
            if (id.startsWith("tienda_nobuscar_")) {
                const tab = id.replace("tienda_nobuscar_", "");
                fijarFiltros(interaction.user.id, { busqueda: null });
                await interaction.update(vistaDePestana(interaction, tab));
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

    // Menús de categoría y rareza: tienda_filtro_{categoria|rareza}_{catalogo|inventario}.
    async handleSelect(client, interaction) {
        const [, , tipo, tab] = interaction.customId.split("_");
        const valor = interaction.values[0];
        fijarFiltros(interaction.user.id, { [tipo]: valor === paneles.SIN_FILTRO ? null : valor });
        await interaction.update(vistaDePestana(interaction, tab));
    },

    // Formulario de búsqueda: tienda_modal_buscar_{catalogo|inventario}.
    async handleModal(client, interaction) {
        const tab = interaction.customId.replace("tienda_modal_buscar_", "");
        const texto = interaction.fields.getTextInputValue("busqueda").trim().slice(0, 40);
        fijarFiltros(interaction.user.id, { busqueda: texto || null });
        const payload = vistaDePestana(interaction, tab);
        if (interaction.isFromMessage?.()) return interaction.update(payload);
        return interaction.reply({ ...payload, flags: MessageFlags.Ephemeral });
    },
};
