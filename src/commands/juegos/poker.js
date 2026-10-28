// 🃏 /poker (#531): `abrir compra` abre una mesa de Texas hold'em en el canal (ciegas 50/100, de 2 a 6 jugadores) y
// `estadisticas` enseña tus manos jugadas y ganadas. Los botones de la mesa: sentarse, repartir, volver a jugar, levantarse
// y, en la mano, retirarse, pasar o igualar, subir, all-in y ver tus cartas en privado. Reglas en systems/poker/, mensaje en
// paneles/poker.js y la mano en juego en discord/envios/poker.js.
const { SlashCommandBuilder } = require("discord.js");
const mesas = require("../../systems/poker/mesas");
const mano = require("../../systems/poker/mano");
const juego = require("../../discord/envios/poker");
const { mensajeMesa, modalSentarse, modalSubir, cartas } = require("../../paneles/poker");
const { fmtNumero } = require("../../core/formato");
const { efimero } = require("../../discord/respuestas");

const numero = (texto) => Number(String(texto ?? "").replace(/[.\s]/g, ""));

async function abrir(interaction) {
    const r = mesas.abrir({
        guildId: interaction.guildId,
        channelId: interaction.channelId,
        userId: interaction.user.id,
        compra: interaction.options.getInteger("compra") ?? mesas.COMPRA_MIN * 2,
    });
    if (!r.ok) return interaction.reply(efimero(`❌ ${r.motivo}`));
    await interaction.reply(mensajeMesa(r.mesa));
    const m = await interaction.fetchReply();
    mesas.guardarMensaje(r.mesa.id, m.id);
}

function estadisticas(interaction) {
    const s = mesas.stats(interaction.user.id);
    const pct = s.manos ? Math.round((s.ganadas / s.manos) * 100) : 0;
    return interaction.reply(
        efimero(
            `🃏 **Tu póker**: ${s.manos} manos jugadas · ${s.ganadas} ganadas (${pct} %) · ${fmtNumero(s.fichas_ganadas)} fichas ganadas.`,
        ),
    );
}

/** Botones de entre manos: sentarse, repartir, volver y levantarse. */
async function entreManos(client, interaction, accion, id) {
    const userId = interaction.user.id;
    if (accion === "sentarse") return interaction.showModal(modalSentarse(id));
    if (accion === "volver") {
        const ok = mesas.volver(id, userId);
        await interaction.reply(efimero(ok ? "🔙 Vuelves a jugar desde la próxima mano." : "❌ No estás sentado en esta mesa."));
        return juego.repintar(client, id);
    }
    if (accion === "levantarse") {
        if (juego.enMano(id, userId)) return interaction.reply(efimero("✋ Estás jugando esta mano: levántate cuando acabe."));
        const r = mesas.levantarse(id, userId);
        if (!r.ok) return interaction.reply(efimero(`❌ ${r.motivo}`));
        await interaction.reply(efimero(`🚪 Te levantas con **${fmtNumero(r.fichas)}** fichas, ya en tu efectivo.`));
        if (r.quedan === 0) return juego.cerrarMesa(client, id, "mesa vacía");
        return juego.repintar(client, id);
    }
    const m = mesas.obtener(id);
    if (!mesas.asiento(id, userId)) return interaction.reply(efimero("❌ Siéntate primero."));
    if (m.manos === 0 && m.abierta_por !== userId) return interaction.reply(efimero("▶️ La primera mano la reparte quien abrió la mesa."));
    if (!(await juego.iniciarMano(client, id)))
        return interaction.reply(efimero(`❌ Hacen falta ${mesas.MIN_JUGADORES} jugadores con fichas (o ya hay una mano en juego).`));
    return interaction.reply(efimero("🃏 ¡Cartas!"));
}

module.exports = {
    componentHandlers: [
        { types: ["button"], prefixes: ["poker_"], method: "handleButton", acl: "poker" },
        { types: ["modal"], prefixes: ["poker_modal_"], method: "handleModal", acl: "poker" },
    ],
    data: new SlashCommandBuilder()
        .setName("poker")
        .setDescription("🃏 Póker Texas hold'em entre jugadores (ciegas 50/100)")
        .addSubcommand((s) =>
            s
                .setName("abrir")
                .setDescription("Abre una mesa en este canal y siéntate")
                .addIntegerOption((o) =>
                    o
                        .setName("compra")
                        .setDescription(`Fichas con las que te sientas (${mesas.COMPRA_MIN} a ${mesas.COMPRA_MAX})`)
                        .setMinValue(mesas.COMPRA_MIN)
                        .setMaxValue(mesas.COMPRA_MAX),
                ),
        )
        .addSubcommand((s) => s.setName("estadisticas").setDescription("Tus manos jugadas y ganadas")),

    async run(client, interaction) {
        if (!interaction.guildId) return interaction.reply(efimero("Esto solo funciona en un servidor."));
        if (interaction.options.getSubcommand() === "estadisticas") return estadisticas(interaction);
        return abrir(interaction);
    },

    // poker_{acción}_{mesa}
    async handleButton(client, interaction) {
        const [, accion, num] = interaction.customId.split("_");
        const id = Number(num);
        if (!mesas.obtener(id) || mesas.obtener(id).estado === "cerrada") return interaction.reply(efimero("Esta mesa ya está cerrada."));
        if (["sentarse", "empezar", "volver", "levantarse"].includes(accion)) return entreManos(client, interaction, accion, id);
        if (accion === "cartas") {
            const mias = juego.cartasDe(id, interaction.user.id);
            return interaction.reply(efimero(mias ? `🃏 Tus cartas: ${cartas(mias)}` : "🃏 No estás en esta mano."));
        }
        if (accion === "subir") {
            const m = juego.enJuego.get(id)?.mano;
            const a = m && mano.acciones(m);
            if (!a || a.userId !== interaction.user.id) return interaction.reply(efimero("⏳ No es tu turno."));
            return interaction.showModal(modalSubir(id, a));
        }
        // El botón de en medio es «Pasar» o «Igualar» según lo que haya en la mesa en este momento.
        let tipo = accion;
        if (accion === "igualar") {
            const m = juego.enJuego.get(id)?.mano;
            tipo = m && mano.acciones(m)?.pasar ? "pasar" : "igualar";
        }
        const r = await juego.actuar(client, id, interaction.user.id, { tipo });
        if (!r.ok) return interaction.reply(efimero(`❌ ${r.motivo}`));
        return interaction.deferUpdate();
    },

    async handleModal(client, interaction) {
        const [, , que, num] = interaction.customId.split("_");
        const id = Number(num);
        if (que === "sentarse") {
            const r = mesas.sentarse(id, interaction.user.id, numero(interaction.fields.getTextInputValue("compra")));
            if (!r.ok) return interaction.reply(efimero(`❌ ${r.motivo}`));
            await interaction.reply(efimero("🪑 ¡Sentado! Jugarás desde la próxima mano."));
            return juego.repintar(client, id);
        }
        const r = await juego.actuar(client, id, interaction.user.id, {
            tipo: "subir",
            total: numero(interaction.fields.getTextInputValue("total")),
        });
        if (!r.ok) return interaction.reply(efimero(`❌ ${r.motivo}`));
        return interaction.deferUpdate();
    },
};
