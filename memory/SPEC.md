# Registro Ore Lavoro — Specifica v1 (LOCAL-FIRST MVP)

## Cos'è
PWA mobile-first in italiano per lavoratori (cantieri, manutenzione, logistica, pulizie, autisti):
registrazione giornaliera delle ore con calcolo automatico di ordinarie, straordinari, festivi,
notturne, maggiorazioni e stima del compenso. Zero attrito: inserimento di una giornata in ~30 secondi.

## Vincoli dalla chat (obbligatori)
- **100% LOCAL-FIRST**: NESSUN MongoDB, NESSUN FastAPI, NESSUN /api, NESSUN account/login.
  Tutto in **IndexedDB** (wrapper promise in `frontend/src/lib/repo.ts`). Funziona completamente offline.
- Architettura pronta per sync cloud futuro: ogni mutazione passa da `lib/store.ts` (repo layer unico) — NON implementata ora.
- Export **CSV** (separatore `;`, BOM), **Backup/Import JSON**, **PDF semplice** intitolato
  "Riepilogo Presenze e Stima Retribuzione" — MAI la parola "Cedolino".
- Ogni netto è etichettato **"Stima netto"**; disclaimer "Stima indicativa, non sostituisce la busta paga."
- Tutte le percentuali (straordinario, festivo, notturno, domenicale, reperibilità, trasferta) modificabili
  nelle Impostazioni, default 0. In più: indennità reperibilità €/giorno (scelta utente).
- Dati dimostrativi "DATI DI PROVA" al primo avvio, rimovibili con UN pulsante → app completamente vuota.
- PWA installabile su Android: manifest + service worker (passthrough in dev, cache in produzione).

## Data model (localStorage/IndexedDB, no Mongo)
- `DayEntry { id, date: "YYYY-MM-DD", dayType: lavoro|ferie|malattia|permesso|riposo, start, end: "HH:MM",
  breakMinutes, notturno, reperibilita, trasferta, festivo: boolean|null (null=auto da festività), note, createdAt, updatedAt }`
  — più entry per stessa data consentite.
- `Settings { workerName, company, dailyOrdinaryHours=8, weeklyOrdinaryHours=40, basePay=0,
  overtimePct=0, holidayPct=0, nightPct=0, sundayPct=0, reperibilitaPct=0, trasfertaPct=0,
  reperibilitaEuroPerDay=0, netEnabled=false, netPct=0, patronalName, patronalMonth, patronalDay }`

## Motore di calcolo (lib/stats.ts, funzioni pure)
- netto = fine − inizio − pausa; fine ≤ inizio ⇒ turno a cavallo della mezzanotte (+24h).
- Ordinarie/straordinario: per entry in ordine di data, ordinarie = min(netto, ore ordinarie giornaliere,
  residuo del tetto settimanale ISO (default 40h)); il resto è straordinario.
- Festivo: festività nazionali italiane (calcolate per anno, Pasqua/Pasquetta incluse) + festività patronale
  configurabile (ricorrente GG/MM); override manuale per entry.
- Notturne: checkbox "Lavoro notturno" auto-sugerito se il tocca la finestra 22:00–06:00; se attivo tutte le
  ore del turno contano notturne.
- Stima retribuzione: base = tutte le ore × paga oraria; maggiorazioni % calcolate separatamente su:
  straordinario, ore dei giorni festivi, ore notturne, ore della domenica (se non festivo), ore dei giorni
  con reperibilità, ore dei giorni con trasferta; + indennità reperibilità €/giorno. Totale = somma.
  Stima netto = totale × (1 − %trattenute) se attivata.
- Ferie/Malattia/Permesso/Riposo: giorni senza orari; contati nei riepiloghi.

## Schermate + rotte
- `/` Oggi: intestazione (titolo, nome, azienda, selettore mese/anno), banner DATI DI PROVA, 4 metriche
  principali (card scura), Ore festive/Notturne, Stima compenso, CTA "+ Inserisci giornata", card "oggi",
  ultime 5 giornate con "Copia giornata".
- `/inserisci`: form (tipo giornata segmentato, data con Oggi/Ieri, ora inizio/fine 24h, pausa a pill
  Nessuna/15/30/45/60/Personalizzata, ore nette calcolate live, checkbox festivo/notturno/reperibilità/
  trasferta, note, Salva/Annulla). Parametri: `?id=` modifica, `?copia=` duplica, `?data=` prefill.
- `/calendario`: griglia mensile Lun–Dom; cella = numero + ore + "+Xh" straordinario + badge tipo + tinta
  festivo; tap apre Sheet dettaglio con Modifica/Duplica/Elimina (con conferma).
- `/riepilogo`: Tab Mese (tutti i totali + breakdown maggiorazioni + totale stimato + Stima netto +
  disclaimer) e Tab Anno (12 mesi + totale annuale). Export CSV / PDF / Backup JSON.
- `/impostazioni`: dati lavoratore, orario ordinario (giornaliero/settimanale), paga e maggiorazioni (%),
  indennità reperibilità, Stima netto (on/off + %), festività patronale + elenco festività nazionali,
  backup export/import, rimozione dati di prova.
- Bottom nav fissa 4 sezioni: Oggi, Calendario, Riepilogo, Impostazioni. Nascosta su /inserisci.

## File map (frontend solo; backend del template NON toccato, nessun endpoint aggiunto)
- `lib/types.ts` modelli + default; `lib/dates.ts` date it; `lib/hours.ts` orari/valute; `lib/holidays.ts` festività
- `lib/repo.ts` IndexedDB; `lib/store.ts` stato + persistenza + demo + import/export backup
- `lib/stats.ts` calcoli; `lib/demo.ts` dati di prova; `lib/csv.ts`, `lib/pdf.ts` (PDF generato a mano, zero dipendenze), `lib/export.ts`
- `components/`: BottomNav, MonthNav, DemoBanner, EntrySheet; `pages/`: Oggi, Calendario, Riepilogo, Impostazioni, InserisciGiornata
- PWA: `public/manifest.webmanifest`, `public/icon.svg`, `public/sw.js` (registrato da main.tsx)

## Validazioni (messaggi semplici in italiano)
"Scegli la data della giornata." / "Inserisci l'ora di inizio." / "Controlla l'orario di fine lavoro."
/ "La pausa non può superare la durata del turno." / "Le ore lavorate devono essere maggiori di zero."
/ "Il valore non può essere negativo." / ore settimanali ≥ giornaliere.

## Test di accettazione (dal brief utente)
1. 06:00–18:00 pausa 30 → 11h30; con ordinaria 8h → 8h ordinarie + 3h30 straordinarie.
2. 06:00–19:00 pausa 30 → 12h30; 8h + 4h30.
3. Giornata festiva con maggiorazione configurata → maggiorazione calcolata separatamente nel riepilogo.
4. Modifica giornata → totali mensili aggiornati.
5. Eliminazione giornata (con conferma) → totali aggiornati.
Extra: turno 21:00–05:00 → 8h notturne; demo rimovibile con un pulsante; backup export/import; CSV/PDF.

## Credenziali
Nessuna: nessun login, nessun account. I dati vivono solo sul dispositivo.
