# farm-ts

Minimal split backend/frontend starter: **FastAPI + MongoDB** behind a
**Vite + React 19 + TypeScript** frontend, joined by a small typed fetch layer
over `/api`. This is a bare skeleton — no app features are implemented. Build on
top of it.

## Layout

```
farm-ts/
  backend/   FastAPI + motor (async MongoDB) + Pydantic v2 — python, /root/.venv
  frontend/  Vite + React 19 + Tailwind v4 + shadcn/ui (TypeScript strict)
  tests/     Playwright e2e workspace (pre-scaffolded)
```

## Running

Two separate processes, managed by supervisor in the pod (see "Pod conventions"
below); to run them by hand from two terminals instead:

```bash
cd backend && uvicorn server:app --host 0.0.0.0 --port 8001 --reload   # http://localhost:8001
cd frontend && yarn dev                                                # http://localhost:3000
```

Per pubblicare soltanto il servizio opzionale di analisi AI, senza database:

```bash
cd backend && uvicorn payslip_server:app --host 0.0.0.0 --port "$PORT" --workers 1 --no-proxy-headers
```

Configurare nel backend `OPENAI_API_KEY` come secret, `OPENAI_PAYSLIP_MODEL`
e `CORS_ORIGINS`. Nel build del frontend impostare soltanto l'URL pubblico non
segreto `VITE_AI_API_BASE_URL`; la chiave OpenAI non deve mai essere esposta al browser.

### Protezione dell'endpoint AI

`POST /api/analyze-payslip-ai` è gestito dal servizio FastAPI dedicato
`backend/payslip_server.py` e dal router `backend/lib/payslip_ai.py`. Il frontend
invia il documento solo dopo il consenso, direttamente all'URL del servizio AI.
Il servizio non dispone di login, cookie di sessione o ID account verificati:
un indirizzo IP limita l'abuso, ma non costituisce una quota per utente.

| Variabile backend | Default | Funzione |
| --- | ---: | --- |
| `AI_MAX_UPLOAD_BYTES` | `15728640` (15 MiB) | Dimensione massima del file; il corpo multipart ha un ulteriore margine limitato. |
| `AI_MULTIPART_OVERHEAD_BYTES` | `16384` (16 KiB) | Margine massimo per boundary e intestazioni multipart. |
| `AI_UPLOAD_TIMEOUT_SECONDS` | `60` | Tempo massimo assoluto, in secondi, per ricevere il corpo dell'upload; accetta un numero positivo finito. |
| `AI_RATE_LIMIT_REQUESTS` | `6` | Richieste per client di rete nella finestra mobile. |
| `AI_RATE_LIMIT_WINDOW_SECONDS` | `60` | Durata della finestra del rate limit. |
| `AI_RATE_CLIENTS_MAX` | `10000` | Numero massimo di client di rete tenuti nei contatori in memoria; nuovi client ricevono HTTP 429 finché gli altri scadono. |
| `AI_MAX_CONCURRENT_ANALYSES` | `2` | Numero massimo di richieste AI contemporanee per processo; le eccedenze ricevono HTTP 503. |
| `AI_DAILY_ANALYSIS_LIMIT` | `200` | Ammissioni alle analisi AI per giorno UTC e per processo; oltre il limite, HTTP 429. |
| `AI_TRUSTED_PROXY_CIDRS` | vuoto | IP/reti dei soli proxy fidati, separati da virgole; abilita la lettura della catena `X-Forwarded-For` a partire dal peer verificato. |

Il limite sul corpo HTTP viene applicato all'ingresso ASGI: le richieste con
`Content-Length` eccessivo sono respinte prima del parsing multipart; per le
altre, la lettura viene interrotta durante lo streaming non appena supera il
limite, con HTTP 413 e senza completare il caricamento o chiamare OpenAI.
Il middleware ASGI, eseguito prima del parser multipart di FastAPI, impone una
scadenza assoluta per ricevere l'intero corpo dal momento in cui la richiesta
ottiene uno slot di concorrenza. Un upload incompleto alla scadenza riceve
HTTP 408 con codice `UPLOAD_TIMEOUT`; lo slot viene liberato e OpenAI non viene
chiamato.
Questa scadenza riguarda la ricezione del corpo, non la successiva analisi AI.
La route controlla di nuovo la dimensione esatta del file prima di chiamare
OpenAI. Il rate limit per IP, la quota giornaliera e il limite di concorrenza
sono tutti **per processo**, con contatori in memoria. Un riavvio azzera i
contatori; più worker o istanze moltiplicano i limiti effettivi. In particolare,
`AI_DAILY_ANALYSIS_LIMIT=200` indica 200 ammissioni al giorno UTC **per
processo**, non una garanzia globale né una quota per account. La quota
giornaliera è condivisa da tutti i client ammessi in quel processo. Il budget
del progetto OpenAI resta il limite esterno da impostare per contenere la spesa
anche in caso di riavvii.

#### Identificazione del client dietro Render

Il comando di avvio previsto per il prossimo deploy è quello sopra, con
`--workers 1 --no-proxy-headers`: Uvicorn non deve sostituire il peer della
connessione con un valore di un header prima della verifica applicativa. Con
`AI_TRUSTED_PROXY_CIDRS` vuoto, il servizio usa `scope["client"][0]` e ignora
`X-Forwarded-For`. Se più utenti arrivano attraverso lo stesso peer Render,
condivideranno la stessa finestra di rate limit IP e potrebbero ricevere 429
anche con poche richieste individuali. Non è ancora verificato se il deployment
Render effettivo presenta questa topologia.

Prima di valorizzare `AI_TRUSTED_PROXY_CIDRS`, raccogliere **sul deployment
effettivo** queste informazioni:

1. Comando di avvio e opzioni Uvicorn realmente attivi, numero di worker,
   istanze e percorsi d'ingresso (inclusi eventuali CDN o proxy aggiuntivi).
2. Indirizzo IP del peer TCP osservato da FastAPI per richieste di prova
   attraverso ciascun percorso, incluse eventuali varianti IPv4 e IPv6; chi
   gestisce ciascun peer e quali intervalli CIDR ufficiali, completi e
   mantenuti nel tempo lo comprendono.
3. Comportamento di ogni proxy su `X-Forwarded-For`: se rimuove o conserva
   valori inviati dal client, se aggiunge il peer a destra e in quale ordine,
   come tratta header multipli e se la catena cambia fra percorsi d'ingresso.
4. Possibilità di raggiungere il servizio senza i proxy verificati; se esiste,
   queste connessioni devono restare non fidate. Serve inoltre sapere come
   aggiornare e riverificare gli intervalli quando Render o la topologia cambia.

Per osservare il peer, eseguire richieste controllate da reti note e leggere
temporaneamente `scope["client"][0]` (o `request.client.host`) in una risposta
diagnostica accessibile solo all'operatore, con `Cache-Control: no-store`; il
valore deve riflettere il socket con `--no-proxy-headers` davvero attivo.
Verificare la catena con le **sole richieste di prova dell'operatore**, ripetute
anche con un valore `X-Forwarded-For` deliberatamente fittizio inviato dal
client: confrontare gli header ricevuti, l'ordine degli hop e il peer reale.
La diagnostica può restituire gli header all'operatore per la verifica puntuale,
ma va rimossa subito dopo. Non registrare gli IP o l'intera catena delle
richieste ordinarie in log, tracing o analytics; conservare solo l'esito della
verifica, i CIDR confermati e la data/fonte della conferma. Non inserire token
diagnostici negli URL.

Valorizzare `AI_TRUSTED_PROXY_CIDRS` **solo** con i CIDR dei peer proxy
effettivamente controllati e verificati, dopo aver confermato che il percorso
non consenta al client di far accettare un IP arbitrario come propria identità.
La scansione applicativa di `X-Forwarded-For` procede da destra verso sinistra,
partendo dal peer fidato e fermandosi al primo hop non fidato. Un header
forgiato non diventa attendibile soltanto perché è presente. Se indirizzi,
catena o possibilità di accesso diretto restano incerti, lasciare la variabile
vuota e considerare il rate limit IP un limite approssimativo per peer di rete.
Una vera quota per account richiederebbe un'identità verificata e contatori
condivisi e persistenti.

## The `/api` proxy convention

Every backend route lives under `/api` (the backend mounts one
`APIRouter(prefix="/api")`), and the frontend dev server
(`frontend/vite.config.ts`) proxies `/api/*` to `http://localhost:8001`. So
frontend code always calls a **relative** path — `apiGet("/status")` →
`/api/status` — and never an absolute backend URL. The same code works in dev
(via the Vite proxy) and in production (once both are served behind a single
origin).

## Backend

FastAPI, async throughout. `python` is the app venv interpreter
(`/root/.venv/bin/python`); backend deps are pip-installed from
`backend/requirements.txt`.

- **Entry point**: `backend/server.py` — creates `app = FastAPI()`, creates
  `api_router = APIRouter(prefix="/api")`, registers routes **on the router**,
  and calls `app.include_router(api_router)` at the bottom. CORS middleware is
  added from `CORS_ORIGINS`. Never hang a route directly off `app` — it would
  land outside `/api` and the Vite proxy would not reach it.
- **The route pattern** (copy `status` in `server.py`):
  1. a Pydantic model per request body and per response
     (`StatusCheckCreate` / `StatusCheck`);
  2. an `async def` handler decorated with
     `@api_router.post("/status", response_model=StatusCheck)`;
  3. `await` the motor call inside it.
  FastAPI validates the request against the Pydantic model before your handler
  runs — a malformed body never reaches your code, it gets an automatic `422`
  with a `{"detail": [...]}` body.
- **Growing the backend**: as `server.py` gets crowded, move models to
  `backend/models/` and routers to `backend/routers/` (one module per resource,
  each exporting its own `APIRouter`, mounted from `server.py` via
  `api_router.include_router(...)` or `app.include_router(...)` with the `/api`
  prefix preserved).
- **MongoDB**: import the shared handle — `from lib.db import client, db`
  (`backend/lib/db.py` self-loads `.env` before reading env). Use it from
  `server.py`, every router, and standalone scripts like `seed.py`; never
  construct another `AsyncIOMotorClient`. Collections are attributes:
  `await db.status_checks.insert_one(...)`, `await db.status_checks.find().to_list(1000)`.
  Motor connects lazily, so importing `server` never blocks on Mongo. `pymongo`
  is installed too if you need a sync client in a script.
- **Ids**: documents use a string `id` (`uuid4`) field, not Mongo's `ObjectId`
  — `ObjectId` is not JSON-serializable and leaks into response bodies. Keep the
  `uuid4` default-factory pattern from `StatusCheck`.
- **Config**: `backend/.env` — `MONGO_URL` (connection string), `DB_NAME`
  (database name), `CORS_ORIGINS`. `server.py` loads it with `python-dotenv`
  above its local imports, and `lib/db.py` self-loads it so standalone scripts
  inherit it too. The pod runs `mongod` locally, so `MONGO_URL` points at
  `localhost`. Add new secrets/config here; read them with `os.environ`.
- **Dates**: `backend/lib/dates.py` — `today_iso(tz=None)`. The pod clock is
  UTC; anchor "today" server-side with this, never with client-side date math.
- **Interactive check**: `cd /app/backend && python -c 'import server'` catches
  syntax/import errors without waiting for the supervisor log.

## Frontend

- Vite + React 19 + TypeScript strict, dev server on port `3000`.
- Tailwind CSS v4 (via the `@tailwindcss/vite` plugin — no separate
  `tailwind.config.js` needed) + shadcn/ui, initialized with the `base-nova`
  style and `neutral` base color, `@` path alias (`@/*` → `src/*`) wired in both
  `tsconfig.app.json`/`tsconfig.json` and `vite.config.ts`.
- `react-router-dom` and `motion` are preinstalled — don't re-add them. `src/App.tsx`
  is the `<Routes>` table and nothing else; screens live in `src/pages/*.tsx` and are
  imported as `@/pages/<Name>`. `src/pages/Home.tsx` ships as the worked example. Add
  a `<Route>` for every page you write, in the same edit that creates the page — a
  page with no route is unreachable, and any URL without a matching `<Route>` renders a
  **blank page** — `<Routes>` matches nothing and mounts nothing.
- Components installed under `src/components/ui/`: button, card, input, label,
  select, dialog, sheet, tabs, badge, calendar, sonner, textarea, table, popover,
  dropdown-menu, checkbox. Add more with `npx shadcn@latest add <component>`.
- `src/lib/api.ts` — the typed fetch layer: `apiGet<T>`, `apiPost<T>`,
  `apiPut<T>`, `apiPatch<T>`, `apiDelete<T>`, all relative to base `/api`,
  throwing `ApiError` (with `status` and the parsed body) on any non-2xx.
  **Nothing infers across the Python boundary** — you declare the response type
  yourself as a TS interface mirroring the endpoint's Pydantic model, and keeping
  the two in sync is a manual discipline. When you change a Pydantic model,
  change its TS interface in the same edit.
- `src/pages/Home.tsx` is a minimal example of the wiring: TanStack Query's `useQuery`
  with `apiGet<StatusCheck[]>("/status")` as the `queryFn`. It is a **non-blocking
  connectivity probe**, not a proof of the round trip — the result is deliberately
  discarded so the splash renders identically with no backend. `apiGet<T>` does no
  runtime validation either; `T` is your assertion, not a check. See the
  static-preview rule in `TEMPLATE.md` §4 for why no page may be gated on a fetch.

## TypeScript

`frontend/tsconfig.app.json` / `tsconfig.node.json` have `strict: true`. In the
pod:

```bash
cd frontend && yarn typecheck
```

— plain `tsc --noEmit` run from `frontend/` checks ZERO files (root tsconfig uses
project references with `"files": []`) and exits 0 even with type errors. Always
use `-b` for the frontend. Lint with `cd frontend && yarn lint` (oxlint).

## Data fetching

TanStack Query is wired: `QueryClientProvider` in `src/main.tsx`, `useQuery` demo
in `src/pages/Home.tsx` (see above). Use `useQuery`/`useMutation`, not
fetch-in-`useEffect`.

## Completion gate (tier 1)

When the build is complete, run tier 1 once, all in the same turn: a curl smoke
over the key `/api` endpoints (assert status AND a response field, plus one
negative case), `cd frontend && yarn typecheck`, and ONE happy-path browser pass
through the core user journey. Clean on all three → finish; any failure is a real
bug — fix it, re-run the failed check, and escalate to the testing subagent.
No routine typecheck/lint/smoke passes during the build — tier 1 runs exactly once.


## Testing

Two lanes.

**Backend (pytest)** — specs in `backend/tests/` as `test_*.py`, run with:

```bash
cd /app/backend && pytest
```

`backend/pytest.ini` is canonical: `addopts = -n 2 --dist loadscope` (pytest-xdist,
already parallel — do not pass your own `-n`) and `asyncio_mode = auto` (so
`async def test_...` needs no marker). Serial is `-n 0`, **never**
`-p no:xdist` (that errors, because `addopts` still passes `-n`/`--dist`).
`backend/tests/conftest.py` is pre-scaffolded — a sync `client` fixture
(`httpx.Client` rooted at `/api`), an async `aclient`, and an `api_url()` helper,
all pointed at `BACKEND_URL` (default `http://localhost:8001`). Tests hit the
live uvicorn process, so the app under test is the one the browser sees. Add
app-specific fixtures below the marker; do not re-create the file.

**Frontend (Playwright)** — `/app/tests/` is pre-scaffolded:
`playwright.config.ts` (canonical — edit the marked lines only),
`fixtures/helpers.ts`, and a `package.json` that resolves
`@playwright/test@1.62.0` (node_modules baked into the image). Write specs into
`tests/e2e/`. Do NOT re-create the config/helpers or install/upgrade playwright —
matching Chromium browsers live at `/pw-browsers`.

The backend lane is pytest: this template's backend is Python, so `vitest` does
not apply to it.

## Pod conventions

This template runs under supervisord in the Emergent agent pod — supersedes any
local-run instructions above.

- Backend, frontend, and `mongod` are each a supervisor program. After code or
  config changes, restart and wait for readiness:

  ```bash
  sudo supervisorctl restart frontend backend
  until curl -sf -o /dev/null http://localhost:3000; do sleep 2; done
  ```

- Status, only after a restart you triggered:
  `sudo supervisorctl status frontend backend`. Logs:
  `/var/log/supervisor/backend.err.log`, `backend.out.log`,
  `frontend.err.log`.
- App in a browser: the pod's preview URL (frontend, port `3000`). Backend API
  directly at port `8001`.
- `mongod` runs locally in the pod (`--bind_ip_all`); `MONGO_URL` in
  `backend/.env` points at `localhost`, no separate Mongo container.
- Both dev servers hot-reload on file edits (uvicorn `--reload` for the backend,
  Vite HMR for the frontend); no rebuild step needed for normal iteration. A
  restart is still needed after changing `.env`, `requirements.txt`, or
  `vite.config.ts`.
