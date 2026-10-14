// 🏅 Logros de la categoría «racha» (solo datos): días seguidos ganando XP. Se completan solos cuando la racha llega a ese número
// (evento `streak_days`, que lanza systems/xp/progreso al sumar un día). El catálogo (systems/logros/catalogo) los junta en su orden.

const dias = (id, name, target, rewardCoins) => ({
    id,
    name,
    desc: `Mantén una racha de ${target} días seguidos`,
    category: "racha",
    event: "streak_days",
    metric: "max",
    target,
    rewardCoins,
});

const RACHA = [
    dias("racha_3", "Constante", 3, 300),
    dias("racha_7", "Una semana entera", 7, 1000),
    dias("racha_30", "Imparable", 30, 5000),
    dias("racha_100", "Leyenda", 100, 20000),
];

module.exports = { RACHA };
