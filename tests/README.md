# Tests

```
npm test              # everything: type check, unit + API (Vitest), then end-to-end (Playwright)
npm run typecheck     # tsc on the server (no output files)
npm run test:unit     # Vitest only (a few seconds)
npm run test:e2e      # Playwright only (about 2 minutes)
npx playwright install chromium   # once, for the end-to-end tests
```

Nothing here touches your real data or the server on port 4545, and nothing needs the internet.

| Folder | Runner | What |
| --- | --- | --- |
| `unit/` | Vitest | `lib/*` in-process: store (history rule, playlists, settings, `tildify`, `cleanTrack`), sources parsing (Audius, Archive, Radio Browser, Jamendo, SoundCloud canonical links, LRCLIB `sameSong`), library scanning (tags, folder fallback, `.lrc`). |
| `api/` | Vitest | Starts a real server (`server.ts`) on its own port and checks the HTTP API: routes, JSON shapes, host check, JSON-only mutations, Range requests, SSE events, sessions and takeover, phone access on PORT+1. |
| `e2e/` | Playwright | The scenario list from `CLAUDE.md` in Chromium: every screen in every language, language switch while playing, handoff, one player per device and tab, phone touch seeking and menu, offline buffer, SoundCloud widget, icon sync, phone login, history, lyrics, Media Session. |
| `support/` | | Shared pieces (below). |

## How the test servers work

`support/server.js` starts `server.ts` with:

- its own `PORT` (API tests 4710/4720, end-to-end 4730; the phone listener is PORT+1),
- a temporary `DATA_DIR` whose `db.json` points at a temporary music folder,
- a generated library (`support/fixtures.js`): small WAV files with RIFF tags, one untagged file (folder fallback) and one `.lrc` sidecar,
- `--import support/fake-net-preload.js`, which replaces `fetch()` with canned answers from Audius, Internet Archive, Radio Browser, LRCLIB, SoundCloud oEmbed, ListenBrainz and Jamendo (`support/fake-net.js`). Requests to other hosts fail as if offline.

In the browser, requests that leave the test server are blocked. SoundCloud's Widget API is replaced by `support/fake-soundcloud-widget.js`, which records what the app asks it to do. `phone.local` resolves to 127.0.0.1, so a test can act like a phone on Wi-Fi (the offline buffer skips local files on localhost). Service workers are blocked in tests.

`TUNES_SERVER_ENTRY` selects the server entry file (default `server.ts`). `TUNES_BROWSER` points Playwright at an installed Chromium browser (for example Brave) instead of its own.

## Writing end-to-end tests for the React port

The tests drive the app through the DOM and the class names in `css/app.css` (`.tr`, `.deck`, `.handoff`, `body.is-playing`, …). Keep those class names in the React components and the tests keep working. The few places that reach into app modules (player, offline buffer, i18n) go through `appModule()` in `e2e/helpers.js`. When the module layout changes, update that one function.
