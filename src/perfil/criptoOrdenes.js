// Botones, menús y formularios criptoord_* de /cripto: las órdenes de TTCL (alertas, stop-loss, compra recurrente) y vender por monedas.
// No es un comando: el router registra sus rutas igual que las de dinero.js. Las reglas están en systems/cripto (ordenes, ventaPorMonedas).
const { MessageFlags } = require("discord.js");
const mercado = require("../systems/cripto/mercado");
const ordenes = require("../systems/cripto/ordenes");
const ventaPorMonedas = require("../systems/cripto/ventaPorMonedas");
const guildSettings = require("../systems/guildSettings");
const panel = require("../paneles/cripto/ordenes");
const operar = require("../paneles/cripto/operar");
const { createLogger } = require("../core/logger");

const log = createLogger("Cripto");

/** Un número del formulario («1.500», «1 500», «12,5»). NaN si no lo es. */
const numero = (texto) =>
    Number(
        String(texto)
            .trim()
            .replace(/\s/g, "")
            .replace(/\.(?=\d{3}(\D|$))/g, "")
            .replace(",", "."),
    );
const tras = (id, prefijo) => id.slice(prefijo.length);

// Los botones, en orden: el primero que encaja con el id se atiende.
const BOTONES = [
    [(id) => id === "criptoord_ordenes", (i) => i.update(panel.pantallaOrdenes(i.user.id))],
    [(id) => id === "criptoord_nueva_alerta", (i) => i.showModal(panel.modalAlerta())],
    [(id) => id === "criptoord_nueva_stoploss", (i) => i.showModal(panel.modalStopLoss())],
    [(id) => id === "criptoord_nueva_recurrente", (i) => i.showModal(panel.modalRecurrente())],
    [(id) => id === "criptoord_vender", (i) => i.showModal(panel.modalVentaMonedas())],
    [
        (id) => id.startsWith("criptoord_rec_ok_"),
        (i, id) => {
            const [monedas, horas] = tras(id, "criptoord_rec_ok_").split("_").map(Number);
            const r = ordenes.crearRecurrente(i.user.id, i.guildId, monedas, horas);
            return i.update(panel.pantallaOrdenes(i.user.id, r.mensaje));
        },
    ],
    [
        (id) => id.startsWith("criptoord_vender_ok_"),
        async (i, id) => {
            const neto = Number(tras(id, "criptoord_vender_ok_"));
            const cfg = guildSettings.getSettings(i.guildId).cripto;
            const tenencia = mercado.getUserCarteras(i.user.id).find((r) => r.cripto === mercado.TTCL.simbolo)?.cantidad || 0;
            const q = ventaPorMonedas.cotizarPorMonedas(tenencia, neto, Number(cfg.fee_sell_pct || 0));
            const r = q.ok
                ? await mercado.ejecutarVenta(i.guildId, i.user.id, mercado.TTCL.simbolo, 100, { ttcl: q.ttcl })
                : { ok: false, msg: q.motivo };
            return i.update(operar.pantallaVender(i.user.id, i.guildId, operar.avisoVenta(r)));
        },
    ],
];

async function crearDesdeModal(i, crear) {
    const r = crear();
    if (r.ok) log.info(`${i.user.tag} crea una orden de TTCL (${r.orden.tipo})`);
    return i.update(panel.pantallaOrdenes(i.user.id, r.mensaje));
}

const FORMULARIOS = {
    criptoord_modal_alerta: (i) =>
        crearDesdeModal(i, () => ordenes.crearAlerta(i.user.id, i.guildId, numero(i.fields.getTextInputValue("precio")))),
    criptoord_modal_stoploss: (i) =>
        crearDesdeModal(i, () => ordenes.crearStopLoss(i.user.id, i.guildId, numero(i.fields.getTextInputValue("precio")))),
    criptoord_modal_recurrente: (i) => {
        const monedas = numero(i.fields.getTextInputValue("monedas"));
        const horas = numero(i.fields.getTextInputValue("horas"));
        if (!Number.isInteger(monedas) || monedas < 1 || !Number.isInteger(horas) || horas < ordenes.PERIODO_MIN_HORAS) {
            return i.update(
                panel.pantallaOrdenes(i.user.id, `❌ Escribe monedas enteras y un periodo de al menos ${ordenes.PERIODO_MIN_HORAS} hora.`),
            );
        }
        return i.update(panel.pantallaConfirmarRecurrente(i.user.id, i.guildId, monedas, horas));
    },
    criptoord_modal_vender: (i) => {
        const neto = numero(i.fields.getTextInputValue("monedas"));
        if (!Number.isInteger(neto) || neto < 1) {
            return i.update(operar.pantallaVender(i.user.id, i.guildId, "❌ Escribe un número entero de monedas, p. ej. 2500."));
        }
        return i.update(panel.pantallaConfirmarVentaMonedas(i.user.id, i.guildId, neto));
    },
};

module.exports = {
    componentHandlers: [
        { types: ["button"], prefixes: ["criptoord_"], method: "handleButton", acl: "cripto" },
        { types: ["stringSelect"], prefixes: ["criptoord_"], method: "handleSelect", acl: "cripto" },
        { types: ["modal"], prefixes: ["criptoord_modal_"], method: "handleModal", acl: "cripto" },
    ],

    async handleButton(client, interaction) {
        const ownerId = interaction.message?.interaction?.user?.id || interaction.message?.interactionMetadata?.user?.id;
        if (ownerId && ownerId !== interaction.user.id) {
            return interaction.reply({ content: "⛔ Solo quien abrió el panel puede usar estos botones.", flags: MessageFlags.Ephemeral });
        }
        const ruta = BOTONES.find(([encaja]) => encaja(interaction.customId));
        if (ruta) return ruta[1](interaction, interaction.customId);
    },

    async handleSelect(client, interaction) {
        if (interaction.customId !== "criptoord_cancelar") return;
        const ok = ordenes.cancelar(interaction.user.id, Number(interaction.values[0]));
        return interaction.update(
            panel.pantallaOrdenes(interaction.user.id, ok ? "🗑️ Orden cancelada." : "Esa orden ya no estaba activa."),
        );
    },

    async handleModal(client, interaction) {
        const f = FORMULARIOS[interaction.customId];
        if (f) return f(interaction);
    },
};
