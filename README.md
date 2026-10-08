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

## Google Maps Reviews tab

Add any business from Google Maps (search by name or paste a Maps link), a
listing from Tripadvisor (hotels, restaurants, attractions and tours; search by
name or paste a Tripadvisor link), or a hotel from Google Hotels (Google reviews
plus partner sites). The app pulls its reviews newest-first through SerpApi
(`google_maps_reviews` / `tripadvisor_reviews` / `google_hotels_reviews`), up to the history window
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

Tripadvisor listings also show the listing's profile (`tripadvisor_place`, one
search per sync): rating and ranking ("#7 of 214 hotels in Da Nang"), award,
rating distribution, category scores (Location, Rooms, Value, Service...),
Tripadvisor's AI summary of reviews and its highlights, style rankings and
amenities. Their reviews keep the title, trip type (Couples, Family, Business,
Friends, Solo) and per-review category ratings, and the dashboard adds a
"who stays and how they rate it" table by trip type.

Large backfills run as a series of time-boxed requests
(`src/app/api/reviews/sync`) that the page chains automatically, so they
stay under the function time limit. Without a server OpenAI key the analysis
falls back to a keyword method. Without SerpApi keys the reviews are
simulated.

## Brand Mentions tab

Tracks how AI answer engines talk about the project's brand for a set of prompts (questions people ask AI), next
to what customers say in the brand's own reviews. It uses the same projects (brand, competitors, market) as Google
Search Tracking; old `/google-search-tracking?view=brand-mentions` links redirect to `/brand-mentions`.

- **Prompts**: type them, upload a CSV/TSV/TXT (a `prompt`/`query`/`question` column and an optional `topic`
  column are recognised), or let ChatGPT suggest them. Suggestions are decision-making questions, grouped as
  Comparisons (brand vs a named competitor), Worth it?, Reviews, Best for ([category] for [purpose] in
  [location]), Right fit (which option suits a specific need) and Who it suits. They draw on the brand,
  competitors, tracked keywords and the brand's review listings (category, location, traveller types, what
  customers praise and criticise); price-range, things-to-do and similar questions are filtered out. Prompts
  naming the brand are tagged branded automatically.
- **Sources**: Google AI Mode and AI Overview (SerpApi, ~3 credits per prompt), ChatGPT (OpenAI Responses API
  with web search, `gpt-5.4-mini` by default) and Claude (Anthropic Messages API with web search,
  `claude-opus-5-5` by default, with server-side refusal fallback). Models are chosen per project.
- **Analysis**: each answer is read by `OPENAI_MODEL` for brand mentions and position, sentiment (0-100), the
  brands and attributes discussed, and the claims made about the brand (fact or opinion, with the source used).
- **Dashboard**: perception score and narrative (strengths / weaknesses), sentiment trend per run, head-to-head
  against competitors (project + auto-detected), attributes (leading / at parity / behind), brand facts to mark
  correct or incorrect, source sentiment with a claims table, and every full answer with its sources. Filters:
  date range, platform, branded / unbranded, topic.
- **Customer reviews**: the brand's Google Maps, Tripadvisor and Google Hotels listings from the Reviews tab
  (matched by brand name, or chosen by hand) - review volume, average rating, a customer score on the same 0-100
  scale as the AI perception score, results per review site, what customers praise and criticise (with quotes),
  the Tripadvisor ranking / summary / highlights, trip types, and competitor listings' ratings. The dashboard's
  "AI answers vs. real customers" card compares the two topic by topic (aligned, AI misses it, contradicts, AI
  only); it's generated after each run and on demand (one small `OPENAI_MODEL` call, counted in the daily limit).
  The weekly cron also checks the brand's listings for new reviews (about 1-3 SerpApi searches per listing; can be
  switched off).
- **Schedule & cost control**: runs weekly (daily cron `/api/brand/run` starts due runs and continues unfinished
  ones) plus Run now. A daily spending limit (default $5, shared by all projects, editable in Costs & limits)
  pauses runs when reached; they continue the next day. Costs & limits shows today's spend and projected cost per
  run / week / month for each model.

## Images tab

Find, crop and download images as JPG:

- **Google Images** (SerpApi `google_images`, ~100 images per page, 1 credit
  per page) with Creative Commons / photos-only / large-only filters. Each
  result shows its size and source page.
- **Instagram profile** (SerpApi `instagram_profile`): a public account's
  recent posts, 1 credit per page.
- **AI generator**: pick the OpenAI model (GPT Image 2.5 Flare / Sunburst,
  GPT Image 2, 1.5, 1 Mini, 1; the list and prices live in
  `src/lib/images/models.ts`), prompt, optional reference images (upload or
  link), quality low / medium / high, 1-4 variations. The panel shows the
  estimated cost before generating (OpenAI's per-image prices) and the actual
  cost afterwards (from the token usage OpenAI returns). GPT Image 2 and newer
  draw at your exact shape; older models draw at the closest of
  1024x1024 / 1536x1024 / 1024x1536. Results open in the cropper at the exact
  size you asked for.
- **Crop & download**: crop to an exact size (presets or custom) with a box
  locked to the output's shape, or resize keeping the original proportions,
  then download one JPG or a ZIP of several. Remote images go through a
  server-side proxy (`/api/images/proxy`, which refuses private/internal
  addresses) so the browser can read their pixels.
- **Library**: generated images, Google / Instagram results saved with
  "Save to library" (original file, fetched server-side, no SerpApi credits),
  and downloaded JPGs are kept per project in Vercel Blob, so they can be
  re-downloaded or re-cropped later.

## Articles tab

Manage SEO articles from a Google Sheets content plan and publish them to the project's WordPress site:

- **Import** a content-plan Sheet (one row per article: title, focus keyword, a
  link to its Google Doc, categories, tags, publish date...; columns are
  matched by header and can be remapped) or a single Google Doc. Doc headings
  become H2/H3 (the post title is the H1); images in the Doc are copied to the
  project's image library. Re-importing updates an article in place.
- **Google sign-in** (OAuth, read-only Sheets + Docs scopes) reads private
  files the viewer can open. Tokens stay in an encrypted, httpOnly cookie in
  that browser. Without sign-in, files shared as "Anyone with the link" still
  work via Google's public export.
- **Editor**: rich text (headings, lists, links, tables, images with alt text)
  or raw HTML; images come from the project library, any image link, or an
  upload.
- **On-page SEO panel**: live score and checklist (keyword in title / meta /
  slug / intro / subheadings, density, title and meta lengths, content length,
  headings, featured image, alt text, internal and outbound links), a Google
  result preview, and **ChatGPT suggestions** (`OPENAI_MODEL`) for SEO titles,
  meta descriptions, slug, keywords, excerpt, missing subtopics, image alt text,
  categories/tags and concrete edits - each applied with one click.
- **Publish to WordPress** (REST API + Application Password, stored encrypted
  per project): as a draft, live, or scheduled. Uploads the images (once per
  site), sets featured image, categories and tags (created if missing), and
  the Yoast SEO / Rank Math title, description and focus keyword via a small
  helper plugin (`/api/wordpress/plugin` downloads it). Publishing again updates
  the same post.

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
| `SERPAPI_API_KEY` (or `SERPAPI_API_KEY_1..20`) | For real SerpApi data | - | Google Search Tracking, the Reviews tab, and the ChatGPT tab's local comparison. Several numbered keys fail over to the next when one runs out of searches. |
| `OPENAI_IMAGE_MODEL` | No | `gpt-image-2.5-flare` | Default model in the Images tab's generator until a viewer picks another (must be one listed in `src/lib/images/models.ts`; your OpenAI organisation may need to be verified to use GPT Image models). |
| `BLOB_READ_WRITE_TOKEN` | For tracking & reviews | - | Vercel Blob store that holds tracking history and fetched reviews. |
| `LOCAL_BLOB_DIR` | No | - | Local development only: store those JSON documents in this folder instead of Vercel Blob. |
| `ANTHROPIC_API_KEY` | For Claude in Brand Mentions | - | Claude API key (console.anthropic.com). Without it, Claude answers are placeholders. |
| `APP_SECRET` | For the Articles tab | - | Long random string that encrypts Google sign-in cookies and stored WordPress application passwords. Changing it signs everyone out and requires re-entering WordPress passwords. |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | For Google sign-in | - | OAuth "Web application" client with the Sheets and Docs APIs enabled. Redirect URI: `https://<your-domain>/api/google/callback`. Without them, only link-shared Sheets/Docs can be imported. |

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
