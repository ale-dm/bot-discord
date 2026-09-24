// Normalización de nombres/apodos (sin dependencias: la usan systems/apodos.js y duende.js).

// "Raúl" / "raul" / "  RAUL " -> "raul"
function normalizarApodo(s) {
    return String(s || "")
        .trim()
        .toLowerCase()
        .normalize("NFD")
        .replace(/[̀-ͯ]/g, "")
        .replace(/\s+/g, " ");
}

// El modelo suele mandar el nombre con artículo ("el perro", "la burra"): se prueba también sin él.
function sinArticulo(norm) {
    return norm.replace(/^(el|la|los|las|un|una)\s+/, "");
}

module.exports = { normalizarApodo, sinArticulo };
