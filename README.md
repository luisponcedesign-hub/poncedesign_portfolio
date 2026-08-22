# Ponce Design — Portfolio

Static site. Plain HTML, CSS and JavaScript — no framework, no build dependencies
beyond Python 3 (which ships with macOS).

## Run it locally

```bash
python3 -m http.server 4321
```

Then open <http://localhost:4321>.

## How the site is put together

```
index.html              home page — hero, work grid, about, contact
work/<slug>.html        one page per project  ← generated, don't hand-edit
assets/img/case/        full-resolution artwork used inside case studies
assets/video/           optional showreel lives here
data/projects.json      all project content   ← edit this
scripts/build.py        generator
assets/css/style.css    design tokens + all styles
assets/js/main.js       interaction layer
assets/img/thumbs/      project imagery
sitemap.xml             generated
```

`data/projects.json` is the single source of truth. `scripts/build.py` reads it and
writes the 15 case study pages, injects the card grid and the reel band into
`index.html` between their `<!--GRID:START-->` / `<!--CRAFT:START-->` markers, and
regenerates `sitemap.xml`.

**After any content change, run:**

```bash
python3 scripts/build.py
```

## Editing content

### Add or change a project

Edit the entry in `data/projects.json`, then rebuild. Fields:

| field | notes |
|---|---|
| `slug` | becomes `work/<slug>.html` — changing it changes the URL |
| `title`, `client`, `year`, `role` | shown on the card and in the case study facts row |
| `tags` | array; also drives the filter chips |
| `thumb` | filename inside `assets/img/thumbs/` |
| `summary` | card description and case study intro |
| `size` | `"hero-card"` for the lead split card, `"wide"` for half-width, omit for a third |
| `stub` | `true` renders the "case study in progress" scaffold |
| `sections` | the written case study (omit when `stub` is true) |
| `orig` | link to the original Adobe Portfolio page |

### Writing a case study

`sections` is an ordered list of blocks:

```jsonc
{ "h": "Heading" }
{ "p": "Paragraph. <b>Bold</b>, <i>italic</i> and <a href='…'>links</a> are allowed." }
{ "ul": ["First point", "Second point"] }
{ "pull": "A pull quote." }
{ "kpis": [{ "v": "+25%", "l": "What the number means" }] }
{ "note": "Amber callout — use for editor's notes." }
{ "links": [{ "t": "Label", "u": "https://…" }] }
{ "img": "<slug>/file.png", "cap": "Caption", "alt": "…", "wide": true }
```

`img` paths are relative to `assets/img/case/`. Width and height are read off the file
at build time, so images never cause layout shift. `"wide": true` breaks the figure out
of the reading column to the full page width and makes it click-to-enlarge — use it for
journey maps, flow diagrams, and anything unreadable at prose width.

Turning a stub into a real case study: delete `"stub": true`, add a `sections` array,
rebuild.

### Changing the look

Everything lives in the `:root` block at the top of `assets/css/style.css` — the
grayscale ramp, the orange/yellow accents, the off-white surfaces, the type stack
(Roboto, Roboto Condensed, Roboto Mono), the spacing rhythm and the easing curves.
Change a token there and it propagates through both the home page and every case study.

## The craft section

The Development / AI / craft band (`#craft`, between Work and About) is generated from
the `craft` object in `data/projects.json`. It carries five things:

| key | renders as |
|---|---|
| `blocks` | the capability columns — front-end, and AI-assisted design & development |
| `certs` | the certifications list; each row is `t` / `org` / `date` / `u` |
| `motion` | the motion & storytelling note — deliberately secondary |
| `principles` | Rams and Nielsen side by side, with source links |
| `reel` | optional showreel, see below |

Add a certification by appending to `certs` and rebuilding. The list renders in the
order given, so keep it newest-first.

### Optional showreel

`craft.reel` renders a player **only when there is something to play** — an `embed` URL,
or a real file at `src`. With neither, nothing renders at all; there is no placeholder,
because motion is a supporting note in this section rather than its headline. Drop an
MP4 at `assets/video/reel.mp4` and rebuild to make it appear beside the motion copy. It
starts muted, plays only while on screen, and has an opt-in sound button.

## Motion

Handled in `assets/js/main.js`: character-split headline, rotating discipline word,
scroll progress bar, condensing/auto-hiding header, custom cursor with magnetic
buttons, staggered scroll reveals, thumbnail parallax, animated stat counters,
filter re-entry animation, radial mobile drawer, and a page-transition curtain.

Three rules the code holds to:

- **`prefers-reduced-motion` is respected** — every effect is disabled or reduced.
- **Content is never hidden behind a JavaScript callback.** Elements only start
  hidden when `<html>` carries the `js` class (set by an inline script in `<head>`),
  and the reveal observer has a one-second fallback for anything already on screen.
- **The page-transition curtain uncovers via a CSS animation with `fill-mode: both`**,
  so it always resolves to hidden on its own. JavaScript only ever raises it on the
  way out.

## Accessibility

Skip link, visible focus rings, semantic landmarks, `aria-pressed` filter chips with a
live region announcing result counts, labelled mobile menu with escape-to-close, alt
text on every image, and a full no-JavaScript fallback — all 15 project cards are in
the served HTML, so the site works and indexes without scripts.

## Known content gaps

- **No showreel file exists yet.** The craft section reads fine without one; drop an MP4
  at `assets/video/reel.mp4` and rebuild to add it.
- **Nine case studies are stubs.** They render a consistent scaffold and link to the
  original portfolio page. Fill in `sections` in `data/projects.json` to promote one.
  `dexcom-g6-cgm` is the worked example of a fully written one.
- **Two thumbnails are weak crops.** `aura-chat-room.png` and
  `integrations-app-exchange.png` are pale, mostly-empty screenshots that read as blank
  cards against the off-white page. Replacing them with higher-contrast artwork is the
  single biggest visual upgrade available.
- **Card thumbnails are small.** The grid crops came off the Adobe Portfolio CDN at
  430–1100px behind signed URLs, so those exact crops can't be re-fetched larger. The
  build caps every case study cover at 1.5× its source width to avoid visible softness.
  Full-resolution artwork *is* available on the project pages, though — the Dexcom case
  study uses it (`assets/img/case/dexcom-g6-cgm/`, 1200–1800px). The same harvest can be
  repeated for any other project.
- **Only `mobile-aura-voice` has real metrics.** Every number on that page came from
  the source material. No metrics were invented anywhere else — the Dexcom case study
  quotes the journey map and storyboards verbatim rather than inventing outcomes.

## Deploying

It's a static site — any host works (Netlify, Vercel, GitHub Pages, S3). Upload the
whole directory. Before going live, replace `https://poncedesign.com` in
`scripts/build.py` (the `SITE` constant), `robots.txt`, and the `canonical`/`og:` tags
in `index.html` with the real domain, then rebuild.
