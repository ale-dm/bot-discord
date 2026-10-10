// Piezas básicas de las pantallas de perfil: colores por nivel, la barra de progreso y las medallas.

const MEDALLAS = ["🥇", "🥈", "🥉", "4️⃣", "5️⃣"];

function colorByLevel(level) {
    if (level >= 60) return 0x8e44ad;
    if (level >= 40) return 0x2980b9;
    if (level >= 25) return 0xf1c40f;
    if (level >= 10) return 0x2ecc71;
    return 0x4a90e2;
}

function progressBar(current, needed, size = 14) {
    const ratio = needed > 0 ? Math.max(0, Math.min(1, current / needed)) : 0;
    const filled = Math.round(ratio * size);
    return "█".repeat(filled) + "░".repeat(Math.max(0, size - filled));
}

// `opcionesLogros`: qué logros de Plex cuentan en el resumen (plexTrofeos.opcionesPerfil).

module.exports = { MEDALLAS, colorByLevel, progressBar };
