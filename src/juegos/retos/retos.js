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
const { avisarGanadores } = require("../../discord/envios/apuestas");
const { avisarTurno, enviarRecordatorios } = require("./avisos");
const { botonRevancha } = require("./revancha");
const { DEPORTES, sincronizarPartidos } = require("../../services/oddsApi");
const { createLogger } = require("../../core/logger");
const { esAdmin } = require("../../core/permisos");

const log = createLogger("Retos");

const privado = (content) => ({ content, flags: MessageFlags.Ephemeral });
// El número de reto va siempre al final del customId.
const retoDe = (customId) => Number(customId.split("_").at(-1));
const leerCantidad = (i) => importeElegido(i.fields);
// Un campo opcional del formulario: uno antiguo, sin ese campo, lo deja vacío.
const leerOpcional = (i, id) => {
    try {
        return i.fields.getTextInputValue(id);
    } catch {
        return "";
    }
};
const leerProvocacion = (i) => leerOpcional(i, "provocacion");
// Las partidas del duelo (#436): 3 si se eligió «al mejor de 3»; si no (o con un formulario sin ese campo), 1.
const leerSerie = (i) => {
    try {
        return i.fields.getStringSelectValues(paneles.CAMPO_SERIE, false)?.[0] === "3" ? 3 : 1;
    } catch {
        return 1;
    }
};

// Pasos para lanzar un reto (en el panel de /juegos) y las pantallas de la pestaña ⚔️ Retos.
const PASOS_PANEL = [
    "retos_nuevo_",
    "retos_partido_select",
    "retos_lado_",
    "retos_juego_",
    "retos_rival_",
    "retos_abierto_",
    "retos_bloqueos",
    "retos_desbloquear_",
    "retos_caraacara",
];

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

/**
 * Cron: cierra lo que se ha quedado colgado, repinta sus mensajes (también el de las porras que se cierran solas), avisa por
 * DM de lo devuelto o ganado y recuerda los retos que van a caducar.
 */
async function revisarRetos(client) {
    const { cerrados, pagos, modificados, recordatorios } = retos.revisar();
    await actualizarMensajes(
        client,
        [...cerrados, ...modificados].map((r) => r.id),
    );
    await avisarGanadores(client, pagos);
    await enviarRecordatorios(client, recordatorios);
    return cerrados.length + modificados.length;
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
        return i.update(
            paneles.buildElegirRival(
                `d_${juego}`,
                `Duelo de ${j.emoji} **${j.nombre}**. Elige a quién retas, o lánzalo **abierto** para que lo acepte el primero que quiera.`,
            ),
        );
    }
    // retos_abierto_d_{juego}: un duelo sin rival fijo (#438); el formulario de la cantidad ya no lleva a nadie.
    if (id.startsWith("retos_abierto_")) {
        const clave = id.replace("retos_abierto_", "");
        const j = retos.JUEGOS[clave.replace("d_", "")];
        if (!j) return i.reply(privado("❌ Ese juego no existe."));
        return i.showModal(
            paneles.modalCantidad(`retos_modal_${clave}_abierto`, "⚔️ ¿Cuánto os jugáis?", dinero.efectivo(i.user.id), { conSerie: true }),
        );
    }
    // 🚫 Bloqueos (#450) y 🆚 cara a cara (#437), en la pestaña ⚔️ Retos.
    if (id === "retos_bloqueos") return i.update(paneles.buildBloqueos(i.user.id));
    if (id.startsWith("retos_desbloquear_")) {
        const quito = retos.desbloquear(i.user.id, id.replace("retos_desbloquear_", ""));
        return i.update(
            paneles.buildBloqueos(i.user.id, quito ? "✅ Desbloqueado: ya puede retarte otra vez." : "Esa persona ya no estaba bloqueada."),
        );
    }
    if (id === "retos_caraacara") return i.reply({ ...paneles.elegirRivalCaraACara(), flags: MessageFlags.Ephemeral });
}

// Lo que se responde a una acción sobre el mensaje público: el mensaje repintado o el error en privado.
async function responder(i, r) {
    if (!r.ok) return i.reply(privado(r.mensaje));
    await i.update(paneles.mensajeReto(r.reto));
    if (r.mensaje) await i.followUp(privado(r.mensaje));
}

/** 💬 Contraoferta (#442): solo el rival de un reto pendiente puede proponerla; abre el formulario con la cantidad. */
async function abrirContraoferta(i, retoId) {
    const reto = retos.obtener(retoId);
    if (!reto || reto.estado !== "pendiente") return i.reply(privado("Este reto ya no está pendiente."));
    if (reto.rival !== i.user.id) return i.reply(privado("⛔ Este reto no es para ti."));
    if (reto.contraoferta) return i.reply(privado("💬 Ya has hecho una contraoferta en este reto: solo se permite una."));
    return i.showModal(
        paneles.modalCantidad(`retos_modal_contra_${retoId}`, "💬 Contraoferta de cantidad", dinero.efectivo(i.user.id), {
            conProvocacion: false,
        }),
    );
}

/** 🚫 Bloquear (#450): el rival bloquea a quien le retó; se devuelven los retos pendientes entre los dos y se repintan. */
async function bloquearDesdeReto(client, i, retoId) {
    const r = retos.bloquearDesdeReto(retoId, i.user.id);
    if (!r.ok) return i.reply(privado(r.mensaje));
    const bloqueado = r.devueltos.find((d) => d.id === retoId)?.creador;
    await i.reply(
        privado(
            `🚫 Has bloqueado a ${bloqueado ? `<@${bloqueado}>` : "esa persona"}: ya no puede retarte y los retos pendientes entre vosotros se han devuelto. ` +
                "Puedes quitarlo en `/juegos` → ⚔️ Retos → 🚫 Bloqueos.",
        ),
    );
    await actualizarMensajes(
        client,
        r.devueltos.map((d) => d.id),
    );
    void avisarGanadores(client, r.pagos);
}

// Al aceptar un duelo de blackjack, cada uno juega su mano en privado: se le dice cómo.
function conAvisoBlackjack(r) {
    if (r.ok && r.reto.juego === "blackjack") r.mensaje = "🃏 Pulsa **Mi mano** para jugar tu mano (solo la ves tú).";
    return r;
}

async function botonReto(client, i) {
    const id = i.customId;
    const userId = i.user.id;
    const retoId = retoDe(id);

    if (id.startsWith("retos_aceptar_")) return responder(i, conAvisoBlackjack(retos.aceptar(retoId, userId)));
    if (id.startsWith("retos_rechazar_")) return responder(i, retos.rechazar(retoId, userId));
    if (id.startsWith("retos_cancelar_")) return responder(i, retos.cancelar(retoId, userId));
    if (id.startsWith("retos_acepcontra_")) return responder(i, conAvisoBlackjack(retos.aceptarContraoferta(retoId, userId)));
    if (id.startsWith("retos_contra_")) return abrirContraoferta(i, retoId);
    if (id.startsWith("retos_bloquear_")) return bloquearDesdeReto(client, i, retoId);
    if (id.startsWith("retos_rendirse_")) return responder(i, retos.rendirse(retoId, userId));
    if (id.startsWith("retos_revancha_")) return botonRevancha(i, retoId);
    // retos_ppt_{jugada}_{id}
    if (id.startsWith("retos_ppt_")) {
        const r = retos.jugarPpt(retoId, userId, id.split("_")[2]);
        await responder(i, r);
        if (r.ok) void avisarTurno(client, retoId, userId);
        return;
    }

    if (id.startsWith("retos_bj_ver_")) {
        const reto = retos.obtener(retoId);
        if (!reto || reto.tipo !== "duelo" || !retos.esParticipante(reto, userId)) return i.reply(privado("⛔ No juegas en este duelo."));
        return i.reply({ ...paneles.vistaManoBlackjack(reto, userId), flags: MessageFlags.Ephemeral });
    }
    // Pedir, plantarse o doblar, desde tu mano (mensaje privado): se repinta tu mano y el mensaje del reto.
    const accionBj = ["pedir", "plantar", "doblar"].find((a) => id.startsWith(`retos_bj_${a}_`));
    if (accionBj) {
        const r = retos.jugarBlackjack(retoId, userId, accionBj === "plantar" ? "plantarse" : accionBj);
        if (!r.ok) return i.reply(privado(r.mensaje));
        await i.update(paneles.vistaManoBlackjack(r.reto, userId));
        await actualizarMensajes(client, [retoId]);
        if (r.mensaje) await i.followUp(privado(r.mensaje));
        void avisarTurno(client, retoId, userId);
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
        { types: ["userSelect"], prefixes: ["retos_rival_", "retos_cara_"], method: "handleSelect", acl: "juegos" },
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
        // retos_cara_sel: con quién se ve el cara a cara (#437), un resumen privado que sustituye al selector.
        if (id === "retos_cara_sel") {
            const otro = i.users?.first?.() || { id: i.values[0] };
            if (otro.bot) return i.reply(privado("❌ Los bots no juegan retos."));
            if (otro.id === i.user.id) return i.reply(privado("❌ Elige a otra persona."));
            return i.update({ content: "", ...paneles.vistaCaraACara(i.user.id, otro.id, retos.caraACara(i.user.id, otro.id)) });
        }
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
            const cierre = retos.leerCierre(leerOpcional(i, "cierre"));
            if (!cierre.ok) return i.reply(privado(cierre.mensaje));
            const r = retos.crearPorra({
                ...base,
                pregunta: i.fields.getTextInputValue("pregunta"),
                opciones: retos.leerOpciones(i.fields.getTextInputValue("opciones")),
                cantidad: leerCantidad(i),
                cierraEn: cierre.ms,
            });
            if (!r.ok) return i.reply(privado(r.mensaje));
            return publicar(i, r.reto);
        }
        // retos_modal_contra_{id}: la contraoferta del rival (#442); el mensaje del reto se repinta con la propuesta.
        if (id.startsWith("retos_modal_contra_")) {
            const r = retos.contraofertar(retoDe(id), i.user.id, leerCantidad(i));
            if (!r.ok) return i.reply(privado(r.mensaje));
            return i.update(paneles.mensajeReto(r.reto));
        }
        // retos_modal_p_{eleccion}_{matchId}_{rival} · retos_modal_d_{juego}_{rival} · retos_modal_d_{juego}_abierto
        const [tipo, ...partes] = id.replace("retos_modal_", "").split("_");
        const rival = partes.pop();
        const abierto = tipo === "d" && rival === "abierto";
        const r =
            tipo === "p"
                ? retos.crearPartido({
                      ...base,
                      rival,
                      eleccion: partes[0],
                      matchId: partes.slice(1).join("_"),
                      cantidad: leerCantidad(i),
                      provocacion: leerProvocacion(i),
                  })
                : retos.crearDuelo({
                      ...base,
                      rival: abierto ? null : rival,
                      abierto,
                      juego: partes[0],
                      cantidad: leerCantidad(i),
                      serie: leerSerie(i),
                      provocacion: leerProvocacion(i),
                  });
        if (!r.ok) return i.reply(privado(r.mensaje));
        return publicar(i, r.reto, abierto ? null : rival);
    },

    actualizarMensajes,
    revisarRetos,
};
