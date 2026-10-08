const {
    SlashCommandBuilder,
    EmbedBuilder,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    PermissionFlagsBits,
    MessageFlags,
} = require("discord.js");
const guildSettings = require("../../systems/guildSettings");
const { CATALOG } = require("../../systems/achievementsSystem");
const log = require("../../core/logger").createLogger("ayuda");

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
            "`/duende` — un panel con 💬 Hablar, 🧠 Recuerdos (anotar, olvidar y ver lo que sabe de ti; los admins, de cualquiera) y 🎭 Personalidad del canal.",
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
            "`/sonidos` — un tablero de botones con los sonidos del servidor: pulsas uno y el bot entra en tu canal de voz y lo reproduce. Los sube un admin en `/paneladmin` → 🔊 Sonidos.",
            "`/conectar [canal]` — el bot se queda **30 minutos** en un canal de voz, para que `/sonidos` suene al momento sin entrar y salir. Sin canal, usa el tuyo; si ya está conectado, lo desconecta.",
        ],
    },
    progresion: {
        boton: "Niveles",
        emoji: "📈",
        titulo: "Niveles, rachas y logros",
        abrir: [
            ["perfil", "perfil", "Perfil", "👤"],
            ["perfil", "logros", "Logros", "🏅"],
            ["perfil", "rankings", "Rankings", "🏆"],
            ["pase", "", "Pase", "🛡️"],
        ],
        texto: [
            "Ganas XP escribiendo (una vez cada 15 s) y en voz (5 XP/min, sin mute y con alguien más en el canal). Al subir de nivel desbloqueas rangos y roles.",
            "**Racha diaria**: cada día seguido ganando XP suma +2 % de XP (hasta +50 %). Te aviso por DM si está en peligro.",
            "`/perfil [usuario] [seccion]` — todo lo tuyo (o de otra persona) en pestañas: 👤 Perfil (nivel, progreso, rango, racha y recompensas de nivel) · 💰 Economía · 🎲 Juegos · 🏅 Logros · 🏆 Rankings. Con Plex vinculado, 👤 Perfil → 🍿 Plex: tus horas, en qué idiomas lo ves y lo que te falta poco.",
            `**Logros**: ${CATALOG.length}, con recompensa en monedas; en 🏅 Logros se ven (también los secretos), se filtran por categoría o dificultad y se reclaman uno a uno o todos. Los de 🍿 Plex (horas vistas, películas, series, anime, maratones...) cuentan lo que ves si tienes la cuenta de Plex vinculada; además hay **trofeos** por terminar cada temporada, serie o saga, por géneros, directores y décadas, y los que crean los admins (algunos con fechas, como eventos), con lo raros que son; **por idioma**: en inglés, VOSE o castellano, y el anime doblado o en japonés con subtítulos; y **sociales**: la misma película que otro el mismo día, verlo en cuanto llega a Plex o ser el primero en ver un estreno. Cada uno tiene dificultad: 🟢 Fácil, 🟡 Normal o 🎰 Gordo del Plex (con rol al llegar a 1, 5 y 10, si los admins lo ponen). Lo que sale al importar tu historial da menos monedas. Con 🍿 Ocultar mis logros de Plex no se anuncian ni los ven los demás.`,
            "**Rankings**: nivel, riqueza, casino, logros, TTCL, 🍿 Plex (logros, Gordos, políglota y horas) y ⚽ apostadores (beneficio, acierto y racha), en una pantalla con un menú.",
            "`/pase` — el pase de batalla de la temporada (15 días): cada cosa que haces (escribir, voz, casino, cripto, apuestas, tienda, completar un logro) da XP con un tope diario, y cada nivel da monedas, que se cobran a mano en el propio `/pase`. Cada día hay 3 misiones que dan XP extra.",
        ],
    },
    plex: {
        boton: "Plex",
        emoji: "🍿",
        titulo: "Plex",
        abrir: [["plex", "", "Plex", "🍿"]],
        texto: [
            "`/plex` — todo lo de Plex en un panel: 🎬 Sesión de cine (una peli o serie a una hora, con recordatorio 10 minutos antes y botones para apuntarse), 🎯 Para ti (recomendaciones según lo que has visto, con 📥 para pedirlas a Seerr), 🎞️ Wrapped y 🏅 Mi Plex.",
            "**Wrapped mensual**: el día 1 de cada mes te llega por DM tu resumen del mes anterior. Es privado: nadie más lo ve.",
            "Si tu cuenta de Plex no está vinculada, el panel lo indica; con la vinculación, tus horas, logros y recomendaciones salen de tu propio historial.",
        ],
    },
    economia: {
        boton: "Economía",
        emoji: "💰",
        titulo: "Economía",
        abrir: [
            ["perfil", "eco", "Economía", "💰"],
            ["tienda", "catalogo", "Tienda", "🛒"],
        ],
        texto: [
            "Empiezas con **1.000 monedas** en 💵 efectivo. Se juega y se compra con el **efectivo**; el 🏦 **banco** es el sitio seguro (hay que sacar el dinero para gastarlo).",
            "`/perfil` → 💰 Economía: 🏦 Ingresar · 💵 Sacar · 💸 Transferir · 📜 Movimientos (con filtro), más lo ganado en el casino y tu cartera cripto. En el casino, la tienda y la cripto también hay un botón 💵 Sacar del banco.",
            "🎁 **Diario**: una vez al día, en `/perfil` → 💰 Economía, unas monedas que suben con tu racha de días ganando XP.",
            "`/tienda` — un panel con pestañas: 🛒 Catálogo (compra con los botones, filtra por categoría y rareza, o busca por nombre), 🎒 Inventario (tus objetos, con un botón para usarlos: los de rol te dan un rol, los consumibles un efecto) y 🧾 Mis compras.",
        ],
    },
    casino: {
        boton: "Casino",
        emoji: "🎰",
        titulo: "Casino",
        abrir: [
            ["juegos", "casino", "Casino", "🎰"],
            ["juegos", "stats", "Stats", "📊"],
        ],
        texto: [
            "`/juegos` — todo lo que es apostar monedas, en pestañas: 🎰 Casino · ⚽ Apuestas · ⚔️ Retos · 📋 Mis jugadas · 📊 Stats.",
            "**Juegos**: blackjack (×2, blackjack ×2,5), tragaperras con jackpot, ruleta (×2 · docenas ×3 · número ×36), adivinar la carta (hasta ×20) y piedra, papel o tijera (×2).",
            "Eliges juego e importe con botones; al acabar: 🔄 Repetir · 🎲 Otra apuesta · 📊 Stats · ◀ Casino.",
            "Una partida sin tocar 15 min se da por perdida; si el bot se reinicia a mitad, se te devuelve lo apostado.",
        ],
    },
    apuestas: {
        boton: "Apuestas",
        emoji: "⚽",
        titulo: "Apuestas deportivas y retos",
        abrir: [
            ["juegos", "apuestas", "Apuestas", "⚽"],
            ["juegos", "retos", "Retos", "⚔️"],
            ["juegos", "jugadas", "Mis jugadas", "📋"],
        ],
        texto: [
            "Partidos reales de LaLiga, Premier y Champions con cuotas reales: `/juegos` → ⚽ Apuestas. También al **🎯 marcador exacto**: si lo aciertas, ×8 lo apostado.",
            "**Quiniela** de la jornada (botón 🧾): el 90 % del bote se reparte entre quien más acierte (mínimo la mitad de aciertos; si nadie llega, se devuelve lo apostado).",
            "**⚔️ Retos** (`/juegos` → ⚔️): apuesta contra otra persona a un partido («a que gana el Betis»; el otro va con lo contrario), un duelo de piedra-papel-tijera, dados o blackjack, o una **porra** con opciones que resuelve un admin. El dinero se guarda hasta que se resuelve y el ganador se lo lleva todo; si nadie acepta en 24 h, se devuelve.",
            "**Mis jugadas** (`/juegos` → 📋): lo que tienes en juego (cuánto, lo que podrías cobrar y tu beneficio del mes), con tus pronósticos de la quiniela, tus 🧩 combinadas y los aciertos que llevas, y lo ya resuelto. Una apuesta a un partido que aún no ha empezado se puede ↩️ cancelar, con un 10 % de comisión.",
            "Se pagan solas cada hora cuando acaban los partidos, y te aviso por DM si ganas.",
        ],
    },
    cripto: {
        boton: "Cripto",
        emoji: "📊",
        titulo: "Cripto",
        abrir: [["cripto", "", "Cripto", "📊"]],
        texto: [
            "`/cripto` — panel con precios, gráficos, compra, venta, cartera e historial.",
            "**$TTCL**, la moneda del servidor: su precio sube cuando se compra y baja cuando se vende.",
        ],
    },
    admin: {
        boton: "Admin",
        emoji: "🛠️",
        titulo: "Administración",
        soloAdmin: true,
        abrir: [["paneladmin", "", "Panel admin", "🛠️"]],
        texto: [
            "`/paneladmin` — todo en un panel: banco, niveles y XP, configuración (Duende, cripto, casino, tienda, logros, permisos de comandos), ⚽ Apuestas (liquidar ahora, crear quinielas, premios de la liga, límites), 🛒 Catálogo (objetos y lo que está a la venta), 🔊 Sonidos (subir y borrar), 🩺 Sistema (diagnóstico, TTCL, nivel de log), Plex, Seerr y auditoría.",
            "`/duende` → 🎭 Personalidad — los admins añaden, quitan y eligen las personalidades del canal.",
            "`/mensaje usuario` — manda un DM de parte del bot a alguien: eliges a quién y escribes el texto en un formulario (tu nombre va en el mensaje). Solo admins; cada envío queda en la auditoría.",
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
    // En una sección, una fila con sus paneles: cada botón abre el comando como si se hubiera escrito.
    const abrir = activa && SECCIONES[activa].abrir;
    if (abrir) {
        filas.push(
            new ActionRowBuilder().addComponents(
                abrir.map(([cmd, sec, texto, emoji]) =>
                    new ButtonBuilder()
                        .setCustomId(`ayuda_abrir_${cmd}_${sec}`)
                        .setLabel(`Abrir ${texto}`)
                        .setEmoji(emoji)
                        .setStyle(ButtonStyle.Success),
                ),
            ),
        );
    }
    return filas;
}

// Abre el panel de /cmd [seccion] como respuesta nueva, con quien pulsa como dueño. La interacción del botón hace de
// la del comando: se le cambian las opciones y deja de ser un botón (para que el comando responda y no edite la ayuda).
async function abrirPanel(client, interaction, cmd, sec) {
    const comando = client.slashCommands?.get(cmd);
    if (!comando) {
        await interaction.reply({ content: `No encuentro /${cmd}.`, flags: MessageFlags.Ephemeral });
        return;
    }
    const acl = guildSettings.isCommandAllowed(interaction, cmd);
    if (!acl.ok) {
        await interaction.reply({ content: acl.message || "⛔ Acción no permitida aquí.", flags: MessageFlags.Ephemeral });
        return;
    }
    const falsa = Object.create(interaction);
    falsa.commandName = cmd;
    falsa.isButton = () => false;
    falsa.isChatInputCommand = () => true;
    falsa.options = {
        getString: (nombre) => (nombre === "seccion" && sec) || null,
        getSubcommand: () => sec || null,
        getUser: () => null,
        getBoolean: () => null,
        getInteger: () => null,
        getNumber: () => null,
    };
    log.info(`Abre /${cmd}${sec ? ` ${sec}` : ""} desde la ayuda · ${interaction.user?.tag}`);
    await comando.run(client, falsa);
}

function embedInicio(interaction) {
    return new EmbedBuilder()
        .setTitle("🤖 Guía de El Duende")
        .setDescription(
            "Pulsa una sección para ver sus comandos y abrir sus paneles.\n\n" +
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
        });
    },

    async handleButton(client, interaction) {
        if (interaction.customId.startsWith("ayuda_abrir_")) {
            const [cmd, sec] = interaction.customId.slice("ayuda_abrir_".length).split("_");
            const permitido = Object.values(SECCIONES).some(
                (s) => (!s.soloAdmin || esAdmin(interaction)) && s.abrir?.some(([c, x]) => c === cmd && x === sec),
            );
            if (permitido) await abrirPanel(client, interaction, cmd, sec);
            else await interaction.reply({ content: "Ese panel no está disponible.", flags: MessageFlags.Ephemeral });
            return;
        }
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
