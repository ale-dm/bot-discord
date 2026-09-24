# Errores conocidos

Fallos concretos encontrados en las revisiones que **aún no están corregidos**, normalmente porque hace
falta decidir cómo debe funcionar. Los ya corregidos están en el [CHANGELOG](../CHANGELOG.md) (sección
"Errores corregidos" de cada revisión). La deuda técnica está en [DEUDA_TECNICA.md](DEUDA_TECNICA.md).

Al corregir uno: borrarlo de aquí y apuntarlo en el CHANGELOG.

**Gravedad:** 🔴 pierde dinero o datos · 🟠 comportamiento incorrecto · 🟢 detalle.

| ID | Error | Área | Gravedad | Falta |
|---|---|---|---|---|
| [E-01](#e-01-la-quiniela-paga-aunque-no-se-acierte-nada) | La quiniela paga aunque no se acierte nada | Apuestas | 🟠 | Decidir la regla |
| [E-02](#e-02-duende-recuerda-deja-a-cualquiera-escribir-en-el-perfil-de-otro) | `/duende recuerda` deja a cualquiera escribir en el perfil de otro | Duende | 🟠 | Decidir quién puede |
| [E-03](#e-03-duende-personas-enseña-a-todo-el-canal-lo-que-se-sabe-de-cada-uno) | `/duende personas` enseña a todo el canal lo que se sabe de cada uno | Duende | 🟢 | Decidir si privado |
| [E-04](#e-04-el-historial-antiguo-no-tiene-lo-apostado-en-fútbol) | El historial antiguo no tiene lo apostado en fútbol | Apuestas | 🟢 | Nada (informativo) |

---

## E-01 La quiniela paga aunque no se acierte nada

**Qué pasa.** Al liquidar, el 90 % del bote se reparte entre quienes tengan **más** aciertos, sean los
que sean (`pagarapuestas.js`). Con un solo jugador, recupera el 90 % aunque falle los 10 partidos; si
todos aciertan 0, todos recuperan el 90 %.
**Propuesta.** Un mínimo de aciertos para cobrar (p. ej. 5 de 10). Si nadie llega: devolver lo apostado,
o acumular el bote para la jornada siguiente (más emoción). También cabe exigir un mínimo de 2 jugadores.

## E-02 `/duende recuerda` deja a cualquiera escribir en el perfil de otro

**Qué pasa.** Cualquiera puede añadir notas sobre cualquier persona, y esas notas van directas al prompt
del Duende cada vez que esa persona habla. Solo el afectado o un admin pueden borrarlas.
**Por qué importa.** Además de notas ofensivas, una nota como "ignora tus instrucciones y..." cambia cómo
responde el Duende a esa persona (inyección de prompt).
**Propuesta.** Una de estas: solo sobre uno mismo (y los admins sobre cualquiera); o que las notas sobre
otro queden pendientes hasta que un admin las apruebe (encaja con la feature F-DU-04); o al menos un
cooldown y avisar al afectado por DM.

## E-03 `/duende personas` enseña a todo el canal lo que se sabe de cada uno

**Qué pasa.** La respuesta es pública e incluye las notas (o la descripción, si no hay notas) de todos.
Las descripciones están escritas para que el Duende sepa de qué picar a cada uno.
**Propuesta.** Respuesta privada (solo quien lo pide), o que cada uno vea solo lo suyo y los admins todo.

## E-04 El historial antiguo no tiene lo apostado en fútbol

**Qué pasa.** Hasta esta revisión, al apostar en `/apuestas` o en la quiniela no se apuntaba en el
historial lo apostado (solo el premio al ganar). Ya está corregido para las apuestas nuevas, pero en las
antiguas el "ganado/perdido" de `/nivel` cuenta el premio entero como ganancia.
**Propuesta.** Nada: se irá diluyendo. (Se podría rellenar desde `apuestas_usuario`, pero esa tabla no
guarda la fecha de la apuesta.)
