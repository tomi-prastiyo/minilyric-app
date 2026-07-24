import { useEffect, useState, useRef } from 'react';
import { Lock, Unlock, X, Music } from 'lucide-react';
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

  const closeWindow = () => {
    if (window.electron?.windowControl) {
      window.electron.windowControl('close');
    }
  };

  return (
    <div 
      className={`relative w-full h-full flex flex-col group transition-colors duration-500 ${!isLocked ? 'bg-rose-950/60 backdrop-blur-sm shadow-inner shadow-pink-500/20' : 'bg-transparent'}`}
      style={{ WebkitAppRegion: isLocked ? 'no-drag' : 'drag' } as any}
    >
      <div className="flex-1 overflow-hidden relative flex flex-col items-center justify-center pt-4">
        
        {!appState.track ? (
          <div className="flex flex-col items-center gap-3 z-10 p-6 rounded-2xl bg-pink-900/30 text-center border border-pink-400/20 shadow-xl shadow-pink-900/30 animate-pulse" style={{ WebkitAppRegion: 'no-drag' } as any}>
            <div className="p-3 bg-pink-500/20 rounded-full">
              <Music className="w-6 h-6 text-pink-300" />
            </div>
            <div className="text-pink-100 font-medium text-lg">
              Waiting for music to play...
            </div>
            <p className="text-xs text-pink-300/80 mt-1">Play music from Spotify, YouTube Music, iTunes, etc.</p>
          </div>
        ) : !appState.lyrics || appState.lyrics.length === 0 ? (
          <div className="flex flex-col items-center gap-2 z-10 p-5 rounded-2xl bg-pink-900/30 border border-pink-400/20 shadow-xl shadow-pink-900/30" style={{ WebkitAppRegion: 'no-drag' } as any}>
            <div className="flex items-center gap-3 text-pink-100 font-medium text-lg text-center animate-pulse">
              <Music className="w-5 h-5 text-pink-300 animate-spin" style={{ animationDuration: '3s' }} />
              <span>Finding lyrics: "{appState.track.name}"...</span>
            </div>
          </div>
        ) : (
          <div 
            ref={scrollRef}
            className="w-full h-full overflow-y-auto hide-scrollbar px-8 py-[60px] pb-[80px]"
            style={{ 
              WebkitAppRegion: 'no-drag', // Allows scrolling without dragging the window
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
                    initial={{ opacity: 0, y: 15 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ type: "spring", stiffness: 300, damping: 25 }}
                    className={`text-center transition-all duration-500 min-h-[30px] my-3 ${
                      isActive 
                        ? 'text-3xl font-extrabold text-pink-50 scale-110 tracking-wide' 
                        : isPassed
                          ? 'text-xl font-semibold text-pink-200/50'
                          : 'text-xl font-semibold text-pink-200/30'
                    }`}
                    style={{ 
                      textShadow: isActive 
                        ? '0 0 25px rgba(244,114,182,0.9), 0 0 50px rgba(219,39,119,0.5)' 
                        : '0 2px 5px rgba(0,0,0,0.6)' 
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

      <div 
        className={`absolute top-3 right-3 p-2 flex gap-2 z-[60] transition-opacity duration-300 ${isLocked ? 'opacity-0 group-hover:opacity-100' : 'opacity-100'}`}
        style={{ WebkitAppRegion: 'no-drag' } as any}
        onMouseEnter={() => {
          if (isLocked && window.electron?.windowControl) window.electron.windowControl('capture-mouse');
        }}
        onMouseLeave={() => {
          if (isLocked && window.electron?.windowControl) window.electron.windowControl('ignore-mouse');
        }}
      >
        <button 
          onClick={toggleLock} 
          className="cursor-pointer p-2 rounded-xl bg-pink-900/40 hover:bg-pink-600/80 text-pink-100 transition-all shadow-md shadow-pink-950/50 flex items-center justify-center pointer-events-auto backdrop-blur-md border border-pink-400/20 hover:scale-110" 
          title="Lock Window (Click-Through)"
        >
          {isLocked ? <Lock size={16} /> : <Unlock size={16} />}
        </button>
        <button 
          onClick={closeWindow} 
          className="cursor-pointer p-2 rounded-xl bg-pink-900/40 hover:bg-rose-600/90 text-pink-100 transition-all shadow-md shadow-pink-950/50 flex items-center justify-center pointer-events-auto backdrop-blur-md border border-pink-400/20 hover:scale-110" 
          title="Close"
        >
          <X size={16} />
        </button>
      </div>

    </div>
  );
}

export default App;
