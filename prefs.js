import Gio from 'gi://Gio';
import Gtk from 'gi://Gtk?version=4.0';
import Adw from 'gi://Adw';

import {ExtensionPreferences, gettext as _} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

export default class UsageTrayPreferences extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        const settings = this.getSettings();

        // ---- General page ----
        const general = new Adw.PreferencesPage({
            title: _('General'),
            icon_name: 'view-refresh-symbolic',
        });
        window.add(general);

        const displayGroup = new Adw.PreferencesGroup({
            title: _('Top bar'),
            description: _('What to show and how often to refresh.'),
        });
        general.add(displayGroup);

        const showGo = new Adw.SwitchRow({
            title: _('Show OpenCode Go'),
            subtitle: _('Show Go usage in the top bar label'),
        });
        displayGroup.add(showGo);

        const showCodex = new Adw.SwitchRow({
            title: _('Show Codex'),
            subtitle: _('Show Codex subscription usage in the top bar label'),
        });
        displayGroup.add(showCodex);

        const showClaude = new Adw.SwitchRow({
            title: _('Show Claude'),
            subtitle: _('Show Claude Code usage in the top bar label'),
        });
        displayGroup.add(showClaude);

        settings.bind('show-go', showGo, 'active', Gio.SettingsBindFlags.DEFAULT);
        settings.bind('show-codex', showCodex, 'active', Gio.SettingsBindFlags.DEFAULT);
        settings.bind('show-claude', showClaude, 'active', Gio.SettingsBindFlags.DEFAULT);

        const refreshRow = new Adw.SpinRow({
            title: _('Refresh every'),
            subtitle: _('Minutes between usage checks (2–120)'),
            adjustment: new Gtk.Adjustment({
                lower: 2,
                upper: 120,
                step_increment: 1,
                page_increment: 5,
                value: settings.get_int('refresh-minutes'),
            }),
        });
        displayGroup.add(refreshRow);
        refreshRow.connect('notify::value', () => {
            settings.set_int('refresh-minutes', Math.round(refreshRow.value));
        });
        settings.connect('changed::refresh-minutes', () => {
            const v = settings.get_int('refresh-minutes');
            if (Math.round(refreshRow.value) !== v)
                refreshRow.value = v;
        });

        // ---- OpenCode Go page ----
        const goPage = new Adw.PreferencesPage({
            title: _('OpenCode Go'),
            icon_name: 'go-home-symbolic',
        });
        window.add(goPage);

        const goGroup = new Adw.PreferencesGroup({
            title: _('OpenCode Go API key'),
            description: _('Subscribe at https://opencode.ai/auth, then /connect in OpenCode. Leave empty to auto-read ~/.local/share/opencode/auth.json.'),
        });
        goPage.add(goGroup);

        const goKey = new Adw.PasswordEntryRow({
            title: _('API key'),
        });
        goKey.text = settings.get_string('opencode-go-key');
        goKey.connect('notify::text', () => {
            if (settings.get_string('opencode-go-key') !== goKey.text)
                settings.set_string('opencode-go-key', goKey.text);
        });
        settings.connect('changed::opencode-go-key', () => {
            if (goKey.text !== settings.get_string('opencode-go-key'))
                goKey.text = settings.get_string('opencode-go-key');
        });
        goGroup.add(goKey);

        // ---- Codex page ----
        const cxPage = new Adw.PreferencesPage({
            title: _('Codex'),
            icon_name: 'system-run-symbolic',
        });
        window.add(cxPage);

        const cxGroup = new Adw.PreferencesGroup({
            title: _('Codex subscription'),
            description: _('Install the CLI (npm i -g @openai/codex) and run `codex login`. That writes ~/.codex/auth.json, which this extension auto-reads. Or paste the values manually below.'),
        });
        cxPage.add(cxGroup);

        const authPath = new Adw.EntryRow({
            title: _('auth.json path'),
        });
        authPath.text = settings.get_string('codex-auth-path');
        authPath.connect('notify::text', () => {
            if (settings.get_string('codex-auth-path') !== authPath.text)
                settings.set_string('codex-auth-path', authPath.text);
        });
        cxGroup.add(authPath);

        const cxToken = new Adw.PasswordEntryRow({
            title: _('Access token'),
        });
        cxToken.text = settings.get_string('codex-access-token');
        cxToken.connect('notify::text', () => {
            if (settings.get_string('codex-access-token') !== cxToken.text)
                settings.set_string('codex-access-token', cxToken.text);
        });
        cxGroup.add(cxToken);

        const cxAccount = new Adw.EntryRow({
            title: _('Account ID'),
        });
        cxAccount.text = settings.get_string('codex-account-id');
        cxAccount.connect('notify::text', () => {
            if (settings.get_string('codex-account-id') !== cxAccount.text)
                settings.set_string('codex-account-id', cxAccount.text);
        });
        cxGroup.add(cxAccount);

        const hintGroup = new Adw.PreferencesGroup({
            title: _('Notes'),
            description: _('• Token fields override the file when filled. Clear them to go back to auto-read.\n• Tokens refresh automatically when you use Codex; the tray re-reads the file each poll.\n• Keys are stored in dconf (plaintext). Do not share them.'),
        });
        cxPage.add(hintGroup);

        // ---- Claude page ----
        const ccPage = new Adw.PreferencesPage({
            title: _('Claude'),
            icon_name: 'system-run-symbolic',
        });
        window.add(ccPage);

        const ccGroup = new Adw.PreferencesGroup({
            title: _('Claude Code subscription'),
            description: _('Sign in once with Claude Code. That writes ~/.claude/.credentials.json, which this extension auto-reads. Or paste the values manually below.'),
        });
        ccPage.add(ccGroup);

        const ccAuthPath = new Adw.EntryRow({
            title: _('credentials path'),
        });
        ccAuthPath.text = settings.get_string('claude-auth-path');
        ccAuthPath.connect('notify::text', () => {
            if (settings.get_string('claude-auth-path') !== ccAuthPath.text)
                settings.set_string('claude-auth-path', ccAuthPath.text);
        });
        ccGroup.add(ccAuthPath);

        const ccToken = new Adw.PasswordEntryRow({
            title: _('Access token'),
        });
        ccToken.text = settings.get_string('claude-access-token');
        ccToken.connect('notify::text', () => {
            if (settings.get_string('claude-access-token') !== ccToken.text)
                settings.set_string('claude-access-token', ccToken.text);
        });
        ccGroup.add(ccToken);

        const ccHint = new Adw.PreferencesGroup({
            title: _('Notes'),
            description: _('• Token field overrides the file when filled. Clear it to go back to auto-read.\n• The usage endpoint is rate-limited: keep refresh at 15 min, expired tokens refresh when you reopen Claude Code.\n• Keys are stored in dconf (plaintext). Do not share them.'),
        });
        ccPage.add(ccHint);
    }
}
