const { MessageFlags } = require("discord.js");
const { canalElegido, canalesElegidos, rolesElegidos, opcionElegida } = require("../common");

// Una hora (0-23) del desplegable; null si no es válida, para que el manejador lo diga.
function horaElegida(fields, id) {
    const n = Number(opcionElegida(fields, id));
    return Number.isInteger(n) && n >= 0 && n <= 23 ? n : null;
}
const guildSettings = require("../../systems/guildSettings");
const adminAudit = require("../../systems/adminAudit");
const { guardarAuditado } = require("./guardar");
const { buildDuendePanel, buildEventosPanel } = require("./vistas");
const { guardarSeguro, guardarDeposito } = require("./economia");
const { guardarAnadir, guardarQuitar } = require("./autoroles");

async function modalDuende(interaction, id, guildId) {
    const modeloAntes = guildSettings.getSettings(guildId).duende.model;
    const modelo = interaction.fields.getTextInputValue("model").trim();
    guardarAuditado(guildId, interaction.user.id, "settings.duende.update", {
        "duende.model": modelo,
        "duende.temperature": interaction.fields.getTextInputValue("temperature").trim(),
        "duende.history_limit": interaction.fields.getTextInputValue("history").trim(),
    });
    if (modelo === modeloAntes) {
        await interaction.reply({ content: "✅ Configuración de Duende actualizada.", flags: MessageFlags.Ephemeral });
        return true;
    }
    // Modelo nuevo: se prueba ya, en vez de descubrir en el chat que no existe o que no usa las herramientas.
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const { comprobarModelo, modeloDe, textoComprobacion } = require("../../services/duende/gemini");
    const r = await comprobarModelo(modeloDe(guildId));
    await interaction.editReply({
        content:
            `✅ Configuración de Duende actualizada.\n${textoComprobacion(r)}` +
            (r.ok ? "" : "\nVuelve a ✏️ Editar IA y pon otro modelo (o déjalo vacío para el de .env)."),
    });
    return true;
}

async function modalDuendeChannel(interaction, id, guildId) {
    const channelId = canalElegido(interaction.fields, "channel");
    guardarAuditado(guildId, interaction.user.id, "settings.duende.channel", { "duende.allowed_channel_id": channelId });
    await interaction.reply({ content: "✅ Canal permitido de Duende actualizado.", flags: MessageFlags.Ephemeral });
    return true;
}

async function modalDuendeEspontaneo(interaction, id, guildId) {
    const channelId = canalElegido(interaction.fields, "channel");
    guardarAuditado(guildId, interaction.user.id, "settings.duende.espontaneo", {
        "duende.espontaneo_enabled": interaction.fields.getRadioGroup("enabled"),
        "duende.espontaneo_channel_id": channelId,
    });
    await interaction.reply({ content: "✅ Mensajes espontáneos del Duende actualizados.", flags: MessageFlags.Ephemeral });
    return true;
}

async function modalDuendeTono(interaction, id, guildId) {
    const desde = horaElegida(interaction.fields, "desde");
    const hasta = horaElegida(interaction.fields, "hasta");
    const formales = canalesElegidos(interaction.fields, "formales");
    if (![desde, hasta].every((h) => Number.isInteger(h) && h >= 0 && h <= 23) || desde === hasta) {
        await interaction.reply({
            content: "❌ Las horas de la madrugada son números enteros de 0 a 23 (y distintos entre sí).",
            flags: MessageFlags.Ephemeral,
        });
        return true;
    }
    const malos = formales.filter((c) => !/^\d{17,20}$/.test(c));
    if (malos.length) {
        await interaction.reply({
            content: `❌ Esto no son IDs de canal: ${malos.join(", ").slice(0, 200)}. (Clic derecho en el canal → Copiar ID del canal.)`,
            flags: MessageFlags.Ephemeral,
        });
        return true;
    }
    const valores = {
        "duende.madrugada_activa": interaction.fields.getRadioGroup("activa"),
        "duende.madrugada_desde": desde,
        "duende.madrugada_hasta": hasta,
        "duende.canales_formales": formales.join(","),
    };
    guardarAuditado(guildId, interaction.user.id, "settings.duende.tono", valores);
    if (interaction.isFromMessage?.()) await interaction.update(buildDuendePanel(guildId));
    else await interaction.reply({ content: "✅ Tono del Duende actualizado.", flags: MessageFlags.Ephemeral });
    return true;
}

async function modalCriptoMarket(interaction, id, guildId) {
    guardarAuditado(guildId, interaction.user.id, "settings.cripto.market", {
        "cripto.fee_buy_pct": interaction.fields.getTextInputValue("feeBuy").trim(),
        "cripto.fee_sell_pct": interaction.fields.getTextInputValue("feeSell").trim(),
        "cripto.max_impacto_pct": interaction.fields.getTextInputValue("impacto").trim() || "0",
        "cripto.eventos_canal": canalElegido(interaction.fields, "canal"),
    });
    await interaction.reply({ content: "✅ Configuración de mercado cripto actualizada.", flags: MessageFlags.Ephemeral });
    return true;
}

async function modalCriptoLimits(interaction, id, guildId) {
    guardarAuditado(guildId, interaction.user.id, "settings.cripto.limits", {
        "cripto.min_buy": interaction.fields.getTextInputValue("minBuy").trim(),
        "cripto.max_buy": interaction.fields.getTextInputValue("maxBuy").trim(),
        "cripto.cooldown_buy_sec": interaction.fields.getTextInputValue("buyCd").trim(),
        "cripto.min_sell": interaction.fields.getTextInputValue("minSell").trim(),
        "cripto.max_sell": interaction.fields.getTextInputValue("maxSell").trim(),
    });
    await interaction.reply({ content: "✅ Límites de compra/venta cripto actualizados.", flags: MessageFlags.Ephemeral });
    return true;
}

async function modalCasinoLimits(interaction, id, guildId) {
    guardarAuditado(guildId, interaction.user.id, "settings.casino.limits", {
        "casino.min_bet": interaction.fields.getTextInputValue("min").trim(),
        "casino.max_bet": interaction.fields.getTextInputValue("max").trim(),
        "casino.global_cooldown_sec": interaction.fields.getTextInputValue("cooldown").trim(),
        "casino.daily_limit": interaction.fields.getTextInputValue("daily").trim(),
    });
    await interaction.reply({ content: "✅ Límites de casino actualizados.", flags: MessageFlags.Ephemeral });
    return true;
}

// Tope de apuesta y cooldown por juego (#460, #461): un número por juego; vacío o 0 = vale el general.
const JUEGOS_POR_CAMPO = { bj: "blackjack", slots: "tragaperras", ruleta: "ruleta", ppt: "ppt", adivinar: "adivinar" };

function valoresPorJuego(interaction, prefijo) {
    const valores = {};
    for (const [campo, juego] of Object.entries(JUEGOS_POR_CAMPO)) {
        valores[`casino.${prefijo}_${juego}`] = interaction.fields.getTextInputValue(campo).trim() || "0";
    }
    return valores;
}

async function modalCasinoTopes(interaction, id, guildId) {
    guardarAuditado(guildId, interaction.user.id, "settings.casino.topes", valoresPorJuego(interaction, "max_bet"));
    await interaction.reply({ content: "✅ Topes de apuesta por juego actualizados.", flags: MessageFlags.Ephemeral });
    return true;
}

async function modalCasinoEsperas(interaction, id, guildId) {
    guardarAuditado(guildId, interaction.user.id, "settings.casino.esperas", valoresPorJuego(interaction, "cooldown_sec"));
    await interaction.reply({ content: "✅ Cooldown por juego actualizado.", flags: MessageFlags.Ephemeral });
    return true;
}

async function modalCasinoRtp(interaction, id, guildId) {
    guardarAuditado(guildId, interaction.user.id, "settings.casino.rtp", {
        "casino.rtp_blackjack": interaction.fields.getTextInputValue("bj").trim(),
        "casino.rtp_tragaperras": interaction.fields.getTextInputValue("slots").trim(),
        "casino.rtp_ruleta": interaction.fields.getTextInputValue("ruleta").trim(),
        "casino.rtp_adivinar": interaction.fields.getTextInputValue("adivinar").trim(),
        "casino.rtp_rasca": interaction.fields.getTextInputValue("rasca").trim(),
    });
    await interaction.reply({ content: "✅ RTP de casino actualizado.", flags: MessageFlags.Ephemeral });
    return true;
}

async function modalTienda(interaction, id, guildId) {
    guardarAuditado(guildId, interaction.user.id, "settings.tienda.update", {
        "tienda.enabled": interaction.fields.getRadioGroup("enabled"),
        "tienda.buy_cooldown_sec": interaction.fields.getTextInputValue("buyCd").trim(),
        "tienda.daily_limit": interaction.fields.getTextInputValue("daily").trim(),
        "tienda.notif_channel_id": canalElegido(interaction.fields, "channel"),
    });
    await interaction.reply({ content: "✅ Configuración de tienda actualizada.", flags: MessageFlags.Ephemeral });
    return true;
}

// La regla de un comando antes y después, solo con lo que cambió (#407).
function diffAcl(antes, despues) {
    const cambios = {};
    for (const campo of Object.keys(despues)) {
        if (JSON.stringify(antes[campo]) !== JSON.stringify(despues[campo]))
            cambios[campo] = { antes: antes[campo], despues: despues[campo] };
    }
    return Object.keys(cambios).length ? { cambios } : { sinCambios: true };
}

async function modalAcl(interaction, id, guildId) {
    const command = interaction.fields.getTextInputValue("command").trim().replace(/^\//, "").toLowerCase();
    const enabledRaw = interaction.fields.getRadioGroup("enabled");

    if (!command) {
        await interaction.reply({ content: "❌ Debes indicar un comando.", flags: MessageFlags.Ephemeral });
        return true;
    }

    const antes = guildSettings.getCommandAcl(guildId, command);
    const despues = {
        enabled: enabledRaw === "1" || enabledRaw === "true" || enabledRaw === "si",
        allowedChannels: canalesElegidos(interaction.fields, "channels"),
        allowedRoles: rolesElegidos(interaction.fields, "roles"),
    };
    guildSettings.setCommandAcl(guildId, command, despues);
    adminAudit.logAdminAction({
        guildId,
        actorId: interaction.user.id,
        action: "settings.acl.update",
        details: { command, ...diffAcl(antes, despues) },
    });

    await interaction.reply({ content: `✅ ACL actualizada para /${command}.`, flags: MessageFlags.Ephemeral });
    return true;
}

async function modalLogros(interaction, id, guildId) {
    guardarAuditado(guildId, interaction.user.id, "settings.logros.update", {
        "logros.enabled": interaction.fields.getRadioGroup("enabled"),
        "logros.reward_multiplier": interaction.fields.getTextInputValue("mult").trim(),
        "logros.notify_channel_id": canalElegido(interaction.fields, "channel"),
        "logros.disabled_categories": interaction.fields.getTextInputValue("disabled").trim().toLowerCase(),
    });
    await interaction.reply({ content: "✅ Configuración de logros actualizada.", flags: MessageFlags.Ephemeral });
    return true;
}

async function modalEventosXp(interaction, id, guildId) {
    const campo = (c) => interaction.fields.getTextInputValue(c).trim();
    const entero = (c, min, max) => {
        const n = Number(campo(c));
        return Number.isFinite(n) && n >= min && n <= max ? n : null;
    };
    let valores;
    if (id === "paneladmin_cfg_eventos_xp_modal") {
        const mult = entero("mult", 1, 5);
        const desde = horaElegida(interaction.fields, "desde");
        const hasta = horaElegida(interaction.fields, "hasta");
        if (mult === null || !Number.isInteger(desde) || !Number.isInteger(hasta) || desde === hasta) {
            await interaction.reply({
                content: "❌ El multiplicador va de 1 a 5, y las horas son enteras de 0 a 23 (y distintas entre sí).",
                flags: MessageFlags.Ephemeral,
            });
            return true;
        }
        valores = {
            "eventos.xp_activo": interaction.fields.getRadioGroup("activo"),
            "eventos.xp_mult": mult,
            "eventos.xp_desde": desde,
            "eventos.xp_hasta": hasta,
        };
    } else {
        const pct = entero("pct", 100, 300);
        if (!Number.isInteger(pct)) {
            await interaction.reply({
                content: "❌ El % de los premios es un número entero de 100 a 300.",
                flags: MessageFlags.Ephemeral,
            });
            return true;
        }
        valores = { "eventos.casino_activo": interaction.fields.getRadioGroup("activo"), "eventos.casino_pct": pct };
    }
    guardarAuditado(guildId, interaction.user.id, "settings.eventos.update", valores);
    if (interaction.isFromMessage?.()) await interaction.update(buildEventosPanel(guildId));
    else await interaction.reply({ content: "✅ Eventos actualizados.", flags: MessageFlags.Ephemeral });
    return true;
}

async function modalMantenimientoMensaje(interaction, id, guildId) {
    const mensaje = interaction.fields.getTextInputValue("mensaje").trim();
    if (!mensaje) {
        await interaction.reply({ content: "❌ El mensaje no puede estar vacío.", flags: MessageFlags.Ephemeral });
        return true;
    }
    guardarAuditado(guildId, interaction.user.id, "mantenimiento.mensaje", { "mantenimiento.mensaje": mensaje });
    await interaction.reply({ content: "✅ Mensaje de mantenimiento actualizado.", flags: MessageFlags.Ephemeral });
    return true;
}

const ACCIONES_MODAL = new Map([
    ["paneladmin_cfg_mantenimiento_modal", modalMantenimientoMensaje],
    ["paneladmin_cfg_duende_modal", modalDuende],
    ["paneladmin_cfg_duende_channel_modal", modalDuendeChannel],
    ["paneladmin_cfg_duende_espontaneo_modal", modalDuendeEspontaneo],
    ["paneladmin_cfg_duende_tono_modal", modalDuendeTono],
    ["paneladmin_cfg_cripto_market_modal", modalCriptoMarket],
    ["paneladmin_cfg_cripto_limits_modal", modalCriptoLimits],
    ["paneladmin_cfg_casino_limits_modal", modalCasinoLimits],
    ["paneladmin_cfg_casino_rtp_modal", modalCasinoRtp],
    ["paneladmin_cfg_casino_topes_modal", modalCasinoTopes],
    ["paneladmin_cfg_casino_esperas_modal", modalCasinoEsperas],
    ["paneladmin_cfg_tienda_modal", modalTienda],
    ["paneladmin_cfg_economia_seguro_modal", guardarSeguro],
    ["paneladmin_cfg_economia_deposito_modal", guardarDeposito],
    ["paneladmin_cfg_autoroles_add_modal", guardarAnadir],
    ["paneladmin_cfg_autoroles_remove_modal", guardarQuitar],
    ["paneladmin_cfg_acl_modal", modalAcl],
    ["paneladmin_cfg_logros_modal", modalLogros],
    ["paneladmin_cfg_eventos_xp_modal", modalEventosXp],
    ["paneladmin_cfg_eventos_casino_modal", modalEventosXp],
]);

async function handleSettingsModal(interaction) {
    const id = interaction.customId;
    const guildId = interaction.guildId;
    const accion = ACCIONES_MODAL.get(id);
    if (accion) return accion(interaction, id, guildId);
    return false;
}

module.exports = {
    ACCIONES_MODAL,
    handleSettingsModal,
};
