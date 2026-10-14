const { Type: SchemaType } = require("@google/genai");
const xpSystem = require("../../../systems/xpSystem");
const achievementsSystem = require("../../../systems/achievementsSystem");
const { resolveNameToDiscordId, buildPersonProfileText } = require("../../../systems/duende/personas");
const perfiles = require("../../../systems/duende/perfiles");
const { getTtclPrecio } = require("../../../systems/cripto/mercado");
const dinero = require("../../../systems/dinero");
const prestamos = require("../../../systems/prestamos");
const plexTrofeos = require("../../../systems/plexTrofeos");
const tienda = require("../../../systems/tienda");
const objetos = require("../../../systems/objetos");
const misJugadas = require("../../../systems/apuestas/misJugadas");
const { marcadorDe } = require("../../../systems/apuestas/marcador");
const mercados = require("../../../systems/apuestas/mercados");
const repoCasino = require("../../../repositorios/casino");

const DUENDE_CORE_TOOL_DECLARATIONS = [
    {
        name: "consultar_nivel_y_racha",
        description: "Consulta el nivel, XP, rango y racha diaria del usuario que te está hablando ahora mismo.",
        parameters: { type: SchemaType.OBJECT, properties: {} },
    },
    {
        name: "consultar_saldo",
        description:
            "Consulta el dinero del usuario que te está hablando ahora mismo: efectivo (lo que gasta) y banco (lo que tiene guardado).",
        parameters: { type: SchemaType.OBJECT, properties: {} },
    },
    {
        name: "precio_ttcl",
        description: "Consulta el precio actual de la criptomoneda TTCL en este servidor.",
        parameters: { type: SchemaType.OBJECT, properties: {} },
    },
    {
        name: "consultar_logros",
        description: "Consulta cuántos logros ha completado el usuario que te está hablando ahora mismo.",
        parameters: { type: SchemaType.OBJECT, properties: {} },
    },
    {
        name: "tirar_dado",
        description: "Tira un dado de N caras y devuelve el resultado.",
        parameters: {
            type: SchemaType.OBJECT,
            properties: {
                caras: { type: SchemaType.NUMBER, description: "Número de caras del dado (por defecto 6)" },
            },
        },
    },
    {
        name: "consultar_tienda",
        description: "Consulta qué objetos hay a la venta en la tienda del bot (/tienda): nombre, precio, stock, tipo y rareza.",
        parameters: {
            type: SchemaType.OBJECT,
            properties: {
                busqueda: { type: SchemaType.STRING, description: "Opcional: texto para filtrar por nombre o tipo" },
            },
        },
    },
    {
        name: "consultar_inventario",
        description: "Consulta los objetos que tiene en su inventario el usuario que te está hablando ahora mismo.",
        parameters: { type: SchemaType.OBJECT, properties: {} },
    },
    {
        name: "consultar_mis_apuestas",
        description:
            "Consulta las apuestas de fútbol del usuario que te está hablando ahora mismo: las que tiene en juego (partido, a qué apostó, cuánto y cuánto ganaría), sus quinielas abiertas con los aciertos que lleva y su balance de apuestas.",
        parameters: { type: SchemaType.OBJECT, properties: {} },
    },
    {
        name: "consultar_partidas_casino",
        description:
            "Consulta las últimas partidas de casino (blackjack, ruleta, tragaperras, adivinar, piedra-papel-tijera) del usuario que te está hablando ahora mismo y cuánto lleva ganado y perdido en el casino.",
        parameters: {
            type: SchemaType.OBJECT,
            properties: {
                cantidad: { type: SchemaType.NUMBER, description: "Cuántas partidas recientes traer (por defecto 5, máximo 15)" },
            },
        },
    },
    {
        name: "consultar_perfil_persona",
        description:
            "Consulta qué sabes de una persona del servidor por su nombre o apodo: su descripción y las notas que tengas sobre ella. Úsala cuando te pregunten quién es alguien, o te hablen de alguien y no la ubiques de memoria — incluida la persona que te está hablando ahora, si pregunta por sí misma.",
        parameters: {
            type: SchemaType.OBJECT,
            properties: {
                persona: {
                    type: SchemaType.STRING,
                    description: "Nombre o apodo de la persona, tal cual se ha usado en la conversación (o 'yo' si pregunta por sí misma)",
                },
            },
            required: ["persona"],
        },
    },
];

/** Lo que usan las herramientas de este grupo (#475): cada una lo recibe como último argumento, y en los tests se pasan dobles. */
const REALES_CORE = {
    xpSystem,
    achievementsSystem,
    resolveNameToDiscordId,
    buildPersonProfileText,
    perfiles,
    getTtclPrecio,
    dinero,
    prestamos,
    plexTrofeos,
    tienda,
    objetos,
    misJugadas,
    marcadorDe,
    mercados,
    repoCasino,
};

const DUENDE_CORE_EXECUTORS = {
    consultar_nivel_y_racha(args, ctx, d = REALES_CORE) {
        if (!ctx.guildId) return { error: "Solo disponible en servidores." };
        const p = d.xpSystem.getProfile(ctx.guildId, ctx.userId);
        return {
            nivel: p.nivel,
            xp: p.xp,
            xp_necesaria_siguiente_nivel: p.xp_need,
            rango: p.title?.title || "sin rango",
            racha_dias: p.streak,
            racha_bonus_xp_pct: p.streakBonusPct,
            ranking_servidor: p.rank,
        };
    },
    consultar_saldo(args, ctx, d = REALES_CORE) {
        const c = d.dinero.cuenta(ctx.userId);
        const p = d.prestamos.abierto(ctx.userId);
        return {
            efectivo: c.efectivo,
            banco: c.banco,
            total: c.total,
            ...(p
                ? {
                      prestamo_del_duende: {
                          le_falta_devolver: p.falta,
                          vence: new Date(p.vence_en).toLocaleString("es-ES", { timeZone: "Europe/Madrid" }),
                          vencido_y_en_deuda: p.estado === "deuda",
                      },
                  }
                : {}),
        };
    },
    precio_ttcl(args, ctx, d = REALES_CORE) {
        return { precio_ttcl_en_coins: d.getTtclPrecio() };
    },
    consultar_logros(args, ctx, d = REALES_CORE) {
        if (!ctx.guildId) return { error: "Solo disponible en servidores." };
        // Como en su perfil: sin Plex vinculado, los de Plex que no tiene no cuentan.
        const opciones = d.plexTrofeos.opcionesPerfil(ctx.guildId, ctx.userId, true);
        const s = d.achievementsSystem.getSummary(ctx.guildId, ctx.userId, opciones);
        return { logros_completados: s.completed, logros_totales: s.total, porcentaje: s.completionPct };
    },
    tirar_dado(args) {
        const caras = Math.max(2, Math.min(1000, Math.floor(Number(args?.caras) || 6)));
        return { caras, resultado: 1 + Math.floor(Math.random() * caras) };
    },
    consultar_tienda(args, _ctx, d = REALES_CORE) {
        const busqueda = String(args?.busqueda || "").trim() || undefined;
        const items = d.tienda.itemsTienda({ busqueda });
        return {
            a_la_venta: items.slice(0, 15).map((i) => ({
                nombre: i.nombre,
                precio: i.precio,
                stock: i.stock === null ? "ilimitado" : i.stock,
                tipo: i.tipo || null,
                rareza: i.rareza || null,
                solo_uno_por_persona: Boolean(i.unico),
                descripcion: i.descripcion ? String(i.descripcion).slice(0, 150) : null,
            })),
            total: items.length,
        };
    },
    consultar_inventario(args, ctx, d = REALES_CORE) {
        const items = d.objetos.inventarioDe(ctx.userId);
        return {
            objetos: items.slice(0, 20).map((o) => ({
                nombre: o.nombre,
                cantidad: o.cantidad,
                tipo: o.tipo || null,
                rareza: o.rareza || null,
                se_puede_usar: d.objetos.esUsable(o),
            })),
            distintos: items.length,
        };
    },
    consultar_mis_apuestas(args, ctx, d = REALES_CORE) {
        const eleccion = (a) =>
            d.marcadorDe(a.eleccion)
                ? `marcador exacto ${d.marcadorDe(a.eleccion)}`
                : d.mercados.esMercado(a.eleccion)
                  ? d.mercados.textoEleccion(a).toLowerCase()
                  : a.eleccion === "home"
                    ? a.home_team
                    : a.eleccion === "away"
                      ? a.away_team
                      : "empate";
        const stats = d.misJugadas.estadisticas(ctx.userId);
        return {
            partidos_en_juego: d.misJugadas.partidosDe(ctx.userId, { pendientes: true, limite: 10 }).map((a) => ({
                partido: `${a.home_team} vs ${a.away_team}`,
                empieza: a.start_time,
                apostado_a: eleccion(a),
                cantidad: a.cantidad,
                cuota: a.cuota,
                ganaria: Math.round(a.cantidad * a.cuota),
            })),
            quinielas_abiertas: d.misJugadas.quinielasDe(ctx.userId, { abiertas: true, limite: 3 }).map((q) => ({
                jornada: q.jornada,
                apostado: q.cantidad,
                aciertos_hasta_ahora: q.detalle.aciertos,
                partidos_jugados: q.detalle.jugados,
                partidos_total: q.detalle.total,
            })),
            balance_partidos: { apostado: stats.partidos.apostado, ganado: stats.partidos.ganado, en_juego: stats.partidos.enJuego },
            balance_quinielas: { apostado: stats.quinielas.apostado, ganado: stats.quinielas.ganado, en_juego: stats.quinielas.enJuego },
        };
    },
    consultar_partidas_casino(args, ctx, d = REALES_CORE) {
        const cantidad = Math.max(1, Math.min(15, Math.floor(Number(args?.cantidad) || 5)));
        const { ganado, perdido } = d.repoCasino.totalesCasino(ctx.userId);
        return {
            ultimas_partidas: d.misJugadas
                .ultimasCasino(ctx.userId, cantidad)
                .map((p) => ({ juego: p.juego, apostado: p.apuesta, resultado_neto: p.resultado })),
            total_ganado: ganado,
            total_perdido: perdido,
        };
    },
    consultar_perfil_persona(args, ctx, d = REALES_CORE) {
        if (!ctx.guild) return { error: "Solo disponible en servidores." };
        const nombre = String(args?.persona || "").trim();
        if (!nombre) return { error: "Falta el nombre de la persona." };

        const esQuienHabla = /^(yo|y[oó]\s*mism[oa]|m[ií])$/i.test(nombre);
        const discordId = esQuienHabla ? ctx.userId : d.resolveNameToDiscordId(nombre, ctx.guild);
        if (!discordId) return { encontrado: false, nota: `No identifico a "${nombre}" entre los miembros del server.` };

        const perfil = d.perfiles.perfilPorDiscordId(discordId);
        const info = perfil ? d.buildPersonProfileText(perfil) : "";
        if (!info) return { encontrado: false, nota: "No tengo ninguna nota ni descripción guardada de esa persona." };

        const member = ctx.guild.members.cache.get(discordId);
        return { encontrado: true, nombre: member?.displayName || perfil?.name || nombre, info };
    },
};

module.exports = { DUENDE_CORE_TOOL_DECLARATIONS, DUENDE_CORE_EXECUTORS };
