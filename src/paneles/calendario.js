// 📅 La vista del calendario (#540): los eventos de una semana o un mes agrupados por día (en hora de Madrid) con su hora en
// timestamp de Discord, botones para ir a la anterior y la siguiente y cambiar de vista, y un desplegable para ver el detalle
// de uno (con el enlace al mensaje original si lo hay). Sin eventos lo explica en vez de quedarse en blanco.
const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder } = require("discord.js");
const calendario = require("../systems/calendario");
const { momentoMadrid } = require("../core/zonaMadrid");
const { paginaDeLista } = require("./menuPaginado");

const COLOR = 0x16a085;
const MAX_DESCRIPCION = 3800;
const DIAS = ["lunes", "martes", "miércoles", "jueves", "viernes", "sábado", "domingo"];
const MESES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];

const ts = (ms, estilo) => `<t:${Math.floor(ms / 1000)}:${estilo}>`;
const corto = (t, n) => (String(t).length > n ? `${String(t).slice(0, n - 1)}…` : String(t));

/** «sábado 25/10» de un instante, en hora de Madrid. */
function cabeceraDia(ms) {
    const m = momentoMadrid(ms);
    const indice = (new Date(`${m.dia}T00:00:00Z`).getUTCDay() + 6) % 7;
    return `${DIAS[indice]} ${m.dia.slice(8, 10)}/${m.dia.slice(5, 7)}`;
}

function lineaEvento(e) {
    const hora = e.diaEntero ? "todo el día" : ts(e.inicio, "t");
    return `${e.emoji} ${hora} · ${e.enlace ? `[${e.titulo}](${e.enlace})` : e.titulo}`;
}

/** El texto de la lista, agrupado por día y sin pasar del límite de un embed. */
function textoEventos(eventos) {
    if (!eventos.length) return "No hay nada programado. Cuando haya sesiones de cine, partidos, quinielas o eventos, saldrán aquí.";
    const partes = [];
    let diaActual = null;
    let mostrados = 0;
    for (const e of eventos) {
        const cabecera = `**${cabeceraDia(e.inicio)}**`;
        const trozo = (cabecera !== diaActual ? `${partes.length ? "\n" : ""}${cabecera}\n` : "") + lineaEvento(e);
        if (partes.join("\n").length + trozo.length > MAX_DESCRIPCION) break;
        partes.push(trozo);
        diaActual = cabecera;
        mostrados++;
    }
    if (mostrados < eventos.length) partes.push(`\n…y ${eventos.length - mostrados} más.`);
    return partes.join("\n");
}

/**
 * La vista. `modo`: "sem" o "mes"; `offset`: semanas o meses desde el actual.
 * @returns {{ embeds, components, allowedMentions }}
 */
function vista(guildId, { modo = "sem", offset = 0, ahora = Date.now() } = {}) {
    const rango = modo === "mes" ? calendario.rangoMes(ahora, offset) : calendario.rangoSemana(ahora, offset);
    const eventos = calendario.eventos(guildId, rango.desde, rango.hasta);
    const titulo =
        modo === "mes"
            ? `📅 ${MESES[rango.mes - 1]} de ${rango.anio}`
            : `📅 Semana del ${rango.lunes.slice(8, 10)}/${rango.lunes.slice(5, 7)}`;
    const embed = new EmbedBuilder()
        .setTitle(titulo)
        .setDescription(textoEventos(eventos))
        .setFooter({ text: "Las horas salen en tu zona horaria. Los eventos se crean en hora de Madrid." })
        .setColor(COLOR);
    const nav = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId(`calendario_ver_${modo}_${offset - 1}`)
            .setLabel("◀ Anterior")
            .setStyle(ButtonStyle.Secondary),
        new ButtonBuilder()
            .setCustomId(`calendario_ver_${modo}_0`)
            .setLabel(modo === "mes" ? "Este mes" : "Esta semana")
            .setStyle(ButtonStyle.Primary)
            .setDisabled(offset === 0),
        new ButtonBuilder()
            .setCustomId(`calendario_ver_${modo}_${offset + 1}`)
            .setLabel("Siguiente ▶")
            .setStyle(ButtonStyle.Secondary),
        new ButtonBuilder()
            .setCustomId(`calendario_ver_${modo === "mes" ? "sem" : "mes"}_0`)
            .setLabel(modo === "mes" ? "🗓️ Por semanas" : "🗓️ Por meses")
            .setStyle(ButtonStyle.Secondary),
    );
    const filas = [nav];
    if (eventos.length) {
        filas.push(
            new ActionRowBuilder().addComponents(
                new StringSelectMenuBuilder()
                    .setCustomId(`calendario_det_${modo}_${offset}`)
                    .setPlaceholder("Ver el detalle de un evento")
                    .addOptions(
                        paginaDeLista(eventos).items.map((e) => ({
                            label: corto(`${e.emoji} ${e.titulo.replace(/<@!?(\d+)>/g, "alguien")}`, 100),
                            description: corto(cabeceraDia(e.inicio), 100),
                            value: e.clave,
                        })),
                    ),
            ),
        );
    }
    return { content: "", embeds: [embed], components: filas, allowedMentions: { parse: [] } };
}

/** El detalle de un evento (privado). */
function detalle(e) {
    const embed = new EmbedBuilder()
        .setTitle(`${e.emoji} ${corto(e.titulo.replace(/<@!?(\d+)>/g, "alguien"), 240)}`)
        .setDescription(
            `${e.titulo}\n\n🕐 ${e.diaEntero ? `${ts(e.inicio, "D")} (todo el día)` : `${ts(e.inicio, "F")} (${ts(e.inicio, "R")})`}` +
                (e.enlace ? `\n🔗 [Ir al mensaje](${e.enlace})` : ""),
        )
        .setColor(COLOR);
    return { embeds: [embed], allowedMentions: { parse: [] } };
}

/** El recordatorio que sale en el canal fijo. */
function recordatorio(e) {
    return {
        content: `⏰ **Dentro de poco** (${ts(e.inicio, "R")}): ${e.emoji} ${e.titulo}` + (e.enlace ? `\n🔗 ${e.enlace}` : ""),
        allowedMentions: { parse: [] },
    };
}

module.exports = { vista, detalle, recordatorio, textoEventos };
