// Herramienta consultar_trofeos_plex del Duende: los trofeos de una persona, quién tiene un trofeo y el ranking del
// servidor. Sacada de herramientas/plex.js para que ese fichero siga por debajo de 400 líneas.

const achievementsSystem = require("../../../systems/achievementsSystem");
const plexLinks = require("../../../systems/plexLinks");
const { resolverPersonaVinculada } = require("./base");

/** Los trofeos y logros de Plex que ha completado una persona del servidor. */
async function trofeosDePersona(args, ctx, { plexTrofeos, nombre, dificultad }) {
    const r = await resolverPersonaVinculada(args.persona, ctx);
    if (r.error) return r;
    // Quien oculta sus logros de Plex no los enseña (salvo a sí mismo).
    if (r.discordId !== ctx.userId && plexTrofeos.oculto(ctx.guildId, r.discordId)) {
        return { persona: args.persona, oculto: true, error: `${args.persona} tiene sus logros de Plex ocultos.` };
    }
    const plex = achievementsSystem.listUserAchievements(ctx.guildId, r.discordId).filter((a) => a.category === "plex");
    const hechos = plex.filter((a) => a.completed).sort((a, b) => b.completedAt - a.completedAt);
    const rarezas = plexTrofeos.rarezas(ctx.guildId);
    const porDificultad = (d) => hechos.filter((a) => a.dificultad === d).length;
    return {
        persona: args.persona,
        logros_de_plex_completados: hechos.length,
        logros_de_plex_totales: plex.length,
        por_dificultad: { facil: porDificultad("facil"), normal: porDificultad("normal"), gordo_del_plex: porDificultad("gordo") },
        trofeos: hechos
            .filter((a) => a.trofeo)
            .slice(0, 15)
            .map((a) => ({
                nombre: a.name,
                de_que_es: a.desc,
                dificultad: dificultad(a.dificultad),
                lo_tiene_el_pct_del_servidor: rarezas.get(a.id) || null,
            })),
        ultimos_conseguidos: hechos.slice(0, 10).map((a) => ({
            nombre: a.name,
            descripcion: a.desc,
            fecha: new Date(a.completedAt).toISOString().slice(0, 10),
        })),
        sin_reclamar: hechos.filter((a) => a.claimable).length,
    };
}

/** Quién tiene el trofeo de una serie, saga, película o director. */
function trofeosDeTitulo(args, ctx, { plexTrofeos, nombre, dificultad }) {
    const lista = plexTrofeos.buscar(ctx.guildId, args.titulo);
    if (!lista.length) {
        return {
            titulo: args.titulo,
            encontrado: false,
            nota: "Nadie tiene todavía un trofeo de eso (los de cada serie, saga o director se crean cuando alguien lo consigue).",
        };
    }
    return {
        titulo: args.titulo,
        trofeos: lista.map((t) => ({
            nombre: t.nombre,
            de_que_es: t.descripcion,
            dificultad: dificultad(t.dificultad),
            quien_lo_tiene: t.quienes.map(nombre),
        })),
    };
}

/** Sin persona ni título: quién tiene más logros de Plex, más gordos del Plex y más logros de idioma. */
function rankingTrofeos(ctx, nombre) {
    const r = require("../../../systems/plexRankings").rankings(ctx.guildId);
    if (!r) return { error: "Nadie tiene la cuenta de Plex vinculada todavía." };
    return {
        mas_logros_de_plex: r.logros.map((x) => ({ persona: nombre(x.discordUserId), logros: x.n })),
        mas_gordos_del_plex: r.gordos.map((x) => ({ persona: nombre(x.discordUserId), gordos: x.n })),
        mas_poliglota: r.poliglota.map((x) => ({ persona: nombre(x.discordUserId), logros_de_idioma: x.n })),
    };
}

async function consultarTrofeosPlex(args, ctx) {
    if (!ctx.guildId) return { error: "Solo disponible en servidores." };
    const plexTrofeos = require("../../../systems/plexTrofeos");
    const plexIdiomas = require("../../../systems/plexIdiomas");
    const nombre = (discordId) =>
        ctx.guild?.members?.cache?.get(discordId)?.displayName ||
        plexLinks.getLinkByDiscordId(ctx.guildId, discordId)?.plexUsername ||
        "alguien";
    const dificultad = (d) => plexIdiomas.DIFICULTADES[d]?.nombre || null;
    const ayudas = { plexTrofeos, nombre, dificultad };

    if (args?.persona) return trofeosDePersona(args, ctx, ayudas);
    if (args?.titulo) return trofeosDeTitulo(args, ctx, ayudas);
    return rankingTrofeos(ctx, nombre);
}

module.exports = { consultarTrofeosPlex };
