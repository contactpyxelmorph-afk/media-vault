# Media Vault PWA

This folder is the free offline iPhone option.

Host `docs/` with GitHub Pages:

1. Push this repository to GitHub.
2. Open repository Settings.
3. Go to Pages.
4. Set the source to `Deploy from a branch`.
5. Select the branch and `/docs`.
6. Open the GitHub Pages URL on the iPhone in Safari.
7. Tap Share, then Add to Home Screen.

How it works:

- The app shell is cached with a service worker, so it can open without the PC after the first load.
- Downloaded MP4/MP3 files are stored in IndexedDB on that phone.
- Playlists are also stored in IndexedDB on that phone.
- Saved files play without the PC or the runner.
- New downloads still need the Windows runner on the home PC.
- When away from home, paste the runner's `different Wi-Fi` Cloudflare link into the Home PC runner field.
- Because GitHub Pages is HTTPS, use the runner's HTTPS Cloudflare link. Browser security may block a plain `http://192.168...` same-Wi-Fi link from an HTTPS PWA.
- App updates only refresh the cached app shell. They do not clear the media or playlist stores.
- Each download can be saved as MP4 video or MP3 audio and assigned to a playlist before it starts.

Limits:

- This does not run `yt-dlp` on the iPhone.
- iOS can evict browser/PWA storage if the device is low on space.
- Locked-screen playback in a web app depends on iOS Safari media behavior and is not as controllable as a native app.
