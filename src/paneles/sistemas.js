// 🎛️ Lo que se ve de las apuestas de sistema (#534): el formulario (tamaño e importe por combinación), la confirmación con el
// coste, el retorno máximo y cuántas patas pueden fallar, y el texto de un sistema con el detalle de cada subcombinación para
// 📋 Mis jugadas.
const {
    EmbedBuilder,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    ModalBuilder,
    LabelBuilder,
    StringSelectMenuBuilder,
} = require("discord.js");
const sistemas = require("../systems/apuestas/sistemas");
const combinadas = require("../systems/apuestas/combinadas");
const mercados = require("../systems/apuestas/mercados");
const { filasImporte } = require("./importes");
const { fmtNumero } = require("../core/formato");

const COLOR = 0x8e44ad;
const ICONO = { pendiente: "⏳", acierta: "✅", falla: "❌", anulada: "➖" };

/** El formulario: qué sistema (los que valen para `m` patas) y el importe de cada combinación. */
function formularioSistema(m) {
    return new ModalBuilder()
        .setCustomId("combinada_modal_sistema")
        .setTitle("🎛️ Apuesta de sistema")
        .addLabelComponents(
            new LabelBuilder().setLabel("Sistema").setStringSelectMenuComponent(
                new StringSelectMenuBuilder()
                    .setCustomId("tamano")
                    .setRequired(true)
                    .addOptions(
                        sistemas.tamanosPara(m).map((k) => ({
                            label: `${k} de ${m} (${sistemas.combinaciones(m, k).length} combinaciones)`,
                            value: String(k),
                        })),
                    ),
            ),
        )
        .addComponents(
            ...filasImporte({
                textoEtiqueta: `Importe por combinación (${combinadas.MIN_APUESTA}-${combinadas.MAX_APUESTA})`,
                placeholder: "Ejemplo: 100",
            }),
        );
}

/** ¿Seguro? Coste total, retorno si aciertan todas y el peor escenario, antes de cobrar nada. */
function confirmarSistema(p, cantidad, aviso = "") {
    const embed = new EmbedBuilder()
        .setTitle(`🎛️ Sistema ${p.k} de ${p.m}`)
        .setDescription(
            (aviso ? `${aviso}\n\n` : "") +
                `**${p.combinaciones}** combinaciones de **${fmtNumero(cantidad)}** 🪙 → coste total **${fmtNumero(p.coste)}** 🪙 (se cobra una vez).\n` +
                `🏆 Si aciertas los ${p.m}: **${fmtNumero(p.premioMaximo)}** 🪙.\n` +
                `🛟 Puedes fallar hasta **${p.puedenFallar}** ${p.puedenFallar === 1 ? "partido" : "partidos"} y seguir cobrando las combinaciones que no los llevan.`,
        )
        .setFooter({ text: `Coste máximo ${fmtNumero(sistemas.MAX_COSTE)}. Un partido anulado cuenta con cuota 1,00.` })
        .setColor(COLOR);
    const fila = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId(`combinada_sistemaok_${p.k}_${cantidad}`)
            .setLabel(`✅ Apostar ${fmtNumero(p.coste)}`)
            .setStyle(ButtonStyle.Success)
            .setDisabled(p.coste > sistemas.MAX_COSTE),
        new ButtonBuilder().setCustomId("combinada_ver").setLabel("◀ Volver al boleto").setStyle(ButtonStyle.Secondary),
    );
    return { content: "", embeds: [embed], components: [fila] };
}

/** Un sistema con sus patas y cada subcombinación (cuota y lo que cobró), para 📋 Mis jugadas. */
function textoSistema(s) {
    const estado =
        s.estado === "abierta"
            ? "⏳ En juego"
            : s.estado === "reembolsada"
              ? `↩️ Devuelto (+${fmtNumero(s.premio)})`
              : s.premio > 0
                ? `🏆 +${fmtNumero(s.premio)}`
                : "❌ Sin premio";
    const patas = s.patas
        .map(
            (p, i) =>
                `${i + 1}. ${ICONO[p.resultado]} ${p.home_team ?? "?"} vs ${p.away_team ?? "?"} · ${mercados.textoEleccion(p)} @${p.cuota}`,
        )
        .join("\n");
    const combos = s.combinaciones
        .map((c) => {
            const nombre = c.indices
                .split(",")
                .map((i) => Number(i) + 1)
                .join("+");
            return `${nombre} @${c.cuota}${c.premio === null ? "" : c.premio > 0 ? ` ✅ ${fmtNumero(c.premio)}` : " ❌"}`;
        })
        .join(" · ");
    return `**Sistema ${s.k} de ${s.m}** · ${s.combinaciones} × ${fmtNumero(s.cantidad)} = ${fmtNumero(s.coste)} 🪙 · ${estado}\n${patas}\n${combos}`;
}

module.exports = { formularioSistema, confirmarSistema, textoSistema };
