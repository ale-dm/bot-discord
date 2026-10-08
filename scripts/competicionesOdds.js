// Lista las claves de fútbol de The Odds API (/v4/sports) para comprobar las de services/oddsApi.js (DEPORTES).
// Uso: ODDS_API_KEY=... node scripts/competicionesOdds.js
// La lista de deportes no gasta créditos de cuota (lo dice la propia API), así que se puede ejecutar sin miedo.
require("dotenv").config();
const { DEPORTES } = require("../src/services/oddsApi");

async function main() {
    const key = process.env.ODDS_API_KEY;
    if (!key) throw new Error("Falta ODDS_API_KEY (en .env o en el entorno).");
    const res = await fetch(`https://api.the-odds-api.com/v4/sports/?apiKey=${encodeURIComponent(key)}`, {
        signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) throw new Error(`La API respondió ${res.status}: ${(await res.text()).slice(0, 200)}`);
    const deportes = await res.json();
    const futbol = deportes.filter((d) => d.key.startsWith("soccer_"));
    const disponibles = new Set(futbol.map((d) => d.key));

    for (const [id, d] of Object.entries(DEPORTES)) {
        const ok = disponibles.has(d.apiKey);
        console.log(`${ok ? "✅" : "❌"} ${id.padEnd(12)} ${d.apiKey}${ok ? "" : "  ← no está en la API; revisa la clave"}`);
    }
    console.log("\nFútbol disponible en la API:");
    for (const d of futbol) console.log(`  ${d.key.padEnd(34)} ${d.title}`);
}

main().catch((e) => {
    console.error("❌", e.message);
    process.exit(1);
});
