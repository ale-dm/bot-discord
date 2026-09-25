const {
    SlashCommandBuilder,
    EmbedBuilder,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    PermissionFlagsBits,
    MessageFlags,
} = require("discord.js");

// Guía del bot dentro de Discord. El contenido sigue a docs/FUNCIONALIDADES.md: si se
// añade o cambia un comando, actualizar las dos cosas.
const SECCIONES = {
    duende: {
        boton: "Duende",
        emoji: "🧙",
        titulo: "El Duende e IA",
        texto: [
            '**Hablar con el Duende**: escribe "duende" o menciónale y responde siempre. A veces se mete solo en la conversación, ve las imágenes que mandas y puede responder por voz si estás en un canal de voz.',
            'Puede mirar datos reales: tu nivel, saldo, logros, precio de TTCL y, en los canales permitidos, Plex y Seerr ("¿qué ha visto Raúl esta semana?", "pídeme Dune").',
            "`/duende recuerda usuario nota` · `/duende olvida usuario` · `/duende personas` — lo que el Duende sabe de ti (en privado; los admins, de cualquiera).",
            "`/duende talk texto` · `/duende list` — hablarle por comando / ver personalidades.",
            "`/ia prompt [agente] [generar_imagen]` — asistentes especializados (técnico, creativo, profesor, coach…).",
            "`/imagen descripcion [imagen1..5] [estilo]` — genera o edita imágenes.",
            "`/bola8 pregunta` — la bola 8 mágica.",
        ],
    },
    voz: {
        boton: "Voz",
        emoji: "🎙️",
        titulo: "Voz",
        texto: [
            "`/tts texto [voz]` — el bot entra en tu canal de voz y lo lee en voz alta.",
            "`/escuchar [usuario]` — el Duende escucha lo que dices en voz y te contesta hablando; sigue la conversación mientras hables.",
        ],
    },
    progresion: {
        boton: "Niveles",
        emoji: "📈",
        titulo: "Niveles, rachas y logros",
        texto: [
            "Ganas XP escribiendo (una vez cada 15 s) y en voz (5 XP/min, sin mute y con alguien más en el canal). Al subir de nivel desbloqueas rangos y roles.",
            "**Racha diaria**: cada día seguido ganando XP suma +2 % de XP (hasta +50 %). Te aviso por DM si está en peligro.",
            "`/perfil [usuario] [seccion]` — todo lo tuyo (o de otra persona) en pestañas: 👤 Perfil (nivel, progreso, rango, racha y recompensas de nivel) · 💰 Economía · 🎲 Juegos · 🏅 Logros · 🏆 Rankings.",
            "**Logros**: 36, con recompensa en monedas; en 🏅 Logros se ven (también los secretos) y se reclaman uno a uno o todos.",
            "**Rankings**: nivel, riqueza, casino, logros y TTCL, en una pantalla con un menú.",
        ],
    },
    economia: {
        boton: "Economía",
        emoji: "💰",
        titulo: "Economía",
        texto: [
            "Empiezas con **1.000 monedas** en 💵 efectivo. Se juega y se compra con el **efectivo**; el 🏦 **banco** es el sitio seguro (hay que sacar el dinero para gastarlo).",
            "`/perfil` → 💰 Economía: 🏦 Ingresar · 💵 Sacar · 💸 Transferir · 📜 Movimientos (con filtro), más lo ganado en el casino y tu cartera cripto. En el casino, la tienda y la cripto también hay un botón 💵 Sacar del banco.",
            "`/tienda ver | inventario | historial` — en pestañas: 🛒 Catálogo (compra con los botones), 🎒 Inventario (tus objetos, con un botón para usarlos: los de rol te dan un rol, los consumibles un efecto) y 🧾 Mis compras.",
        ],
    },
    casino: {
        boton: "Casino",
        emoji: "🎰",
        titulo: "Casino",
        texto: [
            "`/juegos` — todo lo que es apostar monedas, en pestañas: 🎰 Casino · ⚽ Apuestas · 📋 Mis jugadas · 📊 Stats.",
            "**Juegos**: blackjack (×2, blackjack ×2,5), tragaperras con jackpot, ruleta (×2 · docenas ×3 · número ×36), adivinar la carta (hasta ×20) y piedra, papel o tijera (×2).",
            "Eliges juego e importe con botones; al acabar: 🔄 Repetir · 🎲 Otra apuesta · 📊 Stats · ◀ Casino.",
            "Una partida sin tocar 15 min se da por perdida; si el bot se reinicia a mitad, se te devuelve lo apostado.",
        ],
    },
    apuestas: {
        boton: "Apuestas",
        emoji: "⚽",
        titulo: "Apuestas deportivas",
        texto: [
            "Partidos reales de LaLiga, Premier y Champions con cuotas reales: `/juegos` → ⚽ Apuestas.",
            "**Quiniela** de la jornada (botón 🧾): el 90 % del bote se reparte entre quien más acierte (mínimo la mitad de aciertos; si nadie llega, se devuelve lo apostado).",
            "**Mis jugadas** (`/juegos` → 📋): lo que tienes en juego, con tus pronósticos de la quiniela y los aciertos que llevas, y lo ya resuelto.",
            "Se pagan solas cada hora cuando acaban los partidos, y te aviso por DM si ganas.",
        ],
    },
    cripto: {
        boton: "Cripto",
        emoji: "📊",
        titulo: "Cripto",
        texto: [
            "`/cripto` — panel con precios, gráficos, compra, venta, cartera e historial.",
            "BTC, ETH, SOL, BNB, XRP y DOGE con su precio real (1 € = 1.000 monedas).",
            "**$TTCL**, la moneda del servidor: su precio sube cuando se compra y baja cuando se vende.",
        ],
    },
    admin: {
        boton: "Admin",
        emoji: "🛠️",
        titulo: "Administración",
        soloAdmin: true,
        texto: [
            "`/paneladmin` — banco, niveles y XP, configuración (Duende, cripto, casino, tienda, logros, permisos de comandos), Plex, Seerr y auditoría.",
            "`/tienda añadir | editar | eliminar | config` · `/objeto crear | editar | eliminar | ver`",
            "`/duende set | add | remove` — personalidades del Duende.",
            "`/diagnostico [nivel_log]` — estado del bot, errores recientes y consumo de Gemini.",
            "`/pagarapuestas` — forzar ahora el pago de apuestas.",
        ],
    },
};

function esAdmin(interaction) {
    return !!interaction.memberPermissions?.has(PermissionFlagsBits.Administrator);
}

function seccionesVisibles(interaction) {
    return Object.entries(SECCIONES).filter(([, s]) => !s.soloAdmin || esAdmin(interaction));
}

function botones(interaction, activa) {
    const secciones = seccionesVisibles(interaction);
    const todos = [
        new ButtonBuilder()
            .setCustomId("ayuda_inicio")
            .setLabel("Inicio")
            .setEmoji("🏠")
            .setStyle(activa ? ButtonStyle.Secondary : ButtonStyle.Primary),
        ...secciones.map(([id, s]) =>
            new ButtonBuilder()
                .setCustomId(`ayuda_${id}`)
                .setLabel(s.boton)
                .setEmoji(s.emoji)
                .setStyle(id === activa ? ButtonStyle.Primary : ButtonStyle.Secondary),
        ),
    ];
    const filas = [];
    for (let i = 0; i < todos.length; i += 5) filas.push(new ActionRowBuilder().addComponents(todos.slice(i, i + 5)));
    return filas;
}

function embedInicio(interaction) {
    return new EmbedBuilder()
        .setTitle("🤖 Guía de El Duende")
        .setDescription(
            "Pulsa una sección para ver sus comandos.\n\n" +
                seccionesVisibles(interaction)
                    .map(([, s]) => `${s.emoji} **${s.titulo}**`)
                    .join("\n") +
                "\n\n`/ping` — comprobar que el bot responde · `/ayuda` — volver aquí",
        )
        .setColor(0x00b894);
}

function embedSeccion(id) {
    const s = SECCIONES[id];
    return new EmbedBuilder()
        .setTitle(`${s.emoji} ${s.titulo}`)
        .setDescription(s.texto.map((l) => `• ${l}`).join("\n\n"))
        .setColor(0x00b894);
}

module.exports = {
    componentHandlers: [{ types: ["button"], prefixes: ["ayuda_"], method: "handleButton" }],
    data: new SlashCommandBuilder().setName("ayuda").setDescription("Guía de todo lo que puede hacer el bot"),

    async run(client, interaction) {
        await interaction.reply({
            embeds: [embedInicio(interaction)],
            components: botones(interaction, null),
            flags: MessageFlags.Ephemeral,
        });
    },

    async handleButton(client, interaction) {
        const id = interaction.customId.replace("ayuda_", "");
        const s = SECCIONES[id];
        if (!s || (s.soloAdmin && !esAdmin(interaction))) {
            await interaction.update({ embeds: [embedInicio(interaction)], components: botones(interaction, null) });
            return;
        }
        await interaction.update({ embeds: [embedSeccion(id)], components: botones(interaction, id) });
    },

    // Para tests
    __test: { SECCIONES },
};
