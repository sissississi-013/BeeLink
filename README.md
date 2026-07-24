# BeeLink · AI Pollination Broker

BeeLink is a hackathon prototype for evidence-backed commercial pollination
brokering. It interviews beekeepers and growers by voice, extracts structured
facts with provenance, supports a shared 360° field view, and pairs only
human-confirmed profiles or clearly labeled public-source leads.

## Data principles

- The participant ledger includes a small, official-source demo lead pool.
- Profile fields come from live interview tool calls and retain a source,
  evidence excerpt, confidence level, and capture time.
- Public-source facts link back to their source and leave unpublished
  commercial terms unresolved.
- Draft and review records are excluded from matching; confirmed interviews
  and sourced leads are match-ready.
- Visual notes are observations, not pest or disease diagnoses.
- The browser force-renders the exact visible panorama perspective, rejects
  blank WebGL captures, and verifies the same frame with a separate image
  analysis before Relay may describe it.
- The bundled panorama is explicitly synthetic and cannot create visual
  evidence records. Users can upload a real equirectangular scene instead.

## Local development

Copy the safe placeholder file and add your own server-side credentials:

```bash
cp .env.example .env
```

The required variables are `GOOGLE_AI_APIKEY` for the live voice interview and
`OCTEN_API_KEY` for public-source search. Never expose these values in browser
code or commit the populated `.env` file.

Then run:

```bash
npm install
npm run dev
```

The server mints one-use Gemini Live tokens and proxies source searches. The
long-lived keys are never returned to the browser.

## Verification

```bash
npm test
npm run build
```

## Runtime

- Gemini 3.1 Flash Live Preview for bidirectional voice, transcription,
  function calls, and visual frames
- Cloudflare D1 for durable participant and observation records
- Pannellum for rotatable equirectangular inspection scenes
- vinext / React for the Sites-hosted application
