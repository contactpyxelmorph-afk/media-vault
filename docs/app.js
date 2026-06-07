const DB_NAME = 'media-vault-pwa';
const DB_VERSION = 2;
const CLIENT_KEY = 'client-id';
const SERVER_KEY = 'server-config';
const DEFAULT_PLAYLIST_ID = 'main-library';
const ALL_PLAYLISTS_ID = 'all';

const els = {
  connectionLabel: document.querySelector('#connectionLabel'),
  serverForm: document.querySelector('#serverForm'),
  serverInput: document.querySelector('#serverInput'),
  runnerStatusBadge: document.querySelector('#runnerStatusBadge'),
  serverStatusDetail: document.querySelector('#serverStatusDetail'),
  testServerButton: document.querySelector('#testServerButton'),
  downloadForm: document.querySelector('#downloadForm'),
  urlInput: document.querySelector('#urlInput'),
  recoverForm: document.querySelector('#recoverForm'),
  recoverJobInput: document.querySelector('#recoverJobInput'),
  playlistSelect: document.querySelector('#playlistSelect'),
  playlistNameInput: document.querySelector('#playlistNameInput'),
  playlistAddButton: document.querySelector('#playlistAddButton'),
  modeRadios: [...document.querySelectorAll('input[name="downloadMode"]')],
  scopeRadios: [...document.querySelectorAll('input[name="downloadScope"]')],
  downloadButton: document.querySelector('#downloadButton'),
  jobBadge: document.querySelector('#jobBadge'),
  jobProgress: document.querySelector('#jobProgress'),
  logBox: document.querySelector('#logBox'),
  storageLabel: document.querySelector('#storageLabel'),
  libraryPlaylistSelect: document.querySelector('#libraryPlaylistSelect'),
  libraryList: document.querySelector('#libraryList'),
  tabs: [...document.querySelectorAll('.tab')],
  views: {
    download: document.querySelector('#downloadView'),
    library: document.querySelector('#libraryView'),
  },
  playerScreen: document.querySelector('#playerScreen'),
  closePlayerButton: document.querySelector('#closePlayerButton'),
  playerCount: document.querySelector('#playerCount'),
  playerTitle: document.querySelector('#playerTitle'),
  modeButton: document.querySelector('#modeButton'),
  videoPlayer: document.querySelector('#videoPlayer'),
  audioPlayer: document.querySelector('#audioPlayer'),
  audioArtwork: document.querySelector('#audioArtwork'),
  previousButton: document.querySelector('#previousButton'),
  nextButton: document.querySelector('#nextButton'),
};

const state = {
  db: null,
  clientId: '',
  serverUrl: '',
  apiToken: '',
  runnerStatus: 'unlinked',
  runnerSupportsPlaylists: null,
  files: [],
  playlists: [],
  selectedPlaylistId: DEFAULT_PLAYLIST_ID,
  libraryPlaylistId: ALL_PLAYLISTS_ID,
  activeJob: null,
  pendingJobs: {},
  pollTimer: null,
  objectUrl: '',
  currentFile: null,
  currentIndex: -1,
  playQueue: [],
  playerMode: 'video',
};

function openDatabase() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      const tx = request.transaction;
      let files;
      if (!db.objectStoreNames.contains('files')) {
        files = db.createObjectStore('files', { keyPath: 'id' });
      } else {
        files = tx.objectStore('files');
      }
      if (!files.indexNames.contains('sourceUrl')) {
        files.createIndex('sourceUrl', 'sourceUrl', { unique: false });
      }
      if (!files.indexNames.contains('createdAt')) {
        files.createIndex('createdAt', 'createdAt', { unique: false });
      }
      if (!files.indexNames.contains('playlistId')) {
        files.createIndex('playlistId', 'playlistId', { unique: false });
      }
      if (!db.objectStoreNames.contains('settings')) {
        db.createObjectStore('settings', { keyPath: 'key' });
      }
      if (!db.objectStoreNames.contains('playlists')) {
        const playlists = db.createObjectStore('playlists', { keyPath: 'id' });
        playlists.createIndex('createdAt', 'createdAt', { unique: false });
      }
    };
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);
  });
}

function transact(storeName, mode, action) {
  return new Promise((resolve, reject) => {
    const tx = state.db.transaction(storeName, mode);
    const store = tx.objectStore(storeName);
    const request = action(store);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);
  });
}

async function getSetting(key, fallback = null) {
  const item = await transact('settings', 'readonly', (store) => store.get(key));
  return item?.value ?? fallback;
}

async function setSetting(key, value) {
  await transact('settings', 'readwrite', (store) => store.put({ key, value }));
}

async function getAllFiles() {
  const files = await transact('files', 'readonly', (store) => store.getAll());
  return files.sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
}

async function saveFileRecord(file) {
  await transact('files', 'readwrite', (store) => store.put(file));
}

async function deleteFileRecord(id) {
  await transact('files', 'readwrite', (store) => store.delete(id));
}

async function getAllPlaylists() {
  const playlists = await transact('playlists', 'readonly', (store) => store.getAll());
  return playlists.sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
}

async function getPlaylist(id) {
  return transact('playlists', 'readonly', (store) => store.get(id));
}

async function savePlaylistRecord(playlist) {
  await transact('playlists', 'readwrite', (store) => store.put(playlist));
}

async function ensureDefaultPlaylist() {
  const existing = await getPlaylist(DEFAULT_PLAYLIST_ID);
  if (existing) {
    return;
  }
  await savePlaylistRecord({
    id: DEFAULT_PLAYLIST_ID,
    name: 'Main Library',
    createdAt: '2024-01-01T00:00:00.000Z',
  });
}

function makeClientId() {
  return `pwa-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function normalizeServerUrl(value) {
  return value.trim().replace(/\/+$/, '');
}

function parseServerLink(value) {
  const trimmed = value.trim();
  if (!trimmed) {
    return { serverUrl: '', apiToken: '' };
  }
  const parsed = new URL(trimmed);
  const token = parsed.searchParams.get('token') || '';
  parsed.searchParams.delete('token');
  return { serverUrl: normalizeServerUrl(parsed.toString()), apiToken: token };
}

function serverLinkForDisplay() {
  if (!state.serverUrl) {
    return '';
  }
  if (!state.apiToken) {
    return state.serverUrl;
  }
  const parsed = new URL(state.serverUrl);
  parsed.searchParams.set('token', state.apiToken);
  return parsed.toString();
}

function authHeaders(extra = {}) {
  return {
    Accept: 'application/json',
    'Content-Type': 'application/json',
    ...(state.apiToken ? { 'X-Api-Token': state.apiToken } : {}),
    ...(state.clientId ? { 'X-Client-Id': state.clientId } : {}),
    ...extra,
  };
}

function runnerHelpMessage(error, action = 'request') {
  const message = error?.message || String(error || '');
  const lower = message.toLowerCase();
  if (lower.includes('load failed') || lower.includes('failed to fetch') || error instanceof TypeError) {
    return `${action} failed: the phone cannot reach the Windows runner. Check that the runner is ON, the different-Wi-Fi Cloudflare link is current, the link was pasted fully including token, and the runner was restarted after the playlist update.`;
  }
  return message || `${action} failed.`;
}

function setRunnerStatus(status, detail = '') {
  state.runnerStatus = status;
  const labels = {
    unlinked: 'Not linked',
    saved: 'Link saved',
    checking: 'Checking',
    online: 'Online',
    offline: 'Offline',
    warning: 'Update runner',
  };
  const classes = ['status-muted', 'status-checking', 'status-online', 'status-offline', 'status-warning'];
  els.runnerStatusBadge.classList.remove(...classes);
  els.runnerStatusBadge.classList.add({
    checking: 'status-checking',
    online: 'status-online',
    offline: 'status-offline',
    warning: 'status-warning',
  }[status] || 'status-muted');
  els.runnerStatusBadge.textContent = labels[status] || 'Unknown';
  if (detail) {
    els.serverStatusDetail.textContent = detail;
  }
}

async function apiJson(path, options = {}) {
  if (!state.serverUrl) {
    throw new Error('Save the home PC runner link first.');
  }
  let response;
  try {
    response = await fetch(`${state.serverUrl}${path}`, {
      ...options,
      headers: authHeaders(options.headers || {}),
    });
  } catch (error) {
    throw new Error(runnerHelpMessage(error, 'Runner request'));
  }
  if (!response.ok) {
    const text = await response.text();
    let detail = text;
    try {
      detail = JSON.parse(text).detail || text;
    } catch {
    }
    const requestError = new Error(detail || `HTTP ${response.status}`);
    requestError.status = response.status;
    requestError.detail = detail;
    throw requestError;
  }
  const contentType = response.headers.get('content-type') || '';
  if (!contentType.includes('application/json')) {
    throw new Error('Runner link did not return app data. Paste the exact link from the Windows runner, not a browser warning page or GitHub page.');
  }
  return response.json();
}

function log(lines) {
  els.logBox.textContent = lines.filter(Boolean).slice(-18).join('\n') || 'Waiting for a download job.';
}

function titleFromFileName(name) {
  return (name || 'Untitled media')
    .replace(/\.[^.]+$/, '')
    .replace(/\s+\[[^\]]+\]$/, '')
    .replace(/_/g, ' ');
}

function safeName(name) {
  return (name || `download-${Date.now()}.mp4`).replace(/[^a-zA-Z0-9._-]+/g, '_');
}

function formatBytes(bytes) {
  if (!bytes) {
    return '0 B';
  }
  const units = ['B', 'KB', 'MB', 'GB'];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(value >= 10 || unit === 0 ? 0 : 1)} ${units[unit]}`;
}

function mediaKind(fileName, mimeType = '') {
  const lowered = `${fileName || ''} ${mimeType}`.toLowerCase();
  if (lowered.includes('audio') || lowered.endsWith('.mp3') || lowered.endsWith('.m4a') || lowered.endsWith('.aac')) {
    return 'audio';
  }
  return 'video';
}

function mediaModeForFile(file) {
  if (file.sourceMode) {
    return file.sourceMode;
  }
  return mediaKind(file.fileName, file.mimeType) === 'audio' ? 'audio' : 'mp4';
}

function modeLabel(mode) {
  return mode === 'audio' ? 'MP3 audio' : 'MP4 video';
}

function selectedDownloadMode() {
  return els.modeRadios.find((radio) => radio.checked)?.value || 'mp4';
}

function selectedDownloadScope() {
  return els.scopeRadios.find((radio) => radio.checked)?.value || 'single';
}

function selectedNoPlaylist() {
  return selectedDownloadScope() !== 'playlist';
}

function updateDownloadButtonLabel() {
  const format = selectedDownloadMode() === 'audio' ? 'MP3' : 'MP4';
  const scope = selectedNoPlaylist() ? '' : ' Playlist';
  els.downloadButton.textContent = `Download${scope} ${format}`;
}

function playlistIdForFile(file) {
  return file.playlistId || DEFAULT_PLAYLIST_ID;
}

function playlistName(id) {
  return state.playlists.find((playlist) => playlist.id === id)?.name || 'Main Library';
}

function currentLibraryFiles() {
  if (state.libraryPlaylistId === ALL_PLAYLISTS_ID) {
    return state.files;
  }
  return state.files.filter((file) => playlistIdForFile(file) === state.libraryPlaylistId);
}

function makePlaylistId() {
  return `playlist-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function fillPlaylistSelect(select, includeAll = false) {
  select.innerHTML = '';
  if (includeAll) {
    const option = document.createElement('option');
    option.value = ALL_PLAYLISTS_ID;
    option.textContent = 'All playlists';
    select.append(option);
  }
  state.playlists.forEach((playlist) => {
    const option = document.createElement('option');
    option.value = playlist.id;
    option.textContent = playlist.name;
    select.append(option);
  });
}

function setActiveView(viewName) {
  els.tabs.forEach((tab) => tab.classList.toggle('active', tab.dataset.view === viewName));
  Object.entries(els.views).forEach(([name, view]) => view.classList.toggle('active', name === viewName));
}

function renderConnection() {
  els.serverInput.value = serverLinkForDisplay();
  if (!state.serverUrl) {
    state.runnerSupportsPlaylists = null;
    els.connectionLabel.textContent = 'Offline player ready';
    setRunnerStatus('unlinked', 'Start the Windows runner app on the home PC, then paste its different-Wi-Fi Cloudflare link when you are on 4G.');
    return;
  }
  els.connectionLabel.textContent = `Runner set: ${state.serverUrl}`;
  if (state.runnerStatus === 'unlinked') {
    setRunnerStatus('saved', 'Runner link saved. Tap Test Link to verify the phone can reach it.');
  }
}

function renderPlaylistControls() {
  fillPlaylistSelect(els.playlistSelect);
  fillPlaylistSelect(els.libraryPlaylistSelect, true);

  if (!state.playlists.some((playlist) => playlist.id === state.selectedPlaylistId)) {
    state.selectedPlaylistId = DEFAULT_PLAYLIST_ID;
  }
  if (
    state.libraryPlaylistId !== ALL_PLAYLISTS_ID
    && !state.playlists.some((playlist) => playlist.id === state.libraryPlaylistId)
  ) {
    state.libraryPlaylistId = ALL_PLAYLISTS_ID;
  }

  els.playlistSelect.value = state.selectedPlaylistId;
  els.libraryPlaylistSelect.value = state.libraryPlaylistId;
}

function renderLibrary() {
  const visibleFiles = currentLibraryFiles();
  els.storageLabel.textContent = state.libraryPlaylistId === ALL_PLAYLISTS_ID
    ? `${state.files.length} file${state.files.length === 1 ? '' : 's'}`
    : `${visibleFiles.length} / ${state.files.length}`;

  if (visibleFiles.length === 0) {
    els.libraryList.innerHTML = state.files.length === 0
      ? '<p class="empty">No files saved on this phone yet.</p>'
      : '<p class="empty">No files saved in this playlist yet.</p>';
    return;
  }

  els.libraryList.innerHTML = '';
  visibleFiles.forEach((file) => {
    const row = document.createElement('article');
    row.className = 'media-row';
    row.innerHTML = `
      <h3></h3>
      <div class="media-meta">
        <span class="playlist-pill"></span>
        <p></p>
      </div>
      <div class="field-group">
        <label>Playlist</label>
        <select class="playlist-move"></select>
      </div>
      <input class="rename-input" />
      <div class="row-actions">
        <button class="play" type="button">Play</button>
        <button class="rename" type="button">Rename</button>
        <button class="delete" type="button">Delete</button>
      </div>
    `;
    row.querySelector('h3').textContent = file.title;
    row.querySelector('.playlist-pill').textContent = playlistName(playlistIdForFile(file));
    row.querySelector('p').textContent = `${modeLabel(mediaModeForFile(file))} · ${formatBytes(file.size)} · ${file.fileName}`;
    const input = row.querySelector('.rename-input');
    input.value = file.title;
    const moveSelect = row.querySelector('.playlist-move');
    fillPlaylistSelect(moveSelect);
    moveSelect.value = playlistIdForFile(file);
    moveSelect.addEventListener('change', async () => {
      file.playlistId = moveSelect.value || DEFAULT_PLAYLIST_ID;
      await saveFileRecord(file);
      await refreshFiles();
    });
    row.querySelector('.play').addEventListener('click', () => playFile(file, 0, true, currentLibraryFiles()));
    row.querySelector('.rename').addEventListener('click', async () => {
      if (!row.classList.contains('editing')) {
        row.classList.add('editing');
        input.focus();
        return;
      }
      file.title = input.value.trim() || 'Untitled media';
      await saveFileRecord(file);
      await refreshFiles();
    });
    row.querySelector('.delete').addEventListener('click', async () => {
      if (!confirm(`Delete "${file.title}" from this phone?`)) {
        return;
      }
      await deleteFileRecord(file.id);
      await refreshFiles();
    });
    els.libraryList.append(row);
  });
}

async function refreshFiles() {
  state.files = await getAllFiles();
  renderLibrary();
}

async function refreshPlaylists() {
  await ensureDefaultPlaylist();
  state.playlists = await getAllPlaylists();
  renderPlaylistControls();
  renderLibrary();
}

async function createPlaylist() {
  const name = els.playlistNameInput.value.trim();
  if (!name) {
    log(['Enter a playlist name first.']);
    return;
  }

  const existing = state.playlists.find((playlist) => playlist.name.toLowerCase() === name.toLowerCase());
  if (existing) {
    state.selectedPlaylistId = existing.id;
    els.playlistNameInput.value = '';
    renderPlaylistControls();
    log([`Using existing playlist: ${existing.name}`]);
    return;
  }

  const playlist = {
    id: makePlaylistId(),
    name,
    createdAt: new Date().toISOString(),
  };
  await savePlaylistRecord(playlist);
  state.selectedPlaylistId = playlist.id;
  state.libraryPlaylistId = playlist.id;
  els.playlistNameInput.value = '';
  await refreshPlaylists();
  log([`Playlist created: ${playlist.name}`]);
}

async function checkHealth({ silent = false } = {}) {
  if (!state.serverUrl) {
    renderConnection();
    if (!silent) {
      log(['Paste and save the Windows runner link first.']);
    }
    return false;
  }
  setRunnerStatus('checking', 'Checking the Windows runner link...');
  try {
    const health = await apiJson('/health');
    state.runnerSupportsPlaylists = health.playlist_files_supported === true;
    if (!health.ok) {
      els.connectionLabel.textContent = 'Home runner unavailable';
      setRunnerStatus('offline', 'The runner answered, but did not report a healthy status.');
      return false;
    }
    els.connectionLabel.textContent = `Home runner online · yt-dlp ${health.yt_dlp_version || ''}`;
    if (state.runnerSupportsPlaylists) {
      setRunnerStatus(
        'online',
        `Connected to runner. Playlist downloads supported. FFmpeg ${health.ffmpeg_available ? 'available' : 'not detected'}.`,
      );
    } else {
      setRunnerStatus('warning', 'Runner is online, but it does not report playlist support. Restart the updated Windows runner, then tap Test Link again.');
    }
    if (!silent) {
      log([state.runnerSupportsPlaylists ? 'Runner link works. Playlist downloads are supported.' : 'Runner link works, but update/restart the runner for playlist downloads.']);
    }
    return true;
  } catch (error) {
    state.runnerSupportsPlaylists = null;
    els.connectionLabel.textContent = 'Home runner unavailable; saved media still works';
    const message = runnerHelpMessage(error, 'Runner test');
    setRunnerStatus('offline', message);
    if (!silent) {
      log([message]);
    }
    return false;
  }
}

function renderJob(job) {
  if (!job) {
    els.jobBadge.textContent = 'Idle';
    els.jobProgress.value = 0;
    log(['Waiting for a download job.']);
    return;
  }
  els.jobBadge.textContent = job.status;
  els.jobProgress.value = job.progress || 0;
  log([
    `${job.status} ${job.percent || '0%'}`,
    job.speed || '',
    job.eta ? `ETA ${job.eta}` : '',
    ...(job.log || []),
    job.error ? `Error: ${job.error}` : '',
  ]);
}

function jobMediaItems(job, sourceMode) {
  const fallbackName = job.playback_name || job.output_name || `${job.id}.${sourceMode === 'audio' ? 'mp3' : 'mp4'}`;
  const files = Array.isArray(job.files) && job.files.length > 0
    ? job.files
    : [{
        name: job.output_name || fallbackName,
        relative_path: job.output_relative_path,
        playback_name: job.playback_name || fallbackName,
        playback_relative_path: job.playback_relative_path,
        file_url: job.file_url,
        playback_url: job.playback_url,
      }];

  return files.map((file, index) => {
    const mediaName = file.playback_name || file.name || fallbackName;
    return {
      index,
      mediaName,
      titleName: file.name || mediaName,
      mediaUrl: file.playback_url || file.file_url,
      relativePath: file.playback_relative_path || file.relative_path || mediaName,
    };
  }).filter((item) => item.mediaUrl);
}

function sourceUrlForJobItem(job, item) {
  if (job.no_playlist !== false) {
    return job.url;
  }
  return `${job.url}#${item.relativePath || item.mediaName || item.index}`;
}

function hasDuplicateMedia(mode, sourceUrl, fileName, isPlaylistJob) {
  const normalizedName = fileName.toLowerCase();
  return state.files.some((file) => {
    if (mediaModeForFile(file) !== mode) {
      return false;
    }
    if (file.sourceUrl === sourceUrl) {
      return true;
    }
    return isPlaylistJob && (file.fileName || '').toLowerCase() === normalizedName;
  });
}

async function downloadCompletedJob(job) {
  const pending = state.pendingJobs[job.id] || {};
  const sourceMode = job.mode || pending.mode || 'mp4';
  const playlistId = pending.playlistId || state.selectedPlaylistId || DEFAULT_PLAYLIST_ID;
  const isPlaylistJob = job.no_playlist === false || pending.noPlaylist === false;
  const mediaItems = jobMediaItems(job, sourceMode);
  if (mediaItems.length === 0) {
    throw new Error('The runner did not return a media file URL.');
  }

  let saved = 0;
  let skipped = 0;
  let totalBytes = 0;

  for (const item of mediaItems) {
    const mediaName = item.mediaName || `${job.id}-${item.index}.${sourceMode === 'audio' ? 'mp3' : 'mp4'}`;
    const fileName = safeName(mediaName);
    const sourceUrl = sourceUrlForJobItem(job, item);

    if (hasDuplicateMedia(sourceMode, sourceUrl, fileName, isPlaylistJob)) {
      skipped += 1;
      continue;
    }

    log([
      `Saving ${saved + skipped + 1}/${mediaItems.length} into ${playlistName(playlistId)}...`,
      mediaName,
      ...(job.log || []),
    ]);
    let response;
    try {
      response = await fetch(item.mediaUrl, {
        headers: authHeaders({ Accept: '*/*' }),
      });
    } catch (error) {
      throw new Error(runnerHelpMessage(error, `Saving ${mediaName}`));
    }
    if (!response.ok) {
      throw new Error(`Could not save ${mediaName}: HTTP ${response.status}`);
    }
    const blob = await response.blob();
    const record = {
      id: `${job.id}-${item.index}-${Date.now()}`,
      jobId: job.id,
      sourceUrl,
      sourcePageUrl: job.url,
      sourceMode,
      playlistId,
      title: titleFromFileName(item.titleName || mediaName),
      fileName,
      mimeType: blob.type || (sourceMode === 'audio' ? 'audio/mpeg' : 'video/mp4'),
      size: blob.size,
      blob,
      createdAt: new Date().toISOString(),
    };
    await saveFileRecord(record);
    state.files.push(record);
    saved += 1;
    totalBytes += blob.size;
  }

  delete state.pendingJobs[job.id];
  state.libraryPlaylistId = playlistId;
  renderPlaylistControls();
  await refreshFiles();
  setActiveView('library');
  log([
    saved > 0
      ? `Saved ${saved} file${saved === 1 ? '' : 's'} (${formatBytes(totalBytes)}) into this phone.`
      : 'No new files saved; everything was already in this phone library.',
    skipped > 0 ? `Skipped ${skipped} duplicate file${skipped === 1 ? '' : 's'}.` : '',
    'Saved files will play without the PC.',
  ]);
}

async function recoverPreviousJob(event) {
  event.preventDefault();
  const jobId = els.recoverJobInput.value.trim();
  if (!/^[a-f0-9]{32}$/i.test(jobId)) {
    log(['Enter the 32-character job id from the runner error path.']);
    return;
  }

  const playlistId = state.selectedPlaylistId || DEFAULT_PLAYLIST_ID;
  state.pendingJobs[jobId] = {
    playlistId,
    mode: selectedDownloadMode(),
    noPlaylist: selectedNoPlaylist(),
  };

  try {
    log([`Recovering existing runner files for job ${jobId}...`]);
    const job = await apiJson(`/api/recover/${jobId}`, { method: 'POST' });
    await downloadCompletedJob(job);
    els.recoverJobInput.value = '';
  } catch (error) {
    delete state.pendingJobs[jobId];
    const message = (error?.message || '').trim();
    const recoveryMessage = message === 'Not Found'
      ? 'Recovery endpoint not found. This link is still reaching an old Windows runner. Close the old runner, start the updated runner package, tap Test Link, then recover again.'
      : error?.status === 404
        ? `Recovery did not find job ${jobId} on the computer reached by this runner link. Use the same Windows computer and runner folder that contains downloads\\${jobId}.`
        : runnerHelpMessage(error, 'Recovery request');
    log([
      recoveryMessage,
    ]);
  }
}

async function pollJob(jobId) {
  window.clearInterval(state.pollTimer);
  state.pollTimer = window.setInterval(async () => {
    try {
      const job = await apiJson(`/api/jobs/${jobId}`);
      state.activeJob = job;
      renderJob(job);
      if (job.status === 'succeeded') {
        window.clearInterval(state.pollTimer);
        await downloadCompletedJob(job);
      } else if (['failed', 'canceled'].includes(job.status)) {
        window.clearInterval(state.pollTimer);
      }
    } catch (error) {
      window.clearInterval(state.pollTimer);
      log([runnerHelpMessage(error, 'Job status check')]);
    }
  }, 2000);
}

async function startDownload(event) {
  event.preventDefault();
  const url = els.urlInput.value.trim();
  const mode = selectedDownloadMode();
  const noPlaylist = selectedNoPlaylist();
  const playlistId = state.selectedPlaylistId || DEFAULT_PLAYLIST_ID;
  if (!url) {
    log(['Paste a URL first.']);
    return;
  }
  if (noPlaylist && state.files.some((file) => file.sourceUrl === url && mediaModeForFile(file) === mode)) {
    log([`That URL is already saved as ${modeLabel(mode)} on this phone.`]);
    setActiveView('library');
    return;
  }
  if (!noPlaylist && state.runnerSupportsPlaylists !== true) {
    const online = await checkHealth({ silent: true });
    if (!online) {
      log(['Playlist download blocked because the runner link is not reachable. Tap Test Link and fix the runner connection first.']);
      return;
    }
    if (state.runnerSupportsPlaylists !== true) {
      log(['Playlist download blocked because the runner is old. Restart the updated Windows runner, then tap Test Link again.']);
      return;
    }
  }

  els.downloadButton.disabled = true;
  try {
    const job = await apiJson('/api/jobs', {
      method: 'POST',
      body: JSON.stringify({ url, mode, no_playlist: noPlaylist, client_id: state.clientId }),
    });
    state.pendingJobs[job.id] = { playlistId, mode, noPlaylist };
    els.urlInput.value = '';
    state.activeJob = job;
    renderJob(job);
    log([
      `Runner started ${noPlaylist ? 'single' : 'playlist'} ${modeLabel(mode)} download for ${playlistName(playlistId)}.`,
      ...(job.log || []),
    ]);
    await pollJob(job.id);
  } catch (error) {
    log([runnerHelpMessage(error, 'Download request')]);
  } finally {
    els.downloadButton.disabled = false;
  }
}

function playlistIndex(file) {
  const queue = state.playQueue.length > 0 ? state.playQueue : state.files;
  return queue.findIndex((item) => item.id === file.id);
}

function activeMedia() {
  return state.playerMode === 'audio' ? els.audioPlayer : els.videoPlayer;
}

function configureMediaElement(element, file, startAt = 0, shouldPlay = true) {
  element.src = state.objectUrl;
  element.currentTime = startAt;
  element.loop = (state.playQueue.length || state.files.length) <= 1;
  element.onended = () => playNext();
  element.onplay = updateMediaSession;
  element.onpause = updateMediaSession;
  if (shouldPlay) {
    const promise = element.play();
    if (promise) {
      promise.catch(() => undefined);
    }
  }
}

function playFile(file, startAt = 0, shouldPlay = true, queue = null) {
  if (state.objectUrl) {
    URL.revokeObjectURL(state.objectUrl);
  }
  state.playQueue = queue?.length ? [...queue] : [...state.files];
  state.objectUrl = URL.createObjectURL(file.blob);
  state.currentFile = file;
  state.currentIndex = playlistIndex(file);
  state.playerMode = mediaKind(file.fileName, file.mimeType);
  els.playerScreen.classList.remove('hidden');
  els.playerTitle.textContent = file.title;
  els.playerCount.textContent = `${state.currentIndex + 1} / ${state.playQueue.length}`;
  applyPlayerMode(startAt, shouldPlay);
}

function applyPlayerMode(startAt = 0, shouldPlay = true) {
  const file = state.currentFile;
  if (!file) {
    return;
  }
  const videoModeAllowed = mediaKind(file.fileName, file.mimeType) === 'video';
  if (!videoModeAllowed) {
    state.playerMode = 'audio';
  }
  els.modeButton.textContent = state.playerMode === 'audio' && videoModeAllowed ? 'Video' : 'Audio';
  els.videoPlayer.classList.toggle('hidden', state.playerMode !== 'video');
  els.audioArtwork.classList.toggle('hidden', state.playerMode !== 'audio');
  els.audioPlayer.classList.toggle('hidden', state.playerMode !== 'audio');

  els.videoPlayer.pause();
  els.audioPlayer.pause();
  const element = activeMedia();
  configureMediaElement(element, file, startAt, shouldPlay);
  updateMediaSession();
}

function switchPlayerMode() {
  const file = state.currentFile;
  if (!file || mediaKind(file.fileName, file.mimeType) !== 'video') {
    return;
  }
  const current = activeMedia();
  const startAt = current.currentTime || 0;
  const shouldPlay = !current.paused;
  state.playerMode = state.playerMode === 'audio' ? 'video' : 'audio';
  applyPlayerMode(startAt, shouldPlay);
}

function playNext() {
  const queue = state.playQueue.length > 0 ? state.playQueue : state.files;
  if (queue.length === 0) {
    closePlayer();
    return;
  }
  const nextIndex = state.currentIndex >= 0 ? state.currentIndex + 1 : 0;
  playFile(queue[nextIndex % queue.length], 0, true, queue);
}

function playPrevious() {
  const queue = state.playQueue.length > 0 ? state.playQueue : state.files;
  if (queue.length === 0) {
    closePlayer();
    return;
  }
  const nextIndex = state.currentIndex >= 0 ? state.currentIndex - 1 : queue.length - 1;
  playFile(queue[(nextIndex + queue.length) % queue.length], 0, true, queue);
}

function closePlayer() {
  els.videoPlayer.pause();
  els.audioPlayer.pause();
  els.videoPlayer.removeAttribute('src');
  els.audioPlayer.removeAttribute('src');
  if (state.objectUrl) {
    URL.revokeObjectURL(state.objectUrl);
  }
  state.objectUrl = '';
  state.currentFile = null;
  state.currentIndex = -1;
  state.playQueue = [];
  els.playerScreen.classList.add('hidden');
}

function updateMediaSession() {
  if (!('mediaSession' in navigator) || !state.currentFile) {
    return;
  }
  navigator.mediaSession.metadata = new MediaMetadata({
    title: state.currentFile.title,
    artist: 'Media Vault',
  });
  navigator.mediaSession.setActionHandler('play', () => activeMedia().play());
  navigator.mediaSession.setActionHandler('pause', () => activeMedia().pause());
  navigator.mediaSession.setActionHandler('nexttrack', playNext);
  navigator.mediaSession.setActionHandler('previoustrack', playPrevious);
}

async function requestPersistentStorage() {
  if (!navigator.storage?.persist) {
    return;
  }
  try {
    const alreadyPersisted = await navigator.storage.persisted();
    const persisted = alreadyPersisted || await navigator.storage.persist();
    if (persisted) {
      log(['Phone storage persistence is enabled for this app.']);
    }
  } catch {
  }
}

async function saveServer(event) {
  event.preventDefault();
  try {
    const parsed = parseServerLink(els.serverInput.value);
    state.serverUrl = parsed.serverUrl;
    state.apiToken = parsed.apiToken;
    state.runnerSupportsPlaylists = null;
    await setSetting(SERVER_KEY, parsed);
    renderConnection();
    await checkHealth({ silent: false });
  } catch (error) {
    const message = error.message || 'Invalid runner link.';
    setRunnerStatus('offline', message);
    log([message]);
  }
}

async function init() {
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./sw.js').catch(() => undefined);
  }

  state.db = await openDatabase();
  state.clientId = await getSetting(CLIENT_KEY);
  if (!state.clientId) {
    state.clientId = makeClientId();
    await setSetting(CLIENT_KEY, state.clientId);
  }
  const config = await getSetting(SERVER_KEY, { serverUrl: '', apiToken: '' });
  state.serverUrl = config.serverUrl || '';
  state.apiToken = config.apiToken || '';

  els.tabs.forEach((tab) => tab.addEventListener('click', () => setActiveView(tab.dataset.view)));
  els.serverForm.addEventListener('submit', saveServer);
  els.testServerButton.addEventListener('click', () => checkHealth({ silent: false }));
  els.downloadForm.addEventListener('submit', startDownload);
  els.recoverForm.addEventListener('submit', recoverPreviousJob);
  els.playlistSelect.addEventListener('change', () => {
    state.selectedPlaylistId = els.playlistSelect.value || DEFAULT_PLAYLIST_ID;
  });
  els.libraryPlaylistSelect.addEventListener('change', () => {
    state.libraryPlaylistId = els.libraryPlaylistSelect.value || ALL_PLAYLISTS_ID;
    renderLibrary();
  });
  els.playlistAddButton.addEventListener('click', createPlaylist);
  els.modeRadios.forEach((radio) => radio.addEventListener('change', updateDownloadButtonLabel));
  els.scopeRadios.forEach((radio) => radio.addEventListener('change', updateDownloadButtonLabel));
  els.closePlayerButton.addEventListener('click', closePlayer);
  els.modeButton.addEventListener('click', switchPlayerMode);
  els.nextButton.addEventListener('click', playNext);
  els.previousButton.addEventListener('click', playPrevious);

  await refreshPlaylists();
  await refreshFiles();
  renderConnection();
  renderJob(null);
  updateDownloadButtonLabel();
  await requestPersistentStorage();
  await checkHealth({ silent: true });
}

init().catch((error) => {
  log([error.message || 'Could not start Media Vault.']);
});
