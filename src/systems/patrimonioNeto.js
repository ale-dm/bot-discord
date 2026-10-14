// 🏦 Patrimonio neto (#401): efectivo + banco + lo pagado por los negocios + la cartera cripto valorada (como cuenta para el impuesto de
// patrimonio). El dinero negro no entra hasta blanquearse. Para no valorar a cada persona contra el mercado, se lee el precio del
// TTCL una vez y se calcula todo en una consulta; el resultado se guarda un minuto (el ranking se repinta en cada pulsación).
const db = require("../core/db");
const mercado = require("./cripto/mercado");
const { CacheLimitada } = require("../core/cacheLimitada");

const TTL_MS = 60_000;
const cache = new CacheLimitada({ max: 5, ttlMs: TTL_MS });

/** El top de patrimonio neto: [{ userId, efectivo, banco, negocios, cripto, total }]. */
function ranking(limite = 10) {
    const guardado = cache.get(limite);
    if (guardado) return guardado;
    const precio = mercado.getTtclPrecio();
    const filas = db
        .prepare(
            `SELECT b.userId, b.enMano AS efectivo, b.saldo AS banco,
                    COALESCE((SELECT SUM(pagado) FROM negocios_usuario n WHERE n.userId = b.userId), 0) AS negocios,
                    COALESCE((SELECT SUM(cantidad) FROM cripto_carteras c WHERE c.userId = b.userId AND c.cripto = 'TTCL' AND c.cantidad > 0), 0) * ? AS cripto
             FROM banco b ORDER BY efectivo + banco + negocios + cripto DESC, b.userId LIMIT ?`,
        )
        .all(precio, limite)
        .map((f) => ({ ...f, cripto: Math.floor(f.cripto), total: f.efectivo + f.banco + f.negocios + Math.floor(f.cripto) }))
        .filter((f) => f.total > 0);
    cache.set(limite, filas);
    return filas;
}

/** Olvida lo guardado (para los tests). */
const olvidar = () => cache.delete(10);

module.exports = { TTL_MS, ranking, olvidar };
