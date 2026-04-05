# gamemode-news-hook

Replace Steam Game Mode update cards with community group announcements.

Injects JavaScript into Steam's CEF pages via remote debugging protocol to replace
Valve event cards (appid=1675200) with custom community group announcements (SkorionOS / SKOS).

## How it works

1. **XHR Hook** (SharedJSContext) — intercepts `ajaxgetadjacentpartnerevents?appid=1675200` responses and replaces event content with our community announcements
2. **MutationObserver** (BigPicture) — hides like/discuss buttons on replaced cards via zero-width space marker detection
3. **Forced navigation** (manual mode only) — triggers library → settings navigation to force React Query to re-fetch

## File structure

```
src/
  gamemode-news-hook                # Entry script (Python3)
  lib/                              # Library modules
    __init__.py
    cef.py                          # CEF/WebSocket communication layer
    js/
      xhr-hook.js                   # XHR Hook (injected into SharedJSContext)
      observer.js                   # MutationObserver (injected into BigPicture)
  systemd/
    gamemode-news-hook.conf         # systemd drop-in for gamescope-session-plus
```

Install paths: `/usr/bin/gamemode-news-hook` and `/usr/lib/gamemode-news-hook/`

## Architecture

### Entry script `gamemode-news-hook`

- Parse arguments (`--auto`, `--debug`)
- Call `cef.py` to wait for CEF pages
- Fetch visible announcement GIDs (filtering logic)
- Read JS files, fill in parameters (`SK_CLAN`, `VISIBLE_GIDS`), inject via CEF

### `cef.py` — CEF communication layer

- `ws_connect / ws_send / ws_recv` — raw WebSocket (no external deps)
- `evaluate(ws, expression)` — CDP Runtime.evaluate wrapper (with retry)
- `get_pages()` — fetch CEF page list
- `wait_for_pages(timeout)` — poll until CEF is ready
- `connect(host, port, path)` — WebSocket connection with error handling

### `xhr-hook.js` — XHR Hook (SharedJSContext)

- Hook `XMLHttpRequest.prototype.open/send`
- Intercept `ajaxgetadjacentpartnerevents?appid=1675200` responses
- Use lazy getter (`Object.defineProperty`) to replace `responseText` and `response`
- Replace Valve event titles, body, counts in `doReplace()`
- **Never replace**: `gid`, `clan_steamid`, `forum_topic_id` (causes blank screen on expand)
- Receives placeholder params: `/*SK_CLAN*/0`, `/*VISIBLE_GIDS*/[]`, filled by Python

### `observer.js` — MutationObserver (BigPicture)

- Watch DOM changes
- Detect replaced cards (zero-width space `\u200B` marker in body)
- Hide like/discuss button areas on replaced cards

### Sort order mechanism

- Pre-fetch Valve events for two tag combos (`patchnotes` and `patchnotes,stablechannel`)
- Build GID → rank map sorted by time descending
- `doReplace` assigns idx from rank map, fallback counter for unknown GIDs

### Abnormal announcement filtering

- Python fetches community group page (`/announcements`)
- Extract visible GIDs via regex `detail/(\d{10,})`
- Pass to JS to filter `window.__skOurEvents`

### Generation mechanism

- Each deployment generates unique `GEN = Date.now()`
- Old hooks detect `this.__skGen !== GEN` and skip
- Prevents hook chain stacking

## Key parameters

- **Clan Account ID**: `46069703` (SkorionOS)
- **Clan SteamID**: `103582791475591111`
- **Valve AppID**: `1675200` (Steam Deck updates)
- **CEF debug port**: `8080`

## Usage

```bash
# Manual mode (with forced navigation, for debugging)
gamemode-news-hook

# Auto mode (wait for CEF, skip navigation)
gamemode-news-hook --auto

# Debug mode (verbose logging)
gamemode-news-hook --debug
```

## Install

```bash
makepkg -si
```

## Notes

- **Must restart gamescope** (`pkill gamescope`) after modifying hook logic, otherwise old hooks stack
- Auto mode polls for CEF readiness (up to 120s)
- Backup working versions before making changes
