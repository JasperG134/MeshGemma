# Projectplan — MeshGemma

**Een offline mesh-app voor smartphones die berichten over LoRa-radio's blijft versturen wanneer het reguliere netwerk uitvalt.**

| | |
| --- | --- |
| Aanvragers | Jasper Groen, Guus Adema (natuurlijke personen, studenten) |
| Fonds & regeling | SIDN fonds — Pioniers |
| Gevraagd bedrag | €10.000 incl. BTW |
| Looptijd | 6 maanden vanaf toekenning |
| Focusgebied | Sterk internet |
| Repository | <https://github.com/JasperG134/MeshGemma> (open source, CC-BY 4.0) |
| Hackathon-demo | <https://www.youtube.com/watch?v=gJu21-9NuGc> |

---

## 1. Aanleiding — eerlijk verhaal

Wij hebben MeshGemma gebouwd voor *The Gemma 4 Good Hackathon* van Kaggle, met de gedachte dat Google's nieuwe edge-AI Gemma 4 lokaal op een telefoon iets nuttigs kan doen tijdens een ramp. Tijdens het bouwen zijn we doorgeschoten: in plaats van alleen een AI-assistent hebben we een werkend, gesigneerd peer-to-peer **mesh-netwerk** geïmplementeerd waarmee iPhones elkaar in vliegtuigstand vinden, incident-meldingen ondertekenen en doorgeven over meerdere hops, en op een offline kaart tonen.

Het werkt — maar nog niet zoals we willen. Twee belangrijke beperkingen die we open op camera benoemen:

1. **De radio-uplink is gesimuleerd.** De AI comprimeert echt situatie­meldingen tot een JSON-payload van ≤200 bytes, maar de "TRANSMIT @ 868 MHz"-stap is een eerlijk gelabelde animatie. Er zit nog geen echte LoRa-radio aan de telefoon vast.
2. **De app is iOS-only.** Het transport via Apple's MultipeerConnectivity is een eigen Swift-module, en daardoor doet Android niet mee. Dat sluit het overgrote deel van de Nederlandse telefoongebruikers uit.

Dit projectplan vraagt de financiering die nodig is om die twee gaten te dichten, en het geheel voor het eerst in Nederland in het veld te testen.

## 2. Het probleem — waarom dit ertoe doet in Nederland

> *"Het is niet de vraag óf het communicatienetwerk uitvalt, maar wanneer."*
> — Ton Verlind, journalist en oud-mediabestuurder, in [Spreekbuis.nl](https://www.spreekbuis.nl/het-is-niet-de-vraag-of-het-communicatienetwerk-uitvalt-maar-wanneer/), 2026.

De afhankelijkheid van het reguliere telefoon- en internetnetwerk is een erkend risico in het Nederlandse crisisbeheersingsbeleid. De bronnen liggen op tafel:

- Het hulpverlenings­communicatie­systeem **C2000** en de back-up **Noodcommunicatievoorziening (NCV)** vallen beide na maximaal **acht uur** uit bij een langdurige stroomstoring. "Oplossing niet in zicht", oordeelt NOS Nieuwsuur (mei 2025, [bron](https://nos.nl/nieuwsuur/artikel/2607176)).
- Het Nederlands Instituut Publieke Veiligheid (NIPV) noemt uitval van vitale telecom­diensten één van de zes belangrijkste risico's voor de Nederlandse veiligheidsregio's ([NIPV — Vitale infrastructuur](https://nipv.nl/vitale-infrastructuur/)).
- De Rijksoverheid benoemt internet- en telefonie-uitval expliciet als crisisrisico in haar publieke voorlichting ([Rijksoverheid — Dreiging in Nederland](https://www.rijksoverheid.nl/onderwerpen/dreiging-in-nederland/energie-drinkwater-internet-zorg-bereikbaarheid-tijdens-crisis)).
- Het scenario is geen abstractie: op 29 april 2026 brak op de Noord-Veluwe de grootste Nederlandse natuurbrand in vijftig jaar uit (~500 ha), met internationale brandweerinzet uit Duitsland en Frankrijk. De droogte van 2026 maakt dit soort grootschalige incidenten waarschijnlijker — en dat is precies waar regulier communicatie­netwerk lokaal onbruikbaar wordt.
- Het scenario van een door een overheid uitgezet internet (bij protesten of geopolitieke escalatie) is in landen om ons heen geen abstractie meer. Een burgerlijk back-up­netwerk waarin **niemand een aan/uit-knop heeft** is een serieuze maatschappelijke waarde.

Het bestaan van het Nederlandse vrijwilligers­initiatief [LocalMesh / MeshCore-NL](https://www.localmesh.nl), dat in 2025–26 explosief groeide en al wordt getest door veiligheidsregio's (THISLINE, [Wat als alle communicatie uitvalt?](https://thisline.eu/wat-als-alle-communicatie-uitvalt-meshcore-uitgelegd/)), is een onafhankelijk bewijs dat het probleem reëel is en dat burgers er nu zelf naar grijpen. Aan dat momentum willen wij een laag toevoegen — geen vervanging, een aanvulling.

## 3. Onze hypothese en hoe we ons positioneren

SIDN fonds heeft hier al een projectfinanciering lopen: [Waag — MeshTesting](https://waag.org/en/project/meshtesting/) (1 sep 2025 – 31 jan 2026) onderzoekt "hoe mesh-netwerken kunnen bijdragen aan een sterker decentraal internet" door use cases met gebruikersgroepen te co-creëren rond **standalone Meshtastic LoRa-knooppunten**. Hun publieke documentatie loopt via [Fablab Amsterdam](https://fablab.waag.org/Projects/bob/meshtastic/) en het naburige [Blackout-project](https://fablab.waag.org/Projects/bob/blackout/) over communicatie tijdens stroomuitval.

Onze hypothese vult daarop aan: **mesh-radio wordt pas massaal bruikbaar wanneer een burger geen aparte LoRa-radio meer hoeft te kopen of te configureren.** Eén LoRa-gateway per groep, wijk of buurthuis, en de rest doet zijn telefoon. De drempel verschuift van "een radio kopen, antenne afregelen, MQTT-server begrijpen" naar "een app installeren". De AI op het toestel comprimeert lange situatie­meldingen tot kleine LoRa-payloads en kan offline eerste-hulp-vragen beantwoorden.

We zijn dus expliciet **complementair** aan MeshTesting, niet concurrerend. MeshTesting inventariseert de use cases voor de mensen die *al* een radio hebben; wij verlagen de drempel voor iedereen die er geen heeft.

## 4. Wat we al hebben (de hackathon-bouwsteen)

Tijdens de Gemma 4 Good Hackathon (Kaggle, mei 2026) hebben we het volgende werkend gekregen, en het is allemaal open source:

- **Gesigneerde mesh** — `SignedEnvelope` met Ed25519 (tweetnacl) en Lamport-klok; ontvangers dedupliceren en verifiëren elk bericht. Twee transporten naar één afhandelaar: TCP-over-mDNS met multi-hop-forwarding **en** Apple MultipeerConnectivity via een eigen Swift-module.
- **On-device Gemma 4 E2B** — multimodaal model (~3,28 GB) draait via llama.rn (llama.cpp) met alle lagen op de iOS Metal GPU. 4096-token context. Foto-analyse, eerste-hulp-tekstuitleg, en compressie van 50 mesh-records naar een streng schema van ≤200 bytes.
- **Offline tactische kaart** — MapLibre met voor­ge­cached­e OSM-tegels; kleur­gecodeerde incident-pins en live peer-stippen.
- **Bewezen op echte hardware** — getest met iPhone XR, iPhone 15 Pro en iPhone 13 mini in één off-grid mesh.
- **Eerlijk over wat nog niet werkt** — TX-knop toont een persistent banner "GESIMULEERD", BLE is alleen presence-only, en de app is iOS-only.

Inhoudelijke documentatie: [`ARCHITECTURE.md`](https://github.com/JasperG134/MeshGemma/blob/main/ARCHITECTURE.md) en [`DEMO_RUNBOOK.md`](https://github.com/JasperG134/MeshGemma/blob/main/DEMO_RUNBOOK.md).

## 5. Doelen voor deze 6 maanden

**Hoofddoel:** een eerlijke veldpilot in Nederland waarbij groepen smartphones via een echte LoRa-gateway berichten uitwisselen op een afstand groter dan de directe Bluetooth-range, zonder enige andere infrastructuur.

**Concrete subdoelen, gefaseerd:**

| Maand | Activiteit | Tastbaar resultaat |
| --- | --- | --- |
| 1 | LoRa-gateway-hardware (Heltec/RAK), antennes, behuizing en één Android-testtoestel aanschaffen. Eerste prototype van een serial/BLE-bridge die `SignedEnvelope` op LoRa zet en omgekeerd. | Werkende bench-test: één telefoon → gateway → tweede telefoon via LoRa. |
| 2 | Bridge interoperabel maken met **MeshCore**-frequentie/preset (SF7/CR5, 868 MHz) zodat onze envelopes ook over bestaande burger-mesh-knooppunten kunnen reizen. | MeshGemma-bericht ontvangen op een commerciële MeshCore-node. |
| 2–3 | Android-client (Bluetooth Classic + WiFi-Direct + TCP-mDNS). Cross-platform interop met iOS-client. | Eén iOS + één Android in dezelfde mesh, signed berichten over en weer. |
| 3–4 | Veldtest op of bij de Veluwe (waar we de hackathon-demo opnamen): 3–4 LoRa-gateways uitgezet over enkele kilometers, 3–4 telefoons, één geënsceneerd "ramp"-scenario. Logging en metingen. | Korte technische rapportage. |
| 4–5 | Schaal- en interop-experiment in stedelijk gebied (Arnhem — naast het SIDN-kantoor; of een hackerspace): dichtheid, congestie, en interop met bestaande LocalMesh-dekking. | Open meetdata: latency, packet loss, batterijverbruik. |
| 5–6 | Eindrapport, code release, demonstratie/lezing bij DARES- of LocalMesh-community, publicatie op de bestaande NL-mesh-fora. | Publieke kennisdeling — verplicht voor Pioniers, en de leukste fase. |

**Wat we *niet* doen** in deze ronde, om scope realistisch te houden: groepskanaal-management op MeshCore-niveau, voice/audio over LoRa, en commercialisering. We blijven een experimentele pilot — Pioniers-scope.

## 6. Innovatie

MeshGemma combineert drie domeinen die in Nederland tot nu toe los van elkaar bestaan:

1. **Smartphone-mesh** — gesigneerde peer-to-peer messaging in vliegtuigstand (vergelijkbaar met Bridgefy / Briar, maar open source en met Ed25519-signatures op envelope-niveau).
2. **LoRa-mesh** — MeshCore/Meshtastic/MeshTesting-werelden, nu nog vrijwel uitsluitend toegankelijk voor radio-amateurs.
3. **On-device LLM** — Gemma 4 E2B op het toestel, voor offline eerste-hulp-uitleg én voor agressieve compressie van mensentekst naar radio-payload.

De brug tussen (1) en (2) — een burger met alleen een telefoon kan deelnemen aan een LoRa-mesh via één gateway in de wijk — bestaat voor zover wij hebben kunnen vinden nog niet in een open vorm in Nederland. De brug van (3) richting (2) — een LLM als bandbreedte-compressor voor radio — is in deze toepassing volgens onze literatuurscan ook nieuw.

## 7. Maatschappelijke meerwaarde & Sterk internet

Het project hoort thuis in SIDN's focusgebied **Sterk internet**: een open, vrij, veerkrachtig internet dat ook bestaat wanneer het reguliere netwerk weg is. Concreet:

- **Geen aan/uit-knop.** Het netwerk wordt niet centraal beheerd; geen provider, geen overheid en geen aanvaller kan het uitschakelen.
- **Open en verifieerbaar.** Iedere envelope is met een publieke sleutel ondertekend; nepberichten worden bij ontvangst gefilterd. Open source, dus reviewbaar.
- **Inclusief.** Door telefoons als front-end te gebruiken, is deelname niet voorbehouden aan radio-amateurs.
- **Niet voor één bedrijf.** Het resultaat is publiek goed: alle code onder MIT/Apache, alle documentatie onder CC-BY 4.0.

Doelgroepen: (a) burgers in een Nederlandse veiligheidsregio die zich willen voorbereiden op langdurige uitval; (b) vrijwillige radio-amateurs (DARES) en de LocalMesh-/MeshCore-NL-community die op zoek zijn naar een laagdrempelige aanvullingslaag bovenop hun bestaande knooppunten; (c) ontwikkelaars en onderzoekers in het bredere Meshtastic-/MeshTesting-ecosysteem.

## 8. Kennisdeling

Verplicht voor Pioniers, en wij doen het graag. Concreet:

- Code en custom Swift/Kotlin-modules op GitHub onder MIT/Apache 2.0 (zoals nu al).
- Documentatie (architectuur, build-runbook, veldmetingen, open meetdata) onder CC-BY 4.0 in dezelfde repository.
- Korte demo + lezing bij minimaal twee gelegenheden: een radio-amateurclub / DARES-bijeenkomst, en een Nederlands tech-/open-source-evenement (of online).
- Een schriftelijk eindrapport waarin we *ook* delen wat níet werkte. Pioniers financiert experimenten; een eerlijk negatief resultaat is voor de community minstens zo nuttig als een positief.
- Een blogpost over de bridge naar MeshCore zodat de bestaande LocalMesh-community direct iets in handen heeft.

## 9. Team & samenwerking

**Kern (2 personen):**

- **Jasper Groen** — full-stack/iOS, AI-on-device. Bouwde de hackathon-prototype mesh-laag (signed envelopes, MultipeerConnectivity, llama.rn-integratie).
- **Guus Adema** — full-stack, native modules. Bouwde de offline kaart, BLE-radar en het radio-compression-paneel.

**Verankering in de Nederlandse internetsector:**

We bouwen voort op de publiek beschikbare resultaten van Waag's MeshTesting-project en op het werk van de LocalMesh-/MeshCore-NL-community. Wij willen dat onze interop-bridge naar MeshCore door die community gereviewd en op den duur geadopteerd kan worden — daarom kiezen we hun frequentie­preset (SF7/CR5, 868 MHz) en publiceren we onze code en meetdata open onder dezelfde licenties die zij hanteren.

## 10. Risico's en hoe we daarmee omgaan

| Risico | Waarschijnlijk­heid | Hoe we ermee omgaan |
| --- | --- | --- |
| LoRa-interop met MeshCore blijkt complexer dan ingeschat (verschillende preset/frequentie/MQTT-conventies). | Middel | Eerst aansluiten op de gangbare MeshCore-preset (SF7/CR5, 868 MHz). Als interop met het publieke netwerk niet binnen scope past, valt het project terug op een eigen LoRa-kanaal en demonstreert dáár de bridge. |
| Android cross-platform mesh blijkt te ambitieus voor 6 maanden. | Middel | Minimum-scope: signed berichten via Wi-Fi/TCP+mDNS en een gateway-modus. Bluetooth-Direct alleen als de tijd het toelaat. |
| Veld­pilot kan niet doorgaan (toestemming, weer, hardware). | Laag-middel | Twee back-up-locaties (Veluwe en stedelijk) en bench-meting als basislijn. |
| Een van de twee teamleden valt uit. | Laag-middel | Bij langere uitval melden we het direct bij SIDN conform Art. 7 algemene voorwaarden en stellen herplanning voor; eventueel een externe vrijwilliger uit de LocalMesh-community om door te bouwen. |
| Verwachtingsmanagement: het kan na 6 maanden nog steeds niet bruikbaar zijn voor het grote publiek. | Hoog (en dat is OK) | Pioniers financiert experimenteel ontwerp. We rapporteren eerlijk wat we leerden, ook bij tegenvallend resultaat. |

## 11. Aanvrager­ver­plich­tingen

Wij dienen als natuurlijke personen in en verklaren akkoord met de [Algemene voorwaarden bij toekenning](https://assets.ctfassets.net/6j4v63szj8fn/VqquhkPQR27w1AsV0PfE1/9b7f80e69a8d32ee0e134310d4d2b893/Algemene_voorwaarden_bij_toekenning_SIDN_fonds_26.pdf): 80%/20%-uitbetaling, eindverantwoording binnen 3 maanden na afronding, melding van wijzigingen in scope/planning/budget zodra bekend, vrijwaring van SIDN voor claims van derden, en open kennisdeling.

Het project is **eerstdaags na toekenning** te starten en binnen 6 maanden af te ronden. Op het moment van toekenning is het project nog niet begonnen — alle in dit plan begrote kosten zijn toekomstige kosten.

---

*Bijlagen: `begroting.md` (verplicht), `videopitch.md` (script). Aanvullend intern: `quickscan-zelfcheck.md`, `bronnen.md`.*
