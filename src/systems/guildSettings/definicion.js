// Lista de ajustes del servidor y cómo es cada uno (datos, sin lógica).

const { CATEGORIAS, XP_NIVEL_BASE, XP_NIVEL_PASO } = require("../pase/constantes");

// Juegos del casino con tope de apuesta y cooldown propios (#460, #461): `casino.max_bet_<juego>` y
// `casino.cooldown_sec_<juego>`. 0 = sin ajuste propio, vale el general (`casino.max_bet` y `casino.global_cooldown_sec`).
const JUEGOS_CASINO = ["blackjack", "tragaperras", "ruleta", "ppt", "adivinar"];

const DEFAULT_FLAT = {
    "duende.model": "",
    "duende.temperature": 0.7,
    "duende.history_limit": 20,
    "duende.allowed_channel_id": "",
    "duende.espontaneo_enabled": 1,
    "duende.espontaneo_channel_id": "",
    "duende.madrugada_activa": false,
    "duende.madrugada_desde": 0,
    "duende.madrugada_hasta": 7,
    "duende.canales_formales": "",

    "cripto.fee_buy_pct": 1,
    "cripto.fee_sell_pct": 1,
    "cripto.cooldown_buy_sec": 0,
    "cripto.cooldown_sell_sec": 0,
    "cripto.min_buy": 100,
    "cripto.max_buy": 500000,
    "cripto.min_sell": 100,
    "cripto.max_sell": 500000,
    "cripto.pausa": false,
    "cripto.max_impacto_pct": 0,
    "cripto.eventos_canal": "",

    "casino.min_bet": 10,
    "casino.max_bet": 100000,
    "casino.global_cooldown_sec": 0,
    "casino.daily_limit": 0,
    "casino.rtp_blackjack": 100,
    "casino.rtp_tragaperras": 100,
    "casino.rtp_ruleta": 100,
    "casino.rtp_adivinar": 100,
    "casino.rtp_rasca": 100,

    "tienda.enabled": true,
    "tienda.buy_cooldown_sec": 0,
    "tienda.daily_limit": 0,
    "tienda.notif_channel_id": "",
    "tienda.recompra_pct": 50,
    "tienda.subida_pct": 0,
    "tienda.recuperacion_pct": 5,
    "tienda.tope_pct": 100,

    "economia.seguro_precio": 2000,
    "economia.seguro_horas": 24,
    "economia.seguro_cooldown_h": 1,
    "economia.seguro_tope_dias": 7,
    "economia.deposito_min": 1000,
    "economia.deposito_max": 100000,
    "economia.deposito_pct_7": 1,
    "economia.deposito_pct_30": 3,
    "economia.deposito_pct_90": 6,

    "logros.enabled": true,
    "logros.notify_channel_id": "",
    "logros.reward_multiplier": 1,
    "logros.disabled_categories": "",

    "plex.tautulli_url": "",
    "plex.tautulli_api_key": "",
    "plex.novedades_channel_id": "",
    "plex.bibliotecas_anime": "",
    "plex.ranking_canal": "",
    "plex.ranking_ultima_semana": "",
    "plex.importacion_pct": 50,
    "plex.rol_gordos_1": "",
    "plex.rol_gordos_5": "",
    "plex.rol_gordos_10": "",
    "plex.resenas_activo": false,
    "plex.resenas_max_dia": 5,
    "plex.resenas_min_votos": 3,
    "plex.resenas_desde": 0,
    "plex.resenas_canal": "",

    "seerr.url": "",
    "seerr.api_key": "",
    "seerr.daily_request_limit": 5,
    "seerr.avisar_disponible": true,

    "apuestas.canal_resultados": "",
    "apuestas.recordatorio": true,
    "apuestas.recordatorio_min": 30,
    "apuestas.recordatorio_quiniela_horas": 3,
    "apuestas.tope_diario": 0,
    "apuestas.max_partido": 0,
    "apuestas.destacado": true,
    "apuestas.destacado_dia": "",

    "alertas.enabled": true,
    "alertas.admin_ids": "",
    "alertas.tipos": "error,gemini,odds,backup",
    "alertas.canal": "",
    "mantenimiento.activo": false,
    "mantenimiento.mensaje": "🛠️ El bot está en mantenimiento. Vuelve a intentarlo en un rato.",

    "avisos.cumple_channel_id": "",
    "bienvenida.canal_id": "",
    "bienvenida.texto": "",
    "sugerencias.canal_id": "",
    "autoroles.lista": "",

    "sonidos.apagado": false,
    "sonidos.silencio_desde": "",
    "sonidos.silencio_hasta": "",
    "sonidos.eventos_minutos": 5,

    "clasificacion.canal": "",
    "clasificacion.premio": 500,
    "clasificacion.premio_rico": -1,
    "clasificacion.premio_activo": -1,
    "clasificacion.premio_apostador": -1,
    "clasificacion.premio_constante": -1,
    "clasificacion.ultima_semana": "",
    "liga.premio_1": 5000,
    "liga.premio_2": 2500,
    "liga.premio_3": 1000,
    "eventos.xp_activo": false,
    "eventos.xp_mult": 2,
    "eventos.xp_desde": 20,
    "eventos.xp_hasta": 22,
    "eventos.casino_activo": false,
    "eventos.casino_pct": 150,
};

const KEY_TYPES = {
    "duende.model": "string",
    "duende.temperature": "number",
    "duende.history_limit": "number",
    "duende.allowed_channel_id": "string",
    "duende.espontaneo_enabled": "number",
    "duende.espontaneo_channel_id": "string",
    "duende.madrugada_activa": "boolean",
    "duende.madrugada_desde": "number",
    "duende.madrugada_hasta": "number",
    "duende.canales_formales": "string",

    "cripto.fee_buy_pct": "number",
    "cripto.fee_sell_pct": "number",
    "cripto.cooldown_buy_sec": "number",
    "cripto.cooldown_sell_sec": "number",
    "cripto.min_buy": "number",
    "cripto.max_buy": "number",
    "cripto.min_sell": "number",
    "cripto.max_sell": "number",
    "cripto.pausa": "boolean",
    "cripto.max_impacto_pct": "number",
    "cripto.eventos_canal": "string",

    "casino.min_bet": "number",
    "casino.max_bet": "number",
    "casino.global_cooldown_sec": "number",
    "casino.daily_limit": "number",
    "casino.rtp_blackjack": "number",
    "casino.rtp_tragaperras": "number",
    "casino.rtp_ruleta": "number",
    "casino.rtp_adivinar": "number",
    "casino.rtp_rasca": "number",

    "tienda.enabled": "boolean",
    "tienda.buy_cooldown_sec": "number",
    "tienda.daily_limit": "number",
    "tienda.notif_channel_id": "string",
    "tienda.recompra_pct": "number",
    "tienda.subida_pct": "number",
    "tienda.recuperacion_pct": "number",
    "tienda.tope_pct": "number",

    "economia.seguro_precio": "number",
    "economia.seguro_horas": "number",
    "economia.seguro_cooldown_h": "number",
    "economia.seguro_tope_dias": "number",
    "economia.deposito_min": "number",
    "economia.deposito_max": "number",
    "economia.deposito_pct_7": "number",
    "economia.deposito_pct_30": "number",
    "economia.deposito_pct_90": "number",

    "logros.enabled": "boolean",
    "logros.notify_channel_id": "string",
    "logros.reward_multiplier": "number",
    "logros.disabled_categories": "string",

    "plex.tautulli_url": "string",
    "plex.tautulli_api_key": "string",
    "plex.novedades_channel_id": "string",
    "plex.bibliotecas_anime": "string",
    "plex.ranking_canal": "string",
    "plex.ranking_ultima_semana": "string",
    "plex.importacion_pct": "number",
    "plex.rol_gordos_1": "string",
    "plex.rol_gordos_5": "string",
    "plex.rol_gordos_10": "string",
    "plex.resenas_activo": "boolean",
    "plex.resenas_max_dia": "number",
    "plex.resenas_min_votos": "number",
    "plex.resenas_desde": "number",
    "plex.resenas_canal": "string",

    "seerr.url": "string",
    "seerr.api_key": "string",
    "seerr.daily_request_limit": "number",
    "seerr.avisar_disponible": "boolean",

    "apuestas.canal_resultados": "string",
    "apuestas.recordatorio": "boolean",
    "apuestas.recordatorio_min": "number",
    "apuestas.recordatorio_quiniela_horas": "number",
    "apuestas.tope_diario": "number",
    "apuestas.max_partido": "number",
    "apuestas.destacado": "boolean",
    "apuestas.destacado_dia": "string",

    "alertas.enabled": "boolean",
    "alertas.admin_ids": "string",
    "alertas.tipos": "string",
    "alertas.canal": "string",
    "mantenimiento.activo": "boolean",
    "mantenimiento.mensaje": "string",

    "avisos.cumple_channel_id": "string",
    "bienvenida.canal_id": "string",
    "bienvenida.texto": "string",
    "sugerencias.canal_id": "string",
    "autoroles.lista": "string",
    "sonidos.apagado": "boolean",
    "sonidos.silencio_desde": "string",
    "sonidos.silencio_hasta": "string",
    "sonidos.eventos_minutos": "number",

    "clasificacion.canal": "string",
    "clasificacion.premio": "number",
    "clasificacion.premio_rico": "number",
    "clasificacion.premio_activo": "number",
    "clasificacion.premio_apostador": "number",
    "clasificacion.premio_constante": "number",
    "clasificacion.ultima_semana": "string",
    "liga.premio_1": "number",
    "liga.premio_2": "number",
    "liga.premio_3": "number",
    "eventos.xp_activo": "boolean",
    "eventos.xp_mult": "number",
    "eventos.xp_desde": "number",
    "eventos.xp_hasta": "number",
    "eventos.casino_activo": "boolean",
    "eventos.casino_pct": "number",
};

for (const juego of JUEGOS_CASINO) {
    DEFAULT_FLAT[`casino.max_bet_${juego}`] = 0;
    DEFAULT_FLAT[`casino.cooldown_sec_${juego}`] = 0;
    KEY_TYPES[`casino.max_bet_${juego}`] = "number";
    KEY_TYPES[`casino.cooldown_sec_${juego}`] = "number";
}

// 🛡️ Pase de batalla (#353): activar, el tope diario de cada categoría y lo que cuesta cada nivel (los valores por defecto son los de
// systems/pase/constantes, así que sin ajustes guardados nada cambia), el canal de los anuncios de nivel (#344) y los objetos por nivel
// (#364, un JSON {"nivel": id del objeto}).
const AJUSTES_PASE = {
    "pase.activo": [true, "boolean"],
    "pase.xp_nivel_base": [XP_NIVEL_BASE, "number"],
    "pase.xp_nivel_paso": [XP_NIVEL_PASO, "number"],
    "pase.canal_nivel": ["", "string"],
    "pase.objetos": ["", "string"],
    ...Object.fromEntries(Object.entries(CATEGORIAS).map(([categoria, { tope }]) => [`pase.tope_${categoria}`, [tope, "number"]])),
};
for (const [clave, [valor, tipo]] of Object.entries(AJUSTES_PASE)) {
    DEFAULT_FLAT[clave] = valor;
    KEY_TYPES[clave] = tipo;
}

module.exports = { DEFAULT_FLAT, KEY_TYPES, JUEGOS_CASINO };
