// 🏅 Logros de la categoría «social» (solo datos). El catálogo (systems/logros/catalogo) los junta en su orden.

const SOCIAL = [
    {
        id: "primer_mensaje",
        name: "Hola Mundo",
        desc: "Envía tu primer mensaje válido",
        category: "social",
        event: "message_count",
        metric: "sum",
        target: 1,
        rewardCoins: 100,
    },
    {
        id: "charlatan_100",
        name: "Charlatán",
        desc: "Envía 100 mensajes válidos",
        category: "social",
        event: "message_count",
        metric: "sum",
        target: 100,
        rewardCoins: 400,
    },
    {
        id: "veterano_1000",
        name: "Veterano",
        desc: "Envía 1000 mensajes válidos",
        category: "social",
        event: "message_count",
        metric: "sum",
        target: 1000,
        rewardCoins: 1500,
    },
    {
        id: "cronista_2500",
        name: "Cronista",
        desc: "Envía 2500 mensajes válidos",
        category: "social",
        event: "message_count",
        metric: "sum",
        target: 2500,
        rewardCoins: 2500,
    },
    {
        id: "leyenda_chat_5000",
        name: "Leyenda del Chat",
        desc: "Envía 5000 mensajes válidos",
        category: "social",
        event: "message_count",
        metric: "sum",
        target: 5000,
        rewardCoins: 5000,
    },
];

module.exports = { SOCIAL };
