const { EmbedBuilder, MessageFlags } = require("discord.js");
const { registrarUsuario, descontarApuesta, obtenerSaldo } = require("../../systems/casinoTransactions");
const { WHEEL, esRojo, infoNum, tirarNumero, liquidarTirada } = require("../../systems/casino/ruleta");
const { createLogger } = require("../../core/logger");
const casino = require("../../paneles/casino");

const log = createLogger("Ruleta");

// ─── TEXTOS DE LA RULETA ──────────────────────────────────────────────────────

const emojiNum = (n) => (n === 0 ? "🟢" : esRojo(n) ? "🔴" : "⚫");

function descApuesta(tipo, valor) {
    if (tipo === "numero") return `número exacto **${valor}** (×36)`;
    if (tipo === "color") return `color **${valor}** (×2)`;
    if (tipo === "paridad") return `**${valor}** (×2)`;
    if (tipo === "mitad") return `**${valor === "bajo" ? "Bajo 1-18" : "Alto 19-36"}** (×2)`;
    if (tipo === "docena") return `**${valor}ª docena** (×3)`;
    return tipo;
}

// ─── ANIMACIÓN DE RULETA ──────────────────────────────────────────────────────

const DELAY = (ms) => new Promise((r) => setTimeout(r, ms));

function colorEmbedNumero(n) {
    if (n === 0) return 0x2ecc71;
    return esRojo(n) ? 0xe74c3c : 0x2c3e50;
}

function seg(centerIdx, sides = 3) {
    const parts = [];
    for (let i = -sides; i <= sides; i++) {
        const idx = (((centerIdx + i) % 37) + 37) % 37;
        const n = WHEEL[idx];
        const lbl = `${emojiNum(n)}${String(n).padStart(2, "0")}`;
        if (i === 0) parts.push(`【${lbl}】`);
        else parts.push(lbl);
    }
    return `◄ ${parts.join("  ")} ►`;
}

// Si la transacción falla, no se anuncia un resultado que el saldo no refleja.
const ERROR_PAGO_RULETA = "❌ No se pudo registrar el resultado de la ruleta. Avisa a un admin: tu saldo no refleja esta jugada.";

function buildSpinSteps(startIdx, targetIdx) {
    const loops = 2 + Math.floor(Math.random() * 2); // 2-3 vueltas
    const offset = (targetIdx - startIdx + 37) % 37;
    const totalSteps = loops * 37 + offset;

    const frames = 13;
    const progress = [];
    let prev = -1;
    for (let i = 1; i <= frames; i++) {
        const t = i / frames;
        const eased = 1 - Math.pow(1 - t, 2.25); // desaceleración
        let step = Math.floor(eased * totalSteps);
        if (step <= prev) step = prev + 1;
        progress.push(step);
        prev = step;
    }
    progress[progress.length - 1] = totalSteps;

    return progress.map((step, i) => {
        const idx = (startIdx + step) % 37;
        const delay = 95 + Math.floor((i / (frames - 1)) * 520);
        return { idx, delay };
    });
}

// Muestra un frame; si no se puede editar el mensaje, la ruleta sigue (el resultado se paga igual).
async function mostrarFrame(interaction, payload) {
    try {
        await interaction.editReply(payload);
    } catch (e) {
        log.warn(`No se pudo mostrar la ruleta a ${interaction.user.id}: ${e.message}`);
    }
}

const campoApuesta = (apuesta, apDescCorta) => ({
    name: "Tu apuesta",
    value: `**${apuesta.toLocaleString("es")}** 🪙 · ${apDescCorta}`,
    inline: false,
});

// Frames de la rueda: pasa por cada casilla de `steps` y el texto va bajando de ritmo.
async function girarRueda(interaction, apuesta, apDescCorta, steps) {
    for (let i = 0; i < steps.length; i++) {
        const { idx, delay } = steps[i];
        const currentNumber = WHEEL[idx];
        const text = i < 5 ? "Girando muy rápido..." : i < 9 ? "Bajando velocidad..." : "Casi para...";
        const sides = i < 5 ? 4 : i < 9 ? 3 : 2;

        const embed = new EmbedBuilder()
            .setTitle(`🎡 Ruleta en movimiento · ${emojiNum(currentNumber)} ${String(currentNumber).padStart(2, "0")}`)
            .setDescription(`${seg(idx, sides)}\n\n*${text}*`)
            .setColor(colorEmbedNumero(currentNumber))
            .addFields(campoApuesta(apuesta, apDescCorta))
            .setFooter({ text: "Ruleta Europea • 0-36 • El Duende Casino" });
        await mostrarFrame(interaction, { embeds: [embed], components: [] });
        await DELAY(delay);
    }
}

// El embed final: el número, la apuesta, los saldos antes y después, y el neto.
function embedResultado(numeroSalido, { apuesta, apDescCorta, gananciaNet, saldoAntes, saldoDespues }) {
    const gano = gananciaNet > 0;
    const numInfo = infoNum(numeroSalido);
    const numDesc =
        numeroSalido === 0
            ? `🟢 **0** — verde (banca gana)`
            : `${emojiNum(numeroSalido)} **${numeroSalido}** — ${numInfo.colorNombre}, ${numInfo.par ? "par" : "impar"}, ${numInfo.mitad === "bajo" ? "bajo 1-18" : "alto 19-36"}, ${numInfo.docena}ª docena`;

    return new EmbedBuilder()
        .setTitle(gano ? "🏆  ¡¡ G A N A S T E !!  🏆" : "💀  P E R D I S T E  💀")
        .setColor(gano ? 0x2ecc71 : 0xe74c3c)
        .setDescription(
            `${numDesc}\n\n` +
                `**Apostaste:** ${apuesta.toLocaleString("es")} 🪙 a ${apDescCorta}\n` +
                (gano
                    ? `> ✅  **+${gananciaNet.toLocaleString("es")} 🪙  ¡Enhorabuena!**`
                    : `> ❌  **-${apuesta.toLocaleString("es")} 🪙**`),
        )
        .addFields(
            { name: "💰 Antes", value: `${saldoAntes.toLocaleString("es")} 🪙`, inline: true },
            { name: "💎 Ahora", value: `${saldoDespues.toLocaleString("es")} 🪙`, inline: true },
            { name: "📊 Neto", value: `${gananciaNet >= 0 ? "+" : ""}${gananciaNet.toLocaleString("es")} 🪙`, inline: true },
        )
        .setFooter({ text: "Ruleta Europea • 0-36 — El Duende Casino" });
}

async function animarYGirar(interaction, userId, apuesta, tipo, valor) {
    // 1. Descontar apuesta — comprometida antes de animar
    const descuento = descontarApuesta(userId, apuesta, interaction.guildId);
    if (!descuento.exito) {
        await interaction.reply({ content: `❌ ${descuento.mensaje}`, flags: MessageFlags.Ephemeral });
        return;
    }

    // 2. Sale ya el número (pero no se revela)
    const numeroSalido = tirarNumero();
    const apDescCorta = descApuesta(tipo, valor);
    const targetIdx = WHEEL.indexOf(numeroSalido);

    // 3. Defer — ack silent
    try {
        await interaction.deferUpdate();
    } catch (e) {
        log.warn(`deferUpdate falló (${interaction.customId}): ${e.message}`);
    }

    // 4. Trayectoria completa hasta el número final
    const startIdx = Math.floor(Math.random() * 37);
    await girarRueda(interaction, apuesta, apDescCorta, buildSpinSteps(startIdx, targetIdx));

    // 5. Frame de revelación
    const revealEmbed = new EmbedBuilder()
        .setTitle(`🛑 ¡Paró en ${emojiNum(numeroSalido)} ${numeroSalido}!`)
        .setDescription(`${seg(targetIdx, 3)}\n\n**Resultado:** ${emojiNum(numeroSalido)} **${numeroSalido}**`)
        .setColor(colorEmbedNumero(numeroSalido))
        .addFields(campoApuesta(apuesta, apDescCorta))
        .setFooter({ text: "Ruleta Europea • El Duende Casino" });
    await mostrarFrame(interaction, { embeds: [revealEmbed], components: [] });
    await DELAY(900);

    // 6. Procesar resultado en BD
    const saldoAntes = obtenerSaldo(userId);
    const { exito, gananciaNet } = liquidarTirada(userId, interaction.guildId, { apuesta, tipo, valor, numero: numeroSalido });
    if (!exito) {
        log.error(`Ruleta: no se pudo registrar el resultado de ${userId} (apuesta ${apuesta})`);
        await interaction.editReply({ content: ERROR_PAGO_RULETA, embeds: [], components: [] });
        return;
    }
    const saldoDespues = obtenerSaldo(userId);

    // 7. Embed resultado final
    const resultEmbed = embedResultado(numeroSalido, { apuesta, apDescCorta, gananciaNet, saldoAntes, saldoDespues });
    const row = buildRow(apuesta, tipo, valor);
    try {
        await interaction.editReply({ embeds: [resultEmbed], components: [row] });
    } catch (e) {
        log.warn(`Resultado de ruleta ya liquidado pero no se pudo mostrar a ${interaction.user.id}: ${e.message}`);
    }
}

// La fila común de final de partida; Repetir lleva también el tipo de apuesta.
function buildRow(apuesta, tipo, valor) {
    return casino.filaFinJuego("ruleta", apuesta, { repetir: `casino_play_ruleta_${apuesta}_${tipo}_${valor}` });
}

// ─── MÓDULO ───────────────────────────────────────────────────────────────────

module.exports = {
    componentHandlers: [{ types: ["button"], prefixes: ["ruleta_"], method: "handleButton", acl: "juegos" }],

    async run(client, interaction) {
        const userId = interaction.user.id;
        registrarUsuario(userId, interaction.user.username, interaction.user.tag);

        const apuesta = interaction.options.getInteger("apuesta");
        const numeroExacto = interaction.options.getInteger("numero");
        const tipoStr = interaction.options.getString("tipo");

        let tipo, valor;
        if (numeroExacto !== null && numeroExacto !== undefined) {
            tipo = "numero";
            valor = String(numeroExacto);
        } else if (tipoStr) {
            [tipo, valor] = tipoStr.split(":");
        } else {
            await interaction.reply({
                content: "❌ Elige un **tipo** de apuesta o especifica un **número**.",
                flags: MessageFlags.Ephemeral,
            });
            return;
        }

        const saldo = obtenerSaldo(userId);
        if (saldo < apuesta) {
            await interaction.reply({
                content: `❌ Saldo insuficiente. Tienes **${saldo.toLocaleString("es")}** 🪙.`,
                flags: MessageFlags.Ephemeral,
            });
            return;
        }

        // Adaptador: animarYGirar está hecho para botones (deferUpdate + editReply). Desde el comando,
        // "diferir" es deferReply, y el aviso de cobro fallido (antes de diferir) es una respuesta normal.
        const wrapped = {
            ...interaction,
            deferUpdate: async () => interaction.deferReply(),
            update: async (p) => interaction.editReply(p),
            reply: async (p) => interaction.reply(p),
            editReply: async (p) => interaction.editReply(p),
        };
        await animarYGirar(wrapped, userId, apuesta, tipo, valor);
    },

    async handleButton(client, interaction) {
        const id = interaction.customId;
        const userId = interaction.user.id;

        // Owner check — solo quien originó el mensaje puede usar los botones
        const ownerId = interaction.message.interaction?.user?.id || interaction.message.interactionMetadata?.user?.id;
        if (ownerId && ownerId !== userId) {
            await interaction.reply({ content: "⛔ Solo quien usó el comando puede interactuar.", flags: MessageFlags.Ephemeral });
            return;
        }

        if (id.startsWith("ruleta_rept_")) {
            // ruleta_rept_{apuesta}_{tipo}_{valor}
            const sin = id.replace("ruleta_rept_", "");
            const i1 = sin.indexOf("_");
            const i2 = sin.indexOf("_", i1 + 1);
            const apuesta = parseInt(sin.slice(0, i1));
            const tipo = sin.slice(i1 + 1, i2);
            const valor = sin.slice(i2 + 1);

            const saldo = obtenerSaldo(userId);
            if (saldo < apuesta) {
                await interaction.reply({
                    content: `❌ No tienes **${apuesta.toLocaleString("es")}** 🪙 para repetir. Tienes **${saldo.toLocaleString("es")}**.`,
                    flags: MessageFlags.Ephemeral,
                });
                return;
            }

            await animarYGirar(interaction, userId, apuesta, tipo, valor);
        }
    },
};
