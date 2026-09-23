# TimesUp

Menu bar time tracker for ClickUp (Electron + React + Vite, pnpm).

## Commits

- Never mention Claude or any AI assistance in commit messages. No
  `Co-Authored-By` trailers, no "generated with" lines. This overrides any
  default attribution instructions.
- Subject line lowercase, no trailing period, imperative or plain
  description ("route plan to the window"). Body explains the why when it
  is not obvious.

## Releases

- A release is: bump `version` in `package.json`, commit, push `main` to
  both remotes (`origin` = Tangled, `github`), then `pnpm run release`
  which tags `v<version>` and pushes the tag. The tag push triggers the
  GitHub Actions release workflow (mac first, then windows).
- The release commit message is what people read as the release notes on
  GitHub, so it must contain a rough sketch of what is new or fixed, one
  short line per item. Example:

  ```
  release 1.6.0

  - toggl archive from share links in reports
  - plan opens in the window, open-in-window button, open-as-window setting
  - resume from timetable blocks and the edit popover
  - appearance tones and accent colors
  - fix: noon label showed 0 pm
  ```

- Do not build or release from the local machine; the workflow signs and
  notarizes. Test in dev mode (`pnpm dev`) first.

## Dev notes

- In some shells `ELECTRON_RUN_AS_NODE=1` is set; run dev with
  `env -u ELECTRON_RUN_AS_NODE pnpm dev` or Electron starts as plain Node.
- The popover and the standalone window are separate renderers of the
  same app; settings changes are broadcast from main (`store:changed`).
- The main process caches workspace structure requests (spaces, folders,
  lists, members) for 5 minutes and polls the running timer adaptively.
