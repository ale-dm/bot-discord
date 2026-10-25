// ⚙️ Config Global → ⏳ Roles temporales (#543): la lista de los activos (persona, rol, quién lo dio y cuándo vence), dar uno
// nuevo (persona, rol, días y si se avisa por DM), y renovar o quitar antes de tiempo uno de la lista, con confirmación. Las
// reglas están en systems/rolesTemporales.js y lo que toca Discord, en discord/envios/rolesTemporales.js.
const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder, MessageFlags } = require("discord.js");
const rolesTemporales = require("../systems/rolesTemporales");
const envios = require("../discord/envios/rolesTemporales");
const { modalConCampos, simpleModal, SI_NO, usuarioElegido, rolElegido } = require("./common");

const PREFIJO = "paneladmin_rtemp_";
const COLOR = 0x9b59b6;
const MAX_LISTA = 20;
const MAX_OPCIONES = 25;

const cuando = (ms) => `<t:${Math.floor(ms / 1000)}:R>`;
const corto = (t, n) => (String(t).length > n ? `${String(t).slice(0, n - 1)}…` : String(t));
const nombreMiembro = (guild, id) => guild?.members?.cache?.get(id)?.displayName || `ID ${id}`;
const nombreRol = (guild, id) => guild?.roles?.cache?.get(id)?.name || `rol ${id}`;

function navegacion() {
    return new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`${PREFIJO}home`).setLabel("⏳ Roles temporales").setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId("paneladmin_cfg_home").setLabel("⚙️ Config Global").setStyle(ButtonStyle.Secondary),
    );
}

/** La pantalla: los activos y los botones para dar uno o elegir uno de la lista. */
function buildHome(guild, aviso = "") {
    const activos = rolesTemporales.activos(guild.id);
    const lineas = activos
        .slice(0, MAX_LISTA)
        .map((r) => `**#${r.id}** · <@${r.userId}> · <@&${r.roleId}> · lo dio <@${r.asignadoPor}> · vence ${cuando(r.vence)}`);
    if (activos.length > MAX_LISTA) lineas.push(`…y ${activos.length - MAX_LISTA} más.`);
    const embed = new EmbedBuilder()
        .setTitle("⏳ Roles temporales")
        .setColor(COLOR)
        .setDescription(
            (aviso ? `${aviso}\n\n` : "") +
                `Da un rol con caducidad (de 1 a ${rolesTemporales.DIAS_MAX} días; ${rolesTemporales.DIAS_DEFECTO} por defecto) y el bot ` +
                "lo quita solo al vencer, también si estaba apagado.\n\n" +
                (lineas.length ? lineas.join("\n") : "No hay ningún rol temporal activo."),
        );
    const filas = [
        new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId(`${PREFIJO}dar`).setLabel("➕ Dar rol temporal").setStyle(ButtonStyle.Success),
            new ButtonBuilder().setCustomId("paneladmin_cfg_home").setLabel("⚙️ Config Global").setStyle(ButtonStyle.Secondary),
        ),
    ];
    if (activos.length) {
        filas.unshift(
            new ActionRowBuilder().addComponents(
                new StringSelectMenuBuilder()
                    .setCustomId(`${PREFIJO}sel`)
                    .setPlaceholder("Elige uno para renovarlo o quitarlo")
                    .addOptions(
                        activos.slice(0, MAX_OPCIONES).map((r) => ({
                            label: corto(`#${r.id} · ${nombreMiembro(guild, r.userId)} · ${nombreRol(guild, r.roleId)}`, 100),
                            description: corto(`Vence el ${new Date(r.vence).toLocaleString("es", { timeZone: "Europe/Madrid" })}`, 100),
                            value: String(r.id),
                        })),
                    ),
            ),
        );
    }
    return { content: "", embeds: [embed], components: filas, allowedMentions: { parse: [] } };
}

/** Una asignación con sus botones de renovar y quitar. */
function buildDetalle(r) {
    const embed = new EmbedBuilder()
        .setTitle(`⏳ Rol temporal #${r.id}`)
        .setColor(COLOR)
        .setDescription(
            `<@${r.userId}> tiene <@&${r.roleId}>.\nLo dio <@${r.asignadoPor}> ${cuando(r.inicio)}.\n` +
                `Vence ${cuando(r.vence)}. Aviso por DM: **${r.avisar ? "sí" : "no"}**.`,
        );
    const fila = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`${PREFIJO}renovar_${r.id}`).setLabel("🔁 Renovar").setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId(`${PREFIJO}quitar_${r.id}`).setLabel("➖ Quitar ya").setStyle(ButtonStyle.Danger),
    );
    return { content: "", embeds: [embed], components: [fila, navegacion()], allowedMentions: { parse: [] } };
}

function buildConfirmarQuitar(r) {
    const fila = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`${PREFIJO}quitarsi_${r.id}`).setLabel("✅ Sí, quitarlo").setStyle(ButtonStyle.Danger),
        new ButtonBuilder().setCustomId(`${PREFIJO}home`).setLabel("✖️ Cancelar").setStyle(ButtonStyle.Secondary),
    );
    return {
        content: `¿Quitar ya <@&${r.roleId}> a <@${r.userId}>? No se puede deshacer (habría que darlo otra vez).`,
        embeds: [],
        components: [fila],
        allowedMentions: { parse: [] },
    };
}

function modalDar() {
    return modalConCampos(`${PREFIJO}dar_modal`, "Dar rol temporal", [
        { id: "usuario", label: "Persona", tipo: "usuario" },
        { id: "rol", label: "Rol", tipo: "rol" },
        { id: "dias", label: `Días (1 a ${rolesTemporales.DIAS_MAX})`, value: String(rolesTemporales.DIAS_DEFECTO), maxLength: 3 },
        { id: "avisar", label: "¿Avisar por DM al darlo y al quitarlo?", tipo: "radio", opciones: SI_NO, valor: "si" },
    ]);
}

const modalRenovar = (id) =>
    simpleModal(`${PREFIJO}renovar_modal_${id}`, "Renovar rol temporal", [
        { id: "dias", label: `Días más (1 a ${rolesTemporales.DIAS_MAX})`, value: String(rolesTemporales.DIAS_DEFECTO), maxLength: 3 },
    ]);

/** Responde en el mismo mensaje si llega de él; si no, en privado. */
const pintar = (interaction, payload) =>
    interaction.isFromMessage?.() === false
        ? interaction.reply({ ...payload, flags: MessageFlags.Ephemeral })
        : interaction.update(payload);

/** Una asignación activa de este servidor, o null. */
function deEsteServidor(interaction, id) {
    const r = rolesTemporales.get(id);
    return r && r.guildId === interaction.guildId && r.estado === "activo" ? r : null;
}

async function guardarDar(interaction) {
    const f = interaction.fields;
    const userId = usuarioElegido(f, "usuario");
    const roleId = rolElegido(f, "rol");
    const dias = rolesTemporales.diasValidos(f.getTextInputValue("dias"));
    if (!userId || !roleId) return pintar(interaction, buildHome(interaction.guild, "❌ Elige la persona y el rol."));
    if (!dias) return pintar(interaction, buildHome(interaction.guild, `❌ Los días van de 1 a ${rolesTemporales.DIAS_MAX}.`));
    const r = await envios.dar(
        interaction.guild,
        { userId, roleId, dias, porId: interaction.user.id, avisar: f.getRadioGroup("avisar") !== "no" },
        { client: interaction.client },
    );
    const aviso = r.ok ? `✅ <@&${roleId}> para <@${userId}> durante ${dias} días (vence ${cuando(r.vence)}).` : `❌ ${r.motivo}`;
    return pintar(interaction, buildHome(interaction.guild, aviso));
}

async function guardarRenovar(interaction, id) {
    const dias = rolesTemporales.diasValidos(interaction.fields.getTextInputValue("dias"));
    if (!dias) return pintar(interaction, buildHome(interaction.guild, `❌ Los días van de 1 a ${rolesTemporales.DIAS_MAX}.`));
    const r = envios.renovar(interaction.guildId, id, dias, interaction.user.id);
    return pintar(interaction, buildHome(interaction.guild, r.ok ? `🔁 Renovado #${id}: vence ${cuando(r.vence)}.` : `❌ ${r.motivo}`));
}

/** Botones de ⏳ Roles temporales. Devuelve false si no es suyo. */
async function handleRolesTempButton(interaction) {
    const id = interaction.customId;
    if (!id.startsWith(PREFIJO)) return false;
    const accion = id.slice(PREFIJO.length);
    if (accion === "home") await interaction.update(buildHome(interaction.guild));
    else if (accion === "dar") await interaction.showModal(modalDar());
    else if (/^(renovar|quitar|quitarsi)_\d+$/.test(accion)) {
        const [tipo, num] = accion.split("_");
        const r = deEsteServidor(interaction, num);
        if (!r) await interaction.update(buildHome(interaction.guild, "Ese rol temporal ya no está activo."));
        else if (tipo === "renovar") await interaction.showModal(modalRenovar(r.id));
        else if (tipo === "quitar") await interaction.update(buildConfirmarQuitar(r));
        else {
            const res = await envios.quitar(interaction.guild, r.id, interaction.user.id, { client: interaction.client });
            const aviso = res.ok ? `➖ Quitado <@&${r.roleId}> a <@${r.userId}>.` : `❌ ${res.motivo}`;
            await interaction.update(buildHome(interaction.guild, aviso));
        }
    } else return false;
    return true;
}

/** Formularios de dar y renovar. */
async function handleRolesTempModal(interaction) {
    const id = interaction.customId;
    if (id === `${PREFIJO}dar_modal`) {
        await guardarDar(interaction);
        return true;
    }
    const m = new RegExp(`^${PREFIJO}renovar_modal_(\\d+)$`).exec(id);
    if (!m) return false;
    await guardarRenovar(interaction, Number(m[1]));
    return true;
}

/** El desplegable de la lista. */
async function handleRolesTempSelect(interaction) {
    if (interaction.customId !== `${PREFIJO}sel`) return false;
    const r = deEsteServidor(interaction, interaction.values[0]);
    await interaction.update(r ? buildDetalle(r) : buildHome(interaction.guild, "Ese rol temporal ya no está activo."));
    return true;
}

module.exports = { PREFIJO, buildHome, handleRolesTempButton, handleRolesTempModal, handleRolesTempSelect };
