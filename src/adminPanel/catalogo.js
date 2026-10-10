// Panel admin → 🛒 Catálogo: los objetos (con si están a la venta, a qué precio y con cuánto stock), y crear,
// editar, eliminar, poner a la venta y quitar de la venta. Antes eran /objeto y los subcomandos de admin de
// /tienda (añadir, editar, eliminar). La configuración de la tienda (activa, límites, canal) está en Config Global.
const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags } = require("discord.js");
const db = require("../core/db");
const adminAudit = require("../systems/adminAudit");
const { simpleModal, modalConCampos, opcionElegida } = require("./common");
const { efectoProteccion } = require("../systems/robar");

const POR_PAGINA = 8;
const TIPOS = ["rol", "consumible", "coleccionable"];
const CAMPOS = ["nombre", "descripcion", "tipo", "efecto", "rol", "imagen", "categoria", "rareza", "unico"];

// Efectos que entiende "Usar" (tienda → Inventario, systems/objetos) para los consumibles, y los de los coleccionables
// que protegen de /robar con solo tenerlos (F-EC-06c, systems/robar).
function validarEfecto(efecto) {
    if (!efecto) return null;
    if (/^monedas:-?\d+$/.test(efecto) || /^mensaje:.+/.test(efecto) || efectoProteccion(efecto)) return null;
    return (
        "El efecto debe ser `monedas:N` (da N monedas) o `mensaje:texto` en un consumible, o `antirrobo:N` (1-100: quita N " +
        "puntos de probabilidad al que intente robar) o `trampa:N` (2-10: multiplica su multa si falla) en un coleccionable."
    );
}

const privado = (content) => ({ content, flags: MessageFlags.Ephemeral });
const idRol = (texto) => String(texto || "").replace(/[<@&>\s]/g, "") || null;

function buildCatalogo(pagina = 1, aviso = "") {
    const objetos = db
        .prepare(
            `SELECT o.*, t.id AS tiendaId, t.precio, t.stock
             FROM objeto o LEFT JOIN tienda t ON t.objetoId = o.id ORDER BY o.id ASC`,
        )
        .all();
    const paginas = Math.max(1, Math.ceil(objetos.length / POR_PAGINA));
    pagina = Math.min(Math.max(1, pagina), paginas);
    const lineas = objetos.slice((pagina - 1) * POR_PAGINA, pagina * POR_PAGINA).map((o) => {
        const extra = [o.tipo, o.categoria, o.rareza, o.unico ? "único" : null, o.efecto, o.rolId ? `<@&${o.rolId}>` : null]
            .filter(Boolean)
            .join(" · ");
        const venta = o.tiendaId ? `🛒 ${o.precio} 🪙 · stock ${o.stock ?? "∞"}` : "— no está a la venta";
        return `**#${o.id} ${o.nombre}**${extra ? ` (${extra})` : ""}\n${venta}`;
    });
    const embed = new EmbedBuilder()
        .setTitle("🛒 Catálogo de objetos")
        .setDescription((aviso ? `${aviso}\n\n` : "") + (lineas.join("\n\n") || "No hay objetos. Crea uno con ➕."))
        .setFooter({ text: `Página ${pagina} de ${paginas} · ${objetos.length} objetos` })
        .setColor(0x3498db);
    const acciones = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId("paneladmin_cat_crear").setLabel("➕ Crear").setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId("paneladmin_cat_editar").setLabel("✏️ Editar").setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId("paneladmin_cat_eliminar").setLabel("🗑️ Eliminar").setStyle(ButtonStyle.Danger),
        new ButtonBuilder().setCustomId("paneladmin_cat_vender").setLabel("🏷️ A la venta").setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId("paneladmin_cat_quitar").setLabel("❌ Quitar de la venta").setStyle(ButtonStyle.Secondary),
    );
    const nav = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId(`paneladmin_cat_pag_${pagina - 1}`)
            .setLabel("◀")
            .setStyle(ButtonStyle.Secondary)
            .setDisabled(pagina <= 1),
        new ButtonBuilder()
            .setCustomId(`paneladmin_cat_pag_${pagina + 1}`)
            .setLabel("▶")
            .setStyle(ButtonStyle.Secondary)
            .setDisabled(pagina >= paginas),
        new ButtonBuilder().setCustomId("paneladmin_home").setLabel("◀ Panel principal").setStyle(ButtonStyle.Secondary),
    );
    return { content: "", embeds: [embed], components: [acciones, nav] };
}

const MODALES = {
    paneladmin_cat_crear: () =>
        modalConCampos("paneladmin_cat_crear_modal", "Crear objeto", [
            { id: "nombre", label: "Nombre", maxLength: 100 },
            { id: "descripcion", label: "Descripción", paragraph: true, maxLength: 1000 },
            {
                id: "tipo",
                label: "Tipo del objeto",
                tipo: "opciones",
                opciones: TIPOS.map((t) => ({ label: t, value: t })),
                valor: "consumible",
            },
            {
                id: "extra",
                label: "Efecto o rol (ID o mención)",
                placeholder: "monedas:500 · mensaje:texto · antirrobo:30 · trampa:3 · <@&123…>",
                required: false,
            },
            { id: "imagen", label: "Imagen (URL)", required: false },
        ]),
    paneladmin_cat_editar: () =>
        modalConCampos("paneladmin_cat_editar_modal", "Editar objeto", [
            { id: "id", label: "ID del objeto", placeholder: "12" },
            { id: "campo", label: "Campo a cambiar", tipo: "opciones", opciones: CAMPOS.map((c) => ({ label: c, value: c })) },
            { id: "valor", label: "Valor nuevo (vacío = borrarlo)", paragraph: true, required: false },
        ]),
    paneladmin_cat_eliminar: () => simpleModal("paneladmin_cat_eliminar_modal", "Eliminar objeto", [{ id: "id", label: "ID del objeto" }]),
    paneladmin_cat_vender: () =>
        simpleModal("paneladmin_cat_vender_modal", "Poner a la venta (o cambiar precio)", [
            { id: "id", label: "ID del objeto" },
            { id: "precio", label: "Precio en monedas" },
            { id: "stock", label: "Stock (vacío = ilimitado)", required: false },
        ]),
    paneladmin_cat_quitar: () => simpleModal("paneladmin_cat_quitar_modal", "Quitar de la venta", [{ id: "id", label: "ID del objeto" }]),
};

async function handleCatalogoButton(interaction) {
    const id = interaction.customId;
    if (id === "paneladmin_cat_home") {
        await interaction.update(buildCatalogo(1));
        return true;
    }
    if (id.startsWith("paneladmin_cat_pag_")) {
        await interaction.update(buildCatalogo(parseInt(id.replace("paneladmin_cat_pag_", ""), 10) || 1));
        return true;
    }
    if (MODALES[id]) {
        await interaction.showModal(MODALES[id]());
        return true;
    }
    return false;
}

// Lee un campo del formulario; si el modal no lo tiene, devuelve cadena vacía.
function leerCampo(interaction, campo) {
    try {
        return interaction.fields.getTextInputValue(campo).trim();
    } catch {
        return "";
    }
}

function auditar(interaction, action, details) {
    adminAudit.logAdminAction({ guildId: interaction.guildId, actorId: interaction.user.id, action, details });
}

function crearObjeto(interaction) {
    const v = (campo) => leerCampo(interaction, campo);
    const tipo = opcionElegida(interaction.fields, "tipo").toLowerCase();
    if (!TIPOS.includes(tipo)) return { error: `El tipo tiene que ser ${TIPOS.join(", ")}.` };
    const extra = v("extra");
    // Los consumibles hacen su efecto al usarlos; los coleccionables, con solo tenerlos (antirrobo/trampa).
    const efecto = tipo === "consumible" || tipo === "coleccionable" ? extra || null : null;
    const rolId = tipo === "rol" ? idRol(extra) : null;
    const errorEfecto = validarEfecto(efecto);
    if (errorEfecto) return { error: errorEfecto };
    const r = db
        .prepare("INSERT INTO objeto (nombre, descripcion, imagen, tipo, unico, rolId, efecto) VALUES (?, ?, ?, ?, 0, ?, ?)")
        .run(v("nombre"), v("descripcion"), v("imagen") || null, tipo, rolId, efecto);
    auditar(interaction, "objeto.create", { id: r.lastInsertRowid, nombre: v("nombre"), tipo, rolId, efecto });
    return { aviso: `✅ Objeto **#${r.lastInsertRowid} ${v("nombre")}** creado. Ponlo a la venta con 🏷️.` };
}

function editarObjeto(interaction, obj) {
    const v = (campo) => leerCampo(interaction, campo);
    const campo = opcionElegida(interaction.fields, "campo").toLowerCase();
    if (!CAMPOS.includes(campo)) return { error: `Campo desconocido. Puede ser: ${CAMPOS.join(", ")}.` };
    let valor = v("valor") || null;
    if (campo === "tipo" && valor && !TIPOS.includes(valor.toLowerCase())) return { error: `El tipo tiene que ser ${TIPOS.join(", ")}.` };
    if (campo === "efecto" && validarEfecto(valor)) return { error: validarEfecto(valor) };
    if ((campo === "nombre" || campo === "descripcion") && !valor) return { error: `El ${campo} no puede quedar vacío.` };
    if (campo === "unico") valor = ["si", "sí", "1", "true"].includes(String(valor).toLowerCase()) ? 1 : 0;
    if (campo === "rol") valor = idRol(valor);
    const columna = campo === "rol" ? "rolId" : campo;
    db.prepare(`UPDATE objeto SET ${columna} = ? WHERE id = ?`).run(valor, obj.id);
    auditar(interaction, "objeto.edit", { id: obj.id, campo, antes: obj[columna], valor });
    return { aviso: `✏️ **#${obj.id} ${obj.nombre}**: ${campo} actualizado.` };
}

function eliminarObjeto(interaction, obj) {
    if (db.prepare("SELECT 1 FROM inventario WHERE itemId = ? LIMIT 1").get(obj.id))
        return { error: "No se puede eliminar: alguien lo tiene en su inventario." };
    if (db.prepare("SELECT 1 FROM tienda WHERE objetoId = ? LIMIT 1").get(obj.id))
        return { error: "No se puede eliminar: está a la venta (quítalo antes con ❌)." };
    db.prepare("DELETE FROM objeto WHERE id = ?").run(obj.id);
    auditar(interaction, "objeto.delete", { id: obj.id, nombre: obj.nombre });
    return { aviso: `🗑️ Objeto **${obj.nombre}** eliminado.` };
}

function venderObjeto(interaction, obj) {
    const v = (campo) => leerCampo(interaction, campo);
    const precio = parseInt(v("precio"), 10);
    const stockTxt = v("stock");
    const stock = stockTxt === "" ? null : parseInt(stockTxt, 10);
    if (!Number.isInteger(precio) || precio < 0) return { error: "El precio tiene que ser un número (0 o más)." };
    if (stock !== null && (!Number.isInteger(stock) || stock < 0))
        return { error: "El stock tiene que ser un número, o vacío para ilimitado." };
    const enVenta = db.prepare("SELECT id, objetoId, precio, stock FROM tienda WHERE objetoId = ?").get(obj.id);
    if (enVenta) {
        db.prepare("UPDATE tienda SET precio = ?, stock = ? WHERE id = ?").run(precio, stock, enVenta.id);
        auditar(interaction, "tienda.item.edit", {
            tiendaId: enVenta.id,
            antes: { precio: enVenta.precio, stock: enVenta.stock },
            precio,
            stock,
        });
    } else {
        db.prepare("INSERT INTO tienda (objetoId, precio, stock) VALUES (?, ?, ?)").run(obj.id, precio, stock);
        auditar(interaction, "tienda.item.add", { objetoId: obj.id, nombre: obj.nombre, precio, stock });
    }
    return { aviso: `🏷️ **${obj.nombre}** a la venta por ${precio} 🪙 (stock ${stock ?? "ilimitado"}).` };
}

function quitarDeVenta(interaction, obj) {
    const r = db.prepare("DELETE FROM tienda WHERE objetoId = ?").run(obj.id);
    if (!r.changes) return { error: "Ese objeto no estaba a la venta." };
    auditar(interaction, "tienda.item.remove", { objetoId: obj.id, nombre: obj.nombre });
    return { aviso: `❌ **${obj.nombre}** ya no está a la venta.` };
}

// Aplica el formulario y devuelve el aviso para el panel (o { error }).
function aplicar(interaction) {
    const id = interaction.customId;
    const objetoId = parseInt(leerCampo(interaction, "id"), 10);
    const obj = Number.isInteger(objetoId)
        ? db
              .prepare("SELECT id, nombre, descripcion, imagen, tipo, unico, categoria, rareza, rolId, efecto FROM objeto WHERE id = ?")
              .get(objetoId)
        : null;

    if (id === "paneladmin_cat_crear_modal") return crearObjeto(interaction);
    if (!obj) return { error: "No existe un objeto con ese ID." };
    if (id === "paneladmin_cat_editar_modal") return editarObjeto(interaction, obj);
    if (id === "paneladmin_cat_eliminar_modal") return eliminarObjeto(interaction, obj);
    if (id === "paneladmin_cat_vender_modal") return venderObjeto(interaction, obj);
    if (id === "paneladmin_cat_quitar_modal") return quitarDeVenta(interaction, obj);
    return null;
}

async function handleCatalogoModal(interaction) {
    if (!interaction.customId.startsWith("paneladmin_cat_")) return false;
    const r = aplicar(interaction);
    if (!r) return false;
    if (r.error) {
        await interaction.reply(privado(`❌ ${r.error}`));
        return true;
    }
    if (interaction.isFromMessage?.()) await interaction.update(buildCatalogo(1, r.aviso));
    else await interaction.reply(privado(r.aviso));
    return true;
}

module.exports = { handleCatalogoButton, handleCatalogoModal };
