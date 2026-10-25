// ⚙️ Config Global → 📊 Estadísticas (#538): una gráfica por métrica (mensajes, XP, economía neta, apuestas y horas de
// Plex) y rango (7, 30 o 90 días), con su resumen. La imagen y el resumen se guardan 5 minutos por servidor, métrica y rango:
// mientras tanto, 🔄 Actualizar está deshabilitado y cambiar de métrica o rango reutiliza lo ya calculado. Solo admins (lo
// comprueba el enrutador del panel) y se audita quién lo abre, no cada consulta.
const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder, AttachmentBuilder } = require("discord.js");
const estadisticas = require("../systems/estadisticas");
const adminAudit = require("../systems/adminAudit");
const { textoResumen, imagen } = require("../paneles/estadisticas");

const PREFIJO = "paneladmin_stats_";
const CACHE_MS = 5 * 60 * 1000;
const COLOR = 0x58a6ff;
const cache = new Map(); // `${guildId}:${metrica}:${dias}` -> { png, periodo, ts }

/** Para los tests: el renderizador y el reloj. */
const opciones = { render: null, ahora: () => Date.now() };

/** Lo calculado de esa combinación, o lo calcula (y lo guarda) si no hay o caducó. */
function calcular(guildId, metrica, dias) {
    const clave = `${guildId}:${metrica}:${dias}`;
    const ahora = opciones.ahora();
    const hit = cache.get(clave);
    if (hit && ahora - hit.ts < CACHE_MS) return hit;
    const periodo = estadisticas.periodo(guildId, metrica, dias, ahora);
    const nuevo = { periodo, png: imagen(periodo, opciones.render), ts: ahora };
    cache.set(clave, nuevo);
    for (const [k, v] of cache) if (ahora - v.ts >= CACHE_MS) cache.delete(k);
    return nuevo;
}

/** La pantalla de una métrica y un rango. */
function buildVista(guildId, metrica = "mensajes", dias = 7) {
    const datos = calcular(guildId, metrica, dias);
    const m = estadisticas.METRICAS[metrica];
    const caduca = datos.ts + CACHE_MS;
    const embed = new EmbedBuilder()
        .setTitle(`📊 ${m.emoji} ${m.nombre} · ${dias} días`)
        .setDescription(
            `${textoResumen(datos.periodo)}\n\n-# Datos de <t:${Math.floor(datos.ts / 1000)}:t>; se pueden actualizar <t:${Math.floor(caduca / 1000)}:R>.`,
        )
        .setImage("attachment://estadisticas.png")
        .setColor(COLOR);
    const metricas = new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder()
            .setCustomId(`${PREFIJO}metrica_${dias}`)
            .setPlaceholder("Métrica")
            .addOptions(
                Object.entries(estadisticas.METRICAS).map(([clave, x]) => ({
                    label: x.nombre,
                    emoji: x.emoji,
                    value: clave,
                    default: clave === metrica,
                })),
            ),
    );
    const rangos = new ActionRowBuilder().addComponents(
        ...estadisticas.RANGOS.map((d) =>
            new ButtonBuilder()
                .setCustomId(`${PREFIJO}ver_${metrica}_${d}`)
                .setLabel(`${d} días`)
                .setStyle(d === dias ? ButtonStyle.Primary : ButtonStyle.Secondary)
                .setDisabled(d === dias),
        ),
        new ButtonBuilder()
            .setCustomId(`${PREFIJO}actualizar_${metrica}_${dias}`)
            .setLabel("🔄 Actualizar")
            .setStyle(ButtonStyle.Secondary)
            .setDisabled(opciones.ahora() < caduca),
        new ButtonBuilder().setCustomId("paneladmin_cfg_home").setLabel("⚙️ Config Global").setStyle(ButtonStyle.Secondary),
    );
    return {
        content: "",
        embeds: [embed],
        components: [metricas, rangos],
        files: [new AttachmentBuilder(Buffer.from(datos.png), { name: "estadisticas.png" })],
        allowedMentions: { parse: [] },
    };
}

/** «mensajes_30» → { metrica, dias } válidos, o null. */
function leer(texto) {
    const m = /^([a-z]+)_(\d+)$/.exec(texto);
    if (!m || !estadisticas.METRICAS[m[1]] || !estadisticas.RANGOS.includes(Number(m[2]))) return null;
    return { metrica: m[1], dias: Number(m[2]) };
}

async function pintar(interaction, metrica, dias) {
    await interaction.deferUpdate();
    await interaction.editReply(buildVista(interaction.guildId, metrica, dias));
}

/** Botones de 📊 Estadísticas. Devuelve false si no es suyo. */
async function handleEstadisticasButton(interaction) {
    const id = interaction.customId;
    if (id === `${PREFIJO}home`) {
        adminAudit.logAdminAction({
            guildId: interaction.guildId,
            actorId: interaction.user.id,
            action: "consulta.estadisticas",
            details: {},
        });
        await pintar(interaction, "mensajes", 7);
        return true;
    }
    const ver = id.startsWith(`${PREFIJO}ver_`) ? leer(id.slice(`${PREFIJO}ver_`.length)) : null;
    if (ver) {
        await pintar(interaction, ver.metrica, ver.dias);
        return true;
    }
    const act = id.startsWith(`${PREFIJO}actualizar_`) ? leer(id.slice(`${PREFIJO}actualizar_`.length)) : null;
    if (!act) return false;
    const clave = `${interaction.guildId}:${act.metrica}:${act.dias}`;
    if (cache.has(clave) && opciones.ahora() - cache.get(clave).ts >= CACHE_MS) cache.delete(clave);
    await pintar(interaction, act.metrica, act.dias);
    return true;
}

/** El desplegable de métrica (conserva el rango). */
async function handleEstadisticasSelect(interaction) {
    const m = new RegExp(`^${PREFIJO}metrica_(\\d+)$`).exec(interaction.customId);
    if (!m) return false;
    const v = leer(`${interaction.values[0]}_${m[1]}`);
    if (!v) return false;
    await pintar(interaction, v.metrica, v.dias);
    return true;
}

module.exports = {
    PREFIJO,
    CACHE_MS,
    opciones,
    buildVista,
    handleEstadisticasButton,
    handleEstadisticasSelect,
    _vaciarCache: () => cache.clear(),
};
