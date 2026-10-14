// Panel admin → 🩺 Sistema, lo de administración del propio bot: 💾 copias de seguridad (#417), 🕒 tareas programadas con su
// última ejecución y lanzarlas a mano (#420, #421) y ✉️ mensajes programados (#424).
const {
    EmbedBuilder,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    StringSelectMenuBuilder,
    MessageFlags,
    AttachmentBuilder,
} = require("discord.js");
const backups = require("../systems/backups");
const adminAudit = require("../systems/adminAudit");
const programados = require("../systems/mensajesProgramados");
const tareas = require("../core/tareasRegistro");
const { paginaDeLista, filaPaginas } = require("../paneles/menuPaginado");
const { createLogger } = require("../core/logger");

const log = createLogger("Sistema");

const boton = (id, label, estilo = ButtonStyle.Secondary) => new ButtonBuilder().setCustomId(id).setLabel(label).setStyle(estilo);
const filaVolver = (...extra) => new ActionRowBuilder().addComponents(...extra, boton("paneladmin_sis_home", "◀ Sistema"));
const auditar = (interaction, action, details) =>
    adminAudit.logAdminAction({ guildId: interaction.guildId, actorId: interaction.user.id, action, details });
const BOM = String.fromCharCode(0xfeff); // para que Excel abra bien los acentos
const kb = (bytes) => `${(bytes / 1024).toFixed(0)} KB`;

// ─── 💾 Copias de seguridad ──────────────────────────────────────────────────────────────────────

function buildCopias(aviso = "", confirmar = false) {
    const lista = backups.listarBackups().reverse();
    const hoy = backups.hayCopiaDeHoy();
    const filas = lista.length ? lista.map((b) => `• \`${b.fichero}\` · ${kb(b.bytes)}`).join("\n") : "Todavía no hay ninguna copia.";
    const embed = new EmbedBuilder()
        .setTitle("💾 Copias de seguridad")
        .setDescription(
            (aviso ? `${aviso}\n\n` : "") +
                `${filas}\n\nSe conservan las últimas **${backups.BACKUP_KEEP}**. La automática se hace cada día a las 04:30 y, ` +
                "si el bot estaba apagado, al arrancar. " +
                (hoy ? "✅ La copia de hoy **ya existe**." : "⚠️ La copia de hoy **todavía no existe**."),
        )
        .setColor(hoy ? 0x2ecc71 : 0xf1c40f)
        .setTimestamp();
    if (confirmar) embed.addFields({ name: "¿Sustituirla?", value: "Ya existe la copia de hoy: hacer otra la sustituye." });
    const accion = confirmar
        ? boton("paneladmin_sis_copia_confirmar", "✅ Sustituir la de hoy", ButtonStyle.Danger)
        : boton("paneladmin_sis_copia_hacer", "💾 Hacer copia ahora", ButtonStyle.Primary);
    return { content: "", embeds: [embed], components: [filaVolver(accion, boton("paneladmin_sis_copias", "🔄 Refrescar"))] };
}

async function hacerCopiaAhora(interaction) {
    await interaction.deferUpdate();
    const sustituye = backups.hayCopiaDeHoy();
    let aviso;
    try {
        const r = await backups.hacerBackup();
        auditar(interaction, "backup.manual", { fichero: r.fichero, bytes: r.bytes, ms: r.ms, sustituida: sustituye, integra: r.integra });
        aviso = r.integra
            ? `✅ Copia \`${r.fichero}\` hecha (${kb(r.bytes)}, ${r.ms} ms).`
            : `❌ La copia no pasó la comprobación de integridad y se descartó (${String(r.motivo).slice(0, 200)}). Las anteriores se conservan.`;
    } catch (e) {
        log.warn(`La copia manual de ${interaction.user.tag} falló: ${e.message}`);
        aviso = `❌ No se pudo hacer la copia: ${e.message.slice(0, 200)}`;
    }
    await interaction.editReply(buildCopias(aviso));
    return true;
}

// ─── 🕒 Tareas programadas ───────────────────────────────────────────────────────────────────────

const UNA_VEZ = /semanal|wrapped|cumplea|domingo|destacado|liga|pase|resumen/i; // solo envían lo que toca en su periodo
const CON_DM = /aviso|racha|préstamo|recordatorio|felicit|resumen|clasificación/i;

function lineaTarea(t) {
    const siguiente = t.siguiente ? ` · próxima <t:${Math.floor(t.siguiente / 1000)}:R>` : "";
    if (t.enCurso) return `⏳ **${t.nombre}** · en curso${siguiente}`;
    if (!t.ultima) return `⚪ **${t.nombre}** · sin ejecutar${siguiente}`;
    const { inicio, ms, ok, error } = t.ultima;
    const cuando = `<t:${Math.floor(inicio / 1000)}:R> · ${ms} ms`;
    return `${ok ? "✅" : "❌"} **${t.nombre}** · ${cuando}${ok ? "" : ` · ${String(error).slice(0, 60)}`}${siguiente}`;
}

function buildTareas(pagina = 0, aviso = "") {
    const p = paginaDeLista(tareas.listar(), pagina);
    const embed = new EmbedBuilder()
        .setTitle("🕒 Tareas programadas")
        .setDescription(
            (aviso ? `${aviso}\n\n` : "") +
                (p.items.length ? p.items.map(lineaTarea).join("\n") : "No hay tareas programadas.") +
                "\n\nElige una para lanzarla ahora, como si fuera su hora.",
        )
        .setColor(0x3498db)
        .setTimestamp();
    const filas = [];
    if (p.items.length) {
        filas.push(
            new ActionRowBuilder().addComponents(
                new StringSelectMenuBuilder()
                    .setCustomId("paneladmin_sis_tarea_sel")
                    .setPlaceholder("Lanzar una tarea ahora")
                    .addOptions(p.items.map((t) => ({ label: t.nombre.slice(0, 100), value: String(t.indice) }))),
            ),
        );
    }
    const paginas = filaPaginas("paneladmin_sis_tareas_p", p);
    if (paginas) filas.push(paginas);
    filas.push(
        filaVolver(boton("paneladmin_sis_tareas", "🔄 Refrescar", ButtonStyle.Primary), boton("paneladmin_sis_tareas_csv", "📄 Exportar")),
    );
    return { content: "", embeds: [embed], components: filas };
}

function buildConfirmarTarea(t) {
    const avisos = [
        UNA_VEZ.test(t.nombre) ? "Solo envía lo que toca en su periodo: si ya salió, no se repetirá." : null,
        CON_DM.test(t.nombre) ? "Puede mandar DMs a usuarios." : null,
    ].filter(Boolean);
    const embed = new EmbedBuilder()
        .setTitle("🕒 ¿Lanzar esta tarea ahora?")
        .setDescription(`**${t.nombre}**\n${avisos.join("\n")}`.trim())
        .setColor(0xe67e22);
    const fila = new ActionRowBuilder().addComponents(
        boton(`paneladmin_sis_tarea_ok_${t.indice}`, "▶️ Lanzar", ButtonStyle.Danger),
        boton("paneladmin_sis_tareas", "Cancelar"),
    );
    return { content: "", embeds: [embed], components: [fila] };
}

async function lanzarTarea(interaction, indice) {
    const t = tareas.listar().find((x) => x.indice === indice);
    if (!t) return interaction.update(buildTareas(0, "❌ Esa tarea ya no existe."));
    await interaction.deferUpdate();
    const r = await tareas.lanzar(indice);
    if (r.estado === "en_curso")
        return interaction.editReply(buildTareas(0, `⏳ **${t.nombre}** ya está en marcha: espera a que termine.`));
    auditar(interaction, "tarea.manual", { tarea: t.nombre });
    const despues = tareas.listar().find((x) => x.indice === indice);
    const fallo = despues?.ultima && !despues.ultima.ok;
    return interaction.editReply(
        buildTareas(0, fallo ? `❌ **${t.nombre}** falló: ${despues.ultima.error}` : `✅ **${t.nombre}** lanzada.`),
    );
}

/** 📄 El registro de tareas como CSV (`;`, con BOM para Excel). */
function csvDeTareas() {
    const esc = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
    const filas = tareas
        .listar()
        .map((t) =>
            [
                esc(t.nombre),
                esc(t.expr),
                esc(t.ultima ? new Date(t.ultima.inicio).toISOString() : "sin ejecutar"),
                esc(t.ultima ? (t.ultima.ok ? "OK" : "ERROR") : ""),
                t.ultima ? t.ultima.ms : "",
                esc(t.ultima?.error),
            ].join(";"),
        );
    return BOM + `${["tarea;horario;ultima_ejecucion;resultado;ms;error", ...filas].join("\n")}\n`;
}

// ─── ✉️ Mensajes programados ─────────────────────────────────────────────────────────────────────

function buildMensajes(guildId, aviso = "") {
    const lista = programados.listarPendientes(guildId);
    const embed = new EmbedBuilder()
        .setTitle("✉️ Mensajes programados")
        .setDescription(
            (aviso ? `${aviso}\n\n` : "") +
                (lista.length
                    ? lista
                          .map(
                              (m) =>
                                  `• **#${m.id}** → <@${m.destinoId}> · <t:${Math.floor(m.enviarEn / 1000)}:F> · ${m.caracteres} caracteres`,
                          )
                          .join("\n")
                    : "No hay ningún mensaje pendiente. Se programan con `/mensaje usuario:… cuando:DD/MM/AAAA HH:MM`.") +
                "\n\nSalen con un margen de 5 minutos; si el bot estaba apagado, salen al arrancar. El texto se borra al enviarse o cancelarse.",
        )
        .setColor(0x9b59b6)
        .setTimestamp();
    const filas = [];
    if (lista.length) {
        const opciones = paginaDeLista(lista).items.map((m) => ({
            label: `#${m.id} → ${m.destinoNombre || m.destinoId}`.slice(0, 100),
            value: String(m.id),
        }));
        filas.push(
            new ActionRowBuilder().addComponents(
                new StringSelectMenuBuilder()
                    .setCustomId("paneladmin_sis_msgs_cancelar")
                    .setPlaceholder("Cancelar uno")
                    .addOptions(opciones),
            ),
        );
    }
    filas.push(filaVolver(boton("paneladmin_sis_msgs", "🔄 Refrescar", ButtonStyle.Primary)));
    return { content: "", embeds: [embed], components: filas };
}

// ─── Enrutado ────────────────────────────────────────────────────────────────────────────────────

// Botones que solo cambian de vista: id → vista.
const VISTAS = [
    [(id) => id === "paneladmin_sis_copias", () => buildCopias()],
    [(id) => id === "paneladmin_sis_copia_hacer" && backups.hayCopiaDeHoy(), () => buildCopias("", true)],
    [(id) => id === "paneladmin_sis_tareas", () => buildTareas()],
    [(id) => /^paneladmin_sis_tareas_p\d+$/.test(id), (id) => buildTareas(Number(/(\d+)$/.exec(id)[1]))],
    [(id) => id === "paneladmin_sis_msgs", (id, i) => buildMensajes(i.guildId)],
];

async function handleExtrasButton(interaction) {
    const id = interaction.customId;
    const vista = VISTAS.find(([encaja]) => encaja(id));
    if (vista) {
        await interaction.update(vista[1](id, interaction));
        return true;
    }
    if (id === "paneladmin_sis_copia_hacer" || id === "paneladmin_sis_copia_confirmar") return hacerCopiaAhora(interaction);
    if (id === "paneladmin_sis_tareas_csv") {
        const fichero = new AttachmentBuilder(Buffer.from(csvDeTareas(), "utf8"), { name: "tareas.csv" });
        await interaction.reply({ content: "📄 El registro de tareas:", files: [fichero], flags: MessageFlags.Ephemeral });
        return true;
    }
    const lanzar = /^paneladmin_sis_tarea_ok_(\d+)$/.exec(id);
    if (lanzar) {
        await lanzarTarea(interaction, Number(lanzar[1]));
        return true;
    }
    return false;
}

async function handleExtrasSelect(interaction) {
    const id = interaction.customId;
    if (id === "paneladmin_sis_tarea_sel") {
        const t = tareas.listar().find((x) => x.indice === Number(interaction.values[0]));
        await interaction.update(t ? buildConfirmarTarea(t) : buildTareas(0, "❌ Esa tarea ya no existe."));
        return true;
    }
    if (id === "paneladmin_sis_msgs_cancelar") {
        const r = programados.cancelar(Number(interaction.values[0]), interaction.guildId);
        if (r) auditar(interaction, "mensaje.cancelado", { id: r.id, destinatario: r.destinoId, caracteres: r.caracteres });
        const aviso = r ? `🗑️ Mensaje #${r.id} cancelado.` : "Ese mensaje ya había salido o se canceló.";
        await interaction.update(buildMensajes(interaction.guildId, aviso));
        return true;
    }
    return false;
}

module.exports = { buildCopias, buildTareas, buildMensajes, csvDeTareas, handleExtrasButton, handleExtrasSelect };
