# AI Brand Mention Tracker

Enter one example prompt (e.g. "best hotel for family in Da Nang"), and this
tool will:

1. Ask ChatGPT to generate a batch of realistic, differently-worded variations
   of that prompt (up to 100).
2. Send each variation to the ChatGPT API and collect the answers.
3. Count how often your brand (and, optionally, named competitors) actually
   gets mentioned in those answers.
4. Show the results on a live dashboard: mention rate, total mentions, a
   brand-vs-competitor comparison chart, every individual prompt/response
   pair with the mentions highlighted, a leaderboard of every business
   ChatGPT mentioned (with your rank among them), and - if you set a location
   - a comparison against Google's local pack via SerpApi.

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
| `SERPAPI_API_KEY` | For real local comparisons | - | Enables the "ChatGPT vs. Google local results" section when a Location is set. Without it, that section still renders using simulated local results. |

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
  consolidated) to extract every business mentioned - not just your named
  brand/competitors - and ranks them so you can see where you land among
  the full field.
- `src/lib/serpapi.ts` + `src/lib/compare.ts` fetch Google Local & Google
  Maps results for the location you set and categorize each business as
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

## Deploying

This is a standard Next.js app (App Router, Node.js runtime). Deploy anywhere
Next.js runs (e.g. Vercel) and set `OPENAI_API_KEY` as an environment
variable. The analyze route sets `maxDuration = 300` for platforms that
support longer-running serverless functions; on a platform with a shorter
hard limit, lower the prompt count accordingly.
