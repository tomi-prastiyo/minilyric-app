import { app, BrowserWindow, ipcMain } from 'electron';
import path from 'path';
import { fileURLToPath } from 'url';
import Kuroshiro from 'kuroshiro';
import KuromojiAnalyzer from 'kuroshiro-analyzer-kuromoji';
import axios from 'axios';
import { getActiveSessions } from 'windows-media-sessions';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Ensure React is running in dev mode
const isDev = process.env.NODE_ENV === 'development' || !app.isPackaged;

let mainWindow: BrowserWindow | null = null;
let kuroshiro: Kuroshiro | null = null;
let currentTrackId: string | null = null;
let currentLyrics: any[] | null = null;
let pollingInterval: NodeJS.Timeout | null = null;

// Initialize Kuroshiro for Romaji conversion
async function initKuroshiro() {
  kuroshiro = new Kuroshiro();
  await kuroshiro.init(new KuromojiAnalyzer());
  console.log('Kuroshiro initialized');
}

// Fetch Lyrics from LRCLIB with fallback
async function fetchLyrics(trackName: string, artistName: string, durationMs: number) {
  try {
    const params: any = { track_name: trackName, artist_name: artistName };
    if (durationMs > 0) {
      params.duration = Math.round(durationMs / 1000);
    }
    
    let lyricData = null;
    
    try {
      // Try exact match first
      const res = await axios.get('https://lrclib.net/api/get', { params });
      lyricData = res.data;
    } catch (err: any) {
      if (err.response && err.response.status === 404) {
        // Fallback to search API if not exactly matched
        const searchParams: any = { q: `${trackName} ${artistName}` };
        const searchRes = await axios.get('https://lrclib.net/api/search', { params: searchParams });
        if (searchRes.data && searchRes.data.length > 0) {
          // Find the first result with synced lyrics
          lyricData = searchRes.data.find((track: any) => track.syncedLyrics);
        }
      }
    }
    
    if (lyricData && lyricData.syncedLyrics) {
      const lines = lyricData.syncedLyrics.split('\n');
      const parsedLyrics = [];

      for (const line of lines) {
        const match = line.match(/^\[(\d{2}):(\d{2}\.\d{2})\](.*)/);
        if (match) {
          const min = parseInt(match[1]);
          const sec = parseFloat(match[2]);
          const text = match[3].trim();
          
          if (text) {
            let convertedText = text;
            if (kuroshiro && Kuroshiro.Util.hasJapanese(text)) {
              convertedText = await kuroshiro.convert(text, { to: 'romaji', mode: 'spaced' });
            }
            parsedLyrics.push({ timeMs: Math.round((min * 60 + sec) * 1000), text: convertedText });
          }
        }
      }
      return parsedLyrics;
    }
    return [];
  } catch (err) {
    console.error('LRCLIB fetch error:', err);
    return [];
  }
}

// Set SMTC backend path
const backendPath = isDev
  ? path.join(__dirname, '..', 'node_modules', 'windows-media-sessions', 'bin', 'win-x64', 'windows-media-sessions-backend.exe')
  : path.join(process.resourcesPath, 'bin', 'win-x64', 'windows-media-sessions-backend.exe');
process.env.WINDOWS_MEDIA_SESSIONS_BACKEND = backendPath;

async function startPolling() {
  if (pollingInterval) clearInterval(pollingInterval);
  
  pollingInterval = setInterval(async () => {
    if (!mainWindow) return;
    
    try {
      const sessions = await getActiveSessions();
      const validSessions = sessions.filter(s => s.title && s.title.trim() !== '');
      const activeSession = validSessions.find(s => s.playbackStatus === 'playing') || validSessions[0];
      
      if (!activeSession) {
        mainWindow.webContents.send('app-state', { isPlaying: false, track: null });
        return;
      }

      const track = {
        name: activeSession.title,
        artists: [{ name: activeSession.artist || 'Unknown Artist' }]
      };
      
      const isPlaying = activeSession.playbackStatus === 'playing';
      const progressMs = activeSession.timeline?.positionMs || 0;
      const durationMs = activeSession.timeline?.durationMs || 0;

      // Track ID is a composite of title and artist since SMTC doesn't provide unique IDs
      const trackId = `${track.name}-${track.artists[0].name}`;

      if (currentTrackId !== trackId) {
        currentTrackId = trackId;
        currentLyrics = await fetchLyrics(track.name, track.artists[0].name, durationMs);
        mainWindow.webContents.send('app-state', { isPlaying, track, progressMs, lyrics: currentLyrics });
      } else {
        mainWindow.webContents.send('app-state', { isPlaying, track, progressMs });
      }
    } catch (err) {
      console.error('SMTC polling error:', err);
    }
  }, 1000);
}

function createWindow() {
  const { screen } = require('electron');
  const primaryDisplay = screen.getPrimaryDisplay();
  const { width } = primaryDisplay.workAreaSize;

  mainWindow = new BrowserWindow({
    width: 500,
    height: 280,
    x: width - 520,
    y: 30,
    transparent: true,
    frame: false,
    alwaysOnTop: true,
    hasShadow: false,
    icon: path.join(__dirname, isDev ? '../public/icon.png' : '../dist/icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: false,
    },
  });

  if (isDev) {
    mainWindow.loadURL('http://127.0.0.1:5173');
  } else {
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'));
  }

  // Hide from taskbar
  mainWindow.setSkipTaskbar(true);

  // Click-through handling
  ipcMain.on('window-control', (event, action, value) => {
    if (!mainWindow) return;
    if (action === 'close') {
      mainWindow.close();
    } else if (action === 'ignore-mouse') {
      mainWindow.setIgnoreMouseEvents(true, { forward: true });
    } else if (action === 'capture-mouse') {
      mainWindow.setIgnoreMouseEvents(false);
    } else if (action === 'toggle-top') {
      mainWindow.setAlwaysOnTop(!!value);
    }
  });

  // State request
  ipcMain.on('request-state', () => {
    if (mainWindow) {
      mainWindow.webContents.send('app-state', { 
        isPlaying: false, 
        track: null, 
        progressMs: 0, 
        lyrics: currentLyrics 
      });
    }
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
    if (pollingInterval) clearInterval(pollingInterval);
  });
}

app.whenReady().then(async () => {
  await initKuroshiro();
  createWindow();
  startPolling();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
