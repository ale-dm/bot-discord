const { Type: SchemaType } = require("@google/genai");
const tautulliClient = require("../../tautulliClient");
const { periodoADias, formatFecha, formatHoras, summarizeWatchHistory, resolverPersonaVinculada } = require("./base");
const { consultarTrofeosPlex } = require("./plexTrofeos");

// Separadas de las generales porque estas se filtran por canal (ver isChannelAllowed
// más abajo): en canales no permitidos, ni siquiera se le declaran a Gemini.
const DUENDE_PLEX_TOOL_DECLARATIONS = [
    {
        name: "consultar_actividad_plex",
        description:
            "Consulta qué ha visto alguien en Plex en los últimos N días (series con nº de episodios, películas sueltas). Llámala con cualquier nombre o apodo que se use para referirse a esa persona, aunque no sepas si tiene Plex vinculado — la propia herramienta te dice si no lo tiene.",
        parameters: {
            type: SchemaType.OBJECT,
            properties: {
                persona: {
                    type: SchemaType.STRING,
                    description:
                        "Nombre o apodo de la persona sobre la que se pregunta, tal cual se ha usado en el mensaje (ej. 'el perro', 'Coneyo')",
                },
                dias: { type: SchemaType.NUMBER, description: "Número de días hacia atrás a consultar (por defecto 7)" },
            },
            required: ["persona"],
        },
    },
    {
        name: "consultar_viendo_ahora",
        description: "Consulta qué se está reproduciendo en Plex ahora mismo y quién lo está viendo.",
        parameters: { type: SchemaType.OBJECT, properties: {} },
    },
    {
        name: "consultar_tiempo_visto",
        description:
            "Consulta cuántas horas ha visto alguien en Plex en un periodo. Llámala con cualquier nombre o apodo, aunque no sepas si tiene Plex vinculado — la propia herramienta te dice si no lo tiene.",
        parameters: {
            type: SchemaType.OBJECT,
            properties: {
                persona: {
                    type: SchemaType.STRING,
                    description: "Nombre o apodo de la persona sobre la que se pregunta, tal cual se ha usado en el mensaje",
                },
                periodo: { type: SchemaType.STRING, description: "semana, mes, año o total" },
            },
            required: ["persona"],
        },
    },
    {
        name: "consultar_ultima_conexion",
        description:
            "Consulta cuándo fue la última vez que alguien vio algo en Plex (cuánto tiempo lleva sin ver nada). Llámala con cualquier nombre o apodo, aunque no sepas si tiene Plex vinculado — la propia herramienta te dice si no lo tiene.",
        parameters: {
            type: SchemaType.OBJECT,
            properties: {
                persona: {
                    type: SchemaType.STRING,
                    description:
                        "Nombre o apodo de la persona sobre la que se pregunta, tal cual se ha usado en el mensaje (ej. 'el perro', 'Coneyo')",
                },
            },
            required: ["persona"],
        },
    },
    {
        name: "consultar_novedades_plex",
        description: "Consulta las últimas películas/episodios añadidos a la biblioteca de Plex del servidor.",
        parameters: {
            type: SchemaType.OBJECT,
            properties: {
                cantidad: { type: SchemaType.NUMBER, description: "Cuántas novedades traer (por defecto 5)" },
            },
        },
    },
    {
        name: "comparar_actividad_plex",
        description:
            "Compara el tiempo visto en Plex entre dos personas en un periodo. Llámala con cualquier nombre o apodo para cada una, aunque no sepas si tienen Plex vinculado — la propia herramienta te dice si alguna no lo tiene.",
        parameters: {
            type: SchemaType.OBJECT,
            properties: {
                persona1: {
                    type: SchemaType.STRING,
                    description: "Primera persona a comparar (nombre o apodo tal cual se ha usado en el mensaje)",
                },
                persona2: {
                    type: SchemaType.STRING,
                    description: "Segunda persona a comparar (nombre o apodo tal cual se ha usado en el mensaje)",
                },
                periodo: { type: SchemaType.STRING, description: "semana, mes, año o total" },
            },
            required: ["persona1", "persona2"],
        },
    },
    {
        name: "consultar_top_visto_server",
        description:
            "Consulta qué películas y series se han visto más en Plex en este servidor en un periodo (entre todo el mundo, no solo los vinculados).",
        parameters: {
            type: SchemaType.OBJECT,
            properties: {
                periodo: { type: SchemaType.STRING, description: "semana, mes o año" },
            },
        },
    },
    {
        name: "buscar_en_plex",
        description: "Busca si una película o serie existe en la biblioteca de Plex del servidor, con su sinopsis, año y nota.",
        parameters: {
            type: SchemaType.OBJECT,
            properties: {
                titulo: { type: SchemaType.STRING, description: "Título a buscar" },
            },
            required: ["titulo"],
        },
    },
    {
        name: "consultar_ranking_plex",
        description:
            "Consulta el ranking de quién más ha visto Plex en este servidor en un periodo (entre todo el mundo, no solo los vinculados).",
        parameters: {
            type: SchemaType.OBJECT,
            properties: {
                periodo: { type: SchemaType.STRING, description: "semana, mes o año" },
            },
        },
    },
    {
        name: "consultar_bibliotecas_plex",
        description: "Consulta cuántas películas, series u otro contenido hay en cada biblioteca de Plex del servidor.",
        parameters: { type: SchemaType.OBJECT, properties: {} },
    },
    {
        name: "consultar_patron_visionado",
        description: "Consulta qué día de la semana y a qué hora se ve más Plex en este servidor en un periodo.",
        parameters: {
            type: SchemaType.OBJECT,
            properties: {
                periodo: { type: SchemaType.STRING, description: "semana, mes o año" },
            },
        },
    },
    {
        name: "consultar_trofeos_plex",
        description:
            "Consulta los logros y trofeos de Plex del servidor (los del bot: series terminadas, sagas, idiomas, 🎰 Gordos del Plex...). Con 'persona': los que tiene esa persona. Con 'titulo': quién tiene el trofeo de esa serie, saga, película o director (p. ej. '¿quién ha terminado Breaking Bad?'). Sin nada: quién tiene más. Llámala con cualquier nombre o apodo.",
        parameters: {
            type: SchemaType.OBJECT,
            properties: {
                persona: {
                    type: SchemaType.STRING,
                    description: "Nombre o apodo de la persona por la que se pregunta, tal cual se ha usado en el mensaje (opcional)",
                },
                titulo: {
                    type: SchemaType.STRING,
                    description: "Serie, saga, película o director por el que se pregunta, p. ej. 'Breaking Bad' (opcional)",
                },
            },
        },
    },
];

const DUENDE_PLEX_EXECUTORS = {
    async consultar_actividad_plex(args, ctx) {
        const r = await resolverPersonaVinculada(args?.persona, ctx);
        if (r.error) return r;
        const dias = Math.max(1, Math.min(365, Math.floor(Number(args?.dias) || 7)));
        const afterDate = new Date(Date.now() - dias * 86400000).toISOString().slice(0, 10);
        const rows = await tautulliClient.getHistory(ctx.guildId, { userId: r.link.tautulliUserId, afterDate, length: 200 });
        return { persona: args.persona, dias, ...summarizeWatchHistory(rows) };
    },
    async consultar_viendo_ahora(args, ctx) {
        const sessions = await tautulliClient.getActivity(ctx.guildId);
        if (!sessions.length) return { viendo_ahora: [] };
        return {
            viendo_ahora: sessions.map((s) => ({
                usuario: s.friendly_name || s.user || "desconocido",
                titulo: s.grandparent_title ? `${s.grandparent_title} - ${s.title}` : s.full_title || s.title,
                progreso_pct: Number(s.progress_percent) || 0,
                estado: s.state || "reproduciendo",
            })),
        };
    },
    async consultar_tiempo_visto(args, ctx) {
        const r = await resolverPersonaVinculada(args?.persona, ctx);
        if (r.error) return r;
        const dias = periodoADias(args?.periodo);
        const stats = await tautulliClient.getUserWatchTimeStats(ctx.guildId, r.link.tautulliUserId, `${dias}`);
        const entry = stats.find((s) => Number(s.query_days) === dias) || stats[0];
        return {
            persona: args.persona,
            periodo: args?.periodo || "semana",
            horas_vistas: formatHoras(entry?.total_time),
            reproducciones: Number(entry?.total_plays) || 0,
        };
    },
    async consultar_ultima_conexion(args, ctx) {
        const r = await resolverPersonaVinculada(args?.persona, ctx);
        if (r.error) return r;
        const rows = await tautulliClient.getHistory(ctx.guildId, { userId: r.link.tautulliUserId, length: 1 });
        if (!rows.length) return { persona: args.persona, sin_actividad: true };
        const last = rows[0];
        return {
            persona: args.persona,
            fecha: formatFecha(last.date || last.started),
            titulo: last.grandparent_title ? `${last.grandparent_title} - ${last.title}` : last.title,
        };
    },
    async consultar_novedades_plex(args, ctx) {
        const cantidad = Math.max(1, Math.min(20, Math.floor(Number(args?.cantidad) || 5)));
        const items = await tautulliClient.getRecentlyAdded(ctx.guildId, cantidad);
        return {
            novedades: items.map((i) => ({
                titulo: i.grandparent_title ? `${i.grandparent_title} - ${i.title}` : i.title,
                tipo: i.media_type,
                anyo: i.year || null,
            })),
        };
    },
    async comparar_actividad_plex(args, ctx) {
        const [r1, r2] = await Promise.all([resolverPersonaVinculada(args?.persona1, ctx), resolverPersonaVinculada(args?.persona2, ctx)]);
        if (r1.error) return r1;
        if (r2.error) return r2;
        const dias = periodoADias(args?.periodo);
        const [s1, s2] = await Promise.all([
            tautulliClient.getUserWatchTimeStats(ctx.guildId, r1.link.tautulliUserId, `${dias}`),
            tautulliClient.getUserWatchTimeStats(ctx.guildId, r2.link.tautulliUserId, `${dias}`),
        ]);
        const e1 = s1.find((s) => Number(s.query_days) === dias) || s1[0];
        const e2 = s2.find((s) => Number(s.query_days) === dias) || s2[0];
        return {
            periodo: args?.periodo || "semana",
            [args.persona1]: { horas_vistas: formatHoras(e1?.total_time), reproducciones: Number(e1?.total_plays) || 0 },
            [args.persona2]: { horas_vistas: formatHoras(e2?.total_time), reproducciones: Number(e2?.total_plays) || 0 },
        };
    },
    async consultar_top_visto_server(args, ctx) {
        if (!ctx.guildId) return { error: "Solo disponible en servidores." };
        const dias = periodoADias(args?.periodo || "mes") || 30;
        const stats = await tautulliClient.getHomeStats(ctx.guildId, dias, 5);
        const pelis = stats.find((s) => s.stat_id === "top_movies");
        const series = stats.find((s) => s.stat_id === "top_tv");
        const format = (s) =>
            (s?.rows || []).map((r) => ({
                titulo: r.grandparent_title || r.title,
                reproducciones: r.total_plays,
                horas: formatHoras(r.total_duration),
            }));
        return { periodo: args?.periodo || "mes", top_peliculas: format(pelis), top_series: format(series) };
    },
    async buscar_en_plex(args, ctx) {
        if (!ctx.guildId) return { error: "Solo disponible en servidores." };
        const titulo = String(args?.titulo || "").trim();
        if (!titulo) return { error: "Falta el título a buscar." };
        const results = await tautulliClient.search(ctx.guildId, titulo);
        const items = [...(results.movie || []), ...(results.show || [])].slice(0, 5);
        if (!items.length) return { encontrado: false, titulo };
        return {
            encontrado: true,
            resultados: items.map((i) => ({
                titulo: i.title,
                tipo: i.media_type,
                anyo: i.year || null,
                nota: i.rating || null,
                sinopsis: i.summary ? String(i.summary).slice(0, 400) : null,
            })),
        };
    },
    async consultar_ranking_plex(args, ctx) {
        if (!ctx.guildId) return { error: "Solo disponible en servidores." };
        const dias = periodoADias(args?.periodo || "mes") || 30;
        const data = await tautulliClient.getPlaysByTopUsers(ctx.guildId, dias);
        const categories = data.categories || [];
        const totalsPerUser = categories.map((_, idx) =>
            (data.series || []).reduce((sum, serie) => sum + (Number(serie.data?.[idx]) || 0), 0),
        );
        const ranking = categories
            .map((usuario, idx) => ({ usuario, reproducciones: totalsPerUser[idx] }))
            .sort((a, b) => b.reproducciones - a.reproducciones)
            .slice(0, 10);
        return { periodo: args?.periodo || "mes", ranking };
    },
    async consultar_bibliotecas_plex(args, ctx) {
        if (!ctx.guildId) return { error: "Solo disponible en servidores." };
        const libs = await tautulliClient.getLibraries(ctx.guildId);
        return {
            bibliotecas: libs.map((l) => ({ nombre: l.section_name, tipo: l.section_type, items: Number(l.count) || 0 })),
        };
    },
    async consultar_patron_visionado(args, ctx) {
        if (!ctx.guildId) return { error: "Solo disponible en servidores." };
        const dias = periodoADias(args?.periodo || "mes") || 30;
        const [dow, hod] = await Promise.all([
            tautulliClient.getPlaysByDayOfWeek(ctx.guildId, dias),
            tautulliClient.getPlaysByHourOfDay(ctx.guildId, dias),
        ]);
        const sumPerCategory = (data) =>
            (data.categories || []).map((_, idx) => (data.series || []).reduce((sum, serie) => sum + (Number(serie.data?.[idx]) || 0), 0));
        const dowTotals = sumPerCategory(dow);
        const hodTotals = sumPerCategory(hod);
        const diaMasActivo = dow.categories?.[dowTotals.indexOf(Math.max(...dowTotals))] || null;
        const horaMasActiva = hod.categories?.[hodTotals.indexOf(Math.max(...hodTotals))] || null;
        return {
            periodo: args?.periodo || "mes",
            dia_mas_activo: diaMasActivo,
            hora_mas_activa: horaMasActiva ? `${horaMasActiva}:00` : null,
        };
    },
    consultar_trofeos_plex: consultarTrofeosPlex,
};

module.exports = { DUENDE_PLEX_TOOL_DECLARATIONS, DUENDE_PLEX_EXECUTORS };
