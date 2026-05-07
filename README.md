# OnMe

Virtual try-on for fashion. Snap a photo or paste a TikTok link, OnMe finds every wearable item, surfaces real buy links, and renders the products on *you* using Perfect Corp's YouCam API.

Built with Expo (React Native) + Cloudflare Workers + Supabase.

---

## Architecture at a glance

```
┌─────────────┐    ┌──────────────────────────┐    ┌──────────────────────┐
│  Expo app   │───▶│  Cloudflare Worker       │───▶│ Perfect Corp YouCam  │
│  (this repo)│    │  (worker/index.ts)       │    │ OpenAI gpt-4o-mini   │
│             │    │  X-Onme-Token bearer     │    │ Replicate (g-dino)   │
│             │    │  Image-host allowlist    │    │ SerpAPI (Lens, etc.) │
└──────┬──────┘    └──────────────────────────┘    └──────────────────────┘
       │
       ▼
┌──────────────────────┐
│  Supabase            │
│  • Auth (magic link) │
│  • Storage (selfies) │
│    private + signed  │
└──────────────────────┘
```

The worker proxies every paid third-party API. The app never holds an API key — only a shared bearer token that authenticates legitimate clients to the worker.

---

## Prerequisites

- **Node 22+** (Wrangler v4 requires it)
- **Cloudflare account** with Wrangler logged in
- **Supabase project**
- API keys for: Perfect Corp YouCam, OpenAI, Replicate, SerpAPI

---

## Setup

### 1. Install

```bash
npm install
```

### 2. Configure the worker

```bash
cd worker
wrangler login

# Generate the shared client/server bearer token (use the same value in both places).
TOKEN=$(openssl rand -hex 32)

wrangler secret put ONME_API_TOKEN          # paste $TOKEN
wrangler secret put PERFECTCORP_API_KEY     # YouCam sk-... — https://yce.makeupar.com/api-console
wrangler secret put OPENAI_API_KEY          # sk-proj-... — https://platform.openai.com/api-keys
wrangler secret put SERPAPI_KEY             # https://serpapi.com/manage-api-key
wrangler secret put REPLICATE_API_TOKEN     # r8_... — https://replicate.com/account/api-tokens

wrangler deploy
```

Note the deploy URL it prints (`https://onme-tryon.<account>.workers.dev`).

### 3. Configure Supabase

In the Supabase Dashboard:

#### Authentication
- **Auth → URL Configuration → Redirect URLs**: add `onme://auth/callback` (production) and `exp://*` (Expo Go dev).
- **Auth → Email**: enable the magic-link provider. Customize the email template if you want.

#### Storage
- Create a bucket named **`selfies`**.
- Set it **PRIVATE** (toggle "Public bucket" off).
- Apply this RLS policy via SQL editor — gates each user to their own folder:

```sql
create policy "users own their selfies"
  on storage.objects for all
  to authenticated
  using (bucket_id = 'selfies' and auth.uid()::text = (storage.foldername(name))[1])
  with check (bucket_id = 'selfies' and auth.uid()::text = (storage.foldername(name))[1]);
```

### 4. Configure the app

Copy `.env.example` to `.env.local` and fill it in:

```ini
EXPO_PUBLIC_TRYON_PROXY_URL=https://onme-tryon.<your-account>.workers.dev
EXPO_PUBLIC_SUPABASE_URL=https://<project>.supabase.co
EXPO_PUBLIC_SUPABASE_ANON_KEY=sb_publishable_...
EXPO_PUBLIC_ONME_API_TOKEN=<same TOKEN you set as wrangler secret>
EXPO_PUBLIC_SENTRY_DSN=                # optional, see Crash reporting below
```

### 5. Run

```bash
npm start
```

Sign in via magic link. The link in the email will deep-link back into the app.

---

## Deploy

### Worker

```bash
cd worker
wrangler deploy
```

### Mobile (EAS)

```bash
eas build --profile production --platform ios
eas submit --platform ios

eas build --profile production --platform android
eas submit --platform android
```

Preview builds for testers:

```bash
eas build --profile preview --platform ios
```

---

## Crash reporting (Sentry)

Optional but strongly recommended for production. To enable:

1. Create a project at https://sentry.io.
2. Set `EXPO_PUBLIC_SENTRY_DSN` in `.env.local` and in EAS env (`eas env:create`).
3. Sentry init lives in `app/_layout.tsx` and is `enabled: !__DEV__` so dev crashes still red-screen.

---

## Project layout

```
app/                 Expo Router routes
  _layout.tsx        Root layout, auth gate, Sentry wrap
  index.tsx          Landing
  sign-in.tsx        Magic-link sign-in
  feed.tsx           Catalog feed
  scan.tsx           Look match (TikTok / photo / camera)
  tryon-real.tsx     Try-on for ad-hoc scanned products
  product/[id].tsx   Try-on for catalog products
  photos.tsx         Body-photo hub
  settings.tsx       Account settings + delete account
  legal/             Privacy + ToS
components/          Background, Logo, sheets
constants/theme.ts   Colors, radii, shadows
lib/
  auth.ts            Supabase auth helpers + useAuthState hook
  scan.ts            Scan pipeline (photo / video / TikTok → detections)
  feed.ts            Catalog (currently hardcoded)
  snap.ts            Body-photo persistence + Supabase upload (signed URLs)
  perfectcorp/       YouCam client
  photoMutator.ts    Mutate-and-retry strategies
  bag.ts             Bag persistence
  tryons.ts          Try-on history persistence
  persistence.ts     Cops + stats
  supabase/client.ts
worker/
  index.ts           Single Cloudflare Worker (every endpoint)
  wrangler.toml
```

---

## Worker endpoints

All require `X-Onme-Token: <ONME_API_TOKEN>`. Image URL fields are validated against `IMAGE_HOST_ALLOWLIST` (defaults to Supabase + YouCam plugin host + tikwm).

| Endpoint           | Purpose                                                              |
|--------------------|----------------------------------------------------------------------|
| `POST /tryon`      | YouCam virtual try-on with 4-pass corrective retry                   |
| `POST /scan-look`  | GPT-4o-mini detects wearable items + descriptions + bboxes           |
| `POST /detect`     | Replicate grounding-dino — pixel-precise bboxes per category         |
| `POST /lens`       | Lens + Yandex (parallel) → social-domain filter → GPT-4o reranker → Shopping → eBay → Images fallback |
| `POST /og-image`   | Scrape source-page og:image (upgrades thumbnails to retailer hero shots) |
| `POST /diagnose`   | Picks next mutation strategy when YouCam fails                       |
| `POST /extract-tiktok` | Fallback only — client does TikTok extraction itself              |

---

## Known limitations

- **Catalog is hardcoded** in `lib/feed.ts`. No CMS / admin. Replace with a Supabase table + simple admin UI before scaling.
- **Bag has no checkout.** "Add to bag" persists but doesn't process payment. Wire Stripe or remove the bag for v1.
- **No tests.** Add Jest + Maestro before scaling beyond demo.
- **No CI.** Add a GitHub Action that runs `npx tsc --noEmit` on PR.
- **`/extract-tiktok`** worker endpoint fails because tikwm rate-limits Cloudflare egress IPs. Client-side extraction works fine via residential IP.

---

## Scripts

```
npm start              # expo start
npm run android        # expo start --android
npm run ios            # expo start --ios
npm run typecheck      # tsc --noEmit
npm run lint           # expo lint
```

---

## License

UNLICENSED — private project.
