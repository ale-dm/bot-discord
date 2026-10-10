const { EmbedBuilder, MessageFlags } = require("discord.js");
const {
    registrarUsuario,
    descontarApuesta,
    procesarGanancia,
    procesarPerdida,
    obtenerSaldo,
    applyRtp,
} = require("../../systems/casinoTransactions");
const { createLogger } = require("../../core/logger");
const casino = require("../../paneles/casino");

const log = createLogger("Ruleta");

// ─── DATOS DE LA RULETA ───────────────────────────────────────────────────────

const ROJOS = new Set([1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36]);

function infoNum(n) {
    if (n === 0) return { emoji: "🟢", colorNombre: "verde", par: false, mitad: null, docena: null };
    return {
        emoji: ROJOS.has(n) ? "🔴" : "⚫",
        colorNombre: ROJOS.has(n) ? "rojo" : "negro",
        par: n % 2 === 0,
        mitad: n <= 18 ? "bajo" : "alto",
        docena: n <= 12 ? 1 : n <= 24 ? 2 : 3,
    };
}

// Retorna ganancia NETA (negativo = pierde apuesta)
function calcularPago(tipo, valor, n, apuesta) {
    const info = infoNum(n);
    let mult = -1;
    switch (tipo) {
        case "numero":
            mult = Number(valor) === n ? 35 : -1;
            break;
        case "color":
            mult = n !== 0 && valor === info.colorNombre ? 1 : -1;
            break;
        case "paridad":
            mult = n !== 0 && (valor === "par") === info.par ? 1 : -1;
            break;
        case "mitad":
            mult = n !== 0 && valor === info.mitad ? 1 : -1;
            break;
        case "docena":
            mult = n !== 0 && Number(valor) === info.docena ? 2 : -1;
            break;
    }
    return mult * apuesta;
}

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

// Orden real de la ruleta europea (sentido horario)
const WHEEL = [
    0, 32, 15, 19, 4, 21, 2, 25, 17, 34, 6, 27, 13, 36, 11, 30, 8, 23, 10, 5, 24, 16, 33, 1, 20, 14, 31, 9, 22, 18, 29, 7, 28, 12, 35, 3,
    26,
];

function colorEmbedNumero(n) {
    if (n === 0) return 0x2ecc71;
    return ROJOS.has(n) ? 0xe74c3c : 0x2c3e50;
}

function seg(centerIdx, sides = 3) {
    const parts = [];
    for (let i = -sides; i <= sides; i++) {
        const idx = (((centerIdx + i) % 37) + 37) % 37;
        const n = WHEEL[idx];
        const { emoji } = infoNum(n);
        const lbl = `${emoji}${String(n).padStart(2, "0")}`;
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

async function animarYGirar(interaction, userId, apuesta, tipo, valor) {
    // 1. Descontar apuesta — comprometida antes de animar
    const descuento = descontarApuesta(userId, apuesta, interaction.guildId);
    if (!descuento.exito) {
        await interaction.reply({ content: `❌ ${descuento.mensaje}`, flags: MessageFlags.Ephemeral });
        return;
    }

    // 2. Calcular resultado ya (pero no revelarlo)
    const numeroSalido = Math.floor(Math.random() * 37);
    let gananciaNet = calcularPago(tipo, valor, numeroSalido, apuesta);
    const apDescCorta = descApuesta(tipo, valor);
    const targetIdx = WHEEL.indexOf(numeroSalido);

    // 3. Defer — ack silent
    try {
        await interaction.deferUpdate();
    } catch (e) {
        log.warn(`deferUpdate falló (${interaction.customId}): ${e.message}`);
    }

    // 4. Animación nueva: trayectoria completa hasta el número final
    const startIdx = Math.floor(Math.random() * 37);
    const steps = buildSpinSteps(startIdx, targetIdx);

    for (let i = 0; i < steps.length; i++) {
        const { idx, delay } = steps[i];
        const currentNumber = WHEEL[idx];
        const info = infoNum(currentNumber);
        const text = i < 5 ? "Girando muy rápido..." : i < 9 ? "Bajando velocidad..." : "Casi para...";
        const sides = i < 5 ? 4 : i < 9 ? 3 : 2;

        const embed = new EmbedBuilder()
            .setTitle(`🎡 Ruleta en movimiento · ${info.emoji} ${String(currentNumber).padStart(2, "0")}`)
            .setDescription(`${seg(idx, sides)}\n\n*${text}*`)
            .setColor(colorEmbedNumero(currentNumber))
            .addFields({ name: "Tu apuesta", value: `**${apuesta.toLocaleString("es")}** 🪙 · ${apDescCorta}`, inline: false })
            .setFooter({ text: "Ruleta Europea • 0-36 • El Duende Casino" });
        try {
            await interaction.editReply({ embeds: [embed], components: [] });
        } catch (e) {
            log.warn(`No se pudo mostrar la ruleta a ${interaction.user.id}: ${e.message}`);
        }
        await DELAY(delay);
    }

    // 5. Frame de revelación
    const infoF = infoNum(numeroSalido);
    const revealEmbed = new EmbedBuilder()
        .setTitle(`🛑 ¡Paró en ${infoF.emoji} ${numeroSalido}!`)
        .setDescription(`${seg(targetIdx, 3)}\n\n**Resultado:** ${infoF.emoji} **${numeroSalido}**`)
        .setColor(colorEmbedNumero(numeroSalido))
        .addFields({ name: "Tu apuesta", value: `**${apuesta.toLocaleString("es")}** 🪙 · ${apDescCorta}`, inline: false })
        .setFooter({ text: "Ruleta Europea • El Duende Casino" });
    try {
        await interaction.editReply({ embeds: [revealEmbed], components: [] });
    } catch (e) {
        log.warn(`No se pudo mostrar la ruleta a ${interaction.user.id}: ${e.message}`);
    }
    await DELAY(900);

    // 6. Procesar resultado en BD
    const saldoAntes = obtenerSaldo(userId);
    let pagado;
    if (gananciaNet > 0) {
        gananciaNet = applyRtp(interaction.guildId, "ruleta", apuesta, apuesta + gananciaNet) - apuesta;
        pagado = procesarGanancia(userId, "ruleta", apuesta, apuesta + gananciaNet, `Ruleta: ganaste ${gananciaNet} (${tipo}:${valor})`, {
            n: numeroSalido,
            tipo,
            valor,
        });
    } else {
        pagado = procesarPerdida(userId, "ruleta", apuesta, `Ruleta: perdiste ${apuesta} (${tipo}:${valor})`, {
            n: numeroSalido,
            tipo,
            valor,
        });
    }
    if (!pagado) {
        log.error(`Ruleta: no se pudo registrar el resultado de ${userId} (apuesta ${apuesta})`);
        await interaction.editReply({ content: ERROR_PAGO_RULETA, embeds: [], components: [] });
        return;
    }
    const saldoDespues = obtenerSaldo(userId);

    // 7. Embed resultado final
    const gano = gananciaNet > 0;
    const numInfo = infoNum(numeroSalido);
    const numDesc =
        numeroSalido === 0
            ? `🟢 **0** — verde (banca gana)`
            : `${numInfo.emoji} **${numeroSalido}** — ${numInfo.colorNombre}, ${numInfo.par ? "par" : "impar"}, ${numInfo.mitad === "bajo" ? "bajo 1-18" : "alto 19-36"}, ${numInfo.docena}ª docena`;

    const resultEmbed = new EmbedBuilder()
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
