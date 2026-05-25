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
| 1. Personele uren (eigen tijd) | €7.500,00 |
| 2. Hardware en software | €2.000,00 |
| 3. Reis- en veldwerkkosten | €300,00 |
| 4. Kennisdeling | €200,00 |
| **Totaal aangevraagd** | **€10.000,00** |

## 1. Personele uren

We hanteren het SIDN-norm-uurtarief voor intern werk: **€60/uur** (max. volgens [SIDN FAQ](https://www.sidnfonds.nl/faq)). Geen externe inhuur. Wij houden gedurende het project een **urenstaat** bij (wie, wanneer, welk werk) zodat dit in de eindverantwoording reproduceerbaar is.

| Werkpakket | Uren | Bedrag |
| --- | --- | --- |
| WP1 — LoRa-gateway-integratie (firmware, BLE/serial-bridge, envelope-encoding voor LoRa) | 35 | €2.100 |
| WP2 — Interop met MeshCore-preset & bestaande NL-knooppunten | 15 | €900 |
| WP3 — Android-client (mesh-transporten, signed envelopes, UI-pariteit) | 30 | €1.800 |
| WP4 — Veldtest 1 (Veluwe) — voorbereiding, uitvoering, meting | 15 | €900 |
| WP5 — Veldtest 2 (stedelijk) — voorbereiding, uitvoering, meting | 10 | €600 |
| WP6 — Documentatie, eindrapport, demodag, release | 20 | €1.200 |
| **Subtotaal uren** | **125** | **€7.500** |

Verdeling over 2 teamleden = gemiddeld ~62 uur per persoon over 6 maanden, ofwel ~10 uur per maand. Realistische parttime studentinzet naast studie.

## 2. Hardware en software

| Post | Spec / motivatie | Bedrag |
| --- | --- | --- |
| 4× LoRa-knooppunten (Heltec V3 of vergelijkbaar) | ~€40 p/s. Voor gateway-redundantie en multi-hop-test. | €160 |
| 1× LoRa-gateway (RAK WisGate Edge Lite of vergelijkbaar) | Voor het bench- en stedelijke testopstelling. | €280 |
| Antennes (868 MHz), kabels, behuizingen | Veldbestendig, met SMA-connectoren. | €240 |
| 2× Android-testtoestellen (mid-range, refurbished) | Cross-platform interop niet betrouwbaar te testen met één model. | €700 |
| Apple Developer Program | €99 / jaar — noodzakelijk om de iOS-app op fysieke toestellen te draaien en te distribueren. | €99 |
| Google Play Developer (eenmalig) | $25 voor Android-distributie. | €25 |
| Powerbanks + veldlading (4× 20.000 mAh) | Voor de off-grid veldtests. | €160 |
| Klein materiaal: SD-kaarten, behuizingen, soldeer- en testbenodigdheden | | €136 |
| Reservebudget hardware | Buffer voor uitval/breuk in veld. | €200 |
| **Subtotaal hardware/software** | | **€2.000** |

Alle hardware blijft eigendom van het project en is na afloop beschikbaar voor een eventueel vervolg of voor donatie aan een Nederlandse mesh-community (LocalMesh, DARES) — we melden dit in de eindverantwoording.

## 3. Reis- en veldwerkkosten

| Post | Bedrag |
| --- | --- |
| OV / brandstof: 2 reizen Veluwe-veldtest + 2 reizen partneroverleg (Waag Amsterdam, LocalMesh-community, SIDN Arnhem) | €240 |
| Eten/drinken tijdens een hele dag veldtest met vrijwilligers | €60 |
| **Subtotaal reis/veld** | **€300** |

## 4. Kennisdeling

| Post | Bedrag |
| --- | --- |
| Hosting & domein van een eenvoudige projectpagina (3 jaar `.nl`) | €40 |
| Drukwerk hand-outs voor demodag + reiskosten gastspreker (kostenvergoeding) | €100 |
| Catering bij eindlezing/demodag | €60 |
| **Subtotaal kennisdeling** | **€200** |

## Wat we **niet** in deze begroting opvoeren

- Hackathon-werk (april–mei 2026). Conform SIDN-regels worden kosten van vóór de toekenning niet meebegroot.
- Structurele organisatie- of overheadkosten.
- Salaris of vaste uren niet-toerekenbaar aan het project.
- Inhuur van externe ontwikkelaars (we doen het zelf en zijn binnen het max. interne tarief).

## Afwijkingen en rapportage

Conform de Algemene voorwaarden melden we afwijkingen in scope/planning/budget zodra die bekend zijn. Bij afwijking >20% op een categorie in de eind­verantwoording lichten we die expliciet toe. Restant­bedragen die niet projectmatig zijn besteed worden teruggestort.

## Onderbouwing voor SIDN-beoordelaar

- **Verhouding uren vs. middelen:** uren-aandeel is 75%. Bewust: dit is hoofdzakelijk softwarewerk, hardware is enabler.
- **Tarief:** €60 intern, conform [SIDN-norm](https://www.sidnfonds.nl/faq); geen commercieel tarief.
- **BTW:** als natuurlijke personen / studenten zijn we niet BTW-plichtig — alle bedragen zijn incl. BTW (wat we feitelijk betalen aan onze leveranciers).
- **Geen retroactieve kosten:** alle begrote uren en aankopen vallen na een eventuele toekenning.
