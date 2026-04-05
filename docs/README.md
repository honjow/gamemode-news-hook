# gamemode-news-hook

Replace Steam Game Mode update cards with community group announcements.

Injects JavaScript into Steam's CEF pages via remote debugging protocol to replace
Valve event cards with custom community group announcements.

## How it works

1. **XHR Hook** (SharedJSContext) — intercepts event API responses and replaces content with community announcements
2. **MutationObserver** (BigPicture) — hides like/discuss buttons on replaced cards via zero-width space marker
3. **Daemon mode** — monitors hook liveness and re-injects on Steam restart or JS context reset
4. **Blacklist filter** — excludes broken announcements (present in API but missing from community page)

## Configuration

Config file: `/etc/gamemode-news-hook.conf`

```ini
[hook]
# Steam community group Account ID
clan_id = 46069703

# Valve appid whose events will be replaced (1675200 = Steam Deck updates)
target_appid = 1675200

# CEF remote debugging endpoint
cef_host = localhost
cef_port = 8080

# Steam API language code
lang_list = 6_0

# Daemon mode: seconds between hook liveness checks
monitor_interval = 10

# Minimum seconds between announcement re-fetches in JS
refresh_debounce = 10
```

Priority: environment variables > config file > defaults.

Environment variables: `GNHOOK_CLAN_ID`, `GNHOOK_TARGET_APPID`, `GNHOOK_CEF_HOST`,
`GNHOOK_CEF_PORT`, `GNHOOK_LANG_LIST`, `GNHOOK_MONITOR_INTERVAL`, `GNHOOK_REFRESH_DEBOUNCE`.
`SK_CLAN` is also supported for backward compatibility.

### Using with your own community group

1. Find your group's Account ID from your Steam community group URL or API
2. Edit `/etc/gamemode-news-hook.conf` and set `clan_id` to your group's ID
3. Restart gamescope or the daemon process

## File structure

```
src/
  gamemode-news-hook                # Entry script (Python3)
  gamemode-news-hook.conf           # Default config file
  lib/
    __init__.py
    cef.py                          # CEF/WebSocket communication layer
    js/
      xhr-hook.js                   # XHR Hook (injected into SharedJSContext)
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
- **Manual mode**: connect, inject, navigate, exit
- **Daemon mode** (`--auto`): loop of wait → inject → monitor → re-inject
- Signal handling: graceful shutdown on SIGTERM/SIGINT

### `cef.py` — CEF communication layer

- Raw WebSocket client (no external dependencies)
- CDP `Runtime.evaluate` wrapper with retry
- Page discovery and polling

### `xhr-hook.js` — XHR Hook

- Hooks `XMLHttpRequest.prototype.open/send`
- Intercepts event API responses matching `target_appid`
- Lazy getter replacement for `responseText` and `response`
- Live-refreshes announcements on each intercepted request (with debounce)
- Generation mechanism prevents stale hook stacking

### `observer.js` — MutationObserver

- Detects replaced cards via zero-width space marker
- Hides vote/discuss areas in expanded card view only
- Skips settings page layout (`DialogControlsSection`)

### Blacklist filter

- Python compares API announcements with community page
- GIDs present in API but missing from page are blacklisted
- Cached across network failures

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
- Daemon mode monitors hook liveness and re-injects on Steam restart or JS context reset
- `Restart=on-failure` ensures automatic recovery from crashes
- `python-systemd` is optional; if installed, logs go to systemd journal
- Config file changes take effect on next injection cycle or service restart
