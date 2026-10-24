// 🎲 Ruleta de películas (#576) en /plex → ⭐ Reseñas: tirar, 🎬 Otra, los filtros y 📝 Quiero ver. Solo reparte: la tirada
// está en systems/plexRuleta y la pantalla en paneles/plexRuleta. Se llama desde commands/plex/plex.js.
const plexRuleta = require("../../systems/plexRuleta");
const plexAvisos = require("../../systems/plexAvisos");
const { pantallaRuleta, leerEstado, TODOS } = require("../../paneles/plexRuleta");
const { efimero } = require("../../discord/respuestas");

const OTRA = "plex_ruleta_otra_";
const QUIERO = "plex_ruleta_quiero_";
const MENU = /^plex_sel_ruleta_(genero|decada|duracion)_(.*)$/;

const tirar = (interaction, opciones) => plexRuleta.tirar(interaction.guildId, interaction.user.id, opciones);
const pintar = (interaction, r, aviso = "") => interaction.update(pantallaRuleta(interaction.guildId, interaction.user.id, r, aviso));

async function handleButton(interaction) {
    const id = interaction.customId;
    if (id === "plex_ruleta") return pintar(interaction, tirar(interaction));
    if (id.startsWith(OTRA)) {
        const { filtros, ratingKey } = leerEstado(id.slice(OTRA.length));
        return pintar(interaction, tirar(interaction, { filtros, anterior: ratingKey }));
    }
    if (id.startsWith(QUIERO)) return quieroVer(interaction, leerEstado(id.slice(QUIERO.length)));
    // ⭐ Puntuar va desactivado (solo se valora lo visto y la ruleta no propone nada visto): por si llega igualmente.
    if (id === "plex_ruleta_puntuar")
        return interaction.reply(efimero({ content: "⭐ Se puntúa al verla: cuando la termines te llega un DM para valorarla." }));
}

/** 📝 Quiero ver: la apunta (si sigue en Plex y sin ver) y repinta la misma ficha con el aviso. */
async function quieroVer(interaction, { filtros, ratingKey }) {
    const r = tirar(interaction, { filtros, fijar: ratingKey });
    const p = r.ok ? r.pelicula : null;
    if (!p || p.ratingKey !== ratingKey) return pintar(interaction, r, "❌ Esa película ya no está en la ruleta (¿la has visto ya?).");
    const a = plexAvisos.apuntarDePlex(interaction.guildId, interaction.user.id, { tmdbId: p.tmdb, titulo: p.titulo, anio: p.anio });
    return pintar(interaction, r, a.ok ? `📝 **${a.titulo}** apuntada en tu lista de «quiero ver».` : `❌ ${a.motivo}`);
}

/** Un menú de filtros: cambia ese filtro y tira otra vez (sin repetir la que había). */
async function handleSelect(interaction) {
    const m = MENU.exec(interaction.customId);
    if (!m) return;
    const { filtros, ratingKey } = leerEstado(m[2]);
    const valor = interaction.values?.[0];
    const nuevos = { ...filtros, [m[1]]: valor === TODOS ? "" : valor };
    return pintar(interaction, tirar(interaction, { filtros: nuevos, anterior: ratingKey }));
}

module.exports = { handleButton, handleSelect };
