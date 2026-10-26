// 🗳️ El mensaje público de unas elecciones: en qué fase están, cuándo acaba, quién se presenta, el recuento de votos (sin
// decir a quién va cada voto secreto) y los últimos votos públicos, con los botones de la fase. También los anuncios que se
// publican al cambiar de fase. Solo construye mensajes; las reglas están en systems/elecciones.
const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require("discord.js");
const { fases, repo, votos, candidatos: reglasCandidatos } = require("../../systems/elecciones");

const COLOR = {
    inscripcion: 0x3498db,
    primarias: 0x9b59b6,
    programas: 0xf1c40f,
    generales: 0xe67e22,
    mandato: 0xf39c12,
    cerrada: 0x95a5a6,
    cancelada: 0x95a5a6,
};
const EXPLICACION = {
    inscripcion:
        "¿Quieres ser presidente del servidor? Pulsa **🙋 Presentarme**. Cuando acabe la inscripción empiezan las primarias: " +
        `los **${fases.FINALISTAS}** más votados pasan a las generales.`,
    primarias:
        `Vota a tu candidato con **🗳️ Votar**: los **${fases.FINALISTAS}** más votados pasan a las generales. ` +
        "Eliges si tu voto es 🔒 secreto o 📢 público, y puedes cambiarlo hasta el cierre.",
    programas:
        "Los finalistas eligen el nombre de su partido, su eslogan y su programa electoral con **✍️ Mi programa**. " +
        "Cuando empiecen las generales, " +
        "se envía por privado a todos los que pueden votar.",
    generales:
        "Lee los programas con **📜 Programas** y vota con **🗳️ Votar**. El más votado será el presidente. " +
        "Eliges si tu voto es 🔒 secreto o 📢 público, y puedes cambiarlo hasta el cierre.",
    mandato:
        "El presidente puede mover, desconectar, silenciar o ensordecer en voz a los miembros y crear canales con `/presidente`, " +
        "pero nunca a los admins ni al staff.",
};
const MAX_LISTA = 25;
const MAX_PUBLICOS = 10;
/** Un campo de embed admite 1024 caracteres: con 15 líneas de resultados sobra sitio. */
const MAX_RESULTADOS = 15;

const ts = (ms, estilo = "R") => `<t:${Math.floor(ms / 1000)}:${estilo}>`;
const plural = (n, uno, varios) => `${n} ${n === 1 ? uno : varios}`;

/** «🎗️ **Partido** «eslogan»», o «⏳ sin programa» si aún no lo ha entregado. */
const partidoDe = (c) => (c.partido ? `🎗️ **${c.partido}** «${c.eslogan}»` : "⏳ sin programa");

function lineaCandidato(c, eleccion) {
    if (eleccion.estado === "programas" || eleccion.estado === "generales") return `• <@${c.userId}> — ${partidoDe(c)}`;
    return `• <@${c.userId}>`;
}

/** El campo con la papeleta (o la lista de inscritos) de la fase. */
function campoCandidatos(eleccion) {
    const finalistas = eleccion.estado === "programas" || eleccion.estado === "generales";
    const lista = repo.candidatos(eleccion.id, { finalistas });
    const lineas = lista.slice(0, MAX_LISTA).map((c) => lineaCandidato(c, eleccion));
    const titulo = finalistas ? `Finalistas (${lista.length})` : `Candidatos (${lista.length}/${reglasCandidatos.MAX_CANDIDATOS})`;
    return { name: titulo, value: lineas.join("\n") || "Nadie todavía." };
}

/** Los campos del recuento: total de votos y los últimos públicos. Mientras se vota no se enseña quién va ganando. */
function camposVotacion(eleccion) {
    const fase = eleccion.estado;
    const total = repo.totalVotos(eleccion.id, fase);
    const publicos = repo.votosPublicos(eleccion.id, fase, MAX_PUBLICOS);
    const lista = [
        {
            name: "Recuento",
            value: `${plural(total, "voto", "votos")} · ${repo.totalPublicos(eleccion.id, fase)} 📢 públicos · el resultado se ve al cierre`,
        },
    ];
    if (publicos.length) {
        lista.push({
            name: "📢 Últimos votos públicos",
            value: publicos.map((v) => `<@${v.votanteId}> → <@${v.candidatoId}>`).join("\n"),
        });
    }
    return lista;
}

/** La clasificación final de una fase de votación: «1. @x — 12 votos». */
function tablaResultados(tabla, limite = MAX_RESULTADOS) {
    return (
        tabla
            .slice(0, limite)
            .map(
                (c, n) =>
                    `${n === 0 ? "🥇" : `${n + 1}.`} <@${c.userId}>${c.partido ? ` (${c.partido})` : ""} — ${plural(c.votos, "voto", "votos")}`,
            )
            .join("\n") || "Sin votos."
    );
}

function campos(eleccion) {
    switch (eleccion.estado) {
        case "inscripcion":
        case "programas":
            return [campoCandidatos(eleccion)];
        case "primarias":
        case "generales":
            return [campoCandidatos(eleccion), ...camposVotacion(eleccion)];
        case "mandato":
            return [
                { name: "👑 Presidente", value: `<@${eleccion.presidenteId}> hasta ${ts(eleccion.fase_fin, "f")}` },
                { name: "Resultado de las generales", value: tablaResultados(votos.clasificacion(eleccion.id, "generales")) },
            ];
        default:
            return eleccion.presidenteId
                ? [{ name: "👑 Fue presidente", value: `<@${eleccion.presidenteId}>` }]
                : [{ name: "Motivo", value: eleccion.motivo_cierre || "—" }];
    }
}

const boton = (id, etiqueta, estilo = ButtonStyle.Secondary) => new ButtonBuilder().setCustomId(id).setLabel(etiqueta).setStyle(estilo);

/** Los botones de la fase (ninguno si la elección ya ha terminado). */
function botones(eleccion) {
    const id = eleccion.id;
    const retirar = boton(`elec_retirar_${id}`, "🚪 Retirarme");
    const porFase = {
        inscripcion: [boton(`elec_inscribir_${id}`, "🙋 Presentarme", ButtonStyle.Success), retirar],
        primarias: [boton(`elec_votar_${id}`, "🗳️ Votar", ButtonStyle.Primary), retirar],
        programas: [
            boton(`elec_programa_${id}`, "✍️ Mi programa", ButtonStyle.Primary),
            boton(`elec_programas_${id}`, "📜 Programas"),
            retirar,
        ],
        generales: [boton(`elec_votar_${id}`, "🗳️ Votar", ButtonStyle.Primary), boton(`elec_programas_${id}`, "📜 Programas"), retirar],
        mandato: [boton(`elec_programas_${id}`, "📜 Programa del presidente")],
    }[eleccion.estado];
    return porFase ? [new ActionRowBuilder().addComponents(porFase)] : [];
}

/** El mensaje público de unas elecciones, con lo que toca en su fase. */
function mensajeEleccion(eleccion) {
    const enCurso = eleccion.estado !== "cerrada" && eleccion.estado !== "cancelada";
    const plazo = enCurso && eleccion.estado !== "mandato" ? `\n\n⏰ Esta fase acaba ${ts(eleccion.fase_fin)}.` : "";
    const embed = new EmbedBuilder()
        .setTitle(`🗳️ Elecciones a la presidencia · ${fases.NOMBRE_FASE[eleccion.estado]}`)
        .setColor(COLOR[eleccion.estado] ?? COLOR.cerrada)
        .setDescription(`${EXPLICACION[eleccion.estado] ?? "Estas elecciones ya han terminado."}${plazo}`)
        .addFields(campos(eleccion))
        .setFooter({ text: `Elecciones #${eleccion.id} · un voto por persona en cada votación` });
    return { content: "", embeds: [embed], components: botones(eleccion), allowedMentions: { parse: [] } };
}

module.exports = { mensajeEleccion, tablaResultados, plural, ts };
