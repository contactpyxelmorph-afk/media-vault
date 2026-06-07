# yt-dlp iPhone Controller

This project gives you an iPhone-friendly MP4/MP3 downloader backed by `yt-dlp`.

It does not run the `yt-dlp` Python CLI directly inside the iPhone app. A normal iOS app is sandboxed and is not a good place to execute command-line Python tools, so the practical setup is:

- `server/`: a FastAPI service that runs `yt-dlp` on an always-on machine.
- `mobile/`: an Expo iPhone app for development testing.
- `docs/`: a free GitHub Pages PWA that can be added to the iPhone Home Screen, open offline after first load, and play files saved on that phone.

Use it only for media you own, created, or have permission to download, and respect the rules of the services you access.

## Free Offline iPhone Setup

Use `docs/` for the free offline app option. Host it with GitHub Pages from the `/docs` folder, open the Pages URL in iPhone Safari, then tap Share -> Add to Home Screen.

This gives you:

- free install without App Store upload
- app shell available offline after the first load
- MP4/MP3 storage on the phone through IndexedDB
- phone-local playlists that survive app shell updates
- per-download choice between MP4 video and MP3 audio
- playback of already saved files without the PC

New downloads still need the home PC runner to be on. When the phone is on 4G, use the Windows runner's `different Wi-Fi` Cloudflare link in the PWA's Home PC runner field. Because GitHub Pages is HTTPS, prefer that HTTPS Cloudflare link over a plain same-Wi-Fi `http://192.168...` link.

See `docs/README.md`.

## PC-Off Setup

If your PC is off, the phone still needs a runner somewhere else. Deploy `server/` to a VPS, NAS, Raspberry Pi, or a cloud container host.

The server includes a Docker setup:

```powershell
cd C:\Users\Utente\yt-dlp-iphone-controller\server
docker compose up -d --build
```

Before exposing it on the internet, set a token in `docker-compose.yml`:

```yaml
environment:
  YTDLP_DOWNLOAD_DIR: /downloads
  YTDLP_API_TOKEN: your-long-random-token
```

Then enter the public server URL and token in the iPhone app. Use HTTPS in production through your host, reverse proxy, or tunnel provider.

## Run The Server

```powershell
cd C:\Users\Utente\yt-dlp-iphone-controller\server
python -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install -r requirements.txt
python -m uvicorn main:app --host 0.0.0.0 --port 8000
```

If Windows asks, allow Python through the firewall for private networks.

On the same Wi-Fi network, find your PC IPv4 address:

```powershell
ipconfig
```

The iPhone app should use a server URL like:

```text
http://192.168.1.25:8000
```

## Run The iPhone App

```powershell
cd C:\Users\Utente\yt-dlp-iphone-controller\mobile
npm install
npm start
```

Install Expo Go on the iPhone, scan the QR code, then enter the server URL from above.

Expo Go is a development launcher, so it still depends on your development machine while you are testing. For phone-only use, build and install the app:

```powershell
cd C:\Users\Utente\yt-dlp-iphone-controller\mobile
npx eas build -p ios --profile preview
```

Install that build on the iPhone, then use the URL/token for the always-on runner.

## App Storage

Completed media files are copied from the runner into the app's local document storage:

```text
media-library/
media-library.json
```

The app shows saved files in the storage window. Each saved file can be:

- renamed in the app
- shared/exported to Files or another app
- deleted from app storage

For a standalone iOS build, the app config enables iOS document sharing so the Documents directory can also appear through the Files app. Expo Go may still keep files inside Expo's own sandbox.

## Download Modes

The backend supports these download modes:

- `webm`: WEBM video/audio, merged with `ffmpeg` when needed.
- `best`: best single-file fallback.
- `mp4`: MP4 video/audio, merged with `ffmpeg` when needed.
- `audio`: MP3 extraction with `ffmpeg`.

The free PWA uses only `mp4` and `audio`.

## Useful Checks

Server health:

```powershell
curl http://localhost:8000/health
```

Update yt-dlp inside the server virtual environment:

```powershell
python -m pip install --upgrade yt-dlp
```
