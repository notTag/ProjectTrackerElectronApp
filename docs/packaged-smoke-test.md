# Packaged app smoke test

Run this against the packaged `.app` before a release. Unit tests (`bun run test`) cover the logic; this covers what only the real bundle can show: signing, `file://` loading, Launch Services, and the real `userData` path.

Record what you tested on:

- macOS version: `sw_vers -productVersion`
- Build: `git rev-parse --short HEAD`

## Use a throwaway userData

Steps 3 to 8 write to the app's database. Point the app at an empty folder with `PROJECT_TRACKER_USER_DATA` so your real data is never touched. `open` doesn't pass environment variables through, so run the binary inside the bundle directly:

```bash
DATA=$(mktemp -d)
APP=$(ls -d dist/mac*/Project\ Tracker.app | head -1)
launch() { PROJECT_TRACKER_USER_DATA="$DATA" "$APP/Contents/MacOS/Project Tracker"; }
```

## Checklist

1. Build: `bun run dist`. It must finish without errors and leave a `.dmg` and `.zip` in `dist/`.
2. Launch: quit any running Project Tracker, then run `launch`. The window opens with readable text and no blank screen.
3. First run: the app asks for a scan directory. Pick a folder that contains a few git projects. They appear in the list with names, package managers and GitHub links.
4. Edit: change a project's status or notes. Open its board, create a ticket, move it to another lane.
5. Persist: quit with ⌘Q, then `launch` again. The edits from step 4 are still there.
6. Open in: open a project in a terminal (Warp, Terminal, Ghostty or iTerm2) and in an editor (Cursor, Zed or VSCode). Choose an app that isn't installed and check that the toast says a `cd "<path>"` command was copied to the clipboard.
7. GitHub: on a project with a GitHub remote, load pull requests or issues. With Wi-Fi off, the error reads "Could not reach GitHub. Check your connection."
8. Corrupt database: quit, overwrite the DB with junk, relaunch:

   ```bash
   echo junk > "$DATA/project-tracker.sqlite"
   rm -f "$DATA"/project-tracker.sqlite-*
   launch
   ```

   An error dialog names the file and the reason ("file is not a database"), and the app quits after you click OK. The junk file is still there, unchanged.

## Clean up

```bash
rm -rf "$DATA"
```
