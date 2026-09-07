# GNOME AI Sub Indicator

A GNOME Shell top-bar tray that shows your **OpenCode Go** and **OpenAI Codex (ChatGPT subscription)** usage at a glance. Configure everything from **Extension Manager** — no config files to edit by hand.

Top bar label looks like:

```
Go 2%  ·  Cx 65%
```

Click it for per-window bars, reset countdowns, and quick links to both consoles.

## Features

- **Two sources, one tray**
  - OpenCode Go: 5-hour / weekly / monthly windows via `GET https://opencode.ai/zen/go/v1/usage`
  - Codex subscription (Plus/Pro): primary/secondary windows via `GET https://chatgpt.com/backend-api/wham/usage`
- **Extension Manager settings** (`prefs.js` + GSettings): paste API keys/tokens or leave empty for file auto-detect, toggle each source, set refresh interval (2–120 min, default 15)
- **Credential auto-detect**
  - Go: `~/.local/share/opencode/auth.json` → `opencode-go.key` (falls back to `~/.config/opencode/auth.json`)
  - Codex: `$CODEX_HOME/auth.json` → `~/.codex/auth.json` (written by `codex login`); re-read every poll so CLI token refreshes just work
- **Defensive by design**: each source fails independently, 401 shows `expired` instead of killing the other readout, undocumented endpoints are parsed leniently
- GNOME 50 / 51, `Soup 3`, no Gtk in `extension.js`, no St in `prefs.js`

## Requirements

- GNOME Shell 50+ (Wayland or X11)
- OpenCode with a Go subscription for the Go readout ([subscribe](https://opencode.ai/auth))
- Codex CLI logged in for the Codex readout:
  ```bash
  npm i -g @openai/codex
  codex login   # writes ~/.codex/auth.json
  ```

## Install

```bash
UUID=opencode-go-usage@pranavpp.github.io
mkdir -p ~/.local/share/gnome-shell/extensions/$UUID
cp extension.js prefs.js metadata.json stylesheet.css ~/.local/share/gnome-shell/extensions/$UUID/
mkdir -p ~/.local/share/gnome-shell/extensions/$UUID/schemas
cp schemas/*.gschema.xml ~/.local/share/gnome-shell/extensions/$UUID/schemas/
glib-compile-schemas ~/.local/share/gnome-shell/extensions/$UUID/schemas/
gnome-extensions enable $UUID
```

> GNOME caches extension metadata per session: after first install or a `metadata.json`/schema change, **Log Out → Log In** once. Later `extension.js` tweaks only need disable/enable.

Uninstall:

```bash
gnome-extensions disable opencode-go-usage@pranavpp.github.io
rm -rf ~/.local/share/gnome-shell/extensions/opencode-go-usage@pranavpp.github.io
```

## Configure

Extension Manager → **Usage Tray** → ⚙️, or:

```bash
gnome-extensions prefs opencode-go-usage@pranavpp.github.io
```

| Setting | Empty means | Where to get the value |
|---|---|---|
| OpenCode Go API key | auto-read `opencode/auth.json` | [opencode.ai/auth](https://opencode.ai/auth) → subscribe → `/connect` in OpenCode |
| Codex auth.json path | auto: `$CODEX_HOME/auth.json`, then `~/.codex/auth.json` | `codex login` creates it |
| Codex access token / account ID | auto-read from that file; filled values override the file | advanced / multi-account use |

Until `codex login` exists the tray shows `Cx login?`; an expired token shows `Cx expired`.

## How it works

```
extension.js (gnome-shell process, St/Clutter)
  ├─ PanelMenu.Button in panel center + St.Label  ("Go 2% · Cx 65%")
  ├─ GLib timer (refresh-minutes) + Soup 3 GETs
  │    ├─ opencode.ai/zen/go/v1/usage        (Bearer: Go key)
  │    └─ chatgpt.com/backend-api/wham/usage (Bearer: ChatGPT OAuth + ChatGPT-Account-Id)
  └─ PopupMenu sections with bar rows + reset countdowns

prefs.js (separate gjs process, Gtk4/Adwaita)
  └─ Adw.PreferencesWindow ↔ GSettings (org.gnome.shell.extensions.opencode-go-usage)
```

The Codex endpoint is the same one the Codex CLI polls (undocumented, may change — the extension parses it defensively and only needs read-only usage).

## Security

- Keys live in **dconf (plaintext)** and in your existing `auth.json` files. This matches how the CLIs store them, but treat the machine accordingly.
- The extension **never writes** credentials and never refreshes the Codex token itself — the CLI owns refresh.
- Never commit `auth.json`, tokens, or `schemas/gschemas.compiled` (all git-ignored here). Before pushing, this repo is scanned for `sk-…`, `eyJ…`, refresh tokens, etc.

## Develop / debug

```bash
# reload code
gnome-extensions disable opencode-go-usage@pranavpp.github.io
gnome-extensions enable opencode-go-usage@pranavpp.github.io

# shell-side logs
journalctl -f -o cat /usr/bin/gnome-shell | grep usage-tray
# prefs-side logs
journalctl -f -o cat /usr/bin/gjs
# watch settings change live
dconf watch /org/gnome/shell/extensions/opencode-go-usage/
```

## License

MIT — see [LICENSE](LICENSE) (or treat as MIT if absent in this snapshot).
