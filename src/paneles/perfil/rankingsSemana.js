// 🏆 Rankings: 📅 Esta semana (#368), 🗓️ Semanas (#360) y 🏦 Patrimonio neto (#401). Solo embeds; las reglas están en
// systems/clasificacionSemanal, systems/clasificacion/historial y systems/patrimonioNeto.
const { EmbedBuilder } = require("discord.js");
const guildSettings = require("../../systems/guildSettings");
const clasificacion = require("../../systems/clasificacionSemanal");
const historial = require("../../systems/clasificacion/historial");
const patrimonioNeto = require("../../systems/patrimonioNeto");
const { momentoMadrid, lunesDe, sumarDias, fechaMadridAMs, aFecha } = require("../../core/zonaMadrid");
const { fmtNumero } = require("../../core/formato");
const { MEDALLAS } = require("./basicos");

const medalla = (i) => MEDALLAS[i] || `**${i + 1}.**`;

/** Cuándo se publica la próxima clasificación: el próximo lunes a la hora de publicación, en hora de Madrid (ms). */
function proximaPublicacion(ahora = Date.now()) {
    const { dia, hora } = momentoMadrid(ahora);
    let lunes = lunesDe(dia);
    if (!(lunes === dia && hora < clasificacion.HORA)) lunes = sumarDias(lunes, 7);
    const [a, m, d] = lunes.split("-");
    return fechaMadridAMs(`${d}/${m}/${a} ${clasificacion.HORA}:00`);
}

/** 📅 Esta semana: el top 10 por XP ganada desde el último corte, con la fecha de la próxima publicación. */
function embedEstaSemana(guildId, ahora = Date.now()) {
    const cfg = guildSettings.getSettings(guildId).clasificacion;
    const lista = clasificacion.ranking(guildId, 10).filter((r) => r.xp > 0);
    const proxima = Math.floor(proximaPublicacion(ahora) / 1000);
    const embed = new EmbedBuilder()
        .setTitle("📅 Esta semana")
        .setDescription(
            lista.map((r, i) => `${medalla(i)} <@${r.userId}> — **+${fmtNumero(r.xp)}** XP`).join("\n") ||
                "Nadie ha ganado XP desde el último corte.",
        )
        .setColor(0x3498db);
    const pie = cfg.canal
        ? `Se publica la clasificación <t:${proxima}:F> (<t:${proxima}:R>).`
        : "⚠️ Sin canal de clasificación no hay cortes: esta lista cuenta la XP desde que se instaló el bot, y no se publica nada.";
    return embed.addFields({ name: "⏳ Próxima clasificación", value: pie });
}

/** 🗓️ Semanas: los ganadores de las últimas 8 semanas, la más reciente primero. */
function embedSemanas(guildId) {
    const semanas = historial.ultimasSemanas(guildId, 8);
    const embed = new EmbedBuilder().setTitle("🗓️ Ganadores de las últimas semanas").setColor(0xf1c40f);
    if (!semanas.length) return embed.setDescription("Todavía no hay semanas guardadas: se guardan desde la próxima clasificación.");
    for (const s of semanas) {
        const lineas = clasificacion.CATEGORIAS.filter((c) => s.ganadores[c.id]).map((c) => `${c.emoji} <@${s.ganadores[c.id].userId}>`);
        const fecha = aFecha(s.semana).toLocaleDateString("es-ES", { day: "numeric", month: "long", timeZone: "UTC" });
        embed.addFields({ name: `Semana del ${fecha}`, value: lineas.join(" · ") || "—" });
    }
    return embed;
}

/** 🏦 Patrimonio neto: efectivo + banco + negocios + cripto valorada. */
function embedPatrimonioNeto() {
    const lineas = patrimonioNeto
        .ranking(10)
        .map(
            (f, i) =>
                `${medalla(i)} <@${f.userId}> — **${fmtNumero(f.total)}** 🪙\n   💵 ${fmtNumero(f.efectivo)} · 🏦 ${fmtNumero(f.banco)} · 🏪 ${fmtNumero(f.negocios)} · 💹 ${fmtNumero(f.cripto)}`,
        );
    return new EmbedBuilder()
        .setTitle("🏦 Patrimonio neto")
        .setDescription(lineas.join("\n") || "Nadie tiene patrimonio todavía.")
        .setFooter({ text: "Efectivo + banco + negocios (lo pagado) + cripto valorada. El dinero negro no cuenta hasta blanquearse." })
        .setColor(0x16a085);
}

module.exports = { proximaPublicacion, embedEstaSemana, embedSemanas, embedPatrimonioNeto };
