# Quickscan-zelfcheck — MeshGemma

De officiële [SIDN Quickscan](https://www.sidnfonds.nl/quickscan) stelt zeven vragen. Hieronder de SIDN-vragen verbatim, met onze antwoorden. Als alles groen is, vullen we de Quickscan online in en dienen we via FundPro in.

---

### Vraag 0 (intro / scope-check)

> *"Je overweegt een Pioniers aanvraag in te dienen bij SIDN fonds. Je hebt een goed idee dat je wil uitwerken naar een meer robuust en duurzaam digitaal product of dienst (maximaal aan te vragen bedrag is €10.000,-)"*

✅ **Ja.** We hebben een werkend hackathon-prototype dat we via een 6-maandse pilot willen uitwerken tot een echte demo met LoRa-radio en Android-client. Gevraagd bedrag: €10.000 incl. BTW.

---

### Vraag 1 — Past het project bij SIDN fonds?

> *"SIDN fonds ondersteunt vernieuwende internetprojecten, die bijdragen aan een sterk internet, waarbij algemeen belang voorop staat en kennisdeling vanzelfsprekend is (zie ook de criteria)."*

✅ **Ja.** MeshGemma valt onder het focusgebied **Sterk internet**: een open, vrij, decentraal, veerkrachtig netwerk dat blijft werken wanneer regulier internet (en de zendmasten ernaast) wegvalt. Geen centrale provider, geen aan/uit-knop. Algemeen belang: burgers in heel Nederland kunnen blijven communiceren tijdens uitval of crisis. Kennisdeling: alle code blijft open source (MIT/Apache 2.0), alle documentatie en meetdata onder CC-BY 4.0; eindrapport openbaar; demo/lezing bij minimaal twee NL-gelegenheden.

---

### Vraag 2 — Betreft het een innovatief project?

> *"SIDN fonds wil bijdragen aan vernieuwende en grensverleggende projecten. Projecten betreffen een toepassing van een bestaand idee in een nieuwe context, een nieuwe toepassing van digitale technologie of een geheel nieuw idee."*

✅ **Ja, op twee niveaus.** (a) De brug tussen smartphone-mesh en LoRa-mesh — één LoRa-gateway per wijk + telefoons als front-end zodat burgers zonder eigen LoRa-radio kunnen meedoen aan het bestaande Nederlandse MeshCore-netwerk — bestaat voor zover wij hebben kunnen vinden nog niet in een open vorm. (b) Een LLM (Gemma 4 E2B) op het toestel als **bandbreedte-compressor** voor radio-payload (mensentekst → ≤200 byte JSON) is een nieuwe toepassing van edge-AI in deze context.

---

### Vraag 3 — Heeft het project primair impact in Nederland?

> *"SIDN fonds steunt projecten die in eerste instantie impact hebben op de Nederlandse internetcommunity."*

✅ **Ja.** Pilot­locaties zijn Veluwe en stedelijk (Arnhem). We bouwen voort op de publiek gedeelde resultaten van Waag's MeshTesting (SIDN-gefinancierd, sep 2025–jan 2026) en sluiten frequentie/preset (SF7/CR5, 868 MHz) aan op het bestaande Nederlandse [LocalMesh / MeshCore-NL](https://www.localmesh.nl)-vrijwilligersnetwerk. Onze interop-bridge is bedoeld voor adoptie door de NL-mesh-community en eventueel de Nederlandse veiligheidsregio's die er nu al mee experimenteren (THISLINE, 2026).

---

### Vraag 4 — Is het project al gestart?

> *"SIDN fonds ondersteunt alleen projecten die op het moment van toekennen nog niet van start zijn gegaan. Alleen kosten na toekenning van de financiële bijdrage van SIDN fonds kunnen worden opgevoerd in de projectbegroting."*

✅ **Ja, voldoet.** Het 6-maands vervolgproject (LoRa-integratie, Android-client, veldpilot) start pas ná toekenning. Het hackathon-prototype is een afgeronde *aanloop* — geen kosten van vóór toekenning zijn in de begroting opgenomen.

---

### Vraag 5 — Is de looptijd van het project langer dan een half jaar?

> *"Pioniers zijn projecten met een korte looptijd. Pioniers projecten die langer dan een half jaar duren, komen niet in aanmerking voor een bijdrage van SIDN fonds."*

✅ **Nee.** Plan­ning is **exact 6 maanden** vanaf de toekenning. Zie werkpakketten in `begroting.md` en de gefaseerde planning in `projectplan.md` §5.

---

### Vraag 6 — Is een van de uitsluitingsgronden van toepassing?

> *"Is een van de volgende punten van toepassing op het project?*
> *• Het betreft het ontwikkelen van of verbeteren van een website, app of ai-tool, zonder dat sprake is van substantiële innovatie van diensten of functies/processen die verband houden met de doelstellingen van het SIDN fonds;*
> *• Het betreft een verzoek tot sponsoring;*
> *• Het betreft een project met een religieus of partijpolitiek doel;*
> *• Het betreft structurele organisatiekosten, exploitatielasten en salariskosten, die niet toe te schrijven zijn aan het project."*

✅ **Nee, geen enkele.** Toelichting per punt:

- *App/AI-tool zonder substantiële innovatie* — niet van toepassing: zie Vraag 2. De combinatie smartphone-mesh + LoRa-gateway-bridge + LLM-bandbreedte-compressie is substantieel innovatief, en sluit direct aan op de SIDN-doelstelling "sterk, veerkrachtig en decentraal internet".
- *Sponsoring* — niet van toepassing; dit is een ontwikkelingsproject.
- *Religieus / partijpolitiek* — niet van toepassing.
- *Structurele organisatiekosten / niet-toerekenbare salarissen* — niet van toepassing. We dienen in als natuurlijke personen, niet via een organisatie. De begroting bevat uitsluitend project-toerekenbare interne uren (à €60/uur, conform SIDN-norm) en projectspecifieke aanschaffen.

---

## Disqualifier-extra-check (uit Pioniers-pagina)

Naast de zeven officiële Quickscan-vragen wijst SIDN op een paar extra disqualifiers; ook die hebben we langsgelopen:

| Aanvullende disqualifier | Wij? | Toelichting |
| --- | --- | --- |
| Alleen voor één bedrijf / B2B / productontwikkeling | Nee | Burgers, open source, geen klant. |
| Techniek zonder duidelijk probleem | Nee | NOS Nieuwsuur, NIPV, Rijksoverheid, Verlind: probleem is breed erkend. Zie `bronnen.md`. |
| Geen proactieve kennisdeling | Nee | Open source, CC-BY, eindrapport, demo, lezing. |
| Standalone media­productie / event / sponsoring | Nee | Een ontwikkel- en pilotproject met *kennisdeling* erbij, niet andersom. |

## Honesty-check

Wat we *niet* verbergen, en in projectplan + video expliciet benoemen:

- **TX is gesimuleerd in de huidige build.** Geen echte LoRa-radio aangesloten. Daar vragen we de subsidie voor.
- **iOS-only nu.** Android komt er met deze subsidie ook bij.

Bewust uitlichten van wat er niet klopt is voor SIDN een *plus*, niet een minpunt — Pioniers financiert experimenteel ontwerp, geen kant-en-klare producten.

## Mismatch met bestaand Waag-project?

**Nee, complementair.** Waag's MeshTesting (sep 2025 – jan 2026) inventariseerde use cases voor *standalone Meshtastic LoRa-knooppunten*. Wij bouwen de smartphone-laag erbovenop. We citeren MeshTesting publiek in het projectplan; geen contact nodig.

---

**Conclusie:** zelfcheck groen op alle 7 vragen + alle disqualifiers. We vullen de Quickscan online in, vragen via "Toets je idee" eventueel een snelle bevestiging dat het kansrijk is, en dienen daarna via FundPro in.
