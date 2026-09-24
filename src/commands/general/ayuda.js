const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, PermissionFlagsBits } = require("discord.js");

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
            "`/duende recuerda usuario nota` · `/duende olvida usuario` · `/duende personas` — lo que el Duende sabe de cada uno.",
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
            "`/nivel [usuario]` — nivel, progreso, rango y racha.",
            "`/logros ver` · `/logros reclamar id` · `/logros reclamar_todo` · `/logros top` — 36 logros con recompensa en monedas.",
            "`/perfil [usuario]` — todo junto: nivel, racha, saldo, logros, casino y rankings.",
        ],
    },
    economia: {
        boton: "Economía",
        emoji: "💰",
        titulo: "Economía",
        texto: [
            "Empiezas con **1.000 monedas**. Se juega y se compra con el saldo del banco.",
            "`/banco saldo | depositar | retirar | transferir | top | historial`",
            "`/tienda ver [busqueda] [categoria] [rareza]` — compra con los botones. `/tienda historial` — tus compras.",
            "`/inventario [categoria] [rareza]` · `/usar id` — tus objetos; los de rol te dan un rol, los consumibles un efecto.",
        ],
    },
    casino: {
        boton: "Casino",
        emoji: "🎰",
        titulo: "Casino",
        texto: [
            "`/blackjack apuesta` — pedir, plantarse, doblar y separar. Victoria ×2, blackjack ×2,5.",
            "`/tragaperras [apuesta]` — jackpot progresivo con tres 7️⃣.",
            "`/ruleta apuesta [tipo] [numero]` — color, par/impar, mitades ×2 · docenas ×3 · número ×36.",
            "`/adivinar` — 4 rondas de cartas con 500 monedas, hasta ×20. Puedes retirarte desde la ronda 3.",
            "`/ppt jugada cantidad` — piedra, papel o tijera contra el Duende (×2).",
            "Una partida sin tocar 15 min se da por perdida; si el bot se reinicia a mitad, se te devuelve lo apostado.",
        ],
    },
    apuestas: {
        boton: "Apuestas",
        emoji: "⚽",
        titulo: "Apuestas deportivas",
        texto: [
            "Partidos reales de LaLiga, Premier y Champions con cuotas reales.",
            "`/apuestas [deporte]` — elige partido y resultado (1/X/2).",
            "`/quiniela [deporte]` — pronósticos de la jornada; el 90 % del bote se reparte entre quien más acierte.",
            "`/misapuestas [tipo]` — activas, historial o estadísticas.",
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
        await interaction.reply({ embeds: [embedInicio(interaction)], components: botones(interaction, null), ephemeral: true });
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
