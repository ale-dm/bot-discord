// 🏅 Logros de la categoría «tienda» (solo datos). El catálogo (systems/logros/catalogo) los junta en su orden.

const TIENDA = [
    {
        id: "tienda_primera",
        name: "Cliente",
        desc: "Compra tu primer objeto",
        category: "tienda",
        event: "tienda_buy_count",
        metric: "sum",
        target: 1,
        rewardCoins: 120,
    },
    {
        id: "tienda_20",
        name: "Comprador Compulsivo",
        desc: "Realiza 20 compras",
        category: "tienda",
        event: "tienda_buy_count",
        metric: "sum",
        target: 20,
        rewardCoins: 1100,
    },
    {
        id: "tienda_50",
        name: "Coleccionista",
        desc: "Realiza 50 compras",
        category: "tienda",
        event: "tienda_buy_count",
        metric: "sum",
        target: 50,
        rewardCoins: 3200,
    },
    {
        id: "tienda_5000",
        name: "Mecenas",
        desc: "Gasta 5.000 en tienda",
        category: "tienda",
        event: "tienda_spent",
        metric: "sum",
        target: 5000,
        rewardCoins: 1300,
    },
    {
        id: "tienda_20000",
        name: "Patrocinador",
        desc: "Gasta 20.000 en tienda",
        category: "tienda",
        event: "tienda_spent",
        metric: "sum",
        target: 20000,
        rewardCoins: 6000,
    },
];

module.exports = { TIENDA };
