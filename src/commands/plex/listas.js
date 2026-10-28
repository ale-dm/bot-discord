// 📚 Botones, menús y formularios de las listas de películas (#575) en /plex → ⭐ Reseñas. Solo reparte: las reglas están
// en systems/plexListas y las pantallas en paneles/plexListas. Se llama desde commands/plex/plex.js.
const plexListas = require("../../systems/plexListas");
const {
    pantallaListas,
    pantallaLista,
    pantallaBuscar,
    confirmarBorrar,
    formularioLista,
    formularioBuscar,
} = require("../../paneles/plexListas");
const { pantallaTitulo } = require("../../paneles/plexResenas");

/** Repinta la lista con un aviso (✅ hecho o ❌ el motivo). */
const pintarLista = (interaction, listaId, opciones, r, hecho) =>
    interaction.update(pantallaLista(interaction.guildId, interaction.user.id, listaId, opciones, r.ok ? hecho : `❌ ${r.motivo}`));

/** Lo que solo puede hacer el dueño: abrir los formularios, cambiar la visibilidad y borrar. */
function accionDeDueno(interaction, accion, listaId) {
    const { guildId, user } = interaction;
    const lista = plexListas.obtener(listaId);
    if (!lista || lista.userId !== user.id) {
        return interaction.update(pantallaListas(guildId, user.id, "mias", 0, "❌ Esa lista no es tuya."));
    }
    if (accion === "add") return interaction.showModal(formularioBuscar(lista.id));
    if (accion === "editar") return interaction.showModal(formularioLista(lista));
    if (accion === "borrar") return interaction.update(confirmarBorrar(lista));
    if (accion === "vis") {
        const r = plexListas.cambiarVisibilidad(lista.id, user.id);
        const hecho = r.ok && r.lista.publica ? "🌍 Ahora la ve todo el servidor." : "🔒 Ahora solo la ves tú.";
        return pintarLista(interaction, lista.id, {}, r, hecho);
    }
    const r = plexListas.borrar(lista.id, user.id);
    return interaction.update(
        pantallaListas(guildId, user.id, "mias", 0, r.ok ? `🗑️ Lista **${lista.titulo}** borrada.` : `❌ ${r.motivo}`),
    );
}

/** ⬆️ ⬇️ ❌ ⭐ sobre el título de la posición `pos`. */
function accionSobreTitulo(interaction, accion, listaId, pos) {
    const { guildId, user } = interaction;
    if (accion === "ficha") {
        const lista = plexListas.obtener(listaId);
        const item = plexListas.puedeVer(lista, user.id) ? plexListas.items(listaId)[pos - 1] : null;
        if (!item) return interaction.update(pantallaListas(guildId, user.id, "mias", 0, "❌ Ese título ya no está en la lista."));
        return interaction.update(pantallaTitulo(guildId, user.id, item.clave));
    }
    if (accion === "quitar") {
        const r = plexListas.quitar(listaId, user.id, pos);
        return pintarLista(interaction, listaId, {}, r, r.ok ? `❌ Quitada **${r.item.titulo}**.` : "");
    }
    const r = plexListas.mover(listaId, user.id, pos, accion === "sub" ? -1 : 1);
    return pintarLista(interaction, listaId, { elegido: r.ok ? r.posicion : 0 }, r, "↕️ Movida.");
}

async function handleButton(interaction) {
    const { customId: id, guildId, user } = interaction;
    if (id === "plex_listas" || id === "plex_listas_mias") return interaction.update(pantallaListas(guildId, user.id, "mias"));
    if (id === "plex_listas_publicas") return interaction.update(pantallaListas(guildId, user.id, "publicas"));
    if (id === "plex_listas_nueva") return interaction.showModal(formularioLista());
    const pag = /^plex_listas_pag_(mias|publicas)_(\d+)$/.exec(id);
    if (pag) return interaction.update(pantallaListas(guildId, user.id, pag[1], Number(pag[2])));
    const ver = /^plex_lista_ver_(\d+)_(\d+)$/.exec(id);
    if (ver) return interaction.update(pantallaLista(guildId, user.id, Number(ver[1]), { pagina: Number(ver[2]) }));
    const dueno = /^plex_lista_(add|editar|vis|borrar|borrarsi)_(\d+)$/.exec(id);
    if (dueno) return accionDeDueno(interaction, dueno[1], Number(dueno[2]));
    const titulo = /^plex_lista_(sub|baj|quitar|ficha)_(\d+)_(\d+)$/.exec(id);
    if (titulo) return accionSobreTitulo(interaction, titulo[1], Number(titulo[2]), Number(titulo[3]));
}

/** El desplegable de títulos de una lista (elegir uno) y el de resultados de la búsqueda (añadirlo). */
async function handleSelect(interaction) {
    const { customId: id, guildId, user } = interaction;
    const valor = interaction.values?.[0];
    const item = /^plex_sel_lista_item_(\d+)$/.exec(id);
    if (item) return interaction.update(pantallaLista(guildId, user.id, Number(item[1]), { elegido: Number(valor) }));
    const add = /^plex_sel_lista_add_(\d+)$/.exec(id);
    if (!add) return;
    const r = plexListas.anadir(Number(add[1]), user.id, valor);
    const total = r.ok ? plexListas.items(Number(add[1])).length : 0;
    return pintarLista(interaction, Number(add[1]), { elegido: total }, r, r.ok ? `➕ Añadida **${r.titulo.titulo}**.` : "");
}

async function handleModal(interaction) {
    const { customId: id, guildId, user } = interaction;
    const campos = () => ({
        titulo: interaction.fields.getTextInputValue("titulo"),
        descripcion: interaction.fields.getTextInputValue("descripcion") || "",
    });
    if (id === "plex_modal_lista_nueva") {
        const r = plexListas.crear(guildId, user.id, campos());
        if (!r.ok) return interaction.update(pantallaListas(guildId, user.id, "mias", 0, `❌ ${r.motivo}`));
        return interaction.update(pantallaLista(guildId, user.id, r.lista.id, {}, "📚 Lista creada. Añade títulos con **➕ Añadir**."));
    }
    const editar = /^plex_modal_lista_editar_(\d+)$/.exec(id);
    if (editar)
        return pintarLista(interaction, Number(editar[1]), {}, plexListas.editar(Number(editar[1]), user.id, campos()), "✏️ Guardada.");
    const buscar = /^plex_modal_lista_buscar_(\d+)$/.exec(id);
    if (!buscar) return;
    const lista = plexListas.obtener(Number(buscar[1]));
    if (!lista || lista.userId !== user.id)
        return interaction.update(pantallaListas(guildId, user.id, "mias", 0, "❌ Esa lista no es tuya."));
    const texto = interaction.fields.getTextInputValue("texto");
    return interaction.update(pantallaBuscar(lista, texto, plexListas.buscar(guildId, texto)));
}

module.exports = { handleButton, handleSelect, handleModal };
