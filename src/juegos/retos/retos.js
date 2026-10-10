// Botones de ⚔️ Retos (retos_*). Hay dos clases:
// - Los pasos para lanzar un reto, en el panel de /juegos: solo los usa quien abrió el panel.
// - Los del mensaje público de cada reto (aceptar, jugar, entrar en una porra...): cada acción comprueba quién
//   puede hacerla (el rival, los dos del duelo, un admin...) en systems/retos.js.
// Al lanzar un reto, el panel vuelve a la pestaña ⚔️ Retos y el reto se publica en un mensaje nuevo, mencionando al
// rival. Ese mensaje se edita cuando el reto cambia, también desde el cron (revisarRetos) y la liquidación.
const { MessageFlags } = require("discord.js");
const retos = require("../../systems/retos");
const dinero = require("../../systems/dinero");
const paneles = require("../../paneles/retos");
const { importeElegido } = require("../../paneles/importes");
const { avisarGanadores } = require("../../systems/apuestas/liquidacion");
const { DEPORTES, sincronizarPartidos } = require("../../services/oddsApi");
const { createLogger } = require("../../core/logger");
const { esAdmin } = require("../../core/permisos");

const log = createLogger("Retos");

const privado = (content) => ({ content, flags: MessageFlags.Ephemeral });
// El número de reto va siempre al final del customId.
const retoDe = (customId) => Number(customId.split("_").at(-1));
const leerCantidad = (i) => importeElegido(i.fields);

// Pasos para lanzar un reto (en el panel de /juegos).
const PASOS_PANEL = ["retos_nuevo_", "retos_partido_select", "retos_lado_", "retos_juego_", "retos_rival_"];

async function soloDueno(i) {
    const dueno = i.message?.interaction?.user?.id || i.message?.interactionMetadata?.user?.id;
    if (dueno && dueno !== i.user.id) {
        await i.reply(privado("⛔ Solo quien usó el comando puede interactuar."));
        return false;
    }
    return true;
}

/** Repinta el mensaje público de cada reto (best-effort: si se borró o no hay permisos, se sigue). */
async function actualizarMensajes(client, ids) {
    for (const id of new Set(ids)) {
        const reto = retos.obtener(id);
        if (!reto?.channelId || !reto.messageId) continue;
        try {
            const canal = await client.channels.fetch(reto.channelId);
            await canal.messages.edit(reto.messageId, paneles.mensajeReto(reto));
        } catch (e) {
            log.debug(`No se pudo actualizar el mensaje del reto ${id}: ${e.message}`);
        }
    }
}

/** Cron: cierra lo que se ha quedado colgado, repinta sus mensajes y avisa por DM de lo devuelto o ganado. */
async function revisarRetos(client) {
    const { cerrados, pagos } = retos.revisar();
    if (!cerrados.length) return 0;
    await actualizarMensajes(
        client,
        cerrados.map((r) => r.id),
    );
    await avisarGanadores(client, pagos);
    return cerrados.length;
}

// Publica un reto recién creado: el panel vuelve a ⚔️ Retos y el reto sale en un mensaje nuevo.
async function publicar(i, reto, rivalId = null) {
    await i.update(paneles.buildRetos(i.user.id, "✅ Reto publicado."));
    const mensaje = await i.followUp({
        ...(rivalId ? { content: `<@${rivalId}>, <@${i.user.id}> te ha retado.` } : {}),
        ...paneles.mensajeReto(reto),
        allowedMentions: { users: rivalId ? [rivalId] : [] },
    });
    if (mensaje?.id) retos.guardarMensaje(reto.id, mensaje.channelId || i.channelId, mensaje.id);
}

async function botonPanel(client, i) {
    const id = i.customId;
    if (id === "retos_nuevo_partido") {
        let partidos = retos.partidosParaRetar();
        if (partidos.length) return i.update(paneles.buildElegirPartido(partidos));
        // Sin partidos cargados todavía: se piden a la Odds API (con su caché, como la pestaña ⚽ Apuestas).
        await i.deferUpdate();
        for (const deporte of Object.keys(DEPORTES)) {
            await sincronizarPartidos(deporte).catch((e) => log.warn(`No se pudieron cargar los partidos de ${deporte}: ${e.message}`));
        }
        partidos = retos.partidosParaRetar();
        return i.editReply(paneles.buildElegirPartido(partidos));
    }
    if (id === "retos_nuevo_duelo") return i.update(paneles.buildElegirJuego());
    if (id === "retos_nuevo_porra") return i.showModal(paneles.modalPorra());
    // retos_lado_{eleccion}_{matchId}
    if (id.startsWith("retos_lado_")) {
        const [eleccion, ...resto] = id.replace("retos_lado_", "").split("_");
        const matchId = resto.join("_");
        const p = retos.partidoDe(matchId);
        if (!p) return i.reply(privado("❌ No encuentro ese partido."));
        return i.update(
            paneles.buildElegirRival(
                `p_${eleccion}_${matchId}`,
                `Vas con **${paneles.ladoTexto(p, eleccion)}** en **${p.home_team} vs ${p.away_team}**.\n` +
                    `Quien elijas irá con lo contrario (**${paneles.contrarioTexto(p, eleccion)}**) y tendrá que aceptar.`,
            ),
        );
    }
    // retos_juego_{juego}
    if (id.startsWith("retos_juego_")) {
        const juego = id.replace("retos_juego_", "");
        const j = retos.JUEGOS[juego];
        if (!j) return i.reply(privado("❌ Ese juego no existe."));
        return i.update(paneles.buildElegirRival(`d_${juego}`, `Duelo de ${j.emoji} **${j.nombre}**. Quien elijas tendrá que aceptar.`));
    }
}

// Lo que se responde a una acción sobre el mensaje público: el mensaje repintado o el error en privado.
async function responder(i, r) {
    if (!r.ok) return i.reply(privado(r.mensaje));
    await i.update(paneles.mensajeReto(r.reto));
    if (r.mensaje) await i.followUp(privado(r.mensaje));
}

async function botonReto(client, i) {
    const id = i.customId;
    const userId = i.user.id;
    const retoId = retoDe(id);

    if (id.startsWith("retos_aceptar_")) {
        const r = retos.aceptar(retoId, userId);
        if (r.ok && r.reto.juego === "blackjack") r.mensaje = "🃏 Pulsa **Mi mano** para jugar tu mano (solo la ves tú).";
        return responder(i, r);
    }
    if (id.startsWith("retos_rechazar_")) return responder(i, retos.rechazar(retoId, userId));
    if (id.startsWith("retos_cancelar_")) return responder(i, retos.cancelar(retoId, userId));
    // retos_ppt_{jugada}_{id}
    if (id.startsWith("retos_ppt_")) return responder(i, retos.jugarPpt(retoId, userId, id.split("_")[2]));

    if (id.startsWith("retos_bj_ver_")) {
        const reto = retos.obtener(retoId);
        if (!reto || reto.tipo !== "duelo" || !retos.esParticipante(reto, userId)) return i.reply(privado("⛔ No juegas en este duelo."));
        return i.reply({ ...paneles.vistaManoBlackjack(reto, userId), flags: MessageFlags.Ephemeral });
    }
    // Pedir o plantarse, desde tu mano (mensaje privado): se repinta tu mano y el mensaje del reto.
    if (id.startsWith("retos_bj_pedir_") || id.startsWith("retos_bj_plantar_")) {
        const r = retos.jugarBlackjack(retoId, userId, id.startsWith("retos_bj_pedir_") ? "pedir" : "plantarse");
        if (!r.ok) return i.reply(privado(r.mensaje));
        await i.update(paneles.vistaManoBlackjack(r.reto, userId));
        await actualizarMensajes(client, [retoId]);
        return;
    }

    // retos_porra_op_{opción}_{id}
    if (id.startsWith("retos_porra_op_")) return responder(i, retos.entrarPorra(retoId, userId, Number(id.split("_")[3])));
    if (id.startsWith("retos_porra_cerrar_")) return responder(i, retos.cerrarPorra(retoId, userId, esAdmin(i)));
    if (id.startsWith("retos_porra_resolver_")) {
        if (!esAdmin(i)) return i.reply(privado("⛔ Solo un admin puede decir qué opción ha ganado."));
        const reto = retos.obtener(retoId);
        if (!reto || !["abierta", "cerrada"].includes(reto.estado)) return i.reply(privado("Esta porra ya está resuelta."));
        return i.reply({ ...paneles.elegirGanadoraPorra(reto), flags: MessageFlags.Ephemeral });
    }
    if (id.startsWith("retos_porra_anular_")) {
        const r = retos.anularPorra(retoId, userId, esAdmin(i));
        await responder(i, r);
        if (r.ok) void avisarGanadores(client, r.pagos);
    }
}

module.exports = {
    componentHandlers: [
        { types: ["button"], prefixes: ["retos_"], method: "handleButton", acl: "juegos" },
        { types: ["stringSelect"], prefixes: ["retos_partido_select", "retos_porra_ganadora_"], method: "handleSelect", acl: "juegos" },
        { types: ["userSelect"], prefixes: ["retos_rival_"], method: "handleSelect", acl: "juegos" },
        { types: ["modal"], prefixes: ["retos_modal_"], method: "handleModal", acl: "juegos" },
    ],

    async handleButton(client, interaction) {
        if (PASOS_PANEL.some((p) => interaction.customId.startsWith(p))) {
            if (await soloDueno(interaction)) await botonPanel(client, interaction);
            return;
        }
        await botonReto(client, interaction);
    },

    async handleSelect(client, i) {
        const id = i.customId;
        // Un admin dice qué opción de la porra ha ganado (menú privado): se paga y se repinta la porra.
        if (id.startsWith("retos_porra_ganadora_")) {
            const r = retos.resolverPorra(retoDe(id), Number(i.values[0]), esAdmin(i));
            if (!r.ok) return i.update({ content: r.mensaje, components: [] });
            log.info(`${i.user.tag} resolvió la porra ${r.reto.id}: ${r.reto.resultado}`);
            await i.update({ content: `✅ Porra resuelta: ${r.reto.resultado}.`, components: [] });
            await actualizarMensajes(client, [r.reto.id]);
            void avisarGanadores(client, r.pagos);
            return;
        }
        if (!(await soloDueno(i))) return;
        if (id === "retos_partido_select") {
            const p = retos.partidoDe(i.values[0]);
            if (!p) return i.reply(privado("❌ No encuentro ese partido."));
            return i.update(paneles.buildElegirLado(p));
        }
        // retos_rival_{clave}: con el rival elegido, el formulario de la cantidad.
        if (id.startsWith("retos_rival_")) {
            const rival = i.users?.first?.() || { id: i.values[0] };
            if (rival.bot) return i.reply(privado("❌ No puedes retar a un bot."));
            if (rival.id === i.user.id) return i.reply(privado("❌ No puedes retarte a ti mismo."));
            const clave = id.replace("retos_rival_", "");
            return i.showModal(
                paneles.modalCantidad(`retos_modal_${clave}_${rival.id}`, "⚔️ ¿Cuánto os jugáis?", dinero.efectivo(i.user.id)),
            );
        }
    },

    async handleModal(client, i) {
        const id = i.customId;
        const base = { creador: i.user.id, guildId: i.guildId, channelId: i.channelId };
        if (id === "retos_modal_porra") {
            const r = retos.crearPorra({
                ...base,
                pregunta: i.fields.getTextInputValue("pregunta"),
                opciones: retos.leerOpciones(i.fields.getTextInputValue("opciones")),
                cantidad: leerCantidad(i),
            });
            if (!r.ok) return i.reply(privado(r.mensaje));
            return publicar(i, r.reto);
        }
        // retos_modal_p_{eleccion}_{matchId}_{rival} · retos_modal_d_{juego}_{rival}
        const [tipo, ...partes] = id.replace("retos_modal_", "").split("_");
        const rival = partes.pop();
        const r =
            tipo === "p"
                ? retos.crearPartido({ ...base, rival, eleccion: partes[0], matchId: partes.slice(1).join("_"), cantidad: leerCantidad(i) })
                : retos.crearDuelo({ ...base, rival, juego: partes[0], cantidad: leerCantidad(i) });
        if (!r.ok) return i.reply(privado(r.mensaje));
        return publicar(i, r.reto, rival);
    },

    actualizarMensajes,
    revisarRetos,
};
