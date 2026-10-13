// Eventos de mercado de TTCL (F-EC-12d, #120): uno al día, ±5 %, a una hora aleatoria del día (hora de Madrid). El
// minuto y la dirección se eligen al empezar el día y se guardan. Al llegar la hora, el evento mueve la reserva de TTCL
// del pool (sube o baja el precio sin que nadie opere) y se avisa por DM a quien tenga TTCL.
const db = require("../../core/db");
const { createLogger } = require("../../core/logger");
const { madridDateStr } = require("../xp/rachas");
const guildSettings = require("../guildSettings");
const mercado = require("./mercado");
const avisosDm = require("../avisosDm");

const log = createLogger("Cripto");

const PORCENTAJE = 5;
const MINUTOS_DIA = 24 * 60;

/** Minutos desde medianoche en hora de Madrid. */
function minutoMadrid(fecha) {
    const [h, m] = new Intl.DateTimeFormat("en-GB", {
        timeZone: "Europe/Madrid",
        hour: "2-digit",
        minute: "2-digit",
        hourCycle: "h23",
    })
        .format(fecha)
        .split(":")
        .map(Number);
    return h * 60 + m;
}

function eventoDelDia(dia) {
    return db
        .prepare(
            "SELECT dia, minuto, direccion, porcentaje, aplicado_en, precio_antes, precio_despues, avisados FROM cripto_eventos WHERE dia = ?",
        )
        .get(dia);
}

/** Elige el evento del día al empezarlo: minuto y dirección al azar, guardados para que no cambien. */
function crearEventoDelDia(dia, rng) {
    const minuto = Math.floor(rng() * MINUTOS_DIA);
    const direccion = rng() < 0.5 ? "subida" : "bajada";
    db.prepare("INSERT INTO cripto_eventos (dia, minuto, direccion, porcentaje) VALUES (?, ?, ?, ?)").run(
        dia,
        minuto,
        direccion,
        PORCENTAJE,
    );
    return eventoDelDia(dia);
}

/**
 * Aplica el evento moviendo la reserva de TTCL: para subir un p %, el TTCL del pool se divide entre (1 + p); para bajar,
 * entre (1 − p). El precio (monedas / TTCL) cambia exactamente ese porcentaje.
 */
function aplicar(evento, ahora) {
    return db.transaction(() => {
        const antes = mercado.getTtclPrecio();
        const factor = evento.direccion === "subida" ? 1 + evento.porcentaje / 100 : 1 - evento.porcentaje / 100;
        db.prepare("UPDATE cripto_pool SET ttcl = ttcl / ? WHERE id = 1").run(factor);
        const despues = mercado.getTtclPrecio();
        db.prepare("INSERT INTO cripto_ttcl_precios (precio, timestamp) VALUES (?, ?)").run(despues, ahora);
        db.prepare("UPDATE cripto_eventos SET aplicado_en = ?, precio_antes = ?, precio_despues = ? WHERE dia = ?").run(
            ahora,
            antes,
            despues,
            evento.dia,
        );
        return { ...evento, aplicado_en: ahora, precio_antes: antes, precio_despues: despues };
    })();
}

/**
 * Lo que toca hacer ahora: crea el evento del día si no existe y lo aplica si ya es su hora. Sin tocar Discord.
 * @returns {object|null} el evento aplicado en esta pasada, o null
 */
function revisar(ahora = Date.now(), rng = Math.random) {
    const dia = madridDateStr(new Date(ahora));
    const evento = eventoDelDia(dia) || crearEventoDelDia(dia, rng);
    if (evento.aplicado_en) return null;
    if (minutoMadrid(new Date(ahora)) < evento.minuto) return null;
    const aplicado = aplicar({ ...evento, dia }, ahora);
    log.info(
        `Evento de TTCL: ${aplicado.direccion} del ${aplicado.porcentaje}% (de ${aplicado.precio_antes.toFixed(2)} a ${aplicado.precio_despues.toFixed(2)})`,
    );
    return aplicado;
}

/** A quién avisar: quien tiene TTCL en cartera. */
function destinatarios() {
    return db
        .prepare("SELECT userId FROM cripto_carteras WHERE cripto = 'TTCL' AND cantidad > 0")
        .all()
        .map((r) => r.userId);
}

function textoAviso(evento) {
    const sube = evento.direccion === "subida";
    return (
        `${sube ? "📈" : "📉"} **Evento de mercado:** el $TTCL ${sube ? "sube" : "baja"} un **${evento.porcentaje} %** ` +
        `(de ${Math.round(evento.precio_antes).toLocaleString("es")} a ${Math.round(evento.precio_despues).toLocaleString("es")} 🪙).`
    );
}

/**
 * Publica el evento en el canal que cada servidor tenga configurado (cripto.eventos_canal, #451). Sin canal no hace nada. Si
 * el canal no existe o el bot no puede escribir, el fallo queda en el log y no para nada más.
 * @returns {Promise<number>} canales en los que se ha publicado
 */
async function anunciarEnCanales(client, texto) {
    let publicados = 0;
    for (const guild of client.guilds?.cache?.values() ?? []) {
        const canalId = guildSettings.getSettings(guild.id).cripto.eventos_canal;
        if (!canalId) continue;
        try {
            const canal = guild.channels.cache.get(canalId) || (await guild.channels.fetch(canalId));
            await canal.send({ content: texto, allowedMentions: { parse: [] } });
            publicados++;
        } catch (e) {
            log.warn(`No se pudo anunciar el evento de TTCL en el canal ${canalId} de ${guild.name}: ${e.message}`);
        }
    }
    return publicados;
}

/**
 * Cron (cada 5 min): aplica el evento del día cuando llega su hora, lo anuncia en el canal configurado y avisa por DM a
 * quien tenga TTCL. Un aviso que falla no para los demás. El evento se aplica una sola vez al día (revisar solo lo
 * devuelve cuando lo acaba de aplicar), así que el canal recibe uno por día.
 */
async function revisarYAvisar(client, ahora = Date.now(), rng = Math.random) {
    const evento = revisar(ahora, rng);
    if (!evento) return null;
    const texto = textoAviso(evento);
    await anunciarEnCanales(client, texto);
    let avisados = 0;
    for (const userId of destinatarios()) {
        if (avisosDm.silenciado(userId, "cripto_evento")) continue;
        try {
            const usuario = await client.users.fetch(userId);
            await usuario.send(texto);
            avisados++;
        } catch (e) {
            log.debug(`No se pudo avisar del evento de TTCL a ${userId}: ${e.message}`);
        }
    }
    db.prepare("UPDATE cripto_eventos SET avisados = ? WHERE dia = ?").run(avisados, evento.dia);
    return { ...evento, avisados };
}

/** El último evento que se ha aplicado (para el panel), o null si todavía no hay ninguno. */
function ultimoEvento() {
    return (
        db
            .prepare(
                "SELECT dia, minuto, direccion, porcentaje, aplicado_en, precio_antes, precio_despues, avisados FROM cripto_eventos WHERE aplicado_en IS NOT NULL ORDER BY aplicado_en DESC LIMIT 1",
            )
            .get() || null
    );
}

/**
 * Los últimos eventos ya aplicados, del más reciente al más antiguo (#449). Cada día tiene un solo evento
 * (cripto_eventos.dia es único), así que el cron de 5 minutos no puede duplicarlos aunque lo revise varias veces.
 */
function ultimosEventos(limite = 10) {
    return db
        .prepare(
            "SELECT dia, minuto, direccion, porcentaje, aplicado_en, precio_antes, precio_despues, avisados FROM cripto_eventos WHERE aplicado_en IS NOT NULL ORDER BY aplicado_en DESC LIMIT ?",
        )
        .all(limite);
}

module.exports = { minutoMadrid, revisar, revisarYAvisar, destinatarios, ultimoEvento, ultimosEventos };
