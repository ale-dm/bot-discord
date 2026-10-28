// Lectura de valores: convertir lo guardado al tipo de cada ajuste y pasarlo a la forma anidada.

const { DEFAULT_FLAT, KEY_TYPES, JUEGOS_CASINO } = require("./definicion");
const { CATEGORIAS } = require("../pase/constantes");

function parseValue(key, value) {
    const type = KEY_TYPES[key] || "string";
    if (type === "number") {
        const num = Number(value);
        return Number.isFinite(num) ? num : Number(DEFAULT_FLAT[key] || 0);
    }
    if (type === "boolean") {
        if (typeof value === "boolean") return value;
        const normalized = String(value || "").toLowerCase();
        return normalized === "1" || normalized === "true" || normalized === "si";
    }
    return String(value ?? "");
}

function nodoDuende(flat) {
    return {
        model: flat["duende.model"],
        temperature: flat["duende.temperature"],
        history_limit: flat["duende.history_limit"],
        allowed_channel_id: flat["duende.allowed_channel_id"],
        espontaneo_enabled: !!flat["duende.espontaneo_enabled"],
        espontaneo_channel_id: flat["duende.espontaneo_channel_id"],
        madrugada_activa: flat["duende.madrugada_activa"],
        madrugada_desde: flat["duende.madrugada_desde"],
        madrugada_hasta: flat["duende.madrugada_hasta"],
        canales_formales: flat["duende.canales_formales"],
    };
}

/** Tope de apuesta y cooldown propios de cada juego del casino (#460, #461): max_bet_<juego> y cooldown_sec_<juego>. */
function nodoCasinoPorJuego(flat) {
    const nodo = {};
    for (const juego of JUEGOS_CASINO) {
        nodo[`max_bet_${juego}`] = flat[`casino.max_bet_${juego}`];
        nodo[`cooldown_sec_${juego}`] = flat[`casino.cooldown_sec_${juego}`];
    }
    return nodo;
}

function nodoEconomia(flat) {
    return {
        cripto: {
            fee_buy_pct: flat["cripto.fee_buy_pct"],
            fee_sell_pct: flat["cripto.fee_sell_pct"],
            cooldown_buy_sec: flat["cripto.cooldown_buy_sec"],
            cooldown_sell_sec: flat["cripto.cooldown_sell_sec"],
            min_buy: flat["cripto.min_buy"],
            max_buy: flat["cripto.max_buy"],
            min_sell: flat["cripto.min_sell"],
            max_sell: flat["cripto.max_sell"],
            pausa: flat["cripto.pausa"],
            max_impacto_pct: flat["cripto.max_impacto_pct"],
            eventos_canal: flat["cripto.eventos_canal"],
        },
        casino: {
            min_bet: flat["casino.min_bet"],
            max_bet: flat["casino.max_bet"],
            global_cooldown_sec: flat["casino.global_cooldown_sec"],
            daily_limit: flat["casino.daily_limit"],
            rtp_blackjack: flat["casino.rtp_blackjack"],
            rtp_tragaperras: flat["casino.rtp_tragaperras"],
            rtp_ruleta: flat["casino.rtp_ruleta"],
            rtp_adivinar: flat["casino.rtp_adivinar"],
            rtp_rasca: flat["casino.rtp_rasca"],
            ...nodoCasinoPorJuego(flat),
        },
        tienda: {
            enabled: flat["tienda.enabled"],
            buy_cooldown_sec: flat["tienda.buy_cooldown_sec"],
            daily_limit: flat["tienda.daily_limit"],
            notif_channel_id: flat["tienda.notif_channel_id"],
            recompra_pct: flat["tienda.recompra_pct"],
            subida_pct: flat["tienda.subida_pct"],
            recuperacion_pct: flat["tienda.recuperacion_pct"],
            tope_pct: flat["tienda.tope_pct"],
        },
        // 🛡️ Seguro antirrobo (#526): prima, duración, cooldown entre compras y tope por delante.
        economia: {
            seguro_precio: flat["economia.seguro_precio"],
            seguro_horas: flat["economia.seguro_horas"],
            seguro_cooldown_h: flat["economia.seguro_cooldown_h"],
            seguro_tope_dias: flat["economia.seguro_tope_dias"],
            // 📈 Depósito a plazo (#518): mínimo, máximo y el interés de cada plazo (7, 30 y 90 días).
            deposito_min: flat["economia.deposito_min"],
            deposito_max: flat["economia.deposito_max"],
            deposito_pct_7: flat["economia.deposito_pct_7"],
            deposito_pct_30: flat["economia.deposito_pct_30"],
            deposito_pct_90: flat["economia.deposito_pct_90"],
        },
    };
}

function nodoPlexYLogros(flat) {
    return {
        logros: {
            enabled: flat["logros.enabled"],
            notify_channel_id: flat["logros.notify_channel_id"],
            reward_multiplier: flat["logros.reward_multiplier"],
            disabled_categories: flat["logros.disabled_categories"],
        },
        plex: {
            tautulli_url: flat["plex.tautulli_url"],
            tautulli_api_key: flat["plex.tautulli_api_key"],
            novedades_channel_id: flat["plex.novedades_channel_id"],
            bibliotecas_anime: flat["plex.bibliotecas_anime"],
            ranking_canal: flat["plex.ranking_canal"],
            ranking_ultima_semana: flat["plex.ranking_ultima_semana"],
            importacion_pct: flat["plex.importacion_pct"],
            rol_gordos_1: flat["plex.rol_gordos_1"],
            rol_gordos_5: flat["plex.rol_gordos_5"],
            rol_gordos_10: flat["plex.rol_gordos_10"],
            resenas_activo: flat["plex.resenas_activo"],
            resenas_max_dia: flat["plex.resenas_max_dia"],
            resenas_min_votos: flat["plex.resenas_min_votos"],
            resenas_desde: flat["plex.resenas_desde"],
            resenas_canal: flat["plex.resenas_canal"],
        },
        seerr: {
            url: flat["seerr.url"],
            api_key: flat["seerr.api_key"],
            daily_request_limit: flat["seerr.daily_request_limit"],
            avisar_disponible: flat["seerr.avisar_disponible"],
        },
    };
}

/** Los ajustes del pase de batalla (#353): activo, el tope de cada categoría, lo que cuesta cada nivel, el canal de anuncios y los objetos por nivel. */
function nodoPase(flat) {
    return {
        activo: flat["pase.activo"],
        topes: Object.fromEntries(Object.keys(CATEGORIAS).map((c) => [c, flat[`pase.tope_${c}`]])),
        xp_nivel_base: flat["pase.xp_nivel_base"],
        xp_nivel_paso: flat["pase.xp_nivel_paso"],
        canal_nivel: flat["pase.canal_nivel"],
        objetos: flat["pase.objetos"],
    };
}

/** Los tickets de soporte (#537): canal de los hilos, rol de staff, canal de transcripciones y categorías. */
function nodoTickets(flat) {
    return {
        canal_id: flat["tickets.canal_id"],
        rol_staff: flat["tickets.rol_staff"],
        canal_logs: flat["tickets.canal_logs"],
        categorias: flat["tickets.categorias"],
    };
}

function nodoOtros(flat) {
    return {
        pase: nodoPase(flat),
        apuestas: {
            canal_resultados: flat["apuestas.canal_resultados"],
            recordatorio: flat["apuestas.recordatorio"],
            recordatorio_min: flat["apuestas.recordatorio_min"],
            recordatorio_quiniela_horas: flat["apuestas.recordatorio_quiniela_horas"],
            tope_diario: flat["apuestas.tope_diario"],
            max_partido: flat["apuestas.max_partido"],
            destacado: flat["apuestas.destacado"],
            destacado_dia: flat["apuestas.destacado_dia"],
        },
        alertas: {
            enabled: flat["alertas.enabled"],
            admin_ids: flat["alertas.admin_ids"],
            tipos: flat["alertas.tipos"],
            canal: flat["alertas.canal"],
        },
        mantenimiento: { activo: flat["mantenimiento.activo"], mensaje: flat["mantenimiento.mensaje"] },
        avisos: { cumple_channel_id: flat["avisos.cumple_channel_id"] },
        bienvenida: { canal_id: flat["bienvenida.canal_id"], texto: flat["bienvenida.texto"] },
        sugerencias: { canal_id: flat["sugerencias.canal_id"] },
        tickets: nodoTickets(flat),
        autoroles: { lista: flat["autoroles.lista"] },
        sonidos: {
            apagado: flat["sonidos.apagado"],
            silencio_desde: flat["sonidos.silencio_desde"],
            silencio_hasta: flat["sonidos.silencio_hasta"],
            eventos_minutos: flat["sonidos.eventos_minutos"],
        },
        clasificacion: {
            canal: flat["clasificacion.canal"],
            premio: flat["clasificacion.premio"],
            premio_rico: flat["clasificacion.premio_rico"],
            premio_activo: flat["clasificacion.premio_activo"],
            premio_apostador: flat["clasificacion.premio_apostador"],
            premio_constante: flat["clasificacion.premio_constante"],
            ultima_semana: flat["clasificacion.ultima_semana"],
        },
        liga: {
            premio_1: flat["liga.premio_1"],
            premio_2: flat["liga.premio_2"],
            premio_3: flat["liga.premio_3"],
        },
        eventos: {
            xp: {
                activo: flat["eventos.xp_activo"],
                mult: flat["eventos.xp_mult"],
                desde: flat["eventos.xp_desde"],
                hasta: flat["eventos.xp_hasta"],
            },
            casino: { activo: flat["eventos.casino_activo"], pct: flat["eventos.casino_pct"] },
        },
    };
}

/** ⚠️ Moderación (#542): `moderacion.*` sin el prefijo. */
const nodoModeracion = (flat) => ({
    moderacion: Object.fromEntries(
        Object.entries(flat)
            .filter(([clave]) => clave.startsWith("moderacion."))
            .map(([clave, valor]) => [clave.slice("moderacion.".length), valor]),
    ),
});

/** 📅 Calendario (#540): `calendario.*` sin el prefijo. */
const nodoCalendario = (flat) => ({
    calendario: Object.fromEntries(
        Object.entries(flat)
            .filter(([clave]) => clave.startsWith("calendario."))
            .map(([clave, valor]) => [clave.slice("calendario.".length), valor]),
    ),
});

/** Las claves `<area>.*` sin el prefijo, como un nodo `{ <area>: { … } }`. */
const nodoPlano = (flat, area) => ({
    [area]: Object.fromEntries(
        Object.entries(flat)
            .filter(([clave]) => clave.startsWith(`${area}.`))
            .map(([clave, valor]) => [clave.slice(area.length + 1), valor]),
    ),
});

/** 🗳️ Elecciones a la presidencia: `elecciones.*` sin el prefijo. */
const nodoElecciones = (flat) => nodoPlano(flat, "elecciones");
/** 🎟️ Más economía (#524 y siguientes): cada área nueva, sin su prefijo. */
const AREAS_ECONOMIA_EXTRA = ["loteria"];
const nodoEconomiaExtra = (flat) => Object.assign({}, ...AREAS_ECONOMIA_EXTRA.map((area) => nodoPlano(flat, area)));

function flattenToNested(flat) {
    return {
        ...nodoElecciones(flat),
        ...nodoEconomiaExtra(flat),
        ...nodoCalendario(flat),
        ...nodoModeracion(flat),
        duende: nodoDuende(flat),
        ...nodoEconomia(flat),
        ...nodoPlexYLogros(flat),
        ...nodoOtros(flat),
    };
}

// Caché de los ajustes ya leídos de cada servidor (mapa plano, con los valores parseados). Se lee de la BD una vez y
// luego se sirve de memoria: un mensaje consulta los ajustes varias veces. Se invalida al escribir (setSetting y
// setManySettings son las únicas escrituras de la tabla, salvo las migraciones, que corren antes de leer nada).

module.exports = { parseValue, flattenToNested };
