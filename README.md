# L'Ultimo Falò

Gioco di sopravvivenza nel bosco, da soli o con la comunità. Si gioca dal browser con un soprannome, senza registrazione.

- **Salvataggi**: slot nel browser, file di recupero e un **codice di recupero** (`FALO-XXXX-XXXX`) per riprendere la partita su un altro dispositivo.
- **Bosco della comunità**: stessa mappa per tutti, falò condivisi, regali, chat.
- **Classifica** dei sopravvissuti.

## Struttura

- `public/index.html`: il gioco (una sola pagina).
- `src/worker.js`: il server su Cloudflare Workers. Un Durable Object (`World`) tiene chi è online e la chat, e salva partite e classifica.
- `wrangler.jsonc`: configurazione di Cloudflare.

## Pubblicare su Cloudflare (gratis)

1. Crea un account su https://dash.cloudflare.com/sign-up
2. Vai su **Workers e Pages** → **Crea** → **Importa un repository**.
3. Collega GitHub e scegli questo repository.
4. Lascia le impostazioni proposte (comando di deploy `npx wrangler deploy`) e premi **Distribuisci**.

Il sito sarà su `https://ultimo-falo.<tuo-sottodominio>.workers.dev`. A ogni modifica su GitHub, Cloudflare lo ripubblica da solo.

## Provarlo sul computer

```bash
npm install
npm run dev
```

Poi apri http://localhost:8787
