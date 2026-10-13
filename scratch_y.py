def sub(path, old, new, count=1):
    s = open(path, encoding="utf-8").read()
    assert old in s, (path, old[:60])
    open(path, "w", encoding="utf-8", newline="").write(s.replace(old, new, count))

p = "src/juegos/casino/pptSerie.js"
sub(p, '''    if (!exito) return { ...privado("❌ Hubo un error procesando la partida. Contacta a un administrador."), embeds: [], components: [] };''', '''    if (!exito) return { content: "❌ Hubo un error procesando la partida. Contacta a un administrador.", embeds: [], components: [] };''')
sub(p, '''                return interaction.update({ content: "⌛ Esta serie ya no está en curso.", embeds: [], components: [casino.filaFinJuego("ppt", 100)] });''', '''                return interaction.update({ content: "⌛ Esta serie ya no está en curso.", embeds: [], components: [] });''')
p = "src/paneles/casino.js"
sub(p, '''            new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId("casino_pick_ppt").setLabel("◄ Cambiar apuesta").setStyle(ButtonStyle.Secondary),''', '''            // Al mejor de 3 (#457): la misma apuesta, fija, para tres manos; se cobra una sola vez.
            new ActionRowBuilder().addComponents(
                jugadas.map((j) =>
                    new ButtonBuilder()
                        .setCustomId(`casino_ppt3_ini_${apuesta}_${j.value}`)
                        .setLabel(`🏁 ${j.label} (mejor de 3)`)
                        .setStyle(ButtonStyle.Secondary),
                ),
            ),
            new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId("casino_pick_ppt").setLabel("◄ Cambiar apuesta").setStyle(ButtonStyle.Secondary),''')
sub(p, '.setDescription(`Apuesta: **${apuesta.toLocaleString("es")}** 🪙\n${lineaDinero(userId)}\n\n¿Qué sacas?`)', '.setDescription(\n            `Apuesta: **${apuesta.toLocaleString("es")}** 🪙\n${lineaDinero(userId)}\n\n¿Qué sacas? Una mano, o 🏁 **al mejor de 3** (misma apuesta, gana quien llegue a 2 manos).`,\n        )')
p = "src/core/tareas.js"
sub(p, 'const adivinar = require("../juegos/casino/adivinar.js");', 'const adivinar = require("../juegos/casino/adivinar.js");\nconst pptSerie = require("../systems/casino/pptSerie");')
sub(p, "                adivinar.limpiarAbandonadas();", "                adivinar.limpiarAbandonadas();\n                pptSerie.limpiarAbandonadas();")
