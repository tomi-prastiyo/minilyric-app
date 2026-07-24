import { useEffect, useState, useRef } from 'react';
import { Lock, Unlock, X, Music, Pin, PinOff } from 'lucide-react';
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
  const [isAlwaysOnTop, setIsAlwaysOnTop] = useState(true);
  const [appState, setAppState] = useState<AppState>({});
  const [activeLineIndex, setActiveLineIndex] = useState(-1);
  const scrollRef = useRef<HTMLDivElement>(null);
  
  // Real-time progress tracking
  const [localProgressMs, setLocalProgressMs] = useState(0);
  const lastReceivedProgressRef = useRef<number>(-1);
  const localProgressRef = useRef<number>(0);
  const trackNameRef = useRef<string>('');

  useEffect(() => {
    localProgressRef.current = localProgressMs;
  }, [localProgressMs]);

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

        if (newState.track && newState.track.name !== trackNameRef.current) {
          trackNameRef.current = newState.track.name;
          lastReceivedProgressRef.current = -1; // Force sync for new track
        }
        
        if (newState.progressMs !== undefined) {
          const isFirstSync = lastReceivedProgressRef.current === -1;
          const isNewPosition = newState.progressMs !== lastReceivedProgressRef.current;
          
          // Only evaluate synchronization IF Windows provides a truly new position value
          // This prevents the app from comparing its accurate timer with stale data from Windows
          if (isNewPosition) {
            const drift = Math.abs(newState.progressMs - localProgressRef.current);
            lastReceivedProgressRef.current = newState.progressMs;
            
            // Hard sync if the difference is more than 1.5 seconds (seek) or if it's the first sync
            if (isFirstSync || drift > 1500) {
              setLocalProgressMs(newState.progressMs);
            }
          }
        }
      });
    }
  }, []);

  // Timer for smooth lyrics
  useEffect(() => {
    if (!appState.isPlaying) return;
    
    let lastTick = Date.now();
    const interval = setInterval(() => {
      const now = Date.now();
      const delta = now - lastTick;
      lastTick = now;
      
      setLocalProgressMs(prev => prev + delta);
    }, 50);
    
    return () => clearInterval(interval);
  }, [appState.isPlaying]);

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

  const toggleAlwaysOnTop = () => {
    const newTop = !isAlwaysOnTop;
    setIsAlwaysOnTop(newTop);
    if (window.electron?.windowControl) {
      window.electron.windowControl('toggle-top', newTop);
    }
  };

  const closeWindow = () => {
    if (window.electron?.windowControl) {
      window.electron.windowControl('close');
    }
  };

  return (
    <div 
      className={`relative w-full h-full flex flex-col group transition-all duration-500 ${!isLocked ? 'bg-pink-950/40 backdrop-blur-md border border-pink-500/10 shadow-2xl' : 'bg-transparent'}`}
      style={{ WebkitAppRegion: isLocked ? 'no-drag' : 'drag' } as any}
    >
      {/* Invisible Hover Zone for Unlocking (Only when locked) */}
      {isLocked && (
        <div 
          className="absolute top-0 right-0 w-32 h-20 z-[70]"
          onMouseEnter={() => {
            if (window.electron?.windowControl) window.electron.windowControl('capture-mouse');
          }}
          onMouseLeave={() => {
            if (isLocked && window.electron?.windowControl) window.electron.windowControl('ignore-mouse');
          }}
        >
          <div className="absolute top-3 right-3 opacity-0 hover:opacity-100 transition-opacity duration-300">
            <button 
              onClick={toggleLock} 
              className="cursor-pointer p-2 rounded-lg bg-pink-900/80 hover:bg-pink-600/80 text-pink-100 transition-colors shadow-md flex items-center justify-center backdrop-blur-md border border-pink-400/20"
              title="Unlock Window"
            >
              <Unlock size={14} />
            </button>
          </div>
        </div>
      )}

      {/* Minimal Header (Hidden when locked) */}
      <div 
        className={`absolute top-0 left-0 right-0 p-3 flex items-center justify-between z-[60] transition-all duration-300 ${isLocked ? 'opacity-0 -translate-y-full pointer-events-none' : 'opacity-100 translate-y-0'}`}
        style={{ WebkitAppRegion: 'drag' } as any}
      >
        {appState.track ? (
          <div className="flex items-center gap-3 pl-2">
            <div className="w-9 h-9 rounded-full bg-pink-500/20 flex items-center justify-center border border-pink-400/20 shadow-sm animate-pulse" style={{ animationDuration: appState.isPlaying ? '3s' : '0s' }}>
              <Music size={16} className="text-pink-300" />
            </div>
            <div className="flex flex-col">
              <span className="text-white text-sm font-bold leading-tight truncate max-w-[200px] drop-shadow-md">
                {appState.track.name}
              </span>
              <span className="text-pink-200/90 text-xs truncate max-w-[200px] drop-shadow-md">
                {appState.track.artists[0]?.name}
              </span>
            </div>
          </div>
        ) : (
          <div className="pl-3 text-pink-200/80 text-sm font-medium">MiniLyric</div>
        )}

        <div className="flex gap-2 ml-auto pr-1" style={{ WebkitAppRegion: 'no-drag' } as any}>
          <button 
            onClick={toggleAlwaysOnTop} 
            className={`cursor-pointer p-2 rounded-lg transition-colors shadow-sm flex items-center justify-center backdrop-blur-md border border-pink-400/20 ${isAlwaysOnTop ? 'bg-pink-600/80 hover:bg-pink-500/90 text-white' : 'bg-pink-900/30 hover:bg-pink-600/60 text-pink-100'}`}
            title="Toggle Always on Top"
          >
            {isAlwaysOnTop ? <Pin size={14} /> : <PinOff size={14} />}
          </button>
          <button 
            onClick={toggleLock} 
            className="cursor-pointer p-2 rounded-lg bg-pink-900/30 hover:bg-pink-600/60 text-pink-100 transition-colors shadow-sm flex items-center justify-center backdrop-blur-md border border-pink-400/20" 
            title="Lock Window (Click-Through)"
          >
            {isLocked ? <Lock size={14} /> : <Unlock size={14} />}
          </button>
          <button 
            onClick={closeWindow} 
            className="cursor-pointer p-2 rounded-lg bg-pink-900/30 hover:bg-rose-600/80 text-pink-100 transition-colors shadow-sm flex items-center justify-center backdrop-blur-md border border-pink-400/20" 
            title="Close"
          >
            <X size={14} />
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-hidden relative flex flex-col items-center justify-center mt-6">
        
        {!appState.track ? (
          <div className="flex flex-col items-center gap-2 z-10 p-5 rounded-xl bg-pink-900/20 text-center border border-pink-400/10 shadow-lg" style={{ WebkitAppRegion: 'no-drag' } as any}>
            <Music className="w-5 h-5 text-pink-300/80 mb-1" />
            <div className="text-pink-100 font-medium text-sm">
              Waiting for music...
            </div>
          </div>
        ) : !appState.lyrics || appState.lyrics.length === 0 ? (
          <div className="flex flex-col items-center gap-2 z-10 p-4 rounded-xl bg-pink-900/20 border border-pink-400/10 shadow-lg" style={{ WebkitAppRegion: 'no-drag' } as any}>
            <div className="flex items-center gap-2 text-pink-100 font-medium text-sm text-center">
              <Music className="w-4 h-4 text-pink-300 animate-bounce" />
              <span>Searching lyrics...</span>
            </div>
          </div>
        ) : (
          <div 
            ref={scrollRef}
            className="w-full h-full overflow-y-auto hide-scrollbar px-6 py-[30px] pb-[60px]"
            style={{ 
              WebkitAppRegion: 'no-drag',
              maskImage: 'linear-gradient(to bottom, transparent 0%, black 15%, black 85%, transparent 100%)',
              WebkitMaskImage: 'linear-gradient(to bottom, transparent 0%, black 15%, black 85%, transparent 100%)'
            } as any}
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
                    transition={{ type: "spring", stiffness: 300, damping: 25 }}
                    className={`text-center transition-all duration-500 min-h-[28px] my-2 ${
                      isActive 
                        ? 'text-2xl font-bold text-white scale-105 tracking-wide' 
                        : isPassed
                          ? 'text-lg font-medium text-pink-100/40'
                          : 'text-lg font-medium text-pink-100/20'
                    }`}
                    style={{ 
                      textShadow: isActive 
                        ? '0 0 15px rgba(244,114,182,0.5), 0 2px 4px rgba(0,0,0,0.8)' 
                        : '0 1px 3px rgba(0,0,0,0.8)' 
                    }}
                  >
                    {line.text}
                  </motion.div>
                );
              })}
            </AnimatePresence>
          </div>
        )}

      </div>
    </div>
  );
}

export default App;
