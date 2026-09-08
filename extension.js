import GLib from 'gi://GLib';
import Gio from 'gi://Gio';
import Soup from 'gi://Soup?version=3.0';
import St from 'gi://St';

import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';

const GO_USAGE_URL = 'https://opencode.ai/zen/go/v1/usage';
const CODEX_USAGE_URL = 'https://chatgpt.com/backend-api/wham/usage';
const GO_CONSOLE_URL = 'https://opencode.ai/auth';
const CODEX_CONSOLE_URL = 'https://chatgpt.com/codex';
const BAR_WIDTH = 220;

const GO_AUTH_PATHS = [
    `${GLib.get_home_dir()}/.local/share/opencode/auth.json`,
    `${GLib.get_home_dir()}/.config/opencode/auth.json`,
];

export default class UsageTrayExtension extends Extension {
    enable() {
        console.log('usage-tray v2: enable');
        try {
            this._settings = this.getSettings();
        } catch (e) {
            // Old cached metadata without settings-schema (needs logout/login).
            // Run with defaults + file auto-read so the tray still works.
            console.warn(`usage-tray v2: settings unavailable, using defaults: ${e}`);
            this._settings = null;
        }
        this._goData = null;
        this._cxData = null;
        this._goError = null;
        this._cxError = null;
        this._signalIds = [];

        this._button = new PanelMenu.Button(0.0, this.metadata.name, false);
        this._label = new St.Label({
            text: '…',
            y_align: 2,
            style_class: 'opencode-go-label',
        });
        this._button.add_child(this._label);
        Main.panel.addToStatusArea(this.uuid, this._button, 1, 'center');

        this._session = new Soup.Session();
        this._session.timeout = 20;

        // Re-render on any pref change. Timer restart on interval change.
        // Settings may be null before a logout/login picks up the new schema.
        if (this._settings) {
            for (const key of ['opencode-go-key', 'codex-access-token', 'codex-account-id', 'codex-auth-path', 'show-go', 'show-codex']) {
                this._signalIds.push(this._settings.connect(`changed::${key}`, () => this._refresh()));
            }
            this._signalIds.push(this._settings.connect('changed::refresh-minutes', () => {
                this._restartTimer();
                this._refresh();
            }));
        }

        this._restartTimer();
        this._refresh();
    }

    disable() {
        if (this._timerId) {
            GLib.Source.remove(this._timerId);
            this._timerId = null;
        }
        for (const id of this._signalIds)
            this._settings?.disconnect(id);
        this._signalIds = [];
        this._session?.abort();
        this._session = null;
        this._button?.destroy();
        this._button = null;
        this._label = null;
        this._settings = null;
        this._goData = this._cxData = null;
    }

    // ---------- settings / credentials ----------

    _refreshSeconds() {
        const m = this._settings?.get_int('refresh-minutes') ?? 15;
        return Math.max(2, Math.min(120, m)) * 60;
    }

    _restartTimer() {
        if (this._timerId)
            GLib.Source.remove(this._timerId);
        this._timerId = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, this._refreshSeconds(), () => {
            this._refresh();
            return GLib.SOURCE_CONTINUE;
        });
    }

    _readJsonFile(path) {
        try {
            const expanded = path.startsWith('~/')
                ? `${GLib.get_home_dir()}/${path.slice(2)}`
                : path;
            const file = Gio.File.new_for_path(expanded);
            const [ok, contents] = file.load_contents(null);
            if (!ok)
                return null;
            return JSON.parse(new TextDecoder().decode(contents));
        } catch (e) {
            return null;
        }
    }

    _resolveGoKey() {
        const fromPrefs = this._settings?.get_string('opencode-go-key')?.trim();
        if (fromPrefs)
            return fromPrefs;
        for (const p of GO_AUTH_PATHS) {
            const auth = this._readJsonFile(p);
            const entry = auth?.['opencode-go'] ?? auth?.['opencode'];
            if (entry && typeof entry.key === 'string' && entry.key)
                return entry.key;
        }
        return null;
    }

    _resolveCodexCreds() {
        const prefToken = this._settings?.get_string('codex-access-token')?.trim();
        const prefAccount = this._settings?.get_string('codex-account-id')?.trim();
        if (prefToken)
            return {token: prefToken, accountId: prefAccount || null, source: 'prefs'};

        const customPath = this._settings?.get_string('codex-auth-path')?.trim();
        const candidates = [];
        if (customPath)
            candidates.push(customPath);
        const codexHome = GLib.getenv('CODEX_HOME');
        if (codexHome)
            candidates.push(`${codexHome}/auth.json`);
        candidates.push(`${GLib.get_home_dir()}/.codex/auth.json`);

        for (const p of candidates) {
            const auth = this._readJsonFile(p);
            if (!auth)
                continue;
            // Preferred shape: {tokens: {access_token, account_id}}
            const t = auth.tokens ?? auth;
            const token = t?.access_token ?? auth?.access_token ?? null;
            const accountId = t?.account_id ?? auth?.account_id ?? null;
            if (token)
                return {token, accountId, source: p};
        }
        return {token: null, accountId: null, source: null};
    }

    // ---------- HTTP ----------

    _fetchJson(url, headers) {
        return new Promise((resolve, reject) => {
            const msg = Soup.Message.new('GET', url);
            for (const [k, v] of Object.entries(headers)) {
                if (v)
                    msg.request_headers.append(k, v);
            }
            this._session.send_and_read_async(msg, GLib.PRIORITY_DEFAULT, null, (sess, res) => {
                try {
                    const bytes = sess.send_and_read_finish(res);
                    const status = msg.get_status();
                    if (status !== 200) {
                        reject(new Error(`HTTP ${status}`));
                        return;
                    }
                    resolve(JSON.parse(new TextDecoder().decode(bytes.get_data())));
                } catch (e) {
                    reject(e);
                }
            });
        });
    }

    async _refresh() {
        const showGo = this._settings?.get_boolean('show-go') ?? true;
        const showCx = this._settings?.get_boolean('show-codex') ?? true;

        // Fetch independently so one failure doesn't hide the other.
        if (showGo) {
            const key = this._resolveGoKey();
            if (!key) {
                this._goData = null;
                this._goError = 'key?';
            } else {
                try {
                    const data = await this._fetchJson(GO_USAGE_URL, {
                        'Authorization': `Bearer ${key}`,
                        'User-Agent': 'gnome-usage-tray/2.0',
                    });
                    if (!data?.usage)
                        throw new Error('bad shape');
                    this._goData = data;
                    this._goError = null;
                } catch (e) {
                    console.warn(`usage-tray: go refresh failed: ${e}`);
                    this._goData = null;
                    this._goError = `${e}`.includes('401') || `${e}`.includes('403') ? 'auth' : 'err';
                }
            }
        } else {
            this._goData = null;
            this._goError = null;
        }

        if (showCx) {
            const {token, accountId} = this._resolveCodexCreds();
            if (!token) {
                this._cxData = null;
                this._cxError = 'login?';
            } else {
                try {
                    const data = await this._fetchJson(CODEX_USAGE_URL, {
                        'Authorization': `Bearer ${token}`,
                        'ChatGPT-Account-Id': accountId,
                        'Accept': 'application/json',
                        'User-Agent': 'codex_cli_rs/0.0.0',
                        'Origin': 'https://chatgpt.com',
                    });
                    this._cxData = data;
                    this._cxError = null;
                } catch (e) {
                    console.warn(`usage-tray: codex refresh failed: ${e}`);
                    this._cxData = null;
                    this._cxError = `${e}`.includes('401') || `${e}`.includes('403') ? 'expired' : 'err';
                }
            }
        } else {
            this._cxData = null;
            this._cxError = null;
        }

        this._updateLabel();
        this._renderMenu();
    }

    // ---------- label ----------

    _goPercent() {
        const u = this._goData?.usage;
        if (!u)
            return null;
        return Math.max(u.rolling?.percent ?? 0, u.weekly?.percent ?? 0, u.monthly?.percent ?? 0);
    }

    _cxPercent() {
        const rl = this._cxData?.rate_limit;
        if (!rl)
            return null;
        const vals = [];
        if (typeof rl.primary_window?.used_percent === 'number')
            vals.push(rl.primary_window.used_percent);
        if (typeof rl.secondary_window?.used_percent === 'number')
            vals.push(rl.secondary_window.used_percent);
        if (!vals.length)
            return null;
        return Math.max(...vals);
    }

    _updateLabel() {
        if (!this._label)
            return;
        const showGo = this._settings?.get_boolean('show-go') ?? true;
        const showCx = this._settings?.get_boolean('show-codex') ?? true;
        const parts = [];
        if (showGo) {
            const p = this._goPercent();
            parts.push(p === null ? `Go ${this._goError ?? '--'}` : `Go ${p}%`);
        }
        if (showCx) {
            const p = this._cxPercent();
            parts.push(p === null ? `Cx ${this._cxError ?? '--'}` : `Cx ${p}%`);
        }
        this._label.text = parts.length ? parts.join('  ·  ') : '•';
    }

    // ---------- menu ----------

    _sectionHeader(menu, text) {
        const item = new PopupMenu.PopupMenuItem(text, {reactive: false, can_focus: false});
        item.sensitive = false;
        item.add_style_class_name('usage-tray-header');
        menu.addMenuItem(item);
    }

    _barRow(menu, title, pct, sub) {
        const item = new PopupMenu.PopupBaseMenuItem({reactive: false, can_focus: false});
        const line = new St.BoxLayout({style_class: 'opencode-go-row-line'});
        const name = new St.Label({text: title, x_expand: true});
        const pctLabel = new St.Label({text: `${pct}%`, style_class: 'opencode-go-row-pct'});
        line.add_child(name);
        line.add_child(pctLabel);

        const track = new St.Widget({style_class: 'opencode-go-bar'});
        const fill = new St.Widget({style_class: 'opencode-go-bar-fill' + (pct >= 80 ? ' opencode-go-bar-warn' : '')});
        fill.width = Math.round(BAR_WIDTH * Math.max(0, Math.min(100, pct)) / 100);
        track.add_child(fill);

        const box = new St.BoxLayout({vertical: true, style_class: 'opencode-go-row'});
        box.add_child(line);
        box.add_child(track);
        if (sub) {
            const subLabel = new St.Label({text: sub, style_class: 'usage-tray-sub'});
            box.add_child(subLabel);
        }
        item.add_child(box);
        menu.addMenuItem(item);
    }

    _renderMenu() {
        if (!this._button)
            return;
        const menu = this._button.menu;
        menu.removeAll();
        const showGo = this._settings?.get_boolean('show-go') ?? true;
        const showCx = this._settings?.get_boolean('show-codex') ?? true;

        if (showGo) {
            this._sectionHeader(menu, 'OpenCode Go');
            const u = this._goData?.usage;
            if (!u) {
                const item = new PopupMenu.PopupMenuItem(
                    this._goError === 'key?' ? 'Go API key not set (see Settings)' : `Go: failed to load (${this._goError ?? '?'})`);
                item.sensitive = false;
                menu.addMenuItem(item);
            } else {
                for (const [k, title] of [['rolling', 'Rolling · 5h'], ['weekly', 'Weekly'], ['monthly', 'Monthly']]) {
                    const w = u[k] ?? {};
                    this._barRow(menu, title, w.percent ?? 0, w.resetsAt ? `resets ${this._fmtIso(w.resetsAt)}` : null);
                }
            }
            menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
        }

        if (showCx) {
            const plan = this._cxData?.plan_type ? `Codex · ${this._cxData.plan_type}` : 'Codex';
            this._sectionHeader(menu, plan);
            const rl = this._cxData?.rate_limit;
            if (!rl) {
                let msg = `Codex: failed to load (${this._cxError ?? '?'})`;
                if (this._cxError === 'login?')
                    msg = 'Codex: run `codex login` or set token in Settings';
                else if (this._cxError === 'expired')
                    msg = 'Codex: token expired — re-run `codex login`';
                const item = new PopupMenu.PopupMenuItem(msg);
                item.sensitive = false;
                menu.addMenuItem(item);
            } else {
                if (rl.primary_window)
                    this._barRow(menu, this._cxWindowName(rl.primary_window, 'Primary'), rl.primary_window.used_percent ?? 0, this._fmtCxReset(rl.primary_window));
                if (rl.secondary_window)
                    this._barRow(menu, this._cxWindowName(rl.secondary_window, 'Secondary'), rl.secondary_window.used_percent ?? 0, this._fmtCxReset(rl.secondary_window));
                for (const extra of (this._cxData.additional_rate_limits ?? []).slice(0, 3)) {
                    if (typeof extra?.used_percent === 'number')
                        this._barRow(menu, extra.model ?? extra.label ?? 'Model', extra.used_percent, null);
                }
            }
            menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
        }

        const updated = new PopupMenu.PopupMenuItem(`Updated ${this._fmtTime(new Date())}`);
        updated.sensitive = false;
        menu.addMenuItem(updated);

        menu.addAction('Refresh now', () => this._refresh());
        if (showGo) {
            menu.addAction('Open OpenCode console', () => {
                Gio.AppInfo.launch_default_for_uri(GO_CONSOLE_URL, null);
            });
        }
        if (showCx) {
            menu.addAction('Open Codex usage', () => {
                Gio.AppInfo.launch_default_for_uri(CODEX_CONSOLE_URL, null);
            });
        }
        menu.addAction('Settings…', () => this.openPreferences());
    }

    // ---------- formatting ----------

    _cxWindowName(w, fallback) {
        const s = w.limit_window_seconds;
        if (!s)
            return fallback;
        if (s <= 6 * 3600)
            return `Rolling · ${Math.round(s / 3600)}h`;
        if (s <= 1.5 * 86400)
            return 'Daily';
        if (s <= 7.5 * 86400)
            return 'Weekly';
        if (s <= 32 * 86400)
            return 'Monthly';
        return fallback;
    }

    _fmtCxReset(w) {
        // Prefer relative countdown (reset_at can be days out — HH:MM alone misleads).
        if (typeof w.reset_after_seconds === 'number')
            return `resets in ${this._fmtDur(w.reset_after_seconds)}`;
        if (w.reset_at) {
            const d = new Date(w.reset_at * 1000);
            return `resets ${this._fmtTime(d)}`;
        }
        return null;
    }

    _fmtIso(iso) {
        return this._fmtGoReset(iso) ?? iso;
    }

    // The Go API returns an absolute UTC timestamp; display the remaining
    // duration so this matches the OpenCode console instead of local HH:MM.
    _fmtGoReset(iso) {
        try {
            const ms = new Date(iso).getTime() - Date.now();
            if (Number.isNaN(ms))
                return null;
            if (ms <= 0)
                return 'resetting…';
            return `resets in ${this._fmtDur(ms / 1000)}`;
        } catch (e) {
            return null;
        }
    }

    _fmtDur(secs) {
        // The web consoles floor countdowns rather than rounding them up.
        secs = Math.max(0, Math.floor(secs));
        const d = Math.floor(secs / 86400);
        const h = Math.floor((secs % 86400) / 3600);
        const m = Math.floor((secs % 3600) / 60);
        if (d > 0)
            return `${d}d ${h}h`;
        if (h > 0)
            return `${h}h ${m}m`;
        if (m > 0)
            return `${m}m`;
        return `${secs}s`;
    }

    _fmtTime(d) {
        const h = String(d.getHours()).padStart(2, '0');
        const m = String(d.getMinutes()).padStart(2, '0');
        return `${h}:${m}`;
    }
}
