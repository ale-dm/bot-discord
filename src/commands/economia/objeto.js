const { SlashCommandBuilder, EmbedBuilder, PermissionFlagsBits, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require("discord.js");
const db = require("../../core/db");
const adminAudit = require("../../systems/adminAudit");
const { createLogger } = require("../../core/logger");

const log = createLogger("Objetos");

const OBJETOS_POR_PAGINA = 10;

const TIPOS = [
    { name: "Rol (da un rol de Discord)", value: "rol" },
    { name: "Consumible (se gasta al usarlo)", value: "consumible" },
    { name: "Coleccionable (sin efecto)", value: "coleccionable" },
];

// Efectos que entiende /usar para los consumibles.
function validarEfecto(efecto) {
    if (!efecto) return null;
    if (/^monedas:-?\d+$/.test(efecto) || /^mensaje:.+/.test(efecto)) return null;
    return "El efecto debe ser `monedas:N` (da N monedas) o `mensaje:texto`.";
}

module.exports = {
    componentHandlers: [{ types: ["button"], prefixes: ["objeto_"], method: "handleButton" }],
    data: new SlashCommandBuilder()
        .setName("objeto")
        .setDescription("Gestiona el catálogo de objetos (solo admins)")
        .addSubcommand((sub) =>
            sub
                .setName("crear")
                .setDescription("Crea un nuevo objeto")
                .addStringOption((opt) => opt.setName("nombre").setDescription("Nombre").setRequired(true))
                .addStringOption((opt) => opt.setName("descripcion").setDescription("Descripción").setRequired(true))
                .addStringOption((opt) => opt.setName("imagen").setDescription("URL de imagen").setRequired(false))
                .addStringOption((opt) =>
                    opt
                        .setName("tipo")
                        .setDescription("Tipo de objeto")
                        .setRequired(false)
                        .addChoices(...TIPOS),
                )
                .addStringOption((opt) => opt.setName("categoria").setDescription("Categoría del objeto").setRequired(false))
                .addStringOption((opt) =>
                    opt.setName("rareza").setDescription("Rareza (común, raro, épico, legendario...)").setRequired(false),
                )
                .addBooleanOption((opt) => opt.setName("unico").setDescription("¿Solo se puede comprar una vez?").setRequired(false))
                .addRoleOption((opt) => opt.setName("rol").setDescription("Rol que da (para tipo rol)").setRequired(false))
                .addStringOption((opt) =>
                    opt.setName("efecto").setDescription("Efecto de un consumible: monedas:N o mensaje:texto").setRequired(false),
                ),
        )
        .addSubcommand((sub) =>
            sub
                .setName("eliminar")
                .setDescription("Elimina un objeto del catálogo")
                .addIntegerOption((opt) => opt.setName("id").setDescription("ID del objeto").setRequired(true)),
        )
        .addSubcommand((sub) =>
            sub
                .setName("editar")
                .setDescription("Edita un objeto del catálogo")
                .addIntegerOption((opt) => opt.setName("id").setDescription("ID del objeto").setRequired(true))
                .addStringOption((opt) => opt.setName("nombre").setDescription("Nuevo nombre").setRequired(false))
                .addStringOption((opt) => opt.setName("descripcion").setDescription("Nueva descripción").setRequired(false))
                .addStringOption((opt) => opt.setName("imagen").setDescription("Nueva imagen").setRequired(false))
                .addStringOption((opt) =>
                    opt
                        .setName("tipo")
                        .setDescription("Nuevo tipo")
                        .setRequired(false)
                        .addChoices(...TIPOS),
                )
                .addStringOption((opt) => opt.setName("categoria").setDescription("Categoría del objeto").setRequired(false))
                .addStringOption((opt) =>
                    opt.setName("rareza").setDescription("Rareza (común, raro, épico, legendario...)").setRequired(false),
                )
                .addBooleanOption((opt) => opt.setName("unico").setDescription("¿Solo una vez?").setRequired(false))
                .addRoleOption((opt) => opt.setName("rol").setDescription("Rol que da (para tipo rol)").setRequired(false))
                .addStringOption((opt) =>
                    opt.setName("efecto").setDescription("Efecto de un consumible: monedas:N o mensaje:texto").setRequired(false),
                ),
        )
        .addSubcommand((sub) =>
            sub
                .setName("ver")
                .setDescription("Ver todos los objetos del catálogo")
                .addStringOption((opt) => opt.setName("busqueda").setDescription("Buscar por nombre o tipo").setRequired(false)),
        ),

    async run(client, interaction) {
        try {
            if (!interaction.member.permissions.has(PermissionFlagsBits.Administrator)) {
                await interaction.reply({ content: "Solo administradores pueden usar este comando.", ephemeral: true });
                return;
            }
            const sub = interaction.options.getSubcommand();

            // CREAR
            if (sub === "crear") {
                const nombre = interaction.options.getString("nombre");
                const descripcion = interaction.options.getString("descripcion");
                const imagen = interaction.options.getString("imagen") || null;
                const tipo = interaction.options.getString("tipo") || null;
                const unico = interaction.options.getBoolean("unico") ? 1 : 0;
                const categoria = interaction.options.getString("categoria")?.trim() || null;
                const rareza = interaction.options.getString("rareza")?.trim() || null;
                const rolId = interaction.options.getRole("rol")?.id || null;
                const efecto = interaction.options.getString("efecto")?.trim() || null;
                const errorEfecto = validarEfecto(efecto);
                if (errorEfecto) {
                    await interaction.reply({ content: `❌ ${errorEfecto}`, ephemeral: true });
                    return;
                }

                db.prepare(
                    "INSERT INTO objeto (nombre, descripcion, imagen, tipo, unico, categoria, rareza, rolId, efecto) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
                ).run(nombre, descripcion, imagen, tipo, unico, categoria, rareza, rolId, efecto);
                adminAudit.logAdminAction({
                    guildId: interaction.guildId,
                    actorId: interaction.user.id,
                    action: "objeto.create",
                    details: { nombre, tipo, unico: !!unico, categoria, rareza, rolId, efecto },
                });

                await interaction.reply({ content: `✅ Objeto **${nombre}** creado.`, ephemeral: true });
                return;
            }

            // ELIMINAR
            if (sub === "eliminar") {
                const id = interaction.options.getInteger("id");

                // Verifica si el objeto está en algún inventario
                const enInventario = db.prepare("SELECT 1 FROM inventario WHERE itemId = ? LIMIT 1").get(id);
                if (enInventario) {
                    await interaction.reply({
                        content: "❌ No puedes eliminar este objeto porque está en el inventario de algún usuario.",
                        ephemeral: true,
                    });
                    return;
                }

                // Verifica si el objeto está en la tienda
                const enTienda = db.prepare("SELECT 1 FROM tienda WHERE objetoId = ? LIMIT 1").get(id);
                if (enTienda) {
                    await interaction.reply({ content: "❌ No puedes eliminar este objeto porque está en la tienda.", ephemeral: true });
                    return;
                }

                const obj = db.prepare("SELECT nombre FROM objeto WHERE id = ?").get(id);
                if (!obj) {
                    await interaction.reply({ content: "No existe un objeto con ese ID.", ephemeral: true });
                    return;
                }
                db.prepare("DELETE FROM objeto WHERE id = ?").run(id);
                adminAudit.logAdminAction({
                    guildId: interaction.guildId,
                    actorId: interaction.user.id,
                    action: "objeto.delete",
                    details: { id, nombre: obj.nombre },
                });
                await interaction.reply({ content: `🗑️ Objeto **${obj.nombre}** eliminado.`, ephemeral: true });
                return;
            }

            // EDITAR
            if (sub === "editar") {
                const id = interaction.options.getInteger("id");
                const obj = db.prepare("SELECT * FROM objeto WHERE id = ?").get(id);
                if (!obj) {
                    await interaction.reply({ content: "No existe un objeto con ese ID.", ephemeral: true });
                    return;
                }
                const nombre = interaction.options.getString("nombre") || obj.nombre;
                const descripcion = interaction.options.getString("descripcion") || obj.descripcion;
                const imagen = interaction.options.getString("imagen") || obj.imagen;
                const tipo = interaction.options.getString("tipo") || obj.tipo;
                const unico = interaction.options.getBoolean("unico");
                const categoria = interaction.options.getString("categoria")?.trim() || obj.categoria;
                const rareza = interaction.options.getString("rareza")?.trim() || obj.rareza;
                const rolId = interaction.options.getRole("rol")?.id || obj.rolId;
                const efecto = interaction.options.getString("efecto")?.trim() || obj.efecto;
                const errorEfecto = validarEfecto(efecto);
                if (errorEfecto) {
                    await interaction.reply({ content: `❌ ${errorEfecto}`, ephemeral: true });
                    return;
                }
                db.prepare(
                    "UPDATE objeto SET nombre = ?, descripcion = ?, imagen = ?, tipo = ?, unico = ?, categoria = ?, rareza = ?, rolId = ?, efecto = ? WHERE id = ?",
                ).run(
                    nombre.slice(0, 255),
                    descripcion.slice(0, 1024),
                    imagen ? imagen.slice(0, 512) : null,
                    tipo ? tipo.slice(0, 64) : null,
                    unico !== null ? (unico ? 1 : 0) : obj.unico,
                    categoria ? categoria.slice(0, 64) : null,
                    rareza ? rareza.slice(0, 64) : null,
                    rolId || null,
                    efecto ? efecto.slice(0, 500) : null,
                    id,
                );
                adminAudit.logAdminAction({
                    guildId: interaction.guildId,
                    actorId: interaction.user.id,
                    action: "objeto.edit",
                    details: { id, nombre, tipo, categoria, rareza, rolId, efecto },
                });

                await interaction.reply({ content: `✏️ Objeto #${id} actualizado.`, ephemeral: true });
                return;
            }

            // VER (con paginación)
            if (sub === "ver") {
                const busqueda = interaction.options.getString("busqueda");
                let objetos;
                if (busqueda) {
                    objetos = db
                        .prepare("SELECT * FROM objeto WHERE nombre LIKE ? OR tipo LIKE ? ORDER BY id ASC")
                        .all(`%${busqueda}%`, `%${busqueda}%`);
                } else {
                    objetos = db.prepare("SELECT * FROM objeto ORDER BY id ASC").all();
                }

                const pagina = 1;
                const totalPaginas = Math.ceil(objetos.length / OBJETOS_POR_PAGINA);

                const mostrarPagina = (pag) => {
                    const inicio = (pag - 1) * OBJETOS_POR_PAGINA;
                    const fin = inicio + OBJETOS_POR_PAGINA;
                    return objetos.slice(inicio, fin);
                };

                const embed = new EmbedBuilder()
                    .setTitle("📦 Catálogo de Objetos")
                    .setColor(0x3498db)
                    .setFooter({ text: `Página ${pagina} de ${totalPaginas}` });

                mostrarPagina(pagina).forEach((obj) => {
                    let name = `#${obj.id} - ${obj.nombre}${obj.unico ? " 🟢 Único" : ""}`;
                    name = name.slice(0, 256);

                    let value = obj.descripcion ? obj.descripcion.slice(0, 512) : "";
                    if (obj.tipo) value += `\nTipo: ${obj.tipo}`;
                    if (obj.imagen) value += `\n[Imagen](${obj.imagen})`;
                    value = value.slice(0, 1024);

                    embed.addFields({ name, value, inline: false });
                });

                const row = new ActionRowBuilder().addComponents(
                    new ButtonBuilder()
                        .setCustomId(`objeto_prev_1`)
                        .setLabel("⬅️ Anterior")
                        .setStyle(ButtonStyle.Secondary)
                        .setDisabled(true),
                    new ButtonBuilder()
                        .setCustomId(`objeto_next_1`)
                        .setLabel("Siguiente ➡️")
                        .setStyle(ButtonStyle.Primary)
                        .setDisabled(totalPaginas <= 1),
                );

                await interaction.reply({ embeds: [embed], components: [row], ephemeral: true });
                return;
            }
        } catch (err) {
            log.error("Error ejecutando /objeto:", err);
            try {
                await interaction.reply({ content: "❌ Error ejecutando el comando.", ephemeral: true });
            } catch (e) {
                log.debug(`No se pudo avisar del error: ${e.message}`);
            }
        }
    },

    // Handler para los botones de paginación
    async handleButton(client, interaction) {
        try {
            if (!interaction.customId.startsWith("objeto_")) return;

            const objetos = db.prepare("SELECT * FROM objeto ORDER BY id ASC").all();
            if (!objetos.length) {
                await interaction.update({ content: "No hay objetos en el catálogo.", embeds: [], components: [], ephemeral: true });
                return;
            }

            const [, accion, paginaStr] = interaction.customId.split("_");
            let pagina = parseInt(paginaStr);

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

            const embed = new EmbedBuilder()
                .setTitle("📦 Catálogo de Objetos")
                .setColor(0x3498db)
                .setFooter({ text: `Página ${pagina} de ${totalPaginas}` });

            mostrarPagina(pagina).forEach((obj) => {
                let name = `#${obj.id} - ${obj.nombre}${obj.unico ? " 🟢 Único" : ""}`;
                name = name.slice(0, 256);

                let value = obj.descripcion ? obj.descripcion.slice(0, 512) : "";
                if (obj.tipo) value += `\nTipo: ${obj.tipo}`;
                if (obj.imagen) value += `\n[Imagen](${obj.imagen})`;
                value = value.slice(0, 1024);

                embed.addFields({ name, value, inline: false });
            });

            const row = new ActionRowBuilder().addComponents(
                new ButtonBuilder()
                    .setCustomId(`objeto_prev_${pagina}`)
                    .setLabel("⬅️ Anterior")
                    .setStyle(ButtonStyle.Secondary)
                    .setDisabled(pagina === 1),
                new ButtonBuilder()
                    .setCustomId(`objeto_next_${pagina}`)
                    .setLabel("Siguiente ➡️")
                    .setStyle(ButtonStyle.Primary)
                    .setDisabled(pagina === totalPaginas),
            );

            await interaction.update({ embeds: [embed], components: [row] });
        } catch (err) {
            log.error("Error en la paginación de /objeto:", err);
            try {
                await interaction.update({ content: "❌ Error en la paginación.", embeds: [], components: [], ephemeral: true });
            } catch (e) {
                log.debug(`No se pudo avisar del error: ${e.message}`);
            }
        }
    },
};
