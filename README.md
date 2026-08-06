# swoosh

A private, single-user task and list app. Installable as a PWA, deployed on Vercel.

## What it does

- **Tasks and lists.** Quick-add with light natural-language parsing ("email Dana tomorrow, urgent" picks up the date and priority). Lists are fully configurable in-app.
- **Voice notes.** Tap record, speak, and the transcript is split into individual tasks and routed into the right lists. You review and edit everything before it lands.
- **Private.** A 4-digit code gates the app. The hash is stored on-device; there is no account and no server-side user data.
- **Local-first.** Everything lives in IndexedDB in your browser. Nothing is uploaded except the voice transcript, and only when AI parsing is on.

## Setup

```bash
npm install
npm run dev
```

Open http://localhost:3000 and set a 4-digit code on first launch.

## Voice transcription

Transcription uses the browser's built-in Web Speech API — free, no key, no server. It works in Chrome and Safari (including iOS 15+). Firefox has no support; the voice sheet falls back to a text box there.

## Task extraction (optional)

Splitting a transcript into tasks uses Claude via `/api/parse`. Set one env var:

```
ANTHROPIC_API_KEY=sk-ant-...
```

On Vercel: **Project → Settings → Environment Variables**. Locally, put it in `.env.local`.

Without a key, the app falls back to local keyword rules — it still splits notes into tasks and routes them using the keywords you set per list in Settings, just less cleverly. You can also paste a key into Settings for a single device; the server env var takes precedence.

Model: `claude-opus-5`, called with structured outputs so the response is always valid JSON.

## Deploying to Vercel

1. Push this repo to GitHub.
2. Import it at vercel.com — the Next.js preset needs no changes.
3. Add `ANTHROPIC_API_KEY` under Environment Variables.
4. Add your domain under **Settings → Domains**, then point a CNAME at `cname.vercel-dns.com` from your DNS provider.

## Installing on your phone

Open the deployed URL in Safari or Chrome and choose **Add to Home Screen**. It launches standalone with an offline shell; your data is already local, so it works without a connection (voice transcription and AI parsing both need network).

## Data

Data is per-browser. Clearing site data erases it, and your phone and laptop hold separate copies. **Settings → Your data** has JSON export and import — use export before clearing anything or moving devices.

## Branding

The launch animation and app icons use a swoosh mark, which is a Nike trademark. That's fine for a private personal app, but don't use it on anything public-facing or commercial. To swap it, replace the `<path>` in `components/Splash.tsx` and re-run the icon script — the mark exists in exactly those two places.

## Notes

- The launch animation runs 4 seconds by default and is adjustable (or off) in **Settings → Launch animation**.
- The internal IndexedDB store is still named `suush` from before the rename, deliberately: renaming it would orphan any tasks already saved on-device.
- The 4-digit code keeps casual snoopers out of the app UI. It is not encryption: anyone with devtools access to the device can read IndexedDB directly. Don't store secrets here.
- Auto-lock defaults to one hour of inactivity and is configurable.
