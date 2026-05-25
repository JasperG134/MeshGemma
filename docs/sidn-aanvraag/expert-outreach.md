# Expert-outreach — gesprekken op 26 mei 2026

Doel: minimaal **één** Nederlandse expert die we in het projectplan (en eventueel als adviseur in het team) kunnen citeren over: (a) de realiteit van langdurige communicatie-uitval in Nederland, (b) de waarde van een mesh + LoRa-gateway-laag, en (c) of een laagdrempelige smartphone-front-end een legitiem gat dicht. Eén goed citaat = drie placeholders gevuld in het projectplan.

## Doelpersonen, gerangschikt naar haalbaarheid

| # | Persoon / partij | Waarom | Hoe bereiken |
| --- | --- | --- | --- |
| 1 | **Waag — MeshTesting-projectteam** | Net afgerond SIDN-Pioniers-project op exact dit terrein. Meest natuurlijke "naburige" partij. Een korte review van hun kant is goud. | <https://waag.org/en/contact/>, of via een MeshTesting-contactpersoon op de projectpagina; LinkedIn. |
| 2 | **LocalMesh.nl / MeshCore-NL community** | Lopen actief op het terrein, hebben coverage-kaarten en regelmatig overleg met veiligheidsregio's. Niet "officieel", wel geloofwaardig en getalsmatig groot. | Contact via <https://www.localmesh.nl> of de community-Discord/Matrix; vermeld onze SIDN-aanvraag. |
| 3 | **DARES (Dutch Amateur Radio Emergency Service)** | Officiële vrijwilligers-noodcommunicatie, zit op LoRa én HF. Een dragend citaat van een DARES-coordinator van een veiligheidsregio is bijzonder krachtig. | Via VERON / DARES-coordinator van Gelderland of NoordOost-Gelderland; e-mail. |
| 4 | **Ton Verlind** | Heeft hét quotable artikel ("niet de vraag óf, maar wanneer"). Niet *zelf* radio-expert maar een gevestigde mediastem. Een korte instemming dat hij geciteerd mag worden is voldoende. | <https://www.tonverlind.com/contact> (of via Spreekbuis-redactie). |
| 5 | **NIPV — onderzoeker Crisiscommunicatie** | Officiële kennisinstelling van veiligheidsregio's. Lange route, maar hoog gezag als het lukt. | Via NIPV-website, contactformulier "onderzoek crisiscommunicatie". |
| 6 | **Veiligheidsregio NoordOost-Gelderland** (Veluwe-context) of **Veiligheidsregio Gelderland-Zuid** (Arnhem-context) | Lokaal, direct relevant voor pilot­locaties. Vraag is bescheiden: niet-bindende steunbetuiging op briefpapier. | Algemene communicatie / risicocommunicatie / contactformulier; via gemeente Apeldoorn of Arnhem. |

> **Strategie:** stuur vanavond aan #1, #2 en #3 een mail. Vraag bij allen een korte (15 min) videocall morgen. Eén positief gesprek is genoeg; meerdere is een pré maar geen voorwaarde.

---

## Mailtemplate A — Waag MeshTesting

**Onderwerp:** Korte vraag — voortzetting van MeshTesting met smartphones en on-device AI

Beste [naam],

Wij zijn Jasper Groen en Guus Adema, twee studenten. Tijdens *The Gemma 4 Good Hackathon* hebben we een offline mesh-app gebouwd waarin iPhones zonder enig netwerk gesigneerde berichten uitwisselen en Google's Gemma 4 op het toestel draait — onder andere om situatie­meldingen te comprimeren tot een payload die op een LoRa-radio past. Repo: <https://github.com/JasperG134/MeshGemma>; hackathon-demo: <https://www.youtube.com/watch?v=gJu21-9NuGc>.

Wij overwegen via SIDN fonds Pioniers een vervolgsubsidie aan te vragen voor een veld­pilot in Nederland: echte LoRa-gateways, interoperabel met MeshCore, plus een Android-client. We zien dat als logische voortzetting van jullie MeshTesting-project: jullie hebben de use cases voor standalone LoRa-knooppunten in kaart gebracht; wij willen de smartphone-laag bouwen zodat burgers zonder eigen radio kunnen deelnemen via één wijk-gateway.

Drie korte vragen waar we morgen graag 10–15 minuten over zouden videobellen:

1. Klopt onze positionering — is dit voor jullie een logisch *complementair* vervolg, of zien jullie overlap?
2. Mogen we MeshTesting in onze aanvraag noemen als beïnvloeding/inspiratie en zou een korte review-zin van een MeshTesting-deelnemer mogelijk zijn?
3. Wie zou jullie aanbevelen als Nederlandse adviseur voor het project?

Voor de helderheid: we gaan jullie naam niet zonder toestemming aan onze aanvraag verbinden. Dit is alleen een aftasting.

Veel dank — Jasper & Guus
[telefoonnummer]
[github / linkedin]

---

## Mailtemplate B — LocalMesh / MeshCore-NL community

**Onderwerp:** Smartphones + Gemma 4 + LoRa-gateway — eerlijke vraag aan de community

Hoi LocalMesh-vrijwilligers,

Wij zijn Jasper en Guus, twee studenten die voor de Gemma 4 Good Hackathon een offline mesh-app voor iPhone hebben gebouwd. Werkend prototype, getest in vliegtuigstand met meerdere toestellen, **maar**: de "TX naar LoRa" is op dit moment een eerlijk gelabelde animatie. Er hangt nog geen echte radio aan.

Voor SIDN fonds Pioniers willen we daar verandering in brengen: één LoRa-gateway in een wijk, telefoons als front-end, on-device AI die berichten comprimeert. Idee: de bridge spreekt MeshCore (SF7/CR5, 868 MHz) zodat onze envelopes via jullie bestaande dekking kunnen reizen.

Twee vragen aan jullie als de mensen die het echte werk doen:

1. Wat zien jullie als de grootste praktische valkuilen (regelgeving, congestie, preset-keuze)?
2. Zou iemand van jullie morgen 15 minuten met ons willen videobellen om dit eerlijk door te praten? We citeren niemand zonder akkoord, we willen vooral niet door jullie heen werken.

Code en docs staan hier: <https://github.com/JasperG134/MeshGemma>. Demo: <https://www.youtube.com/watch?v=gJu21-9NuGc>.

73's en alvast dank — Jasper & Guus

---

## Mailtemplate C — DARES-coordinator regio Gelderland

**Onderwerp:** Pioniers-aanvraag SIDN — smartphone-laag op een LoRa-mesh, kort advies gevraagd

Geachte [naam] / DARES-coordinator,

Wij zijn twee Nederlandse studenten met een werkend hackathon-prototype van een offline mesh-app voor smartphones (signed berichten, on-device AI voor compressie en eerste-hulp-uitleg). We willen via SIDN fonds Pioniers een 6-maandse pilot vragen om er een **echte LoRa-gateway** aan te koppelen, interoperabel met MeshCore. Smartphone-front-end + één radio per wijk = zonder LoRa-radio-aankoop deelnemen aan het noodnet.

Onze vraag aan u, als iemand die het echte noodcommunicatie-werk in Nederland doet:

1. Is dit voor DARES-doeleinden een potentieel nuttige laagdrempelige uitbreiding op de bestaande infrastructuur (C2000/NCV/HF/LoRa), of zien wij iets fundamenteels over het hoofd?
2. Mogen wij u (in algemene termen) als beoogde adviseur opnemen in de SIDN-aanvraag, met als enige verplichting een 15-min review-gesprek per maand?
3. Heeft u tijd voor een korte videocall op woensdag of donderdag (15 min)?

Repo en demo voor context: <https://github.com/JasperG134/MeshGemma> · <https://www.youtube.com/watch?v=gJu21-9NuGc>.

Met vriendelijke groet,
Jasper Groen, Guus Adema

---

## Tijdens het gesprek — vragen die het projectplan vullen

Eén focus per gesprek; opname **niet** zonder toestemming. Doel is één bruikbare zin per expert.

1. *(Voor het probleem.)* "Vanuit uw werk: hoe vaak en hoe lang valt in Nederland de civiele communicatie écht onbeschikbaar — en hoe ernstig schat u dat in?" → één-zinscitaat voor §2 van het projectplan.
2. *(Voor de oplossingsruimte.)* "Bestaande LoRa-mesh-initiatieven (MeshCore, MeshTesting) vragen elke deelnemer om een eigen radio. Lost dat het echt op? Of is een smartphone-laag een echte aanvullings­ruimte?" → één-zinscitaat voor §6 / innovatie.
3. *(Voor de maatschappelijke meerwaarde.)* "Hoe groot schat u de inclusie-winst in als deelname mogelijk wordt met alleen een telefoon, geen eigen radio?" → één-zinscitaat voor §7.
4. *(Adviseurschap.)* "Onder welke voorwaarden zou u willen optreden als adviseur in onze SIDN-aanvraag?" — kosten via SIDN-norm voor externe uren (€90/uur), of zonder vergoeding maar met co-author-credit op het eindrapport.

## Wat we de expert teruggeven

- Vooraf inzage in de versie van het projectplan waarin hun citaat staat.
- Optie om uit het project te stappen vóór indienen.
- Co-credit (of anonimiteit) in het eindrapport.
- Een uur van onze tijd om iets in hun eigen vrijwilligers-/onderzoekswerk te helpen, achteraf.

## Wat we *niet* van de expert vragen

- Geen financiële garanties of co-financiering.
- Geen "het werkt en het is veilig" — dat moeten we zelf bewijzen in de pilot.
- Geen formele aansprakelijkheid.
