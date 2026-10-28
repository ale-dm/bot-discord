// 🔨 /subastas (#519): la casa de subastas de objetos entre jugadores. Las abiertas, en las que pujas y las tuyas; pujar
// (se retiene del efectivo y se devuelve si te superan), subastar un objeto del inventario y cancelar mientras nadie haya
// pujado. Reglas en systems/subastas.js, pantallas en paneles/subastas.js y avisos en discord/envios/subastas.js.
const { SlashCommandBuilder } = require("discord.js");
const { paginaDeId } = require("../../paneles/menuPaginado");
const subastas = require("../../systems/subastas");
const { inventarioDe } = require("../../systems/objetos");
const envios = require("../../discord/envios/subastas");
const { pantallaSubastas, pantallaSubasta, pantallaElegirObjeto, modalPuja, modalCrear } = require("../../paneles/subastas");
const { fmtNumero } = require("../../core/formato");
const { efimero } = require("../../discord/respuestas");

const numero = (texto) => Number(String(texto ?? "").replace(/[.\s]/g, ""));

async function pujar(interaction, subastaId) {
    const r = subastas.pujar(subastaId, interaction.user.id, numero(interaction.fields.getTextInputValue("cantidad")));
    if (!r.ok) return interaction.update(pantallaSubasta(interaction.user.id, subastaId, `❌ ${r.motivo}`));
    const aviso = `💰 ¡Pujado! Vas ganando con **${fmtNumero(subastas.pujaMayor(subastaId).cantidad)}** 🪙.${r.prorrogada ? " ⏰ El cierre se ha alargado 2 minutos." : ""}`;
    await interaction.update(pantallaSubasta(interaction.user.id, subastaId, aviso));
    await envios.avisarSuperado(interaction.client, r.subasta, r.superado);
}

function crear(interaction, objetoId) {
    const campo = (id) => interaction.fields.getTextInputValue(id);
    const r = subastas.crear({
        guildId: interaction.guildId,
        userId: interaction.user.id,
        objetoId,
        precio: numero(campo("precio")),
        incremento: numero(campo("incremento")),
        horas: numero(campo("horas")),
    });
    if (!r.ok) return interaction.update(pantallaSubastas(interaction.user.id, "mias", 0, `❌ ${r.motivo}`));
    return interaction.update(
        pantallaSubasta(interaction.user.id, r.subasta.id, `🔨 ¡Subasta abierta! **${r.subasta.nombre}** ya está en la casa de subastas.`),
    );
}

module.exports = {
    componentHandlers: [
        { types: ["button"], prefixes: ["subastas_"], method: "handleButton", acl: "subastas" },
        { types: ["stringSelect"], ids: ["subastas_sel_objeto"], method: "handleSelect", acl: "subastas" },
        { types: ["modal"], prefixes: ["subastas_modal_"], method: "handleModal", acl: "subastas" },
    ],
    data: new SlashCommandBuilder().setName("subastas").setDescription("🔨 Casa de subastas de objetos entre jugadores"),

    async run(client, interaction) {
        if (!interaction.guildId) return interaction.reply(efimero("Esto solo funciona en un servidor."));
        return interaction.reply(efimero(pantallaSubastas(interaction.user.id)));
    },

    async handleButton(client, interaction) {
        const id = interaction.customId;
        const userId = interaction.user.id;
        const vista = /^subastas_vista_(activas|pujas|mias)$/.exec(id);
        if (vista) return interaction.update(pantallaSubastas(userId, vista[1]));
        const pag = /^subastas_pag_(activas|pujas|mias)_(\d+)$/.exec(id);
        if (pag) return interaction.update(pantallaSubastas(userId, pag[1], Number(pag[2])));
        if (id === "subastas_nueva") return interaction.update(pantallaElegirObjeto(subastas.subastables(inventarioDe(userId))));
        const pagObjetos = paginaDeId("subastas_objetos_", id);
        if (pagObjetos !== null) return interaction.update(pantallaElegirObjeto(subastas.subastables(inventarioDe(userId)), pagObjetos));
        const [, accion, num] = /^subastas_(ver|pujar|cancelar)_(\d+)$/.exec(id) || [];
        if (accion === "ver") return interaction.update(pantallaSubasta(userId, Number(num)));
        if (accion === "pujar") {
            const s = subastas.obtener(Number(num));
            if (!s || s.estado !== "abierta")
                return interaction.update(pantallaSubasta(userId, Number(num), "❌ Esta subasta ya está cerrada."));
            return interaction.showModal(modalPuja(s));
        }
        if (accion === "cancelar") {
            const r = subastas.cancelar(Number(num), userId);
            return interaction.update(
                pantallaSubastas(
                    userId,
                    "mias",
                    0,
                    r.ok ? `✖️ Subasta cancelada: **${r.subasta.nombre}** vuelve a tu inventario.` : `❌ ${r.motivo}`,
                ),
            );
        }
    },

    async handleSelect(client, interaction) {
        const objetoId = Number(interaction.values[0]);
        const objeto = subastas.subastables(inventarioDe(interaction.user.id)).find((o) => o.id === objetoId);
        if (!objeto) return interaction.update(pantallaSubastas(interaction.user.id, "mias", 0, "❌ Ya no tienes ese objeto."));
        return interaction.showModal(modalCrear(objeto));
    },

    async handleModal(client, interaction) {
        const puja = /^subastas_modal_puja_(\d+)$/.exec(interaction.customId);
        if (puja) return pujar(interaction, Number(puja[1]));
        const nueva = /^subastas_modal_crear_(\d+)$/.exec(interaction.customId);
        if (nueva) return crear(interaction, Number(nueva[1]));
    },
};
