// Lectura de valores: convertir lo guardado al tipo de cada ajuste y pasarlo a la forma anidada.

const { DEFAULT_FLAT, KEY_TYPES } = require("./definicion");

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
        },
        tienda: {
            enabled: flat["tienda.enabled"],
            buy_cooldown_sec: flat["tienda.buy_cooldown_sec"],
            daily_limit: flat["tienda.daily_limit"],
            notif_channel_id: flat["tienda.notif_channel_id"],
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
        },
        seerr: {
            url: flat["seerr.url"],
            api_key: flat["seerr.api_key"],
            daily_request_limit: flat["seerr.daily_request_limit"],
            avisar_disponible: flat["seerr.avisar_disponible"],
        },
    };
}

function nodoOtros(flat) {
    return {
        apuestas: {
            canal_resultados: flat["apuestas.canal_resultados"],
            recordatorio: flat["apuestas.recordatorio"],
            recordatorio_min: flat["apuestas.recordatorio_min"],
            tope_diario: flat["apuestas.tope_diario"],
            max_partido: flat["apuestas.max_partido"],
            destacado: flat["apuestas.destacado"],
            destacado_dia: flat["apuestas.destacado_dia"],
        },
        alertas: {
            enabled: flat["alertas.enabled"],
            admin_ids: flat["alertas.admin_ids"],
        },
        clasificacion: {
            canal: flat["clasificacion.canal"],
            premio: flat["clasificacion.premio"],
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

function flattenToNested(flat) {
    return {
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
