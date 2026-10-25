// ⚙️ Config Global → 🗳️ Elecciones: abrir unas elecciones a la presidencia, cerrar ya la fase en curso, cancelarlas (o
// destituir al presidente) y los ajustes: canal del panel, rol y categoría del presidente, duraciones, límites de sus poderes,
// reelección y reinicio automático. Lo destructivo pide confirmación y todo se audita (familia `elecciones`).
const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags, ChannelType } = require("discord.js");
const { ajustes: reglas, repo, fases } = require("../systems/elecciones");
const envios = require("../discord/envios/elecciones");
const adminAudit = require("../systems/adminAudit");
const { guardarAuditado } = require("./settings/guardar");
const { modalConCampos, SI_NO, canalElegido, rolElegido } = require("./common");

const PREFIJO = "paneladmin_elec_";
const COLOR = 0x9b59b6;
const CONFIRMAR = {
    adelantar: { texto: "¿Cerrar **ya** la fase en curso y pasar a la siguiente?", etiqueta: "⏭️ Sí, cerrar fase" },
    cancelar: { texto: "¿**Cancelar** las elecciones en marcha? No se puede deshacer.", etiqueta: "✖️ Sí, cancelar" },
    destituir: {
        texto: "¿**Destituir** al presidente? Pierde el rol, sus canales y sus castigos se deshacen.",
        etiqueta: "⚖️ Sí, destituir",
    },
};

const ts = (ms) => `<t:${Math.floor(ms / 1000)}:R>`;
const boton = (id, etiqueta, estilo = ButtonStyle.Secondary, desactivado = false) =>
    new ButtonBuilder().setCustomId(`${PREFIJO}${id}`).setLabel(etiqueta).setStyle(estilo).setDisabled(desactivado);

function textoEleccion(eleccion) {
    if (!eleccion) return "No hay elecciones en marcha.";
    const linea = `**${fases.NOMBRE_FASE[eleccion.estado]}** · acaba ${ts(eleccion.fase_fin)}`;
    if (eleccion.estado === "mandato") return `${linea}\n👑 Presidente: <@${eleccion.presidenteId}>`;
    const panel = eleccion.messageId
        ? `\n🔗 [Panel](https://discord.com/channels/${eleccion.guildId}/${eleccion.channelId}/${eleccion.messageId})`
        : "";
    return `${linea}\n📋 Candidatos: **${repo.candidatos(eleccion.id).length}**${panel}`;
}

function textoAjustes(a) {
    return (
        `Canal del panel: ${a.canal ? `<#${a.canal}>` : "⚠️ sin elegir"}\n` +
        `Rol de presidente: ${a.rolPresidente ? `<@&${a.rolPresidente}>` : "ninguno"}\n` +
        `Categoría de sus canales: ${a.categoria ? `<#${a.categoria}>` : "ninguna (no puede crear canales)"}\n` +
        `Duraciones (días): inscripción **${a.dias.inscripcion}** · primarias **${a.dias.primarias}** · programas **${a.dias.programas}** · ` +
        `generales **${a.dias.generales}** · mandato **${a.dias.mandato}**\n` +
        `Antigüedad para participar: **${a.antiguedadDias}** días · canales: **${a.maxCanales}** · silencio máx.: **${a.maxSancionMin}** min · ` +
        `espera por persona: **${a.cooldownMin}** min\n` +
        `Reelección: **${a.reeleccion ? "sí" : "no"}** · reiniciar al acabar el mandato: **${a.autoReiniciar ? "sí" : "no"}**`
    );
}

/** La pantalla de la sección. */
function buildHome(guildId, aviso = "") {
    const eleccion = repo.activa(guildId);
    const a = reglas.ajustes(guildId);
    const embed = new EmbedBuilder()
        .setTitle("🗳️ Elecciones a la presidencia")
        .setColor(COLOR)
        .setDescription(
            (aviso ? `${aviso}\n\n` : "") +
                "Inscripción → primarias (pasan 4) → programas (se mandan por DM) → generales → mandato. El presidente usa " +
                "`/presidente` para mover, desconectar, silenciar o ensordecer en voz y crear canales, nunca contra admins ni staff.\n\n" +
                "⚠️ El rol de presidente lo da el bot, pero sus permisos los pones tú en Discord. **No le des Mover, Silenciar ni " +
                "Ensordecer miembros**: esos permisos nativos no respetan la jerarquía y podría usarlos contra los admins.",
        )
        .addFields({ name: "Ahora", value: textoEleccion(eleccion) }, { name: "Ajustes", value: textoAjustes(a) });
    const mandato = eleccion?.estado === "mandato";
    const filas = [
        new ActionRowBuilder().addComponents(
            boton("abrir", "🗳️ Abrir elecciones", ButtonStyle.Success, Boolean(eleccion)),
            boton("confirmar_adelantar", "⏭️ Cerrar fase ya", ButtonStyle.Primary, !eleccion),
            boton(
                mandato ? "confirmar_destituir" : "confirmar_cancelar",
                mandato ? "⚖️ Destituir" : "✖️ Cancelar",
                ButtonStyle.Danger,
                !eleccion,
            ),
            boton("republicar", "📌 Publicar el panel otra vez", ButtonStyle.Secondary, !eleccion),
        ),
        new ActionRowBuilder().addComponents(
            boton("canales", "📍 Canal, rol y categoría"),
            boton("duraciones", "⏱️ Duraciones"),
            boton("limites", "🛡️ Límites"),
            boton("reglas", "⚖️ Reelección"),
            new ButtonBuilder().setCustomId("paneladmin_cfg_home").setLabel("⚙️ Config Global").setStyle(ButtonStyle.Secondary),
        ),
    ];
    return { content: "", embeds: [embed], components: filas, allowedMentions: { parse: [] } };
}

function buildConfirmar(accion) {
    const c = CONFIRMAR[accion];
    return {
        content: c.texto,
        embeds: [],
        components: [
            new ActionRowBuilder().addComponents(boton(`si_${accion}`, c.etiqueta, ButtonStyle.Danger), boton("home", "↩️ No, volver")),
        ],
        allowedMentions: { parse: [] },
    };
}

function modalCanales(a) {
    return modalConCampos(`${PREFIJO}canales_modal`, "Canal, rol y categoría", [
        { id: "canal", label: "Canal donde se publica el panel", tipo: "canal", required: false, valor: a.canal },
        { id: "rol", label: "Rol del presidente (vacío = ninguno)", tipo: "rol", required: false, valor: a.rolPresidente },
        {
            id: "categoria",
            label: "Categoría de sus canales (vacío = no crea)",
            tipo: "canal",
            tiposCanal: [ChannelType.GuildCategory],
            required: false,
            valor: a.categoria,
        },
    ]);
}

function modalDuraciones(a) {
    const campo = (fase, label) => ({ id: fase, label, value: String(a.dias[fase]), maxLength: 6 });
    return modalConCampos(`${PREFIJO}duraciones_modal`, "Duración de cada fase (días)", [
        campo("inscripcion", "Inscripción de candidatos"),
        campo("primarias", "Primarias"),
        campo("programas", "Programas electorales"),
        campo("generales", "Elecciones generales"),
        campo("mandato", "Mandato del presidente"),
    ]);
}

function modalLimites(a) {
    const campo = (id, valor) => ({ id, label: reglas.LIMITES[id].nombre, value: String(valor), maxLength: 4 });
    return modalConCampos(`${PREFIJO}limites_modal`, "Límites", [
        campo("antiguedad_dias", a.antiguedadDias),
        campo("max_canales", a.maxCanales),
        campo("max_sancion_min", a.maxSancionMin),
        campo("cooldown_min", a.cooldownMin),
    ]);
}

function modalReglas(a) {
    return modalConCampos(`${PREFIJO}reglas_modal`, "Reelección y reinicio", [
        {
            id: "reeleccion",
            label: "¿El presidente puede volver a presentarse?",
            tipo: "radio",
            opciones: SI_NO,
            valor: a.reeleccion ? "si" : "no",
        },
        { id: "auto", label: "¿Abrir otras al acabar el mandato?", tipo: "radio", opciones: SI_NO, valor: a.autoReiniciar ? "si" : "no" },
    ]);
}

const pintar = (interaction, payload) =>
    interaction.isFromMessage?.() === false
        ? interaction.reply({ ...payload, flags: MessageFlags.Ephemeral })
        : interaction.update(payload);

/** Las acciones sobre la elección en marcha, ya confirmadas. Pueden tardar (anuncios, DM): primero se reconoce el botón. */
async function ejecutar(interaction, accion) {
    const { client, guildId, user } = interaction;
    await interaction.deferUpdate();
    let r;
    if (accion === "abrir") r = await envios.abrirYPublicar(client, guildId, user.id);
    else if (accion === "adelantar") r = await envios.adelantarFase(client, guildId, user.id);
    else r = await envios.cancelar(client, guildId, user.id);
    if (r.ok && accion === "abrir")
        adminAudit.logAdminAction({ guildId, actorId: user.id, action: "elecciones.abrir", details: { eleccionId: r.eleccion.id } });
    const hecho = { abrir: "🗳️ Elecciones abiertas.", adelantar: "⏭️ Fase cerrada.", cancelar: "✖️ Hecho." }[accion] || "✅ Hecho.";
    const aviso = r.ok ? `${hecho}${r.aviso ? ` ⚠️ ${r.aviso}` : ""}` : `❌ ${r.motivo}`;
    return interaction.editReply(buildHome(guildId, aviso));
}

async function republicar(interaction) {
    const eleccion = repo.activa(interaction.guildId);
    const canal = reglas.ajustes(interaction.guildId).canal;
    if (!eleccion || !canal) return pintar(interaction, buildHome(interaction.guildId, "❌ No hay elecciones o falta el canal."));
    const r = await envios.publicar(interaction.client, { ...eleccion, channelId: canal }).catch((e) => ({ ok: false, motivo: e.message }));
    return pintar(interaction, buildHome(interaction.guildId, r.ok ? "📌 Panel publicado." : `❌ ${r.motivo}`));
}

/** Botones de 🗳️ Elecciones. Devuelve false si no es suyo. */
async function handleEleccionesButton(interaction) {
    const id = interaction.customId;
    if (!id.startsWith(PREFIJO)) return false;
    const accion = id.slice(PREFIJO.length);
    const a = reglas.ajustes(interaction.guildId);
    const modales = { canales: modalCanales, duraciones: modalDuraciones, limites: modalLimites, reglas: modalReglas };
    if (accion === "home") await interaction.update(buildHome(interaction.guildId));
    else if (modales[accion]) await interaction.showModal(modales[accion](a));
    else if (accion === "abrir") await ejecutar(interaction, "abrir");
    else if (accion === "republicar") await republicar(interaction);
    else if (accion.startsWith("confirmar_") && CONFIRMAR[accion.slice(10)]) await interaction.update(buildConfirmar(accion.slice(10)));
    else if (accion.startsWith("si_") && CONFIRMAR[accion.slice(3)]) await ejecutar(interaction, accion.slice(3));
    else return false;
    return true;
}

function valoresDelModal(interaction) {
    const campo = (x) => interaction.fields.getTextInputValue(x);
    switch (interaction.customId.slice(PREFIJO.length)) {
        case "canales_modal":
            return {
                ok: true,
                valores: {
                    canal: canalElegido(interaction.fields, "canal"),
                    rol_presidente: rolElegido(interaction.fields, "rol"),
                    categoria_presidente: canalElegido(interaction.fields, "categoria"),
                },
            };
        case "duraciones_modal":
            return reglas.validarDuraciones(Object.fromEntries(Object.keys(reglas.AJUSTE_DURACION).map((f) => [f, campo(f)])));
        case "limites_modal":
            return reglas.validarLimites(Object.fromEntries(Object.keys(reglas.LIMITES).map((k) => [k, campo(k)])));
        case "reglas_modal":
            return {
                ok: true,
                valores: {
                    reeleccion: interaction.fields.getRadioGroup("reeleccion") === "si",
                    auto_reiniciar: interaction.fields.getRadioGroup("auto") === "si",
                },
            };
        default:
            return null;
    }
}

/** Formularios de 🗳️ Elecciones. */
async function handleEleccionesModal(interaction) {
    if (!interaction.customId.startsWith(PREFIJO)) return false;
    const r = valoresDelModal(interaction);
    if (!r) return false;
    if (!r.ok) return pintar(interaction, buildHome(interaction.guildId, `❌ ${r.motivo}`)).then(() => true);
    const valores = Object.fromEntries(Object.entries(r.valores).map(([k, v]) => [`elecciones.${k}`, v]));
    guardarAuditado(interaction.guildId, interaction.user.id, "elecciones.ajustes", valores);
    await pintar(interaction, buildHome(interaction.guildId, "✅ Ajustes guardados."));
    return true;
}

module.exports = { PREFIJO, buildHome, handleEleccionesButton, handleEleccionesModal };
