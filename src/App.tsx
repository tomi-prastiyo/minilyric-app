import { useEffect, useState, useRef } from 'react';
import { Lock, Unlock, X, GripHorizontal } from 'lucide-react';
import { AnimatePresence, motion } from 'framer-motion';

// --- TYPES ---
interface LyricLine {
  timeMs: number;
  text: string;
}

interface TrackInfo {
  name: string;
  artists: { name: string }[];
}

interface AppState {
  isPlaying?: boolean;
  track?: TrackInfo | null;
  progressMs?: number;
  lyrics?: LyricLine[] | null;
}

declare global {
  interface Window {
    electron: {
      windowControl: (action: 'close' | 'ignore-mouse' | 'capture-mouse') => void;
      requestState: () => void;
      onAppState: (callback: (state: AppState) => void) => void;
    };
  }
}

function App() {
  const [isLocked, setIsLocked] = useState(false);
  const [appState, setAppState] = useState<AppState>({});
  const [activeLineIndex, setActiveLineIndex] = useState(-1);
  const scrollRef = useRef<HTMLDivElement>(null);
  
  // Real-time progress tracking
  const [localProgressMs, setLocalProgressMs] = useState(0);
  const lastUpdateRef = useRef<number>(Date.now());

  useEffect(() => {
    if (window.electron?.requestState) {
      window.electron.requestState();
    }

    if (window.electron?.onAppState) {
      window.electron.onAppState((newState) => {
        setAppState(prevState => {
          const merged = { ...prevState, ...newState };
          if (newState.lyrics !== undefined) merged.lyrics = newState.lyrics;
          return merged;
        });
        
        if (newState.progressMs !== undefined) {
          setLocalProgressMs(newState.progressMs);
          lastUpdateRef.current = Date.now();
        }
      });
    }
  }, []);

  // Timer for smooth lyrics
  useEffect(() => {
    if (!appState.isPlaying) return;
    const interval = setInterval(() => {
      const now = Date.now();
      const elapsed = now - lastUpdateRef.current;
      setLocalProgressMs((appState.progressMs || 0) + elapsed);
    }, 100);
    return () => clearInterval(interval);
  }, [appState.isPlaying, appState.progressMs]);

  // Sync active lyric line
  useEffect(() => {
    if (!appState.lyrics || appState.lyrics.length === 0) {
      setActiveLineIndex(-1);
      return;
    }

    let currentIndex = -1;
    for (let i = 0; i < appState.lyrics.length; i++) {
      if (localProgressMs >= appState.lyrics[i].timeMs) {
        currentIndex = i;
      } else {
        break;
      }
    }

    if (currentIndex !== activeLineIndex) {
      setActiveLineIndex(currentIndex);
      if (scrollRef.current) {
        const activeElement = scrollRef.current.children[currentIndex] as HTMLElement;
        if (activeElement) {
          activeElement.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
      }
    }
  }, [localProgressMs, appState.lyrics, activeLineIndex]);

  const toggleLock = () => {
    const newLock = !isLocked;
    setIsLocked(newLock);
    if (window.electron?.windowControl) {
      window.electron.windowControl(newLock ? 'ignore-mouse' : 'capture-mouse');
    }
  };

  const closeWindow = () => {
    if (window.electron?.windowControl) {
      window.electron.windowControl('close');
    }
  };

  return (
    <div 
      className={`relative w-full h-full flex flex-col group transition-colors duration-300 ${!isLocked ? 'bg-black/80' : 'bg-transparent'}`}
      style={{ WebkitAppRegion: 'no-drag' } as any}
    >
      
      {!isLocked && (
        <div 
          className="absolute top-0 left-0 right-0 h-6 flex justify-center items-center opacity-0 group-hover:opacity-100 transition-opacity z-50 cursor-move"
          style={{ WebkitAppRegion: 'drag' } as any}
        >
          <div className="bg-black/50 rounded-full px-4 py-1 mt-2">
            <GripHorizontal size={14} className="text-white/50" />
          </div>
        </div>
      )}

      <div className="flex-1 overflow-hidden relative flex flex-col items-center justify-center pt-4" style={{ WebkitAppRegion: 'no-drag' } as any}>
        
        {!appState.track ? (
          <div className="flex flex-col items-center gap-2 z-10 p-6 rounded-xl bg-black/40 text-center">
            <div className="text-white/70 font-medium text-lg">
              Menunggu media diputar di Windows...
            </div>
            <p className="text-xs text-gray-400 mt-2">Putar musik dari Spotify, YouTube Music, iTunes, dll.</p>
          </div>
        ) : !appState.lyrics || appState.lyrics.length === 0 ? (
          <div className="flex flex-col items-center gap-2 z-10 p-4 rounded-xl bg-black/40">
            <div className="text-white/70 font-medium text-lg text-center">
              Mencari lirik: "{appState.track.name}"...
            </div>
          </div>
        ) : (
          <div 
            ref={scrollRef}
            className="w-full h-full overflow-y-auto hide-scrollbar px-8 py-[60px] pb-[80px]"
            style={{ 
              maskImage: 'linear-gradient(to bottom, transparent 0%, black 15%, black 85%, transparent 100%)',
              WebkitMaskImage: 'linear-gradient(to bottom, transparent 0%, black 15%, black 85%, transparent 100%)'
            }}
          >
            <AnimatePresence>
              {appState.lyrics.map((line, index) => {
                const isActive = index === activeLineIndex;
                const isPassed = index < activeLineIndex;
                
                return (
                  <motion.div
                    key={index}
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    className={`text-center transition-all duration-300 min-h-[30px] my-2 ${
                      isActive 
                        ? 'text-3xl font-extrabold text-white text-shadow-glow scale-105' 
                        : isPassed
                          ? 'text-xl font-semibold text-white/40'
                          : 'text-xl font-semibold text-white/30'
                    }`}
                    style={{ textShadow: isActive ? '0 0 20px rgba(255,255,255,0.3)' : '0 2px 4px rgba(0,0,0,0.5)' }}
                  >
                    {line.text}
                  </motion.div>
                );
              })}
            </AnimatePresence>
          </div>
        )}

      </div>

      <div 
        className={`absolute top-2 right-2 p-2 flex gap-2 z-[60] transition-opacity duration-300 ${isLocked ? 'opacity-0 group-hover:opacity-100' : 'opacity-100'}`}
        style={{ WebkitAppRegion: 'no-drag' } as any}
        onMouseEnter={() => {
          if (isLocked && window.electron?.windowControl) window.electron.windowControl('capture-mouse');
        }}
        onMouseLeave={() => {
          if (isLocked && window.electron?.windowControl) window.electron.windowControl('ignore-mouse');
        }}
      >
        <button onClick={toggleLock} className="cursor-pointer p-2 rounded-md bg-black/40 hover:bg-black/70 text-white transition shadow-sm flex items-center justify-center pointer-events-auto backdrop-blur-sm" title="Kunci Jendela (Tembus Klik)">
          {isLocked ? <Lock size={15} /> : <Unlock size={15} />}
        </button>
        <button onClick={closeWindow} className="cursor-pointer p-2 rounded-md bg-black/40 hover:bg-red-600 text-white transition shadow-sm flex items-center justify-center pointer-events-auto backdrop-blur-sm" title="Tutup">
          <X size={15} />
        </button>
      </div>

    </div>
  );
}

export default App;
