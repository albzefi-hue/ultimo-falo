# L'Ultimo Falò: note del progetto

Gioco di sopravvivenza nel bosco, in italiano, per browser (telefono e computer).

- **Sito online**: https://ultimo-falo.albzefi-782.workers.dev
- **Hosting**: Cloudflare Workers (account `albzefi-782`), collegato a questo repository: ogni push su `main` viene pubblicato da solo in circa un minuto. Il server (Durable Object) può impiegare qualche minuto in più della pagina ad aggiornarsi.
- **Proprietario**: albzefi-hue. Interfaccia e testi sempre in italiano.

## File

- `public/index.html`: tutto il gioco in una pagina (HTML, CSS e JavaScript, nessuna libreria). Canvas 2D.
- `src/worker.js`: server. `fetch` serve i file statici da `public/` e passa `/api/*` a un unico Durable Object `World` (SQLite), che tiene:
  - salvataggi online per codice di recupero (`save:FALO-XXXX-XXXX`);
  - classifica (`score:<codice>`);
  - villaggi della comunità (`village`, versione `bv`);
  - in memoria: chi è online (presenza) e chat/regali degli ultimi 5 minuti.
- `wrangler.jsonc`: configurazione Cloudflare (asset, Durable Object `WORLD`, migrazione `v1`).

## API (`/api/...`)

- `POST save {code?, nick, save}` → `{code}` · `GET load?code=` → `{save, nick}`
- `POST score {code, nick, days, level, wolves}` · `GET scores?code=` → top 20
- `POST sync {id, owner, nick, pres, events, since, bv}` ogni 2 s nel bosco della comunità → `{now, peers, events, bv, builds?}`. Eventi: `chat`, `gift`, `mybuilds` (sostituisce il villaggio del proprietario). Limite 300 richieste/minuto per IP.

## Funzioni del gioco

- Bisogni: salute, fame, sete, calore. Giorno di 240 s (06:00 all'inizio), notte con lupi.
- Costruisci (categorie): attrezzi e vestiti (ascia, piccone, lancia, borraccia, torcia, mantello, maglione, canna da pesca, canna robusta), fuoco e riparo (falò, rifugio), casa e campagna (casa, recinto, orto, pozzo, lanterna, trappola), animali domestici (pollaio, ovile, stalla, cuccia con cane).
- Pesca: scena del "Lago dell'Alba" (lancio, abboccata, tensione della lenza), 11 specie.
- Scuola del bosco con il maestro Gufo vicino all'inizio: Tabellina di Manu (10 domande, +5 s per errore), indovinello del giorno, missione del bosco. Si rinnova a ogni nuovo giorno.
- Mappa (pulsante Mappa / tasto M), obiettivi, livelli ed esperienza.
- Salvataggi: automatico nel browser, 3 slot, file di recupero, codice di recupero online.
- Comunità (`seed` fisso 424242): giocatori visibili, chat, regali, falò condivisi, villaggi e animali visibili a tutti, ora del giorno sincronizzata con il server, classifica.

## Lavorare sul progetto

```bash
npm install
npx wrangler dev --port 8787   # http://localhost:8787
```

- Controllo veloce della sintassi: estrarre lo `<script>` di `public/index.html` e passarlo a `node --check`.
- Per le prove nel browser si usa Playwright con Chromium.
- Nei salvataggi lo stato è in `S` (versione `v: 1`). Ogni nuovo campo va reso facoltativo, perché i salvataggi vecchi devono continuare a caricarsi.
- Le chiavi in `localStorage`: `ultimo-falo-run-v1` (partita), `ultimo-falo-code` (codice di recupero), `ultimo-falo-nick`, `ultimo-falo-slot-*`, `ultimo-falo-best-v1`.

## Altri giochi collegati

- Versione su claude.ai (artifact, con account Claude): https://claude.ai/artifact/HMmG7SJnFMvC14J1KEVKs9 (più vecchia, senza casa/animali/pesca/scuola).
- Lago dell'Alba (gioco di pesca da solo): https://claude.ai/artifact/LbcZGowaGMQFiACsM24a2W
- La Tabellina di Manu: https://github.com/albzefi-hue/tabellina-di-manu
