const guildSettings = require("../../systems/guildSettings");
const { simpleModal, modalConCampos, SI_NO_NUMERICO } = require("../common");
const {
    buildConfigHome,
    buildDuendePanel,
    buildCriptoPanel,
    buildCasinoPanel,
    buildTiendaPanel,
    buildAclPanel,
    buildLogrosPanel,
    buildDiarioPanel,
    buildEventosPanel,
} = require("./vistas");

async function accionEventos(interaction, id, guildId) {
    await interaction.update(buildEventosPanel(guildId));
    return true;
}

async function accionEventosXp(interaction, id, guildId) {
    const { xp } = guildSettings.getSettings(guildId).eventos;
    await interaction.showModal(
        modalConCampos("paneladmin_cfg_eventos_xp_modal", "Happy hour de XP", [
            { id: "activo", label: "Happy hour activa", tipo: "radio", opciones: SI_NO_NUMERICO, valor: xp.activo ? "1" : "0" },
            { id: "mult", label: "Multiplicador de XP (1 a 5, p. ej. 2)", value: String(xp.mult) },
            { id: "desde", label: "Desde la hora (0-23, Madrid)", value: String(xp.desde) },
            { id: "hasta", label: "Hasta la hora (0-23, Madrid)", value: String(xp.hasta) },
        ]),
    );
    return true;
}

async function accionEventosCasino(interaction, id, guildId) {
    const { casino } = guildSettings.getSettings(guildId).eventos;
    await interaction.showModal(
        modalConCampos("paneladmin_cfg_eventos_casino_modal", "Fin de semana del casino", [
            { id: "activo", label: "Fin de semana activo", tipo: "radio", opciones: SI_NO_NUMERICO, valor: casino.activo ? "1" : "0" },
            { id: "pct", label: "Premios en % (100 a 300, p. ej. 150)", value: String(casino.pct) },
        ]),
    );
    return true;
}

async function accionHome(interaction, id, guildId) {
    await interaction.update(buildConfigHome(guildId));
    return true;
}

async function accionDuende(interaction, id, guildId) {
    await interaction.update(buildDuendePanel(guildId));
    return true;
}

async function accionCripto(interaction, id, guildId) {
    await interaction.update(buildCriptoPanel(guildId));
    return true;
}

async function accionCasino(interaction, id, guildId) {
    await interaction.update(buildCasinoPanel(guildId));
    return true;
}

async function accionTienda(interaction, id, guildId) {
    await interaction.update(buildTiendaPanel(guildId));
    return true;
}

async function accionAcl(interaction, id, guildId) {
    await interaction.update(buildAclPanel(guildId));
    return true;
}

async function accionLogros(interaction, id, guildId) {
    await interaction.update(buildLogrosPanel(guildId));
    return true;
}

async function accionDiario(interaction, id, guildId) {
    await interaction.update(buildDiarioPanel(guildId));
    return true;
}

async function accionDiarioEdit(interaction, id, guildId) {
    const d = guildSettings.getSettings(guildId).diario;
    await interaction.showModal(
        modalConCampos("paneladmin_cfg_diario_modal", "Recompensa diaria", [
            { id: "enabled", label: "Recompensa diaria activa", tipo: "radio", opciones: SI_NO_NUMERICO, valor: d.enabled ? "1" : "0" },
            { id: "base", label: "Base (monedas con racha 0)", value: String(d.base) },
            { id: "porDia", label: "Monedas por día de racha", value: String(d.por_dia_racha) },
            { id: "tope", label: "Tope (máximo al día)", value: String(d.tope) },
        ]),
    );
    return true;
}

async function accionDuendeEdit(interaction, id, guildId) {
    const d = guildSettings.getSettings(guildId).duende;
    const modal = simpleModal("paneladmin_cfg_duende_modal", "Duende IA", [
        { id: "model", label: "Modelo (vacío = default)", required: false, value: d.model || "" },
        { id: "temperature", label: "Temperatura (0-2)", required: true, value: String(d.temperature) },
        { id: "history", label: "Límite historial", required: true, value: String(d.history_limit) },
    ]);
    await interaction.showModal(modal);
    return true;
}

async function accionDuendeChannel(interaction, id, guildId) {
    const d = guildSettings.getSettings(guildId).duende;
    const modal = simpleModal("paneladmin_cfg_duende_channel_modal", "Canal Duende", [
        { id: "channel", label: "ID de canal (vacío = cualquiera)", required: false, value: d.allowed_channel_id || "" },
    ]);
    await interaction.showModal(modal);
    return true;
}

async function accionDuendeTono(interaction, id, guildId) {
    const d = guildSettings.getSettings(guildId).duende;
    await interaction.showModal(
        modalConCampos("paneladmin_cfg_duende_tono_modal", "Tono del Duende", [
            {
                id: "activa",
                label: "Más borde de madrugada",
                tipo: "radio",
                opciones: SI_NO_NUMERICO,
                valor: d.madrugada_activa ? "1" : "0",
            },
            { id: "desde", label: "Madrugada desde la hora (0-23, Madrid)", value: String(d.madrugada_desde) },
            { id: "hasta", label: "Madrugada hasta la hora (0-23, Madrid)", value: String(d.madrugada_hasta) },
            {
                id: "formales",
                label: "Canales formales (IDs separados por comas)",
                required: false,
                placeholder: "Vacío = ninguno",
                value: d.canales_formales || "",
            },
        ]),
    );
    return true;
}

async function accionDuendeEspontaneo(interaction, id, guildId) {
    const d = guildSettings.getSettings(guildId).duende;
    const modal = modalConCampos("paneladmin_cfg_duende_espontaneo_modal", "Duende: mensajes solos", [
        {
            id: "enabled",
            label: "Mensajes solos activos",
            tipo: "radio",
            opciones: SI_NO_NUMERICO,
            valor: d.espontaneo_enabled ? "1" : "0",
        },
        { id: "channel", label: "ID de canal (vacío = no sale ninguno)", required: false, value: d.espontaneo_channel_id || "" },
    ]);
    await interaction.showModal(modal);
    return true;
}

async function accionCriptoMarket(interaction, id, guildId) {
    const c = guildSettings.getSettings(guildId).cripto;
    const modal = simpleModal("paneladmin_cfg_cripto_market_modal", "Cripto: comisiones", [
        { id: "feeBuy", label: "Fee compra %", value: String(c.fee_buy_pct) },
        { id: "feeSell", label: "Fee venta %", value: String(c.fee_sell_pct) },
    ]);
    await interaction.showModal(modal);
    return true;
}

async function accionCriptoLimits(interaction, id, guildId) {
    const c = guildSettings.getSettings(guildId).cripto;
    const modal = simpleModal("paneladmin_cfg_cripto_limits_modal", "Cripto: Límites", [
        { id: "minBuy", label: "Compra mínima", value: String(c.min_buy) },
        { id: "maxBuy", label: "Compra máxima", value: String(c.max_buy) },
        { id: "buyCd", label: "Cooldown compra (s)", value: String(c.cooldown_buy_sec) },
        { id: "minSell", label: "Venta mínima", value: String(c.min_sell) },
        { id: "maxSell", label: "Venta máxima", value: String(c.max_sell) },
    ]);
    await interaction.showModal(modal);
    return true;
}

async function accionCasinoLimits(interaction, id, guildId) {
    const c = guildSettings.getSettings(guildId).casino;
    const modal = simpleModal("paneladmin_cfg_casino_limits_modal", "Casino: Límites", [
        { id: "min", label: "Apuesta mínima", value: String(c.min_bet) },
        { id: "max", label: "Apuesta máxima", value: String(c.max_bet) },
        { id: "cooldown", label: "Cooldown global (s)", value: String(c.global_cooldown_sec) },
        { id: "daily", label: "Límite diario (0 sin límite)", value: String(c.daily_limit) },
    ]);
    await interaction.showModal(modal);
    return true;
}

async function accionCasinoRtp(interaction, id, guildId) {
    const c = guildSettings.getSettings(guildId).casino;
    const modal = simpleModal("paneladmin_cfg_casino_rtp_modal", "Casino: RTP", [
        { id: "bj", label: "Blackjack RTP %", value: String(c.rtp_blackjack) },
        { id: "slots", label: "Tragaperras RTP %", value: String(c.rtp_tragaperras) },
        { id: "ruleta", label: "Ruleta RTP %", value: String(c.rtp_ruleta) },
        { id: "adivinar", label: "Adivinar RTP %", value: String(c.rtp_adivinar) },
    ]);
    await interaction.showModal(modal);
    return true;
}

async function accionTiendaEdit(interaction, id, guildId) {
    const t = guildSettings.getSettings(guildId).tienda;
    const modal = modalConCampos("paneladmin_cfg_tienda_modal", "Tienda", [
        { id: "enabled", label: "Tienda activa", tipo: "radio", opciones: SI_NO_NUMERICO, valor: t.enabled ? "1" : "0" },
        { id: "buyCd", label: "Cooldown compra (s)", value: String(t.buy_cooldown_sec) },
        { id: "daily", label: "Límite diario (0 sin límite)", value: String(t.daily_limit) },
        { id: "channel", label: "ID canal notificaciones", required: false, value: t.notif_channel_id || "" },
    ]);
    await interaction.showModal(modal);
    return true;
}

async function accionAclEdit(interaction, id, guildId) {
    const modal = modalConCampos("paneladmin_cfg_acl_modal", "ACL comando", [
        { id: "command", label: "Comando (sin /)", value: "" },
        { id: "enabled", label: "Comando habilitado", tipo: "radio", opciones: SI_NO_NUMERICO, valor: "1" },
        { id: "channels", label: "Canales CSV (IDs)", required: false, value: "" },
        { id: "roles", label: "Roles CSV (IDs)", required: false, value: "" },
    ]);
    await interaction.showModal(modal);
    return true;
}

async function accionLogrosEdit(interaction, id, guildId) {
    const l = guildSettings.getSettings(guildId).logros;
    const modal = modalConCampos("paneladmin_cfg_logros_modal", "Logros", [
        { id: "enabled", label: "Logros activos", tipo: "radio", opciones: SI_NO_NUMERICO, valor: l.enabled ? "1" : "0" },
        { id: "mult", label: "Multiplicador recompensas", value: String(l.reward_multiplier || 1) },
        { id: "channel", label: "Canal anuncio (ID)", required: false, value: l.notify_channel_id || "" },
        { id: "disabled", label: "Categorías off (csv)", required: false, value: l.disabled_categories || "" },
    ]);
    await interaction.showModal(modal);
    return true;
}

const ACCIONES_BOTON = new Map([
    ["paneladmin_cfg_eventos", accionEventos],
    ["paneladmin_cfg_eventos_xp", accionEventosXp],
    ["paneladmin_cfg_eventos_casino", accionEventosCasino],
    ["paneladmin_cfg_home", accionHome],
    ["paneladmin_cfg_duende", accionDuende],
    ["paneladmin_cfg_cripto", accionCripto],
    ["paneladmin_cfg_casino", accionCasino],
    ["paneladmin_cfg_tienda", accionTienda],
    ["paneladmin_cfg_acl", accionAcl],
    ["paneladmin_cfg_logros", accionLogros],
    ["paneladmin_cfg_diario", accionDiario],
    ["paneladmin_cfg_diario_edit", accionDiarioEdit],
    ["paneladmin_cfg_duende_edit", accionDuendeEdit],
    ["paneladmin_cfg_duende_channel", accionDuendeChannel],
    ["paneladmin_cfg_duende_tono", accionDuendeTono],
    ["paneladmin_cfg_duende_espontaneo", accionDuendeEspontaneo],
    ["paneladmin_cfg_cripto_market", accionCriptoMarket],
    ["paneladmin_cfg_cripto_limits", accionCriptoLimits],
    ["paneladmin_cfg_casino_limits", accionCasinoLimits],
    ["paneladmin_cfg_casino_rtp", accionCasinoRtp],
    ["paneladmin_cfg_tienda_edit", accionTiendaEdit],
    ["paneladmin_cfg_acl_edit", accionAclEdit],
    ["paneladmin_cfg_logros_edit", accionLogrosEdit],
]);

async function handleSettingsButton(interaction) {
    const id = interaction.customId;
    const guildId = interaction.guildId;
    const accion = ACCIONES_BOTON.get(id);
    if (accion) return accion(interaction, id, guildId);
    return false;
}

module.exports = {
    accionHome,

    ACCIONES_BOTON,
    handleSettingsButton,
};
