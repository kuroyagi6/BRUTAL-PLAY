import React from 'react';
import { Keyboard, Sun, Moon, Volume2, Gauge, Trash2, RotateCcw, HardDrive, ListMusic, Sparkles, Waves, AudioLines, Timer, Copy, Type, Languages, Monitor, Tablet, Smartphone, ZoomIn, Folder, FolderPlus, FolderSync, Image as ImageIcon, Radio, Youtube, Smartphone as PhoneIcon, Wifi, ShieldCheck, ShieldOff, LogOut, Globe, Cable, Zap, Users, DownloadCloud, RefreshCw, Mic2, BookOpen, KeyRound, X as XIcon, Radar as RadarIcon, Cloud } from 'lucide-react';
import type { WireShape, WireCurrent } from './WiresLayer';
import { useOnlineArtist } from '../hooks/useOnlineArtist';
import { useOnlineLyrics, useAutoLyrics } from '../hooks/useOnlineLyrics';
import { useGeniusMeaning, useGeniusToken } from '../hooks/useGenius';
import { countMeanings, clearMeanings } from '../services/dbService';
import { useOnlineRadar } from '../hooks/useRadar';
import { useArtistPrefetch } from '../hooks/useArtistPrefetch';
import { useArtistImages } from '../hooks/useArtistImages';
import type { RemoteStatus, RemoteDevice } from '../remote/useRemoteServer';
import { VISUALIZER_MODES, VisualizerMode } from './Visualizer';
import { formatSize, formatTime } from '../utils/format';
import { FONT_PRESETS } from '../theme/fontPresets';
import { Lang } from '../i18n/strings';
import { usePlayer } from '../player/PlayerContext';

const LANG_OPTIONS: { id: Lang; label: string }[] = [
  { id: 'ru', label: 'РУССКИЙ' },
  { id: 'en', label: 'ENGLISH' },
  { id: 'mixed', label: 'RU · EN' },
];

const ACCENT_PRESETS = [
  { name: 'GREEN', value: '#00FF41' },
  { name: 'BLUE', value: '#0055FF' },
  { name: 'CYAN', value: '#00E5FF' },
  { name: 'PINK', value: '#FF0080' },
  { name: 'ORANGE', value: '#FF5500' },
  { name: 'YELLOW', value: '#FFD400' },
  { name: 'PURPLE', value: '#9D00FF' },
  { name: 'RED', value: '#FF2222' },
];

const SPEED_PRESETS = [0.5, 0.75, 1, 1.25, 1.5, 2];
const SLEEP_PRESETS = [15, 30, 60];
const ZOOM_PRESETS = [0.8, 0.9, 1, 1.1, 1.25];

type ViewMode = 'desktop' | 'tablet' | 'mobile';
const VIEW_OPTIONS: { id: ViewMode; label: string; icon: React.ReactNode }[] = [
  { id: 'desktop', label: 'DESKTOP', icon: <Monitor size={16} /> },
  { id: 'tablet', label: 'TABLET', icon: <Tablet size={16} /> },
  { id: 'mobile', label: 'MOBILE', icon: <Smartphone size={16} /> },
];

// Cable routing, previewed with the same shape the desktop actually draws — a
// label alone ("CURVED"/"STRAIGHT") doesn't show what you're picking.
const WIRE_SHAPE_OPTIONS: { id: WireShape; label: string; d: string }[] = [
  { id: 'curved', label: 'CURVED', d: 'M 3 16 C 15 16, 21 6, 33 6' },
  { id: 'straight', label: 'STRAIGHT', d: 'M 3 16 L 33 6' },
];

const WIRE_CURRENT_OPTIONS: { id: WireCurrent; label: string; icon: React.ReactNode }[] = [
  { id: 'bolt', label: 'BOLT', icon: <Zap size={16} /> },
  { id: 'quiet', label: 'QUIET', icon: <Cable size={16} /> },
];

// Settings as a desktop window (was a modal overlay). Renders the content that
// fills a BrutalWindow; the window frame supplies the title bar + close/minimize.
interface SettingsViewProps {
  setShowShortcuts: (show: boolean) => void;
  theme: 'dark' | 'light';
  toggleTheme: () => void;
  visualizerMode: VisualizerMode;
  setVisualizerMode: (mode: VisualizerMode) => void;
  watchFolders: boolean;
  setWatchFolders: (v: boolean) => void;
  stationsEnabled: boolean;
  setStationsEnabled: (v: boolean) => void;
  youtubeEnabled: boolean;
  setYoutubeEnabled: (v: boolean) => void;
  cloudEnabled: boolean;
  setCloudEnabled: (v: boolean) => void;
  /** Detected cloud roots, for the toggle's status line. */
  cloudSourceCount: number;
  cloudScanning: boolean;
  cloudScanned: boolean;
  remoteEnabled: boolean;
  setRemoteEnabled: (v: boolean) => void;
  remoteStatus: RemoteStatus | null;
  remoteDevices: RemoteDevice[];
  onTrustDevice: (id: string, trusted: boolean) => void;
  onKickDevice: (id: string) => void;
  dynamicTheme: boolean;
  setDynamicTheme: (v: boolean) => void;
  accentColor: string | null;
  setAccentColor: (c: string | null) => void;
  fontPreset: string;
  setFontPreset: (id: string) => void;
  lang: Lang;
  setLang: (l: Lang) => void;
  viewMode: ViewMode;
  setViewMode: (v: ViewMode) => void;
  zoom: number;
  setZoom: (z: number) => void;
  wireShape: WireShape;
  setWireShape: (s: WireShape) => void;
  wireCurrent: WireCurrent;
  setWireCurrent: (c: WireCurrent) => void;
  onOpenBackgrounds: () => void;
  folders: { path: string; count: number }[];
  onAddFolder: () => void;
  trackCount: number;
  onResetLayout: () => void;
  onClearLibrary: () => void;
  onResetSettings: () => void;
  onRemoveDuplicates: () => Promise<number>;
}

function timeAgo(ts: number): string {
  const s = Math.max(0, Math.round((Date.now() - ts) / 1000));
  if (s < 5) return 'NOW';
  if (s < 60) return `${s}S AGO`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m}M AGO`;
  const h = Math.round(m / 60);
  return `${h}H AGO`;
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="font-mono text-[10px] text-brutal-white/30 uppercase mb-3 tracking-widest">{children}</p>
  );
}

export function SettingsView({
  setShowShortcuts,
  theme,
  toggleTheme,
  visualizerMode,
  setVisualizerMode,
  watchFolders,
  setWatchFolders,
  stationsEnabled,
  setStationsEnabled,
  youtubeEnabled,
  setYoutubeEnabled,
  cloudEnabled,
  setCloudEnabled,
  cloudSourceCount,
  cloudScanning,
  cloudScanned,
  remoteEnabled,
  setRemoteEnabled,
  remoteStatus,
  remoteDevices,
  onTrustDevice,
  onKickDevice,
  dynamicTheme,
  setDynamicTheme,
  accentColor,
  setAccentColor,
  fontPreset,
  setFontPreset,
  lang,
  setLang,
  viewMode,
  setViewMode,
  zoom,
  setZoom,
  wireShape,
  setWireShape,
  wireCurrent,
  setWireCurrent,
  onOpenBackgrounds,
  folders,
  onAddFolder,
  trackCount,
  onResetLayout,
  onClearLibrary,
  onResetSettings,
  onRemoveDuplicates,
}: SettingsViewProps) {
  // Playback settings come from the player context; everything else here is
  // App-level config (theme, language, folders, remote) and stays as props.
  const {
    volume, setVolume, playbackRate, setPlaybackRate,
    crossfade, setCrossfade, normalizeVolume, setNormalizeVolume,
    streamPlayback, setStreamPlayback, sleepDeadline, setSleepTimer, diskUsage,
  } = usePlayer();
  const { playlist } = usePlayer();
  const [onlineArtist, setOnlineArtist] = useOnlineArtist();
  const [onlineLyrics, setOnlineLyrics] = useOnlineLyrics();
  // Its own opt-in, read straight from the flag hook — no prop threading needed,
  // and the RADAR window sees the change immediately via the hook's event.
  const [onlineRadar, setOnlineRadar] = useOnlineRadar();
  const [autoLyrics, setAutoLyrics] = useAutoLyrics();
  // Lyric MEANINGS (Genius annotations) — its own opt-in AND the user's own
  // token, since Genius is the one lookup here that needs a credential.
  const [geniusMeaning, setGeniusMeaning] = useGeniusMeaning();
  const [geniusToken, setGeniusToken] = useGeniusToken();
  const [tokenDraft, setTokenDraft] = React.useState<string>('');
  const [tokenShown, setTokenShown] = React.useState<boolean>(false);
  // How many songs have meanings stored for offline use. Null until read.
  const [meaningCount, setMeaningCount] = React.useState<number | null>(null);
  React.useEffect(() => {
    if (!geniusMeaning) return;
    let cancelled = false;
    countMeanings()
      .then((n: number) => !cancelled && setMeaningCount(n))
      .catch(() => !cancelled && setMeaningCount(0));
    return () => {
      cancelled = true;
    };
  }, [geniusMeaning]);
  // The library-wide photo walk that fills the cache Spotlight reads.
  const prefetch = useArtistPrefetch(playlist);
  const artistImages = useArtistImages(onlineArtist);
  const [confirmAction, setConfirmAction] = React.useState<null | 'library' | 'settings'>(null);
  const [now, setNow] = React.useState(Date.now());
  const [dupResult, setDupResult] = React.useState<string | null>(null);

  // Tick every second while a sleep timer is running so the countdown stays live.
  React.useEffect(() => {
    if (!sleepDeadline) return;
    setNow(Date.now());
    const iv = window.setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(iv);
  }, [sleepDeadline]);

  const sleepRemaining = sleepDeadline ? Math.max(0, Math.round((sleepDeadline - now) / 1000)) : null;

  return (
    // `@container`: every size variant below measures THIS panel, not the
    // viewport. Tailwind's md:/lg: would be useless here — maximizing a window
    // changes the window's box, never the screen's, so a viewport breakpoint is
    // on (or off) identically in both states.
    <div className="@container h-full overflow-y-auto custom-scrollbar bg-brutal-black">
      {/* Portrait (narrow panel): one readable column. Landscape (wide panel):
          see the section flow below — the width buys more settings on screen
          rather than stretching every control across the window. */}
      <div className="max-w-2xl @4xl:max-w-6xl mx-auto p-6 @2xl:p-8 min-h-full flex flex-col">
        <div className="mb-6 border-b-4 border-brutal-white pb-4 shrink-0">
          <h2 className="text-3xl font-display uppercase leading-none">SETTINGS // НАСТРОЙКИ</h2>
          <p className="font-mono text-xs text-brutal-neon mt-2 uppercase tracking-widest">SYSTEM_CONFIG_V2.0</p>
        </div>

        {/* Sections are a single stack until the panel is wide, then they flow
            into two CSS columns (multicol, not grid: the sections have wildly
            different heights and grid rows would align them into dead space).
            `break-inside-avoid` keeps a section from splitting across columns.
            SYSTEM opts out via `column-span: all` — see its wrapper below. */}
        <div className="flex-1 [&>div]:mb-6 [&>div:last-child]:mb-0 [&>div]:break-inside-avoid @4xl:columns-2 @4xl:gap-8">
          {/* GENERAL */}
          <div>
            <SectionLabel>GENERAL</SectionLabel>
            <div className="space-y-3">
              <button
                onClick={() => setShowShortcuts(true)}
                className="w-full brutal-btn flex items-center justify-between group"
              >
                <div className="flex items-center gap-3">
                  <Keyboard size={20} />
                  <span className="text-xl">COMMANDS</span>
                </div>
                <span className="font-mono text-[10px] opacity-50">VIEW / EDIT_SHORTCUTS</span>
              </button>

              <button
                onClick={toggleTheme}
                className="w-full brutal-btn flex items-center justify-between group bg-brutal-white text-brutal-black"
              >
                <div className="flex items-center gap-3">
                  {theme === 'dark' ? <Sun size={20} /> : <Moon size={20} />}
                  <span className="text-xl">INVERT_THEME</span>
                </div>
                <span className="font-mono text-[10px] opacity-50 uppercase">{theme === 'dark' ? 'LIGHT_MODE' : 'DARK_MODE'}</span>
              </button>

              {/* Online artist profiles: fetch bio/photo from MusicBrainz +
                  Wikipedia for the artist page. Off by default — it
                  sends the artist name to those services. */}
              <button
                onClick={() => setOnlineArtist(!onlineArtist)}
                className={`w-full p-3 border-2 flex items-center justify-between font-mono text-xs uppercase transition-colors ${
                  onlineArtist
                    ? 'bg-brutal-neon text-brutal-black border-brutal-black'
                    : 'border-brutal-white/20 hover:border-brutal-neon'
                }`}
              >
                <div className="flex items-center gap-3">
                  <Globe size={16} />
                  <span>ONLINE_ARTIST_PROFILES</span>
                </div>
                <span className="font-display">{onlineArtist ? 'ON' : 'OFF'}</span>
              </button>
              <p className="font-mono text-[10px] text-brutal-white/40 uppercase">
                FETCH_ARTIST_PHOTO // DEEZER, BIO_+_TAGS // MUSICBRAINZ_+_WIKIPEDIA. SENDS_ARTIST_NAME_TO_THOSE_SERVICES.
              </p>

              {/* Library-wide photo walk. Artist photos are cached per artist, and
                  Spotlight only ever READS that cache (it must not fetch while you
                  type). So without a walk like this, a photo only ever appears for
                  an artist whose ARTIST tab you happened to open. */}
              {onlineArtist && (
                <>
                  <button
                    onClick={prefetch.running ? prefetch.stop : prefetch.start}
                    className="w-full p-3 border-2 border-brutal-white/20 hover:border-brutal-neon flex items-center justify-between font-mono text-xs uppercase transition-colors"
                  >
                    <div className="flex items-center gap-3">
                      {prefetch.running ? <XIcon size={16} /> : <Users size={16} />}
                      <span>{prefetch.running ? 'STOP_FETCHING' : 'FETCH_ARTIST_PHOTOS'}</span>
                    </div>
                    {prefetch.running ? (
                      <RefreshCw size={14} className="animate-spin text-brutal-neon" />
                    ) : (
                      <span className="font-display text-brutal-white/40">
                        {artistImages.withPhotos}/{artistImages.total || '—'}
                      </span>
                    )}
                  </button>

                  {prefetch.running ? (
                    <div className="font-mono text-[10px] uppercase text-brutal-neon">
                      <div className="flex items-center justify-between mb-1">
                        <span className="truncate pr-2">{prefetch.current ?? '…'}</span>
                        <span className="shrink-0 tabular-nums">
                          {prefetch.done}/{prefetch.total}
                        </span>
                      </div>
                      <div className="h-1 bg-brutal-white/10">
                        <div
                          className="h-full bg-brutal-neon transition-[width] duration-200"
                          style={{
                            width: `${prefetch.total ? (prefetch.done / prefetch.total) * 100 : 0}%`,
                          }}
                        />
                      </div>
                    </div>
                  ) : prefetch.error === 'offline' ? (
                    <p className="font-mono text-[10px] text-brutal-white/40 uppercase">
                      LOOKUP_UNAVAILABLE_HERE // NEEDS_THE_DESKTOP_APP
                    </p>
                  ) : prefetch.done > 0 ? (
                    <p className="font-mono text-[10px] text-brutal-white/40 uppercase">
                      DONE // {prefetch.done}_ARTISTS
                      {prefetch.failed > 0 && ` // ${prefetch.failed}_FAILED`}
                    </p>
                  ) : (
                    <p className="font-mono text-[10px] text-brutal-white/40 uppercase">
                      LOOK_UP_EVERY_ARTIST_ONCE // ~1_REQUEST_EACH. SKIPS_ALREADY_CACHED.
                    </p>
                  )}
                </>
              )}

              {/* Online lyrics: separate opt-in from artist profiles — different
                  data to a different service. */}
              <button
                onClick={() => setOnlineLyrics(!onlineLyrics)}
                className={`w-full p-3 border-2 flex items-center justify-between font-mono text-xs uppercase transition-colors ${
                  onlineLyrics
                    ? 'bg-brutal-neon text-brutal-black border-brutal-black'
                    : 'border-brutal-white/20 hover:border-brutal-neon'
                }`}
              >
                <div className="flex items-center gap-3">
                  <Mic2 size={16} />
                  <span>ONLINE_LYRICS</span>
                </div>
                <span className="font-display">{onlineLyrics ? 'ON' : 'OFF'}</span>
              </button>
              <p className="font-mono text-[10px] text-brutal-white/40 uppercase">
                FETCH_TIME-SYNCED_LYRICS // LRCLIB. SENDS_TITLE_+_ARTIST_TO_THAT_SERVICE.
              </p>

              {onlineLyrics && (
                <>
                  <button
                    onClick={() => setAutoLyrics(!autoLyrics)}
                    className={`w-full p-3 border-2 flex items-center justify-between font-mono text-xs uppercase transition-colors ${
                      autoLyrics
                        ? 'bg-brutal-neon text-brutal-black border-brutal-black'
                        : 'border-brutal-white/20 hover:border-brutal-neon'
                    }`}
                  >
                    <div className="flex items-center gap-3">
                      <DownloadCloud size={16} />
                      <span>AUTO_FETCH_LYRICS</span>
                    </div>
                    <span className="font-display">{autoLyrics ? 'ON' : 'OFF'}</span>
                  </button>
                  <p className="font-mono text-[10px] text-brutal-white/40 uppercase">
                    LOOK_UP_AUTOMATICALLY_WHEN_A_TRACK_HAS_NO_LYRICS // ONE_REQUEST_PER_NEW_TRACK_PLAYED.
                  </p>
                </>
              )}

              {/* Lyric MEANINGS. A separate service, a separate opt-in, and the
                  only one needing a credential — Genius serves annotations to
                  API clients but never lyric text, so this can't replace LRCLIB
                  and can't corrupt the lyrics on a track. */}
              <button
                onClick={() => setGeniusMeaning(!geniusMeaning)}
                className={`w-full p-3 border-2 flex items-center justify-between font-mono text-xs uppercase transition-colors ${
                  geniusMeaning
                    ? 'bg-brutal-neon text-brutal-black border-brutal-black'
                    : 'border-brutal-white/20 hover:border-brutal-neon'
                }`}
              >
                <div className="flex items-center gap-3">
                  <BookOpen size={16} />
                  <span>LYRIC_MEANINGS</span>
                </div>
                <span className="font-display">{geniusMeaning ? 'ON' : 'OFF'}</span>
              </button>
              <p className="font-mono text-[10px] text-brutal-white/40 uppercase">
                EXPLAIN_THE_PLAYING_LINE // GENIUS_ANNOTATIONS. SENDS_TITLE_+_ARTIST_TO_GENIUS.
              </p>

              {geniusMeaning && (
                <>
                  <div className="border-2 border-brutal-white/20 p-3 space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="font-mono text-[10px] uppercase text-brutal-white/60 flex items-center gap-2">
                        <KeyRound size={12} /> GENIUS_ACCESS_TOKEN
                      </span>
                      <span className={`font-display text-xs ${geniusToken ? 'text-brutal-neon' : 'text-brutal-white/30'}`}>
                        {geniusToken ? 'SET' : 'MISSING'}
                      </span>
                    </div>

                    {geniusToken && !tokenShown ? (
                      <div className="flex gap-2">
                        <span className="flex-1 font-mono text-[10px] text-brutal-white/40 truncate self-center">
                          {geniusToken.slice(0, 6)}••••••••{geniusToken.slice(-4)}
                        </span>
                        <button
                          onClick={() => { setTokenDraft(geniusToken); setTokenShown(true); }}
                          className="brutal-btn text-[10px] px-2 py-1"
                        >
                          CHANGE
                        </button>
                        <button
                          onClick={() => { setGeniusToken(''); setTokenDraft(''); }}
                          className="brutal-btn text-[10px] px-2 py-1"
                        >
                          CLEAR
                        </button>
                      </div>
                    ) : (
                      <div className="flex gap-2">
                        <input
                          type="password"
                          value={tokenDraft}
                          onChange={(e: { target: { value: string } }) => setTokenDraft(e.target.value)}
                          placeholder="PASTE_CLIENT_ACCESS_TOKEN"
                          className="flex-1 min-w-0 bg-brutal-black border-2 border-brutal-white/40 focus:border-brutal-neon px-2 py-1 font-mono text-[10px] text-brutal-white focus:outline-none"
                        />
                        <button
                          onClick={() => { setGeniusToken(tokenDraft); setTokenShown(false); }}
                          disabled={!tokenDraft.trim()}
                          className="brutal-btn text-[10px] px-2 py-1 disabled:opacity-30"
                        >
                          SAVE
                        </button>
                      </div>
                    )}

                    <p className="font-mono text-[10px] text-brutal-white/30 uppercase leading-relaxed">
                      GENIUS.COM/API-CLIENTS → NEW_CLIENT → GENERATE_CLIENT_ACCESS_TOKEN.
                      FREE. NO_WEBSITE_NEEDED — THE_URL_FIELDS_ARE_UNUSED.
                      STAYS_ON_THIS_MACHINE // SENT_ONLY_TO_API.GENIUS.COM.
                    </p>
                  </div>

                  {/* Each song is looked up once and kept, so the corner keeps
                      working with no connection. */}
                  <div className="flex items-center justify-between gap-2">
                    <p className="font-mono text-[10px] text-brutal-white/40 uppercase">
                      {meaningCount === null
                        ? 'CACHED_OFFLINE // …'
                        : `CACHED_OFFLINE // ${meaningCount}_SONGS`}
                    </p>
                    {!!meaningCount && (
                      <button
                        onClick={async () => {
                          await clearMeanings();
                          setMeaningCount(0);
                        }}
                        className="brutal-btn text-[10px] px-2 py-1"
                      >
                        CLEAR_CACHE
                      </button>
                    )}
                  </div>
                </>
              )}
            </div>
          </div>


          {/* AUDIO */}
          <div className="pt-4 border-t-2 border-brutal-white/10">
            <SectionLabel>AUDIO</SectionLabel>

            <div className="flex items-center gap-3 mb-4">
              <Volume2 size={18} className="text-brutal-neon shrink-0" />
              <input
                type="range"
                min={0}
                max={100}
                value={Math.round(volume * 100)}
                onChange={(e) => setVolume(Number(e.target.value) / 100)}
                className="w-full h-2 cursor-pointer"
                style={{ accentColor: 'var(--brutal-accent)' }}
              />
              <span className="font-mono text-xs w-12 text-right">{Math.round(volume * 100)}%</span>
            </div>

            <div className="flex items-center gap-3 mb-2">
              <Gauge size={18} className="text-brutal-neon shrink-0" />
              <p className="font-mono text-[10px] text-brutal-white/50 uppercase">PLAYBACK_SPEED</p>
            </div>
            <div className="grid grid-cols-6 gap-2 mb-4">
              {SPEED_PRESETS.map((speed) => (
                <button
                  key={speed}
                  onClick={() => setPlaybackRate(speed)}
                  className={`p-2 border-2 font-mono text-[10px] uppercase transition-colors ${
                    playbackRate === speed
                      ? 'bg-brutal-neon text-brutal-black border-brutal-black'
                      : 'border-brutal-white/20 hover:border-brutal-neon'
                  }`}
                >
                  {speed}x
                </button>
              ))}
            </div>

            <div className="flex items-center gap-3 mb-2">
              <Waves size={18} className="text-brutal-neon shrink-0" />
              <p className="font-mono text-[10px] text-brutal-white/50 uppercase">CROSSFADE</p>
            </div>
            <div className="flex items-center gap-3 mb-4">
              <input
                type="range"
                min={0}
                max={10}
                step={1}
                value={crossfade}
                onChange={(e) => setCrossfade(Number(e.target.value))}
                className="w-full h-2 cursor-pointer"
                style={{ accentColor: 'var(--brutal-accent)' }}
              />
              <span className="font-mono text-xs w-12 text-right">{crossfade === 0 ? 'OFF' : `${crossfade}S`}</span>
            </div>

            <button
              onClick={() => setNormalizeVolume(!normalizeVolume)}
              className={`w-full p-3 border-2 flex items-center justify-between font-mono text-xs uppercase transition-colors mb-4 ${
                normalizeVolume
                  ? 'bg-brutal-neon text-brutal-black border-brutal-black'
                  : 'border-brutal-white/20 hover:border-brutal-neon'
              }`}
            >
              <div className="flex items-center gap-3">
                <AudioLines size={16} />
                <span>NORMALIZE_VOLUME</span>
              </div>
              <span className="font-display">{normalizeVolume ? 'ON' : 'OFF'}</span>
            </button>

            {/* Experimental: stream from disk instead of loading the whole file
                into memory. Takes effect on the next track change. */}
            <button
              onClick={() => setStreamPlayback(!streamPlayback)}
              className={`w-full p-3 border-2 flex items-center justify-between font-mono text-xs uppercase transition-colors mb-1 ${
                streamPlayback
                  ? 'bg-brutal-neon text-brutal-black border-brutal-black'
                  : 'border-brutal-white/20 hover:border-brutal-neon'
              }`}
            >
              <div className="flex items-center gap-3">
                <Radio size={16} />
                <span>STREAM_FROM_DISK</span>
              </div>
              <span className="font-display">{streamPlayback ? 'ON' : 'OFF'}</span>
            </button>
            <p className="font-mono text-[10px] text-brutal-white/40 uppercase mb-4">
              EXPERIMENTAL // CONSTANT_MEMORY, INSTANT_TRACK_CHANGE. IF_SCRUBBING_MISBEHAVES, TURN_OFF.
            </p>

            {/* Auto-import: watch imported folders and fold in songs added later. */}
            <button
              onClick={() => setWatchFolders(!watchFolders)}
              className={`w-full p-3 border-2 flex items-center justify-between font-mono text-xs uppercase transition-colors mb-1 ${
                watchFolders
                  ? 'bg-brutal-neon text-brutal-black border-brutal-black'
                  : 'border-brutal-white/20 hover:border-brutal-neon'
              }`}
            >
              <div className="flex items-center gap-3">
                <FolderSync size={16} />
                <span>WATCH_FOLDERS</span>
              </div>
              <span className="font-display">{watchFolders ? 'ON' : 'OFF'}</span>
            </button>
            <p className="font-mono text-[10px] text-brutal-white/40 uppercase mb-4">
              AUTO_DETECT // NEW_SONGS_ADDED_TO_IMPORTED_FOLDERS_APPEAR_AUTOMATICALLY.
            </p>

            {/* Experimental: internet-radio stations as desktop icons. */}
            <button
              onClick={() => setStationsEnabled(!stationsEnabled)}
              className={`w-full p-3 border-2 flex items-center justify-between font-mono text-xs uppercase transition-colors mb-1 ${
                stationsEnabled
                  ? 'bg-brutal-neon text-brutal-black border-brutal-black'
                  : 'border-brutal-white/20 hover:border-brutal-neon'
              }`}
            >
              <div className="flex items-center gap-3">
                <Radio size={16} />
                <span>RADIO_STATIONS</span>
              </div>
              <span className="font-display">{stationsEnabled ? 'ON' : 'OFF'}</span>
            </button>
            <p className="font-mono text-[10px] text-brutal-white/40 uppercase mb-4">
              EXPERIMENTAL // ADDS_STATION_ICONS_TO_THE_DESKTOP. DOUBLE-CLICK_TO_PLAY_A_LIVE_STREAM.
            </p>

            {/* Experimental: YouTube videos/playlists as desktop icons. */}
            <button
              onClick={() => setYoutubeEnabled(!youtubeEnabled)}
              className={`w-full p-3 border-2 flex items-center justify-between font-mono text-xs uppercase transition-colors mb-1 ${
                youtubeEnabled
                  ? 'bg-brutal-neon text-brutal-black border-brutal-black'
                  : 'border-brutal-white/20 hover:border-brutal-neon'
              }`}
            >
              <div className="flex items-center gap-3">
                <Youtube size={16} />
                <span>YOUTUBE</span>
              </div>
              <span className="font-display">{youtubeEnabled ? 'ON' : 'OFF'}</span>
            </button>
            <p className="font-mono text-[10px] text-brutal-white/40 uppercase mb-4">
              EXPERIMENTAL // ADD_VIDEO_OR_PLAYLIST_ICONS. PLAYS_IN_YOUTUBE'S_PLAYER (NO_EQ/VISUALIZER).
            </p>

            {/* Experimental: Google Drive / iCloud sync folders as desktop icons. */}
            <button
              onClick={() => setCloudEnabled(!cloudEnabled)}
              className={`w-full p-3 border-2 flex items-center justify-between font-mono text-xs uppercase transition-colors mb-1 ${
                cloudEnabled
                  ? 'bg-brutal-neon text-brutal-black border-brutal-black'
                  : 'border-brutal-white/20 hover:border-brutal-neon'
              }`}
            >
              <div className="flex items-center gap-3">
                <Cloud size={16} />
                <span>CLOUD_SOURCES</span>
              </div>
              <span className="font-display">{cloudEnabled ? 'ON' : 'OFF'}</span>
            </button>
            <p className="font-mono text-[10px] text-brutal-white/40 uppercase mb-4">
              EXPERIMENTAL // FINDS_GOOGLE_DRIVE_AND_ICLOUD_FOLDERS_ALREADY_SYNCED_TO_THIS_PC.
              NO_LOGIN — READS_THE_SYNCED_FOLDERS_ONLY.
              {cloudEnabled && (
                <>
                  <br />
                  <span className="text-brutal-white/60">
                    {cloudScanning
                      ? 'SCANNING...'
                      : !cloudScanned
                        ? ''
                        : cloudSourceCount > 0
                          ? `FOUND_${cloudSourceCount}_SOURCE${cloudSourceCount === 1 ? '' : 'S'} // SEE_DESKTOP`
                          : 'NONE_FOUND // INSTALL_GOOGLE_DRIVE_OR_ICLOUD_FOR_WINDOWS'}
                  </span>
                </>
              )}
            </p>

            {/* RADAR: scans your artists against Deezer for tracks you lack. */}
            <button
              onClick={() => setOnlineRadar(!onlineRadar)}
              className={`w-full p-3 border-2 flex items-center justify-between font-mono text-xs uppercase transition-colors mb-1 ${
                onlineRadar
                  ? 'bg-brutal-neon text-brutal-black border-brutal-black'
                  : 'border-brutal-white/20 hover:border-brutal-neon'
              }`}
            >
              <div className="flex items-center gap-3">
                <RadarIcon size={16} />
                <span>RADAR_SUGGESTIONS</span>
              </div>
              <span className="font-display">{onlineRadar ? 'ON' : 'OFF'}</span>
            </button>
            <p className="font-mono text-[10px] text-brutal-white/40 uppercase mb-4">
              ONLINE // SENDS_ARTIST_NAMES_TO_ITUNES + DEEZER_WHEN_YOU_SCAN.
              LISTS_TRACKS_YOU_DONT_HAVE + ADDS_A_DESKTOP_WIDGET. SUGGESTS_AND_LINKS_OUT_ONLY —
              NO_DOWNLOADING.
            </p>

            <div className="flex items-center gap-3 mb-2">
              <Timer size={18} className="text-brutal-neon shrink-0" />
              <p className="font-mono text-[10px] text-brutal-white/50 uppercase">
                SLEEP_TIMER{sleepRemaining !== null && (
                  <span className="text-brutal-neon"> // STOPS_IN {formatTime(sleepRemaining)}</span>
                )}
              </p>
            </div>
            <div className="grid grid-cols-4 gap-2">
              <button
                onClick={() => setSleepTimer(null)}
                className={`p-2 border-2 font-mono text-[10px] uppercase transition-colors ${
                  sleepDeadline === null
                    ? 'bg-brutal-neon text-brutal-black border-brutal-black'
                    : 'border-brutal-white/20 hover:border-brutal-neon'
                }`}
              >
                OFF
              </button>
              {SLEEP_PRESETS.map((mins) => (
                <button
                  key={mins}
                  onClick={() => setSleepTimer(mins)}
                  className="p-2 border-2 font-mono text-[10px] uppercase transition-colors border-brutal-white/20 hover:border-brutal-neon"
                >
                  {mins}_MIN
                </button>
              ))}
            </div>
          </div>

          {/* PHONE REMOTE */}
          <div className="pt-4 border-t-2 border-brutal-white/10">
            <SectionLabel>PHONE_REMOTE // ПУЛЬТ</SectionLabel>

            <button
              onClick={() => setRemoteEnabled(!remoteEnabled)}
              className={`w-full p-3 border-2 flex items-center justify-between font-mono text-xs uppercase transition-colors mb-1 ${
                remoteEnabled
                  ? 'bg-brutal-neon text-brutal-black border-brutal-black'
                  : 'border-brutal-white/20 hover:border-brutal-neon'
              }`}
            >
              <div className="flex items-center gap-3">
                <PhoneIcon size={16} />
                <span>PHONE_REMOTE</span>
              </div>
              <span className="font-display">{remoteEnabled ? 'ON' : 'OFF'}</span>
            </button>
            <p className="font-mono text-[10px] text-brutal-white/40 uppercase mb-3">
              CONTROL_FROM_PHONE + PLAY_SONGS_ON_PHONE. SAME_WI-FI_OR_HOTSPOT.
            </p>

            {remoteEnabled && (
              <div className="p-3 border-2 border-brutal-neon/50 bg-brutal-neon/5 mb-3">
                {remoteStatus?.url ? (
                  <>
                    <div className="flex items-center gap-2 mb-3">
                      <Wifi size={14} className="text-brutal-neon shrink-0" />
                      <p className="font-mono text-[10px] text-brutal-white/50 uppercase">
                        SCAN_WITH_PHONE_CAMERA
                      </p>
                    </div>
                    {remoteStatus.qr && (
                      <div className="flex justify-center mb-3">
                        {/* White quiet-zone so any camera reads it regardless of theme. */}
                        <img
                          src={remoteStatus.qr}
                          alt="QR to open the remote"
                          className="w-44 h-44 border-4 border-brutal-white bg-white p-1"
                        />
                      </div>
                    )}
                    <div className="grid grid-cols-1 gap-2">
                      <div className="p-2 border-2 border-brutal-white/20">
                        <p className="font-mono text-[9px] text-brutal-white/40 uppercase mb-0.5">OR_OPEN_MANUALLY</p>
                        <p className="font-display text-xl break-all leading-none">{remoteStatus.url}</p>
                      </div>
                      <div className="p-2 border-2 border-brutal-white/20 flex items-center justify-between">
                        <p className="font-mono text-[9px] text-brutal-white/40 uppercase">PIN</p>
                        <p className="font-display text-2xl tracking-[0.3em] leading-none">{remoteStatus.pin}</p>
                      </div>
                    </div>
                    <p className="font-mono text-[10px] text-brutal-white/40 uppercase mt-2">
                      SCAN_= AUTO_LOGIN. MANUAL_= ENTER_PIN. ANYONE_WITH_THE_PIN_ON_THIS_NETWORK_CAN_CONTROL_PLAYBACK.
                    </p>
                  </>
                ) : (
                  <p className="font-mono text-[10px] text-brutal-white/50 uppercase">
                    {remoteStatus?.error
                      ? `SERVER_ERROR // ${remoteStatus.error}`
                      : 'STARTING_SERVER…'}
                  </p>
                )}
              </div>
            )}

            {remoteEnabled && (
              <div>
                <div className="flex items-center justify-between mb-2">
                  <p className="font-mono text-[10px] text-brutal-white/50 uppercase">
                    DEVICES // {remoteDevices.length}
                  </p>
                  <p className="font-mono text-[9px] text-brutal-white/30 uppercase">
                    TRUSTED_= CAN_CONTROL
                  </p>
                </div>
                {remoteDevices.length === 0 ? (
                  <p className="font-mono text-[10px] text-brutal-white/40 uppercase p-3 border-2 border-dashed border-brutal-white/20">
                    NO_DEVICES_CONNECTED_YET
                  </p>
                ) : (
                  <div className="space-y-2">
                    {remoteDevices.map((d) => (
                      <div key={d.id} className="p-2 border-2 border-brutal-white/20">
                        <div className="flex items-center gap-2 mb-2">
                          <span
                            className={`w-2 h-2 shrink-0 border border-brutal-black ${d.connected ? 'bg-brutal-neon' : 'bg-brutal-white/30'}`}
                            title={d.connected ? 'CONNECTED' : 'IDLE'}
                          />
                          <div className="min-w-0 flex-1">
                            <p className="font-mono text-xs truncate">{d.name}</p>
                            <p className="font-mono text-[9px] text-brutal-white/40 truncate">
                              {d.ip} · {d.connected ? 'CONNECTED' : timeAgo(d.lastSeen)}
                              {d.trusted ? ' · TRUSTED' : ' · VIEW_ONLY'}
                            </p>
                          </div>
                        </div>
                        <div className="grid grid-cols-2 gap-2">
                          <button
                            onClick={() => onTrustDevice(d.id, !d.trusted)}
                            className={`p-2 border-2 flex items-center justify-center gap-2 font-mono text-[10px] uppercase transition-colors ${
                              d.trusted
                                ? 'bg-brutal-neon text-brutal-black border-brutal-black'
                                : 'border-brutal-white/20 hover:border-brutal-neon'
                            }`}
                          >
                            {d.trusted ? <ShieldCheck size={14} /> : <ShieldOff size={14} />}
                            {d.trusted ? 'TRUSTED' : 'TRUST'}
                          </button>
                          <button
                            onClick={() => onKickDevice(d.id)}
                            className="p-2 border-2 border-red-600/40 text-red-500 hover:border-red-600 flex items-center justify-center gap-2 font-mono text-[10px] uppercase transition-colors"
                          >
                            <LogOut size={14} />
                            KICK
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* APPEARANCE */}
          <div className="pt-4 border-t-2 border-brutal-white/10">
            <SectionLabel>APPEARANCE</SectionLabel>

            <button
              onClick={() => setDynamicTheme(!dynamicTheme)}
              className={`w-full p-3 border-2 flex items-center justify-between font-mono text-xs uppercase transition-colors mb-3 ${
                dynamicTheme
                  ? 'bg-brutal-neon text-brutal-black border-brutal-black'
                  : 'border-brutal-white/20 hover:border-brutal-neon'
              }`}
            >
              <div className="flex items-center gap-3">
                <Sparkles size={16} />
                <span>DYNAMIC_THEME_FROM_ALBUM_ART</span>
              </div>
              <span className="font-display">{dynamicTheme ? 'ON' : 'OFF'}</span>
            </button>

            <p className="font-mono text-[10px] text-brutal-white/50 uppercase mb-2">ACCENT_COLOR</p>
            <div className="grid grid-cols-4 gap-2 mb-4">
              {ACCENT_PRESETS.map((preset) => (
                <button
                  key={preset.name}
                  onClick={() => {
                    setAccentColor(preset.value);
                    setDynamicTheme(false);
                  }}
                  className={`p-2 border-2 font-mono text-[9px] uppercase transition-all flex items-center gap-2 ${
                    !dynamicTheme && accentColor === preset.value
                      ? 'border-brutal-white bg-brutal-white/10'
                      : 'border-brutal-white/20 hover:border-brutal-white/60'
                  }`}
                >
                  <span className="w-3 h-3 shrink-0 border border-brutal-black" style={{ backgroundColor: preset.value }} />
                  {preset.name}
                </button>
              ))}
            </div>

            <div className="flex items-center gap-2 mb-2">
              <Type size={14} className="text-brutal-neon shrink-0" />
              <p className="font-mono text-[10px] text-brutal-white/50 uppercase">ШРИФТ // TYPEFACE</p>
            </div>
            <div className="grid grid-cols-1 gap-2 mb-4">
              {FONT_PRESETS.map((preset) => (
                <button
                  key={preset.id}
                  onClick={() => setFontPreset(preset.id)}
                  className={`p-3 border-2 flex items-center justify-between transition-colors ${
                    fontPreset === preset.id
                      ? 'bg-brutal-neon text-brutal-black border-brutal-black'
                      : 'border-brutal-white/20 hover:border-brutal-neon'
                  }`}
                  title={preset.id.toUpperCase()}
                >
                  <span className="text-xl uppercase truncate" style={{ fontFamily: preset.display }}>
                    {preset.label}
                  </span>
                  <span className="text-sm shrink-0 ml-3" style={{ fontFamily: preset.sans }}>
                    Аа Bb 123
                  </span>
                </button>
              ))}
            </div>

            <div className="flex items-center gap-2 mb-2">
              <Languages size={14} className="text-brutal-neon shrink-0" />
              <p className="font-mono text-[10px] text-brutal-white/50 uppercase">ЯЗЫК // LANGUAGE</p>
            </div>
            <div className="grid grid-cols-3 gap-2 mb-4">
              {LANG_OPTIONS.map((opt) => (
                <button
                  key={opt.id}
                  onClick={() => setLang(opt.id)}
                  className={`p-2 border-2 font-mono text-[10px] uppercase transition-colors ${
                    lang === opt.id
                      ? 'bg-brutal-neon text-brutal-black border-brutal-black'
                      : 'border-brutal-white/20 hover:border-brutal-neon'
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>

            <p className="font-mono text-[10px] text-brutal-white/50 uppercase mb-2">VISUALIZER_MODE</p>
            <div className="grid grid-cols-2 gap-2">
              {VISUALIZER_MODES.map((mode) => (
                <button
                  key={mode}
                  onClick={() => setVisualizerMode(mode)}
                  className={`p-2 border-2 font-mono text-[10px] uppercase transition-colors ${
                    visualizerMode === mode
                      ? 'bg-brutal-neon text-brutal-black border-brutal-black'
                      : 'border-brutal-white/20 hover:border-brutal-neon'
                  }`}
                >
                  {mode}
                </button>
              ))}
            </div>
          </div>

          {/* DISPLAY */}
          <div className="pt-4 border-t-2 border-brutal-white/10">
            <SectionLabel>DISPLAY // ЭКРАН</SectionLabel>

            <div className="flex items-center gap-2 mb-2">
              <Monitor size={14} className="text-brutal-neon shrink-0" />
              <p className="font-mono text-[10px] text-brutal-white/50 uppercase">VIEW // ВИД</p>
            </div>
            <div className="grid grid-cols-3 gap-2 mb-4">
              {VIEW_OPTIONS.map((opt) => (
                <button
                  key={opt.id}
                  onClick={() => setViewMode(opt.id)}
                  className={`p-3 border-2 flex flex-col items-center gap-2 font-mono text-[10px] uppercase transition-colors ${
                    viewMode === opt.id
                      ? 'bg-brutal-neon text-brutal-black border-brutal-black'
                      : 'border-brutal-white/20 hover:border-brutal-neon'
                  }`}
                >
                  {opt.icon}
                  {opt.label}
                </button>
              ))}
            </div>

            <div className="flex items-center gap-2 mb-2">
              <ZoomIn size={14} className="text-brutal-neon shrink-0" />
              <p className="font-mono text-[10px] text-brutal-white/50 uppercase">ZOOM // МАСШТАБ</p>
            </div>
            <div className="grid grid-cols-5 gap-2">
              {ZOOM_PRESETS.map((z) => (
                <button
                  key={z}
                  onClick={() => setZoom(z)}
                  className={`p-2 border-2 font-mono text-[10px] uppercase transition-colors ${
                    Math.abs(zoom - z) < 0.001
                      ? 'bg-brutal-neon text-brutal-black border-brutal-black'
                      : 'border-brutal-white/20 hover:border-brutal-neon'
                  }`}
                >
                  {Math.round(z * 100)}%
                </button>
              ))}
            </div>
          </div>

          {/* WIRES — how the desktop patch cables look. Both settings apply to
              every cable at once; the defaults are the original look. */}
          <div className="pt-4 border-t-2 border-brutal-white/10">
            <SectionLabel>WIRES // ПРОВОДА</SectionLabel>

            <div className="flex items-center gap-2 mb-2">
              <Cable size={14} className="text-brutal-neon shrink-0" />
              <p className="font-mono text-[10px] text-brutal-white/50 uppercase">SHAPE // ФОРМА</p>
            </div>
            <div className="grid grid-cols-2 gap-2 mb-4">
              {WIRE_SHAPE_OPTIONS.map((opt) => (
                <button
                  key={opt.id}
                  onClick={() => setWireShape(opt.id)}
                  className={`p-3 border-2 flex flex-col items-center gap-2 font-mono text-[10px] uppercase transition-colors ${
                    wireShape === opt.id
                      ? 'bg-brutal-neon text-brutal-black border-brutal-black'
                      : 'border-brutal-white/20 hover:border-brutal-neon'
                  }`}
                >
                  <svg width={36} height={22} viewBox="0 0 36 22" aria-hidden="true">
                    <path d={opt.d} fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" />
                    <circle cx={3} cy={16} r={2.5} fill="currentColor" />
                    <circle cx={33} cy={6} r={2.5} fill="currentColor" />
                  </svg>
                  {opt.label}
                </button>
              ))}
            </div>

            <div className="flex items-center gap-2 mb-2">
              <Zap size={14} className="text-brutal-neon shrink-0" />
              <p className="font-mono text-[10px] text-brutal-white/50 uppercase">CURRENT // ТОК</p>
            </div>
            <div className="grid grid-cols-2 gap-2">
              {WIRE_CURRENT_OPTIONS.map((opt) => (
                <button
                  key={opt.id}
                  onClick={() => setWireCurrent(opt.id)}
                  className={`p-3 border-2 flex flex-col items-center gap-2 font-mono text-[10px] uppercase transition-colors ${
                    wireCurrent === opt.id
                      ? 'bg-brutal-neon text-brutal-black border-brutal-black'
                      : 'border-brutal-white/20 hover:border-brutal-neon'
                  }`}
                >
                  {opt.icon}
                  {opt.label}
                </button>
              ))}
            </div>
            <p className="font-mono text-[9px] text-brutal-white/30 uppercase mt-2">
              QUIET STOPS THE ARCING — THE CONNECT ZAP STILL FIRES
            </p>
          </div>

          {/* WALLPAPER — full editor lives in the Backgrounds window now */}
          <div className="pt-4 border-t-2 border-brutal-white/10">
            <SectionLabel>WALLPAPER // ОБОИ</SectionLabel>
            <button
              onClick={onOpenBackgrounds}
              className="w-full brutal-btn flex items-center justify-between group"
            >
              <div className="flex items-center gap-3">
                <ImageIcon size={20} />
                <span className="text-xl">BACKGROUNDS</span>
              </div>
              <span className="font-mono text-[10px] opacity-50">OPEN_EDITOR</span>
            </button>
          </div>

          {/* FOLDERS */}
          <div className="pt-4 border-t-2 border-brutal-white/10">
            <SectionLabel>FOLDERS // ПАПКИ</SectionLabel>
            <div className="space-y-1 mb-3 max-h-40 overflow-y-auto custom-scrollbar">
              {folders.length === 0 ? (
                <p className="font-mono text-[10px] text-brutal-white/40 uppercase p-3 border-2 border-dashed border-brutal-white/20">
                  NO_FOLDERS_IMPORTED
                </p>
              ) : (
                folders.map((f) => (
                  <div
                    key={f.path}
                    className="flex items-center justify-between gap-2 p-2 border-2 border-brutal-white/20"
                    title={f.path}
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <Folder size={14} className="text-brutal-neon shrink-0" />
                      <span className="font-mono text-[10px] truncate">{f.path}</span>
                    </div>
                    <span className="font-mono text-[9px] bg-brutal-white text-brutal-black px-1.5 py-0.5 shrink-0">
                      {f.count}
                    </span>
                  </div>
                ))
              )}
            </div>
            <button
              onClick={onAddFolder}
              className="w-full p-3 border-2 border-brutal-white/20 hover:border-brutal-neon flex items-center gap-3 font-mono text-xs uppercase transition-colors"
            >
              <FolderPlus size={16} />
              ADD_FOLDER // ДОБАВИТЬ ПАПКУ
            </button>
          </div>

          {/* SYSTEM — spans the full width below both columns. Its buttons wipe
              the library / reset settings, and a red destructive control must
              never end up sitting beside a volume slider. */}
          <div className="pt-4 border-t-2 border-brutal-white/10 [column-span:all]">
            <SectionLabel>SYSTEM</SectionLabel>

            <div className="grid grid-cols-2 gap-2 mb-4">
              <div className="p-3 border-2 border-brutal-white/20">
                <div className="flex items-center gap-2 mb-1">
                  <ListMusic size={14} className="text-brutal-neon" />
                  <p className="font-mono text-[10px] text-brutal-white/50 uppercase">TRACKS</p>
                </div>
                <p className="font-display text-2xl">{trackCount}</p>
              </div>
              <div className="p-3 border-2 border-brutal-white/20">
                <div className="flex items-center gap-2 mb-1">
                  <HardDrive size={14} className="text-brutal-neon" />
                  <p className="font-mono text-[10px] text-brutal-white/50 uppercase">STORAGE</p>
                </div>
                <p className="font-display text-2xl">{formatSize(diskUsage)}</p>
              </div>
            </div>

            <button
              onClick={() => onResetLayout()}
              className="w-full p-3 border-2 border-brutal-white/20 hover:border-brutal-neon flex items-center gap-3 font-mono text-xs uppercase transition-colors mb-3"
            >
              <RotateCcw size={16} />
              RESET_WINDOW_LAYOUT
            </button>

            <button
              onClick={async () => {
                const n = await onRemoveDuplicates();
                setDupResult(n === 0 ? 'NO_DUPLICATES_FOUND' : `REMOVED_${n}_DUPLICATE_TRACKS`);
              }}
              className={`w-full p-3 border-2 flex items-center gap-3 font-mono text-xs uppercase transition-colors mb-3 ${
                dupResult ? 'bg-brutal-neon text-brutal-black border-brutal-black' : 'border-brutal-white/20 hover:border-brutal-neon'
              }`}
            >
              <Copy size={16} />
              {dupResult ?? 'REMOVE_DUPLICATE_TRACKS'}
            </button>

            <p className="font-mono text-[10px] text-red-500/70 uppercase mb-2 tracking-widest">DANGER_ZONE</p>
            <div className="space-y-2">
              <button
                onClick={() => {
                  if (confirmAction === 'library') {
                    onClearLibrary();
                  } else {
                    setConfirmAction('library');
                  }
                }}
                className={`w-full p-3 border-2 flex items-center gap-3 font-mono text-xs uppercase transition-colors ${
                  confirmAction === 'library'
                    ? 'bg-red-600 text-white border-red-600'
                    : 'border-red-600/40 text-red-500 hover:border-red-600'
                }`}
              >
                <Trash2 size={16} />
                {confirmAction === 'library' ? 'CLICK_AGAIN_TO_WIPE_ALL_TRACKS' : 'CLEAR_LIBRARY'}
              </button>
              <button
                onClick={() => {
                  if (confirmAction === 'settings') {
                    onResetSettings();
                  } else {
                    setConfirmAction('settings');
                  }
                }}
                className={`w-full p-3 border-2 flex items-center gap-3 font-mono text-xs uppercase transition-colors ${
                  confirmAction === 'settings'
                    ? 'bg-red-600 text-white border-red-600'
                    : 'border-red-600/40 text-red-500 hover:border-red-600'
                }`}
              >
                <RotateCcw size={16} />
                {confirmAction === 'settings' ? 'CLICK_AGAIN_TO_RESET_SETTINGS' : 'RESET_ALL_SETTINGS'}
              </button>
            </div>
          </div>
        </div>

        <div className="mt-6 pt-4 border-t-2 border-brutal-white/10 flex justify-between items-center shrink-0">
          <p className="font-mono text-[10px] text-brutal-white/30 uppercase">READY</p>
          <div className="flex gap-1">
            <div className="w-1 h-1 bg-brutal-neon" />
            <div className="w-1 h-1 bg-brutal-neon" />
          </div>
        </div>
      </div>
    </div>
  );
}
