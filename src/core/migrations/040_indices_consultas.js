// Índices para las consultas que se repiten (las de cada mensaje, cada clic, cada minuto o cada cinco minutos) y que
// hoy recorren la tabla entera: partidos y apuestas de cada persona, quinielas, combinadas, inventario y la voz de XP.
// Todos son IF NOT EXISTS: aplicar la migración dos veces no cambia nada.
// Si una BD muy antigua no tiene alguna columna de un índice, ese índice se omite (y se avisa): el bot tiene que
// arrancar igual, y el índice se puede añadir después con una migración nueva.

const { crearIndices } = require("./indices");

const INDICES = [
    // Listado de partidos para apostar (filtro por deporte y hora de inicio) y liquidación/destacado (estado y hora).
    "CREATE INDEX IF NOT EXISTS idx_apuestas_partidos_estado_deporte_inicio ON apuestas_partidos(estado, deporte, start_time)",
    "CREATE INDEX IF NOT EXISTS idx_apuestas_partidos_estado_inicio ON apuestas_partidos(estado, start_time)",
    // «Mis jugadas», cancelar, ranking y recordatorios: las apuestas de una persona, y las pendientes.
    "CREATE INDEX IF NOT EXISTS idx_apuestas_usuario_user ON apuestas_usuario(user_id)",
    "CREATE INDEX IF NOT EXISTS idx_apuestas_usuario_pendientes ON apuestas_usuario(pagado, recordado)",
    // Quinielas: los partidos de cada jornada, y las apuestas por jornada y por persona.
    "CREATE INDEX IF NOT EXISTS idx_quiniela_partidos_quiniela ON quiniela_partidos(quiniela_id, orden)",
    "CREATE INDEX IF NOT EXISTS idx_quiniela_partidos_match ON quiniela_partidos(match_id)",
    "CREATE INDEX IF NOT EXISTS idx_quiniela_apuestas_quiniela ON quiniela_apuestas(quiniela_id, user_id)",
    "CREATE INDEX IF NOT EXISTS idx_quiniela_apuestas_user ON quiniela_apuestas(user_id)",
    // Combinadas: las de una persona, y las patas de cada una.
    "CREATE INDEX IF NOT EXISTS idx_combinadas_user ON combinadas(user_id, estado)",
    "CREATE INDEX IF NOT EXISTS idx_combinada_patas_combinada ON combinada_patas(combinada_id)",
    // Inventario: se mira en cada compra, uso o robo.
    "CREATE INDEX IF NOT EXISTS idx_inventario_user ON inventario(userId, itemId)",
    // XP: la voz se mira cada minuto (solo las personas que están en un canal), y cada persona entre servidores.
    "CREATE INDEX IF NOT EXISTS idx_xp_users_voz ON xp_users(voz_inicio) WHERE voz_inicio IS NOT NULL",
    "CREATE INDEX IF NOT EXISTS idx_xp_users_user ON xp_users(userId)",
    "CREATE INDEX IF NOT EXISTS idx_xp_level_history_usuario ON xp_level_history(guildId, userId, createdAt)",
    // Registro de admin: el último de cada servidor.
    "CREATE INDEX IF NOT EXISTS idx_admin_audit_guild ON admin_audit(guildId, id)",
    // Cine: el aviso de cada sesión, cada cinco minutos.
    "CREATE INDEX IF NOT EXISTS idx_cine_sesiones_recordatorio ON cine_sesiones(recordatorio, inicio)",
    // Retos: se busca por el mensaje al pulsar un botón.
    "CREATE INDEX IF NOT EXISTS idx_retos_message ON retos(messageId)",
    // TTCL: quién tiene y cuánto, en cada precio y cada evento.
    "CREATE INDEX IF NOT EXISTS idx_cripto_carteras_cripto ON cripto_carteras(cripto, cantidad)",
];

function up(db) {
    crearIndices(db, INDICES);
}

module.exports = { up, INDICES };
