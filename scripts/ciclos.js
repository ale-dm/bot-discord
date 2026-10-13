// Ciclos de dependencias entre módulos de src/ (#479). Mide los que hay con madge y los compara con la lista de excepciones
// (docs/planificacion/ciclos-permitidos.json): un ciclo nuevo hace fallar `npm run check`, y un ciclo que ya no existe también,
// para que la lista solo pueda bajar (cada refactor la reduce, nadie la amplía). Uso: node scripts/ciclos.js
//   node scripts/ciclos.js --listar   imprime los ciclos actuales en el formato de la lista (para regenerar CICLOS.md)
const fs = require("fs");
const path = require("path");

const RAIZ = path.join(__dirname, "..");
const LISTA = path.join(RAIZ, "docs", "planificacion", "ciclos-permitidos.json");

/** Un ciclo como texto estable: empieza por su módulo menor, así el mismo ciclo sale igual lo encuentre por donde lo encuentre. */
function normalizar(ciclo) {
    const nodos = ciclo.map((f) => f.split(path.sep).join("/"));
    const menor = nodos.reduce((m, f, i) => (f < nodos[m] ? i : m), 0);
    return [...nodos.slice(menor), ...nodos.slice(0, menor)].join(" > ");
}

/** Los ciclos de dependencias que hay ahora en src/, normalizados y ordenados. */
async function ciclosActuales() {
    const madge = require("madge");
    const resultado = await madge(path.join(RAIZ, "src"), { fileExtensions: ["js"] });
    return resultado.circular().map(normalizar).sort();
}

/** @returns {string[]} los ciclos aceptados hasta ahora (la lista de excepciones) */
function ciclosPermitidos() {
    return JSON.parse(fs.readFileSync(LISTA, "utf8")).sort();
}

/**
 * Compara los ciclos que hay con los permitidos.
 * @returns {{ nuevos: string[], resueltos: string[] }} `nuevos`: ciclos que no están en la lista; `resueltos`: entradas de la lista que ya no son ciclos
 */
function comparar(actuales, permitidos) {
    const a = new Set(actuales);
    const p = new Set(permitidos);
    return { nuevos: actuales.filter((c) => !p.has(c)), resueltos: permitidos.filter((c) => !a.has(c)) };
}

async function main() {
    const actuales = await ciclosActuales();
    if (process.argv.includes("--listar")) {
        console.log(JSON.stringify(actuales, null, 4));
        return 0;
    }
    const permitidos = ciclosPermitidos();
    const { nuevos, resueltos } = comparar(actuales, permitidos);
    console.log(`Ciclos de dependencias: ${actuales.length} (permitidos: ${permitidos.length})`);
    if (nuevos.length) {
        console.error(
            `\n❌ Hay ${nuevos.length} ciclo(s) nuevo(s). Rómpelos (inyecta la dependencia o muévela a un módulo común); no se pueden añadir a la lista:`,
        );
        for (const c of nuevos) console.error(`  · ${c}`);
    }
    if (resueltos.length) {
        console.error(
            `\n❌ ${resueltos.length} ciclo(s) de la lista ya no existen: bórralos de docs/planificacion/ciclos-permitidos.json (y de CICLOS.md) para que la lista solo baje:`,
        );
        for (const c of resueltos) console.error(`  · ${c}`);
    }
    return nuevos.length || resueltos.length ? 1 : 0;
}

if (require.main === module) {
    main().then(
        (codigo) => process.exit(codigo),
        (e) => {
            console.error("No se pudo medir los ciclos:", e);
            process.exit(1);
        },
    );
}

module.exports = { normalizar, comparar, ciclosActuales, ciclosPermitidos };
