# AI Brand Mention Tracker

Enter one example prompt (e.g. "top beachfront hotel") and the locations you
care about (e.g. Da Nang, Nha Trang, Phu Quoc), and the ChatGPT Mentions tab
will:

1. Rewrite the prompt for each location and ask ChatGPT to generate
   realistic, differently-worded variations that stay in that place (the
   prompt count - up to 100 - is split evenly across the locations).
2. Send each variation to the ChatGPT API and collect the answers.
3. Extract every business the answers recommend, with its place in each
   answer's list, and roll properties up to their parent brand / chain.
4. Show the results on a live dashboard, in one of two modes:
   - **Regional market** - the most recommended businesses in each location,
     a "who wins where" matrix across locations, and an overall leaderboard
     (share of answers, times listed first, average position).
   - **Brand awareness** - the same breakdown plus how often your brand (and
     optionally named competitors) gets mentioned, overall and per location.
   Optionally, each location is compared against Google's local pack via
   SerpApi.

Put `{location}` in the prompt to control where the place goes; otherwise
" in <location>" is appended, and a prompt that already names one of the
locations has it swapped for each of the others.

## Reviews tab

Add any business from Google Maps (search by name or paste a Maps link), or a
hotel from Google Hotels (Google reviews plus partner sites such as
Tripadvisor). The app pulls its reviews newest-first through SerpApi
(`google_maps_reviews` / `google_hotels_reviews`), up to the history window
(3-24 months, or all history) and review cap you pick, and stores them in
Vercel Blob so later refreshes only fetch what's new. Businesses belong to
the same projects as Google Search Tracking; adding a business that is
already saved under another project reuses its reviews instead of fetching
them again. Widening a business's window or cap later fetches only the
missing reviews (plus a re-read of pages already stored).

Google's "newest first" order isn't strict - recently edited old reviews
appear among new ones - so a fetch only stops when most of a page is older
than the window, and a refresh stops once a page is mostly reviews already
saved.

Each review is analysed for overall sentiment and for the specific points it
praises or criticises. Points are sorted into a fixed set of aspects chosen
for that business (e.g. Breakfast, Room Cleanliness, Front Desk Staff), so
periods stay comparable. The dashboard filters everything by 7 days, 28 days,
3, 6 or 12 months, or all, with deltas against the previous period. It shows:

- headline numbers: reviews, average rating, % positive / negative, owner
  reply rate;
- sentiment over time and the star-rating mix;
- a praise & criticism heatmap (aspect × period). Green cells count praise
  and red cells count criticism; darker means more mentions. Click a cell to
  read those reviews;
- top praise / top criticism with sample quotes, and the review list.

Large backfills run as a series of time-boxed requests
(`src/app/api/reviews/sync`) that the page chains automatically, so they
stay under the function time limit. Without a server OpenAI key the analysis
falls back to a keyword method. Without SerpApi keys the reviews are
simulated.

## Getting started

```bash
npm install
cp .env.example .env.local   # add your OPENAI_API_KEY
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

### Mock mode

If neither a server-configured `OPENAI_API_KEY` nor a visitor-supplied key
(see below) is present, the app runs entirely in **mock mode**: it generates
simulated prompt variations and simulated responses locally so you can try
out the whole flow and dashboard without any API access or cost. A "mock
mode" note appears in the results when this is active.

### Bring-your-own keys

The form also has "Your API keys" fields for OpenAI and SerpApi. These are
meant for visitors to use the tool with their own accounts instead of the
deployer's:

- Kept only in browser memory (plain React state) - never written to
  localStorage, sessionStorage, or cookies, so they're gone on every reload
  and must be re-entered each time.
- Sent with the request body over HTTPS and used only for that single
  request; the server never logs or persists them.
- Take priority over the server's `OPENAI_API_KEY` / `SERPAPI_API_KEY` env
  vars when provided, so a visitor's own key overrides the deployer's.

## Configuration

| Env var | Required | Default | Purpose |
|---|---|---|---|
| `OPENAI_API_KEY` | For real runs | - | Your OpenAI API key. Without it, the app uses mock mode. |
| `OPENAI_MODEL` | No | `gpt-4o-mini` | Chat model used both to generate prompt variations and to answer them. Can be overridden per-run in the UI's "Advanced options". |
| `SERPAPI_API_KEY` (or `SERPAPI_API_KEY_1..8`) | For real SerpApi data | - | Google Search Tracking, the Reviews tab, and the ChatGPT tab's local comparison. Several numbered keys fail over to the next when one runs out of searches. |
| `BLOB_READ_WRITE_TOKEN` | For tracking & reviews | - | Vercel Blob store that holds tracking history and fetched reviews. |
| `LOCAL_BLOB_DIR` | No | - | Local development only: store those JSON documents in this folder instead of Vercel Blob. |

## How it works

- `src/lib/variations.ts` asks ChatGPT for N realistic rephrasings of your
  seed prompt in one JSON-mode call (cheaper and more reliable than N
  separate generation calls).
- `src/app/api/analyze/route.ts` streams progress back to the browser as
  newline-delimited JSON while it fans the generated prompts out to the
  ChatGPT API with bounded concurrency (8 at a time by default).
- `src/lib/mentions.ts` does a case-insensitive, word-boundary match of your
  brand name (plus any aliases) and each competitor name against every
  response.
- The dashboard (`src/app/page.tsx` + `src/components/*`) consumes that
  stream live, so you see prompts complete and stats update as the run
  progresses. Use "Stop" to cancel a run early.
- `src/lib/leaderboard.ts` re-reads all responses (batched, then
  consolidated once for the whole run so names match across locations) to
  extract every business mentioned - not just your named brand/competitors -
  in the order each answer lists them, then ranks them overall and per
  location, by business and by parent brand.
- `src/lib/locations.ts` rewrites the prompt for each location and splits
  the prompt budget across them.
- `src/lib/serpapi.ts` + `src/lib/compare.ts` fetch Google Local & Google
  Maps results for each location and categorize each business as
  mentioned by both ChatGPT and the local pack, ChatGPT only, or the local
  pack only - the same "gap signal" framing used in manual GEO visibility
  audits.
- The UI font is Euclid Circular A, self-hosted via `next/font/local` from
  `src/fonts/euclid-circular-a/` (bring your own licensed copy of the font
  files if you fork this).

## Cost & rate limits

Each run makes 1 call to generate variations plus 1 call per prompt (up to
100 by default). Use the "Number of prompts to run" slider to reduce this
while testing. Failed calls are retried a couple of times with backoff and
otherwise reported per-prompt rather than failing the whole run.

The Reviews tab spends 1 SerpApi search per page of reviews (8 on the first
Google Maps page, then 20), so a 500-review backfill is about 26 searches;
refreshes stop at the first review already stored. Analysis is one model
call per 15 reviews.

## Deploying

This is a standard Next.js app (App Router, Node.js runtime). Deploy anywhere
Next.js runs (e.g. Vercel) and set `OPENAI_API_KEY` as an environment
variable. The analyze route sets `maxDuration = 300` for platforms that
support longer-running serverless functions; on a platform with a shorter
hard limit, lower the prompt count accordingly.
