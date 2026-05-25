# Begroting — MeshGemma

| | |
| --- | --- |
| Project | MeshGemma — smartphone-mesh + LoRa-gateway-pilot |
| Looptijd | 6 maanden vanaf toekenning |
| Aanvragers | Jasper Groen, Guus Adema (natuurlijke personen, niet BTW-plichtig) |
| BTW-status | Alle bedragen **inclusief BTW** |
| Cofinanciering | Nvt — Pioniers vereist dit niet; geen overlappende subsidie aangevraagd. |

## Totaaloverzicht

| Categorie | Bedrag |
| --- | --- |
| 1. Personele uren (eigen tijd) | €8.400,00 |
| 2. Hardware en software | €1.400,00 |
| 3. Reis- en veldwerkkosten | €100,00 |
| 4. Kennisdeling | €100,00 |
| **Totaal aangevraagd** | **€10.000,00** |

> *Verschuiving t.o.v. eerdere concept: de hoofdmoot is naar uren verplaatst, omdat dit hoofdzakelijk software­werk is. Hardware is teruggebracht tot een werkbaar minimum (één gateway, vier knooppunten, één Android-testtoestel). Reis- en kennisdelingsposten zijn realistisch laag gehouden — we doen één veldtest in NL en de demo's primair online + bij een NL-meet-up.*

## 1. Personele uren

We hanteren het SIDN-norm-uurtarief voor intern werk: **€60/uur** (max. volgens [SIDN FAQ](https://www.sidnfonds.nl/faq)). Geen externe inhuur. Wij houden gedurende het project een **urenstaat** bij (wie, wanneer, welk werk) zodat dit in de eindverantwoording reproduceerbaar is.

| Werkpakket | Uren | Bedrag |
| --- | --- | --- |
| WP1 — LoRa-gateway-integratie (firmware, BLE/serial-bridge, envelope-encoding voor LoRa) | 38 | €2.280 |
| WP2 — Interop met MeshCore-preset & bestaande NL-knooppunten | 18 | €1.080 |
| WP3 — Android-client (mesh-transporten, signed envelopes, UI-pariteit) | 34 | €2.040 |
| WP4 — Veldtest 1 (Veluwe-omgeving) — voorbereiding, uitvoering, meting | 14 | €840 |
| WP5 — Veldtest 2 (stedelijk) — voorbereiding, uitvoering, meting | 10 | €600 |
| WP6 — Documentatie, eindrapport, demo/lezing, release | 26 | €1.560 |
| **Subtotaal uren** | **140** | **€8.400** |

Verdeling over 2 teamleden = gemiddeld 70 uur per persoon over 6 maanden, ofwel ~12 uur per maand. Realistische parttime studentinzet naast studie.

## 2. Hardware en software

Werkbaar minimum voor een geloofwaardige LoRa-pilot:

| Post | Spec / motivatie | Bedrag |
| --- | --- | --- |
| 4× LoRa-knooppunten (Heltec V3 of vergelijkbaar) | ~€40 p/s. Voor multi-hop- en gateway-redundantietest. | €160 |
| 1× LoRa-gateway (RAK WisGate Edge Lite of vergelijkbaar) | Voor het bench- en stedelijke testopstelling. | €280 |
| Antennes (868 MHz), kabels, SMA-connectoren, behuizingen | Veldbestendig. | €200 |
| 1× Android-testtoestel (mid-range, refurbished) | Cross-platform interop testen; tweede Android lenen uit eigen kring/team. | €350 |
| Apple Developer Program | €99 / jaar — noodzakelijk om de iOS-app op fysieke toestellen te draaien en te distribueren. | €99 |
| Google Play Developer (eenmalig) | $25 voor Android-distributie. | €25 |
| Klein materiaal: USB-kabels, SD-kaarten, soldeer-/testbenodigdheden | | €100 |
| Powerbanks (2× 20.000 mAh) | Voor off-grid veldtests; tweede set uit eigen voorraad. | €80 |
| Reservebudget hardware | Buffer voor uitval/breuk in veld (~7%). | €106 |
| **Subtotaal hardware/software** | | **€1.400** |

Alle hardware blijft eigendom van het project en is na afloop beschikbaar voor een eventueel vervolg of voor donatie aan een Nederlandse mesh-community (LocalMesh, DARES) — we melden dit in de eindverantwoording.

## 3. Reis- en veldwerkkosten

| Post | Bedrag |
| --- | --- |
| Brandstof / OV: één veldtest Veluwe (heen en terug) + één lokale stedelijke test | €80 |
| Catering tijdens veldtest met testvrijwilligers | €20 |
| **Subtotaal reis/veld** | **€100** |

Bewust laag gehouden: we doen één gerichte NL-veldtest en houden overleg met partners online.

## 4. Kennisdeling

| Post | Bedrag |
| --- | --- |
| Hosting & domein van een eenvoudige projectpagina (3 jaar `.nl`) | €40 |
| Drukwerk / hand-outs voor demo en/of lezing | €30 |
| Catering bij één eindlezing/demo-avond | €30 |
| **Subtotaal kennisdeling** | **€100** |

## Wat we **niet** in deze begroting opvoeren

- Hackathon-werk (april–mei 2026). Conform SIDN-regels worden kosten van vóór de toekenning niet meebegroot.
- Structurele organisatie- of overheadkosten.
- Salaris of vaste uren niet-toerekenbaar aan het project.
- Inhuur van externe ontwikkelaars (we doen het zelf en zijn binnen het max. interne tarief).

## Afwijkingen en rapportage

Conform de Algemene voorwaarden melden we afwijkingen in scope/planning/budget zodra die bekend zijn. Bij afwijking >20% op een categorie in de eind­verantwoording lichten we die expliciet toe. Restant­bedragen die niet projectmatig zijn besteed worden teruggestort.

## Onderbouwing voor SIDN-beoordelaar

- **Verhouding uren vs. middelen:** uren-aandeel is 84%. Bewust hoog: dit is hoofdzakelijk softwarewerk; hardware is enabler en blijft op een werkbaar minimum.
- **Tarief:** €60 intern, conform [SIDN-norm](https://www.sidnfonds.nl/faq); geen commercieel tarief.
- **BTW:** als natuurlijke personen / studenten zijn we niet BTW-plichtig — alle bedragen zijn incl. BTW (wat we feitelijk betalen aan onze leveranciers).
- **Geen retroactieve kosten:** alle begrote uren en aankopen vallen na een eventuele toekenning.
