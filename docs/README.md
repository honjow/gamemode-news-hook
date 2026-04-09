# gamemode-news-hook

Replace Steam Game Mode update cards with custom announcements.

Injects JavaScript into Steam's CEF pages via remote debugging protocol to replace
Valve event cards with custom announcements from a GitHub/Gitee repository.

## How it works

1. Fetches `announcements.json` from a GitHub/Gitee repo (Markdown announcements built by CI), injects as prefetched events
2. **XHR Hook** (SharedJSContext + BigPicture) — intercepts event API responses and replaces content
3. **MutationObserver** (BigPicture) — hides like/discuss buttons on replaced cards via zero-width space marker
4. **BP Event Patch** (BigPicture) — detects stale Valve events in React fiber; patches card titles via MobX observables, patches expanded detail view by invalidating React.memo and forcing re-render
5. **Auto language detection** — detects Steam UI language via `SteamClient.Settings.GetCurrentLanguage()` and filters by language
6. **Daemon mode** — monitors hook liveness and re-injects on Steam restart or JS context reset; detects OS branch (channel) changes and triggers full re-injection with fresh data

## Configuration

Config file: `/etc/gamemode-news-hook.conf`

```ini
[hook]
# Valve appid whose events will be replaced (1675200 = Steam Deck updates)
target_appid = 1675200

# CEF remote debugging endpoint
cef_host = localhost
cef_port = 8080

# Steam API language code: "auto" detects from Steam client, or explicit like "6_0"
lang_list = auto

# Daemon mode: seconds between hook liveness checks
monitor_interval = 5

# Raw URLs for announcements.json, tried in order (mirror first)
[repo_mirrors]
github = https://raw.githubusercontent.com/SkorionOS/gamemode-news/master/announcements.json
```

Priority: environment variables > config file > defaults.

Environment variables: `GNHOOK_TARGET_APPID`, `GNHOOK_CEF_HOST`,
`GNHOOK_CEF_PORT`, `GNHOOK_LANG_LIST`, `GNHOOK_MONITOR_INTERVAL`.

### Using with your own announcement repo

1. Fork [`SkorionOS/gamemode-news`](https://github.com/SkorionOS/gamemode-news) and add your Markdown announcements to `announcements/`
2. The CI workflow automatically builds `announcements.json` on push
3. Edit `/etc/gamemode-news-hook.conf` and update `[repo_mirrors]` with your repo's raw URLs
4. Restart the service

## File structure

```
src/
  gamemode-news-hook                # Entry script (Python3)
  gamemode-news-hook.conf           # Default config file
  lib/
    __init__.py
    cef.py                          # CEF/WebSocket communication layer
    js/
      xhr-hook.js                   # XHR Hook (injected into SharedJSContext + BigPicture)
      observer.js                   # MutationObserver (injected into BigPicture)
  systemd/
    gamemode-news-hook.service      # systemd user service
```

Install paths:
- `/usr/bin/gamemode-news-hook`
- `/usr/lib/gamemode-news-hook/`
- `/etc/gamemode-news-hook.conf`

## Architecture

### Entry script

- Loads config (file + env overrides)
- Fetches `announcements.json` from repo mirrors, filters by lang/channel, converts Markdown→BBCode, injects as `PREFETCHED_EVENTS`
- Auto-detects Steam UI language via CDP (`SteamClient.Settings.GetCurrentLanguage()`)
- **Manual mode**: connect, inject, navigate, exit
- **Daemon mode** (`--auto`): loop of wait → detect language → fetch → inject → monitor → re-inject
- Monitors OS branch changes via `SteamClient.Updates.GetCurrentOSBranch()` and triggers full re-injection when user switches update channels
- Signal handling: graceful shutdown on SIGTERM/SIGINT

### `cef.py` — CEF communication layer

- Raw WebSocket client (no external dependencies)
- CDP `Runtime.evaluate` wrapper with retry and async Promise support
- Page discovery and polling

### `xhr-hook.js` — XHR Hook

- Injected into both SharedJSContext and BigPicture
- Hooks `XMLHttpRequest.prototype.open/send`
- Intercepts event API responses matching `target_appid`
- Lazy getter replacement for `responseText` and `response`
- Uses pre-injected `PREFETCHED_EVENTS`, refreshes asynchronously from repo mirrors
- Preserves original XHR natives to prevent hook stacking on re-injection
- Generation mechanism invalidates stale hooks
- Flushes `g_PartnerEventStore` MobX cache on injection (SharedJSContext)
- Patches stale React fiber event data via MobX ObservableMap (BigPicture card view)
- Patches expanded detail view BBCode renderers by invalidating React.memo on parent components and triggering forceUpdate (debounced via MutationObserver)
- MutationObserver watches for newly rendered event cards and patches them on the fly

### `observer.js` — MutationObserver

- Detects replaced cards via zero-width space marker
- Hides vote/discuss areas in expanded card view only
- Skips settings page layout (`DialogControlsSection`)

## Usage

```bash
# Manual mode (with forced navigation, for debugging)
gamemode-news-hook

# Daemon mode (wait for CEF, monitor, re-inject)
gamemode-news-hook --auto

# Debug mode (verbose logging)
gamemode-news-hook --debug

# Combined
gamemode-news-hook --auto --debug
```

## Install

```bash
makepkg -si
systemctl --user enable gamemode-news-hook.service
```

The service is bound to `gamescope-session-plus@steam.service` and starts/stops automatically with it.

### Service management

```bash
systemctl --user status gamemode-news-hook
systemctl --user restart gamemode-news-hook
journalctl --user -u gamemode-news-hook -f
```

## Notes

- Must restart the service after modifying hook logic, otherwise old hooks stack
- Daemon mode monitors hook liveness (every 5s) and re-injects on Steam restart, JS context reset, or OS channel switch
- `Restart=on-failure` ensures automatic recovery from crashes
- `python-systemd` is optional; if installed, logs go to systemd journal
- Config file changes take effect on next injection cycle or service restart

## Further reading

- [Steam Event API Research](steam-event-api.md) — OS branches, channel tags, event data structure
