# ClickUp Tracker

A menu bar time tracker for ClickUp. Replaces Toggl. Mac + Windows.

## What it does

- Lives in your menu bar / system tray
- Click the icon → small floating window pops out
- Start/stop a live timer against any ClickUp task
- Add manual entries (date, time, duration)
- View today's / last 7 days' log, edit durations, delete entries
- All data lives in ClickUp natively (uses `/time_entries` endpoints)

## Quick start (dev mode)

You need **Node.js 18+** installed.

```bash
npm install
npm run dev
```

The app will launch automatically. Look for the dot icon in your menu bar (Mac, top-right) or system tray (Windows, bottom-right). Click it.

**First run:** Paste your ClickUp API token. Get it from:
> ClickUp → click your avatar → Settings → Apps → Generate API Token

Then pick your workspace. Done.

## Building installers

For a real `.dmg` (Mac) or `.exe` (Windows) you can hand to a colleague:

```bash
npm run build:mac    # produces release/*.dmg  (run on a Mac)
npm run build:win    # produces release/*.exe  (run on Windows)
```

Unsigned builds will trigger a "developer not verified" warning on first launch. Right-click → Open on Mac, "More info → Run anyway" on Windows. For a clean install experience you'd add code-signing certs to `package.json` under `build.mac.identity` / `build.win.certificateFile`.

## Architecture

```
electron main process  ──► holds the API token, proxies requests to api.clickup.com
   ↓ (IPC bridge)
react renderer         ──► UI, runs in a tiny chromium window
```

Think of the main process as a tiny local backend that holds your secret and avoids CORS, and the renderer as the React frontend you already know.

## File map

```
src/
├── main/
│   ├── index.js        # tray + window + IPC handlers
│   └── preload.js      # safe bridge to renderer
└── renderer/
    ├── App.jsx                  # routes to Setup or Tracker
    ├── lib/
    │   ├── clickup.js           # API wrapper
    │   └── time.js              # duration formatters / parser
    └── components/
        ├── Setup.jsx            # token + workspace picker
        ├── Tracker.jsx          # shell with tabs
        ├── TimerPanel.jsx       # start/stop UI
        ├── TaskPicker.jsx       # Space → Folder → List → Task drill-down
        ├── ManualEntry.jsx      # add past entries
        └── History.jsx          # today / 7-day log
```

## Ideas to extend

- **Idle detection** — Electron's `powerMonitor.getSystemIdleTime()` can prompt "you've been idle 5 min, discard that time?"
- **Global hotkey** — `globalShortcut.register('CommandOrControl+Shift+T', toggleWindow)` in main process
- **Auto-launch on boot** — `app.setLoginItemSettings({ openAtLogin: true })`
- **Pinned/recent tasks** — store the last N picked tasks for one-tap restart
- **Pomodoro mode** — fire a system notification at 25 min

## Notes

- API token is stored locally via `electron-store` (encrypted on macOS via Keychain when available).
- Polls `time_entries/current` every 10 seconds so if you start a timer in ClickUp's web app, this stays in sync.
- The window auto-hides when it loses focus (like a real menu bar app). Right-click the tray icon to quit.
