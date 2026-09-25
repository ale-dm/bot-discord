# Features

Ideas de funcionalidad nueva, sin implementar. Cuando se haga una, borrarla de aquí y apuntarla en
[CHANGELOG.md](../CHANGELOG.md). Los problemas del código que ya existe están en
[DEUDA_TECNICA.md](DEUDA_TECNICA.md), y las tareas manuales en [TAREAS.md](TAREAS.md).

**Esfuerzo:** S (reutiliza algo que ya existe, una tarde) · M (un par de días) · L (más).
**Créditos** (solo apuestas): coste extra en la Odds API. El plan gratuito da 500 al mes y hoy se gastan
pocos (se ven en el log y en `/diagnostico`).

## Por dónde empezar

Lo que más aporta con menos trabajo:

1. [F-AP-01](#apuestas-deportivas) Apuestas 1 contra 1: lo más social y no gasta cuota.
2. [F-PX-01](#plex-y-seerr) Aviso "ya está en Plex" cuando llega lo que pediste.
3. [F-EC-01](#economía-y-juego) `/diario`.
4. [F-AP-06](#apuestas-deportivas) + [F-AP-08](#apuestas-deportivas) Resultado en el canal y recordatorio antes del partido.
5. [F-AD-01](#administración) Alertas al admin por DM.

---

## Apuestas deportivas

| ID | Idea | Tipo | Esfuerzo | Créditos | Detalle |
|---|---|---|---|---|---|
| F-AP-01 | **Apuestas 1 contra 1** | Entre jugadores | M | 0 | "Te apuesto 500 a que gana el Madrid": el otro acepta con un botón y el dinero queda retenido hasta el resultado. |
| F-AP-02 | **Combinadas** | Mercado | M | 0 | Varios partidos en un boleto; cuota final = producto de las cuotas; se gana solo si se aciertan todos. |
| F-AP-03 | **Ranking de apostadores** | Entre jugadores | S | 0 | Beneficio, % de acierto y mejor racha (ya se guarda el premio de cada apuesta). |
| F-AP-04 | **Cartera de apuestas** | Seguimiento | S | 0 | Mejorar `/misapuestas`: total en juego, posible premio y beneficio del mes. |
| F-AP-05 | **Cancelar una apuesta** | Reglas | S | 0 | Devolverla antes de que empiece el partido, con una pequeña comisión. |
| F-AP-06 | **Resultado en el canal** | Seguimiento | S | 0 | Al liquidar, además del DM: "Elche 1-0 Oviedo · 3 acertaron, 1.240 monedas repartidas". |
| F-AP-07 | **Partido destacado del día** | Seguimiento | S | 0 | Mensaje con las cuotas del partido grande de la jornada y botón de apostar (usa la caché). |
| F-AP-08 | **Recordatorio antes del partido** | Seguimiento | S | 0 | DM 30 min antes a quien haya apostado. |
| F-AP-09 | **Límites por jugador** | Reglas | S | 0 | Tope diario apostado y máximo por partido, configurables en el panel (el sistema de límites del casino ya existe). |
| F-AP-10 | **Marcador exacto** | Mercado | S | 0 | Sin cuota de la API: premio fijo (p. ej. ×8) o bote repartido entre los que acierten, como la quiniela. |
| F-AP-11 | **Porras propias** | Entre jugadores | M | 0 | Cualquiera crea una apuesta ("¿Llegará Jorge tarde?"), los demás apuestan y un admin decide el resultado. Bote común. |
| F-AP-12 | **Liga de pronósticos por temporada** | Entre jugadores | M | 0 | Puntos por acierto en cada quiniela, clasificación acumulada y premio al final de temporada. |
| F-AP-13 | **Más/menos goles (2,5)** | Mercado | M | +1 por descarga | Mercado `totals`. Se liquida con el marcador que ya se consulta. |
| F-AP-14 | **Hándicap** | Mercado | M | +1 por descarga | Mercado `spreads` ("Barça −1,5"). Mismo coste que F-AP-13: mejor elegir uno de los dos. |
| F-AP-15 | **Más competiciones** | Mercado | M | +1 por competición | Mundial, Eurocopa, Copa del Rey, Europa League. Asumible con la caché si se apuesta poco. Basta con añadirlas a `DEPORTES` en `src/services/oddsApi.js` (y a las opciones de los comandos). |
| F-AP-16 | **Apuestas en directo** | Mercado | L | Muy alto | Cuotas refrescadas cada pocos minutos: agota el plan gratuito en un fin de semana. Solo con plan de pago. |

## Duende e IA

| ID | Idea | Esfuerzo | Detalle |
|---|---|---|---|
| F-DU-01 | **"¿Qué me he perdido?"** | S | `/resumen [horas]`: el Duende resume el canal con su personalidad (ya guarda historial por canal). |
| F-DU-02 | **Personalidad según la hora o el canal** | S | Más borde de madrugada, más formal en ciertos canales. |
| F-DU-03 | **El Duende participa en la economía** | S | Herramientas para que apueste contigo, preste monedas o te rete a piedra-papel-tijera desde el chat. |
| F-DU-04 | **Recuerdos automáticos** | M | Detecta cosas memorables de la conversación y propone guardarlas como nota; un admin las aprueba con un botón. |
| F-DU-05 | **Conversación de voz continua** | M | Modo "tertulia": escucha a todos los del canal, no solo a una persona. |

## Plex y Seerr

| ID | Idea | Esfuerzo | Detalle |
|---|---|---|---|
| F-PX-01 | **Aviso cuando llega lo que pediste** | S | "@Raúl, ya está *Dune 2* en Plex", cruzando el sondeo de novedades con las peticiones de Seerr. |
| F-PX-02 | **Logros de Plex** | S | "100 horas vistas", "maratón de 5 episodios en un día", en el catálogo de logros actual. |
| F-PX-03 | **Recomendaciones personales** | M | A partir de lo que cada uno ve en Tautulli, con botón "Pedir en Seerr". |
| F-PX-04 | **Plex Wrapped mensual** | M | Imagen con horas vistas, top series y el más viciado (ya hay `canvas` para las gráficas de cripto). |
| F-PX-05 | **Sesión de cine** | M | `/cine peli hora`: convocatoria con botones de "me apunto" y recordatorio 10 min antes. |

## Economía y juego

| ID | Idea | Esfuerzo | Detalle |
|---|---|---|---|
| F-EC-01 | **`/diario`** | S | Recompensa diaria que crece con la racha de XP. |
| F-EC-02 | **Eventos temporales** | S | Happy hour de XP ×2, fin de semana con premios del casino subidos (los multiplicadores ya existen). |
| F-EC-03 | **Clasificación semanal con premios** | S | Cada lunes, premio automático al más rico, al más activo y al mejor apostador (con F-AP-03). |
| F-EC-04 | **Duelos de casino entre jugadores** | M | Dados, piedra-papel-tijera o blackjack 1v1, con el dinero retenido (el sistema de partidas en curso ya lo permite). |
| F-EC-05 | **Pase de batalla** | L | Diseñado en [diseno/pase-de-batalla-s1.md](diseno/pase-de-batalla-s1.md). |
| F-EC-06 | **Impuestos, robos y dinero negro** | M | Sobre el efectivo y el banco del [plan de paneles](diseno/reorganizacion-paneles.md#4-plan-de-ejecución) (parte 5): el banco es seguro y el efectivo se puede perder. Robar efectivo a otro, impuestos sobre ingresos o saldo, dinero negro que no se puede ingresar sin "blanquearlo". Por diseñar. |

## Comunidad

| ID | Idea | Esfuerzo | Detalle |
|---|---|---|---|
| F-CO-01 | **Cumpleaños** | S | `/cumple fecha`, felicitación del Duende y regalo de monedas. |
| F-CO-02 | **Recordatorios** | S | `/recuerdame "texto" en 2h`, o pidiéndoselo al Duende en el chat. |
| F-CO-03 | **Encuestas** | S | `/encuesta` con botones y resultado al cerrar. |

## Administración

| ID | Idea | Esfuerzo | Detalle |
|---|---|---|---|
| F-AD-01 | **Alertas por DM al admin** | S | Error nuevo, Odds API con menos de 50 créditos (el dato ya sale en el log), Gemini sin cuota, backup fallido. |
| F-AD-02 | **Resumen semanal para admins** | S | Errores de la semana, créditos de API, uso de Gemini y comandos más usados (datos que ya están en los logs y `/diagnostico`). |
