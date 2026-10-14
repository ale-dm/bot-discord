// 🧙 Duende e IA, fase 11:
// - duende_cuotas (#371, #408): contadores por día (hora de Madrid) que sobreviven a los reinicios: las respuestas del Duende
//   (`chat:global` y `chat:{persona}`) y las imágenes (`imagen:{persona}`).
// - imagenes_generadas (#357): cada /imagen que sale bien (autor, descripción, estilo, enlace al mensaje y al adjunto).
// - duende_recuerdos_dms (#390): el mensaje de DM de cada admin con una propuesta de recuerdo, para quitarle los botones al caducar.
// - duende_espontaneo_dirigidos (#400): la última vez que un mensaje espontáneo se dirigió a cada persona.
// - duende_personalidades.voz (#396): la voz de síntesis de cada personalidad (NULL = la global).
const { addColumnIfMissing } = require("./index");

function up(db) {
    addColumnIfMissing(db, "duende_personalidades", "voz", "TEXT");
    db.exec(`
        CREATE TABLE IF NOT EXISTS duende_cuotas (
            clave TEXT NOT NULL,
            dia TEXT NOT NULL,
            n INTEGER NOT NULL DEFAULT 0,
            PRIMARY KEY (clave, dia)
        );
        CREATE TABLE IF NOT EXISTS imagenes_generadas (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            guildId TEXT,
            userId TEXT NOT NULL,
            prompt TEXT NOT NULL,
            estilo TEXT,
            url TEXT,
            adjunto TEXT,
            creada_en INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_imagenes_usuario ON imagenes_generadas(userId, creada_en);
        CREATE TABLE IF NOT EXISTS duende_recuerdos_dms (
            propuesta_id INTEGER NOT NULL,
            userId TEXT NOT NULL,
            canalId TEXT NOT NULL,
            mensajeId TEXT NOT NULL,
            PRIMARY KEY (propuesta_id, userId)
        );
        CREATE TABLE IF NOT EXISTS duende_espontaneo_dirigidos (
            guildId TEXT NOT NULL,
            userId TEXT NOT NULL,
            ultima INTEGER NOT NULL,
            PRIMARY KEY (guildId, userId)
        );
    `);
}

module.exports = { up };
