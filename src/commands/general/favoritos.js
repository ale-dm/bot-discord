// ⭐ /favoritos (#530): seguir y dejar equipos y ver los próximos partidos de los que sigues. El aviso por DM sale
// solo al refrescar las cuotas (systems/apuestas/favoritos.avisarPartidos) y se puede apagar en /avisos.
const { SlashCommandBuilder } = require("discord.js");
const favoritos = require("../../systems/apuestas/favoritos");
const { buildFavoritos } = require("../../paneles/favoritos");
const { DEPORTES } = require("../../services/oddsApi");
const { MAX_OPCIONES } = require("../../paneles/menuPaginado");
const { efimero } = require("../../discord/respuestas");

const opcionEquipo = (o) =>
    o.setName("equipo").setDescription("El nombre del equipo (empieza a escribir y elige)").setRequired(true).setAutocomplete(true);

function textoProximo(userId, equipo) {
    const clave = favoritos.normalizar(equipo);
    const p = favoritos
        .proximos(userId, { limite: 50 })
        .find((x) => favoritos.normalizar(x.home_team) === clave || favoritos.normalizar(x.away_team) === clave);
    if (!p) return "";
    const unix = Math.floor(Date.parse(p.start_time) / 1000);
    const deporte = DEPORTES[p.deporte] || DEPORTES.laliga;
    return `\n📅 Su próximo partido: ${deporte.emoji} **${p.home_team} vs ${p.away_team}** · ${deporte.name} · <t:${unix}:f> (<t:${unix}:R>).`;
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName("favoritos")
        .setDescription("⭐ Sigue equipos y recibe avisos de sus partidos")
        .addSubcommand((s) =>
            s
                .setName("seguir")
                .setDescription("Sigue a un equipo para que te avise cuando aparezca un partido")
                .addStringOption(opcionEquipo),
        )
        .addSubcommand((s) => s.setName("dejar").setDescription("Deja de seguir a un equipo").addStringOption(opcionEquipo))
        .addSubcommand((s) => s.setName("lista").setDescription("Tus equipos y sus próximos partidos")),

    /** Autocompletado: en `seguir`, el catálogo de partidos; en `dejar`, los equipos que ya sigue. */
    async autocomplete(client, interaction) {
        const texto = String(interaction.options.getFocused() ?? "");
        const sub = interaction.options.getSubcommand();
        const nombres =
            sub === "dejar"
                ? favoritos
                      .seguidos(interaction.user.id)
                      .map((f) => f.equipo)
                      .filter((nombre) => favoritos.normalizar(nombre).includes(favoritos.normalizar(texto)))
                : favoritos.equiposDisponibles({ texto });
        await interaction.respond(nombres.slice(0, MAX_OPCIONES).map((nombre) => ({ name: nombre.slice(0, 100), value: nombre })));
    },

    async run(client, interaction) {
        const userId = interaction.user.id;
        const sub = interaction.options.getSubcommand();
        if (sub === "lista") return interaction.reply(efimero(buildFavoritos(userId)));

        const texto = interaction.options.getString("equipo");
        if (sub === "seguir") {
            const r = favoritos.seguir(userId, texto);
            if (!r.ok) return interaction.reply(efimero(r.motivo));
            return interaction.reply(efimero(`✅ Sigues a **${r.equipo}**.${textoProximo(userId, r.equipo)}`));
        }
        if (sub === "dejar") {
            const r = favoritos.dejar(userId, texto);
            if (!r.ok) return interaction.reply(efimero(r.motivo));
            return interaction.reply(efimero(`✅ Ya no sigues a **${r.equipo}**.`));
        }
        return interaction.reply(efimero("❌ Esa opción de /favoritos no existe."));
    },
};
