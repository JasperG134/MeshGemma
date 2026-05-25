# SIDN fonds — Pioniers aanvraag (MeshGemma)

Werkmap voor de **Pioniers-aanvraag** bij [SIDN fonds](https://www.sidnfonds.nl/aanvragen/pioniers) (tot €10.000, doorlopende call). Alles in deze map is in het Nederlands omdat fonds, FundPro-systeem en eindverantwoording in het Nederlands zijn.

## Inhoud

| Bestand | Wat het is |
| --- | --- |
| `projectplan.md` | **Verplichte bijlage** — max. 4 A4. De kern van de aanvraag. |
| `begroting.md` | **Verplichte bijlage** — onderbouwde kostenraming, totaal €10.000 incl. BTW. |
| `videopitch.md` | **Verplichte bijlage** — hybride remix-plan: hackathon-video als middenmoot + NL intro+outro + NL voice-over. |
| `quickscan-zelfcheck.md` | Interne check tegen de 7 officiële SIDN Quickscan-vragen (verbatim) voordat we indienen. |
| `expert-outreach.md` | Beslissing: **geen** outreach. Lijst met publieke bronnen die we citeren in plaats van mensen te benaderen. |
| `bronnen.md` | Alle citaten en links die het projectplan gebruikt. |

## Status & nog te doen (per 25 mei 2026)

- [x] Onderzoek SIDN-regels en naburig Waag MeshTesting-project (vóór schrijven).
- [x] Concept projectplan, begroting, videopitch-plan, Quickscan-zelfcheck en bronnen.
- [x] Beslissing: **geen outreach** — publieke citaten zijn voldoende; risico van ongevraagde mail > opbrengst.
- [x] Begroting herschaald naar **84% uren / €60·140u = €8.400 + €1.400 hardware + €100 reis + €100 kennisdeling**.
- [x] Videopitch herzien naar **hybride remix** in plaats van scratch-opname.
- [ ] **Vandaag** — Quickscan invullen op <https://www.sidnfonds.nl/quickscan> (antwoorden klaar in `quickscan-zelfcheck.md`).
- [ ] **Vandaag/morgen** — eventueel idee pre-testen via "Toets je idee" <https://www.sidnfonds.nl/aanvragen/pitchjeidee>.
- [ ] **Productie** — videopitch opnemen volgens hybride plan in `videopitch.md`.
- [ ] **Indienen** via FundPro <https://fundpro.se/calls/2504> als **natuurlijke personen** (geen KvK / jaarrekening nodig).

## Strategie in één paragraaf

We pitchen MeshGemma **eerlijk**: gebouwd in een hackathon met Gemma 4 in het middelpunt, daarna doorgeschoten en een werkend mesh-prototype gebouwd dat *nog niet* doet wat we willen — de "radio-uplink" is nu een gelabelde animatie en de app is iOS-only. **Precies dáár vragen we de subsidie voor**: echte LoRa-radio's (gateway-coupling met MeshCore/Meshtastic), Android-client, en een veldpilot in Nederland. Dat past één-op-één op de Pioniers-definitie: *"een belofterijk idee met een sterk team uitwerken tot een demo, pilot of experimenteel ontwerp."*

## Verhouding tot het Waag MeshTesting-project

SIDN fonds heeft Waag's [MeshTesting](https://waag.org/en/project/meshtesting/) (1 sep 2025 – 31 jan 2026) al gefinancierd. **Dat is voor ons goed nieuws, geen probleem**:

- Waag onderzocht use cases voor **standalone Meshtastic LoRa-knooppunten** (apparaten op zichzelf, ~€35 per stuk, configuratie via amateurkanalen).
- MeshGemma is de **laag erbovenop**: gewone smartphones als interface, on-device AI, en **één LoRa-gateway per groep/wijk** in plaats van één radio per burger. Dat is wat het massaal bruikbaar maakt.
- In het projectplan citeren we MeshTesting expliciet als publieke bron. **We zoeken geen contact op** — risico van overlap-suggestie weegt zwaarder dan de potentiële winst van een welwillende reactie. Zie `expert-outreach.md`.

## Ondertussen: belangrijke regels om in het hoofd te houden

- **Geen kosten achteraf**: kosten vóór de toekenning tellen niet mee — de hackathon-uren tellen dus niet, alleen de zes maanden ná de toekenning.
- **Uurtarieven**: max **€60 intern**, **€90 extern** ([SIDN-norm](https://www.sidnfonds.nl/faq)).
- **BTW**: studenten als natuurlijke personen zijn niet BTW-plichtig — begroting **incl. BTW** indienen.
- **80/20**: 80% wordt vóór aanvang uitbetaald, 20% ná goedkeuring van de eindverantwoording (binnen 3 maanden na afronding).
- **Looptijd**: start binnen 1 jaar na toekenning, afronden binnen 6 maanden na start.
- **Openheid is verplicht**: code open source (MIT/Apache 2.0), documentatie CC-BY 4.0, eindverslag publiek deelbaar.

---

*Brondocumenten geverifieerd op 25 mei 2026. Herverifieer de live SIDN-pagina's en de actuele Algemene voorwaarden PDF (`Algemene_voorwaarden_bij_toekenning_SIDN_fonds_26.pdf`) vlak voor indienen.*
