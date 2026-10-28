// 🎱 /bingo (#528): abre una sala de bingo en el canal (o enseña la que ya hay) y los botones de la sala: entrar pagando la
// entrada, empezar ya (quien la abrió) y ver tu cartón en privado. Reglas en systems/bingo.js, mensaje en paneles/bingo.js y
// canto en discord/envios/bingo.js.
const { SlashCommandBuilder } = require("discord.js");
const bingo = require("../../systems/bingo");
const envios = require("../../discord/envios/bingo");
const { mensajeSala, cartonTexto } = require("../../paneles/bingo");
const { efimero } = require("../../discord/respuestas");

async function repintar(interaction, p) {
    if (!p.messageId) return;
    try {
        const canal = await interaction.client.channels.fetch(p.channelId);
        await canal.messages.edit(p.messageId, mensajeSala(p));
    } catch {
        // si el mensaje ya no está, la sala sigue igual
    }
}

function verCarton(interaction, p) {
    const mio = bingo.jugadores(p.id).find((j) => j.userId === interaction.user.id);
    if (!mio) return interaction.reply(efimero("🎫 No estás en esta sala."));
    // Mientras se juega, las bolas que ya han salido se calculan con el tiempo (sale una cada 3 segundos desde que empezó).
    const salidas =
        p.estado === "terminada"
            ? p.bola_ganadora
            : p.estado === "jugando"
              ? Math.min(p.bola_ganadora, Math.floor((Date.now() - p.empezada) / 3000))
              : 0;
    const marcadas = new Set((p.bolas || []).slice(0, salidas));
    return interaction.reply(efimero(`🎫 Tu cartón de la sala #${p.id}\n${cartonTexto(mio.carton, marcadas)}`));
}

module.exports = {
    componentHandlers: [{ types: ["button"], prefixes: ["bingo_"], method: "handleButton", acl: "bingo" }],
    data: new SlashCommandBuilder().setName("bingo").setDescription("🎱 Abre una sala de bingo en este canal (de 2 a 6 jugadores)"),

    async run(client, interaction) {
        if (!interaction.guildId) return interaction.reply(efimero("Esto solo funciona en un servidor."));
        const actual = bingo.activa(interaction.guildId);
        if (actual)
            return interaction.reply(efimero({ ...mensajeSala(actual), content: `🎱 Ya hay una sala abierta en <#${actual.channelId}>.` }));
        const r = bingo.abrir({ guildId: interaction.guildId, channelId: interaction.channelId, userId: interaction.user.id });
        if (!r.ok) return interaction.reply(efimero(`❌ ${r.motivo}`));
        await interaction.reply(mensajeSala(r.partida));
        const m = await interaction.fetchReply();
        bingo.guardarMensaje(r.partida.id, m.id);
    },

    // bingo_{entrar|empezar|carton}_{id}
    async handleButton(client, interaction) {
        const [, accion, id] = interaction.customId.split("_");
        const p = bingo.obtener(Number(id));
        if (!p) return interaction.reply(efimero("Esa sala ya no existe."));
        if (accion === "carton") return verCarton(interaction, p);
        if (accion === "entrar") {
            const r = bingo.entrar(p.id, interaction.user.id);
            if (!r.ok) return interaction.reply(efimero(`❌ ${r.motivo}`));
            if (r.llena) {
                await interaction.reply(efimero("🎟️ ¡Dentro! La sala está llena: empieza el canto."));
                return envios.arrancar(client, p.id);
            }
            await interaction.reply(efimero("🎟️ ¡Dentro! Mira tu cartón con 🎫 Mi cartón."));
            return repintar(interaction, r.partida);
        }
        const r = await envios.arrancar(client, p.id, { porId: interaction.user.id });
        if (r.ok === false) return interaction.reply(efimero(`❌ ${r.motivo}`));
        return interaction.reply(efimero("▶️ ¡Empieza el canto!"));
    },
};
