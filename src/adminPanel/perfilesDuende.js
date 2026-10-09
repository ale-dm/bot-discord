// Panel admin → Config Global → Duende → Perfiles: lo que sabe el Duende de cada persona.
// Se elige a alguien, se ve su ficha completa (Discord ID, username, nombre, apodos, descripción,
// notas y lo que recibe el modelo) y desde ahí se edita todo en un formulario. Ver
// systems/duende/perfiles.js.
const {
    EmbedBuilder,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    UserSelectMenuBuilder,
    StringSelectMenuBuilder,
    MessageFlags,
} = require("discord.js");
const perfiles = require("../systems/duende/perfiles");
const { buildPersonProfileText } = require("../systems/duende/personas");
const apodos = require("../systems/apodos");
const adminAudit = require("../systems/adminAudit");
const { simpleModal } = require("./common");

const P = "paneladmin_perfiles_";
const cortar = (t, n) => (t.length > n ? t.slice(0, n - 1) + "…" : t);

// ─── Lista ───────────────────────────────────────────────────────────────────

function buildPerfilesHome() {
    const lista = perfiles.listarPerfiles();
    let lines = lista.length
        ? lista
              .map((p) => {
                  const quien = p.discordId ? `<@${p.discordId}>` : `\`${p.username}\` *(sin vincular)*`;
                  const desc = p.description ? `${p.description.length} car.` : "sin descripción";
                  return `• ${quien} — **${p.name}** · ${desc} · ${p.notas.length} notas`;
              })
              .join("\n")
        : "No hay perfiles todavía.";
    if (lines.length > 3500) lines = lines.slice(0, 3500) + "\n…";

    const embed = new EmbedBuilder()
        .setTitle("🧠 Perfiles del Duende")
        .setDescription(
            "Lo que el Duende sabe de cada persona y usa para decidir cómo tratarla cuando habla con ella o se habla de ella.\n" +
                "Pulsa **Ver / editar** para ver todo lo que hay de alguien y cambiarlo.\n" +
                "*Sin vincular*: perfil antiguo guardado por username; se vincula solo en cuanto esa persona habla con el Duende " +
                "(o poniéndole el Discord ID al editarlo).\n\n" +
                lines,
        )
        .setColor(0x6c5ce7)
        .setTimestamp();

    const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`${P}elegir`).setLabel("🔎 Ver / editar").setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId(`${P}home`).setLabel("🔄 Refrescar").setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId("paneladmin_cfg_duende").setLabel("◀ Duende").setStyle(ButtonStyle.Secondary),
    );
    return { embeds: [embed], components: [row] };
}

function buildSelector() {
    const lista = perfiles.listarPerfiles();
    const rows = [];
    if (lista.length) {
        rows.push(
            new ActionRowBuilder().addComponents(
                new StringSelectMenuBuilder()
                    .setCustomId(`${P}pick`)
                    .setPlaceholder("Perfiles que ya existen")
                    .addOptions(
                        lista.slice(0, 25).map((p) => ({
                            label: cortar(p.name, 100),
                            description: cortar(
                                `${p.username || "sin username"}${p.discordId ? "" : " · sin vincular"} · ${p.notas.length} notas`,
                                100,
                            ),
                            value: String(p.id),
                        })),
                    ),
            ),
        );
    }
    rows.push(
        new ActionRowBuilder().addComponents(
            new UserSelectMenuBuilder()
                .setCustomId(`${P}user`)
                .setPlaceholder("…o cualquier persona del servidor (crea su perfil)")
                .setMaxValues(1),
        ),
    );
    return {
        content: `Elige de quién ver el perfil.${lista.length > 25 ? " (En la primera lista solo caben 25: usa la segunda para el resto.)" : ""}`,
        embeds: [],
        components: rows,
    };
}

// ─── Ficha ───────────────────────────────────────────────────────────────────

function buildFicha(p, guildId, aviso = null) {
    const apodosDe = p.discordId ? apodos.porPersona(guildId).find((a) => a.discordId === p.discordId) : null;
    const textoModelo = buildPersonProfileText(p);
    const recortado = textoModelo.length > perfiles.MAX_PERFIL_PROMPT;

    // Un embed admite 6.000 caracteres en total: descripción y notas se recortan al mostrarlas
    // (se editan completas en el formulario).
    const desc = p.description ? cortar(p.description, 3000) : "*(sin descripción)*";
    let notas = p.notas.length ? p.notas.map((n, i) => `${i + 1}. ${n}`).join("\n") : "*(sin notas)*";
    notas = cortar(notas, 1024);

    const embed = new EmbedBuilder()
        .setTitle(`🧠 Perfil de ${p.name}`)
        .setDescription(`**Descripción**\n${desc}`)
        .addFields(
            { name: "Discord", value: p.discordId ? `<@${p.discordId}> · \`${p.discordId}\`` : "⚠️ Sin vincular", inline: true },
            { name: "Username", value: p.username ? `\`${p.username}\`` : "—", inline: true },
            { name: "Nombre", value: p.name, inline: true },
            {
                name: "Apodos (se editan en 🏷️ Apodos)",
                value: apodosDe
                    ? cortar([apodosDe.nombre && `**${apodosDe.nombre}**`, ...apodosDe.apodos].filter(Boolean).join(", "), 1024)
                    : "—",
            },
            { name: `Notas (${p.notas.length}/${perfiles.MAX_NOTAS})`, value: notas },
            {
                name: "Lo que recibe el Duende",
                value:
                    `${textoModelo.length.toLocaleString("es")} de ${perfiles.MAX_PERFIL_PROMPT.toLocaleString("es")} caracteres` +
                    (recortado
                        ? ` ⚠️ **se corta**: lo que pase de ahí no lo ve (las notas van al final, son lo primero que se pierde).`
                        : "."),
            },
        )
        .setColor(recortado ? 0xe67e22 : 0x6c5ce7)
        .setFooter({ text: `Perfil #${p.id}${p.actualizadoEn ? " · actualizado" : ""}` });
    if (p.actualizadoEn) embed.setTimestamp(p.actualizadoEn);

    const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`${P}editar_${p.id}`).setLabel("✏️ Editar todo").setStyle(ButtonStyle.Primary),
        new ButtonBuilder()
            .setCustomId(`${P}notas_${p.id}`)
            .setLabel("🧹 Borrar notas")
            .setStyle(ButtonStyle.Secondary)
            .setDisabled(!p.notas.length),
        new ButtonBuilder().setCustomId(`${P}borrar_${p.id}`).setLabel("🗑️ Borrar perfil").setStyle(ButtonStyle.Danger),
        new ButtonBuilder().setCustomId(`${P}elegir_otro`).setLabel("◀ Otra persona").setStyle(ButtonStyle.Secondary),
    );
    return { content: aviso || "", embeds: [embed], components: [row] };
}

function formularioEdicion(p) {
    return simpleModal(`${P}modal_${p.id}`, cortar(`Perfil de ${p.name}`, 45), [
        { id: "nombre", label: "Nombre (cómo le llama el Duende)", value: p.name.slice(0, 60), maxLength: 60 },
        { id: "username", label: "Username (se actualiza solo al hablar)", value: p.username || "", maxLength: 32, required: false },
        { id: "discordId", label: "Discord ID (vacío = sin vincular)", value: p.discordId || "", maxLength: 20, required: false },
        {
            id: "descripcion",
            label: "Descripción (cómo es, cómo tratarle)",
            value: (p.description || "").slice(0, 4000),
            paragraph: true,
            maxLength: 4000,
            required: false,
        },
        {
            id: "notas",
            label: `Notas: una por línea (máx. ${perfiles.MAX_NOTAS}, 200 car.)`,
            value: p.notas.join("\n").slice(0, 4000),
            paragraph: true,
            maxLength: 4000,
            required: false,
        },
    ]);
}

const noExiste = (interaction) => interaction.update({ content: "❌ Ese perfil ya no existe.", embeds: [], components: [] });

function auditar(interaction, action, details) {
    adminAudit.logAdminAction({ guildId: interaction.guildId, actorId: interaction.user.id, action, details });
}

// ─── Handlers ────────────────────────────────────────────────────────────────

async function handlePerfilesButton(interaction) {
    const id = interaction.customId;
    if (!id.startsWith(P)) return false;

    if (id === `${P}home`) {
        await interaction.update(buildPerfilesHome());
        return true;
    }
    if (id === `${P}elegir`) {
        await interaction.reply({ ...buildSelector(), flags: MessageFlags.Ephemeral });
        return true;
    }
    if (id === `${P}elegir_otro`) {
        await interaction.update(buildSelector());
        return true;
    }

    const m = /^paneladmin_perfiles_(editar|notas|borrar|borrarok)_(\d+)$/.exec(id);
    if (!m) return false;
    const [, accion, perfilId] = m;
    const p = perfiles.perfilPorId(perfilId);
    if (!p) {
        await noExiste(interaction);
        return true;
    }

    if (accion === "editar") {
        await interaction.showModal(formularioEdicion(p));
    } else if (accion === "notas") {
        perfiles.borrarNotasPorId(p.id);
        auditar(interaction, "duende.perfil.notas_clear", { perfilId: p.id, discordId: p.discordId, nombre: p.name, notas: p.notas });
        await interaction.update(buildFicha(perfiles.perfilPorId(p.id), interaction.guildId, `🧹 Borradas ${p.notas.length} notas.`));
    } else if (accion === "borrar") {
        const confirmar = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId(`${P}borrarok_${p.id}`).setLabel("Sí, borrar todo").setStyle(ButtonStyle.Danger),
            new ButtonBuilder().setCustomId(`${P}volver_${p.id}`).setLabel("Cancelar").setStyle(ButtonStyle.Secondary),
        );
        await interaction.update({
            content: `⚠️ ¿Borrar el perfil entero de **${p.name}** (descripción y ${p.notas.length} notas)? No se puede deshacer (queda copia en la auditoría).`,
            components: [confirmar],
        });
    } else if (accion === "borrarok") {
        perfiles.borrarPerfilPorId(p.id);
        auditar(interaction, "duende.perfil.delete", {
            perfilId: p.id,
            discordId: p.discordId,
            username: p.username,
            nombre: p.name,
            descripcion: p.description,
            notas: p.notas,
        });
        await interaction.update({ content: `🗑️ Borrado el perfil de **${p.name}**.`, embeds: [], components: buildSelector().components });
    }
    return true;
}

// "Cancelar" del borrado: vuelve a la ficha (va aparte porque "volver" no está en la regex de arriba).
async function handleVolver(interaction) {
    const m = /^paneladmin_perfiles_volver_(\d+)$/.exec(interaction.customId);
    if (!m) return false;
    const p = perfiles.perfilPorId(m[1]);
    if (!p) await noExiste(interaction);
    else await interaction.update(buildFicha(p, interaction.guildId));
    return true;
}

async function handlePerfilesStringSelect(interaction) {
    if (interaction.customId !== `${P}pick`) return false;
    const p = perfiles.perfilPorId(interaction.values[0]);
    if (!p) await noExiste(interaction);
    else await interaction.update(buildFicha(p, interaction.guildId));
    return true;
}

async function handlePerfilesUserSelect(interaction) {
    if (interaction.customId !== `${P}user`) return false;
    const user = interaction.users.first();
    const yaTenia = !!perfiles.perfilDe(user);
    const nombre = apodos.nombreDe(interaction.guildId, user.id) || user.globalName || user.username;
    const p = perfiles.asegurarPerfil(user, nombre);
    if (!yaTenia) auditar(interaction, "duende.perfil.create", { perfilId: p.id, discordId: user.id, nombre });
    await interaction.update(
        buildFicha(p, interaction.guildId, yaTenia ? null : `🆕 Perfil creado para <@${user.id}>. Pulsa **Editar todo** para rellenarlo.`),
    );
    return true;
}

async function handlePerfilesModal(interaction) {
    const m = /^paneladmin_perfiles_modal_(\d+)$/.exec(interaction.customId);
    if (!m) return false;
    const antes = perfiles.perfilPorId(m[1]);
    const campo = (k) => interaction.fields.getTextInputValue(k);
    const notas = campo("notas").split("\n");
    const r = perfiles.actualizarPerfil(m[1], {
        nombre: campo("nombre"),
        username: campo("username"),
        discordId: campo("discordId"),
        descripcion: campo("descripcion"),
        notas,
    });
    if (!r.ok) {
        await interaction.reply({ content: `❌ ${r.error} No se ha guardado nada.`, flags: MessageFlags.Ephemeral });
        return true;
    }
    const despues = perfiles.perfilPorId(m[1]);
    auditar(interaction, "duende.perfil.edit", {
        perfilId: despues.id,
        antes: antes && {
            discordId: antes.discordId,
            username: antes.username,
            nombre: antes.name,
            descripcion: antes.description,
            notas: antes.notas,
        },
        despues: {
            discordId: despues.discordId,
            username: despues.username,
            nombre: despues.name,
            chars: (despues.description || "").length,
            notas: despues.notas.length,
        },
    });

    const escritas = notas.map((n) => n.trim()).filter(Boolean);
    const avisos = ["✅ Guardado."];
    if (escritas.length > perfiles.MAX_NOTAS)
        avisos.push(`Solo se guardan ${perfiles.MAX_NOTAS} notas: se han descartado las ${escritas.length - perfiles.MAX_NOTAS} primeras.`);
    if (escritas.some((n) => n.length > 200)) avisos.push("Alguna nota pasaba de 200 caracteres y se ha recortado.");

    const ficha = buildFicha(despues, interaction.guildId, avisos.join(" "));
    if (interaction.isFromMessage()) await interaction.update(ficha);
    else await interaction.reply({ ...ficha, flags: MessageFlags.Ephemeral });
    return true;
}

module.exports = {
    handlePerfilesButton: async (i) => (await handleVolver(i)) || handlePerfilesButton(i),
    handlePerfilesStringSelect,
    handlePerfilesUserSelect,
    handlePerfilesModal,
};
