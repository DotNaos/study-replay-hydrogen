import { Button } from '@heroui/react';
import { AlertCircle, Check, RefreshCw, Settings } from 'lucide-react';
import { useEffect, useState } from 'react';
import logoImage from './assets/logo.png';
import { CourseDetailView } from './components/CourseDetailView';
import { HomeView } from './components/HomeView';
import { PlayerView } from './components/PlayerView';
import { CourseLibrary, RecordingRow } from './models';
import { useLibraryStore } from './store';

export default function App() {
    const [status, setStatus] = useState('Idle');
    const [message, setMessage] = useState('');

    // Use Zustand store for library data
    const {
        terms,
        watchlist,
        heroRecording,
        recentHistory,
        isLoading,
        isRefreshing,
        loadLibrary,
        refreshCourses,
        loadCourseRecordings,
        toggleWatchlist,
        saveCourseProgress,
        getCourse,
    } = useLibraryStore();

    // Navigation State
    const [view, setView] = useState<'home' | 'course' | 'player'>('home');
    const [selectedCourseId, setSelectedCourseId] = useState<string | null>(
        null,
    );
    const [selectedRecordingUuid, setSelectedRecordingUuid] = useState<
        string | null
    >(null);

    // Auth State
    const [credsDialogOpen, setCredsDialogOpen] = useState(false);
    const [credsLoaded, setCredsLoaded] = useState(false);
    const [username, setUsername] = useState('');
    const [password, setPassword] = useState('');
    const [autoLogin, setAutoLogin] = useState(true);
    const [hasCreds, setHasCreds] = useState(false);
    const [updaterState, setUpdaterState] =
        useState<StudyReplayUpdaterState | null>(null);
    const [updateActionPending, setUpdateActionPending] = useState(false);

    // Get current course/recording from store (reactive!)
    const selectedCourse = selectedCourseId
        ? getCourse(selectedCourseId)
        : null;
    const selectedRecording =
        selectedRecordingUuid && selectedCourse
            ? (selectedCourse.recordings.find(
                  (r) => r.recordingUuid === selectedRecordingUuid,
              ) ?? null)
            : null;

    // Init - Load library and credentials
    useEffect(() => {
        let mounted = true;

        // Load credentials
        window.webexApi.getCredentials().then((payload) => {
            if (!mounted) return;
            setUsername(payload.credentials.username || '');
            setPassword(payload.credentials.password || '');
            setAutoLogin(payload.preferences.autoLogin);
            setHasCreds(payload.hasCredentials);
            setCredsLoaded(true);
        });

        // Load library from store
        loadLibrary();

        return () => {
            mounted = false;
        };
    }, [loadLibrary]);

    useEffect(() => {
        let mounted = true;

        window.webexApi.getUpdaterState().then((payload) => {
            if (mounted) setUpdaterState(payload);
        });

        const handleUpdaterState = (
            _event: any,
            payload: StudyReplayUpdaterState,
        ) => {
            setUpdaterState(payload);
        };

        window.webexApi.onUpdaterState(handleUpdaterState);
        return () => {
            mounted = false;
            window.webexApi.offUpdaterState();
        };
    }, []);

    const handleToggleWatchlist = async (courseId: string, status: boolean) => {
        await toggleWatchlist(courseId, status);
    };

    const handlePlay = (recording: RecordingRow, course: CourseLibrary) => {
        setSelectedRecordingUuid(recording.recordingUuid);
        setSelectedCourseId(course.courseId);
        setView('player');

        // Update course progress (episode tracking)
        if (recording.recordingUuid) {
            saveCourseProgress(course.courseId, recording.recordingUuid);
        }
    };

    const handlePlayCourse = (course: CourseLibrary) => {
        const sorted = [...course.recordings].sort((a, b) =>
            b.recordingDate.localeCompare(a.recordingDate),
        );
        const lastWatched = sorted.find(
            (r) => r.recordingUuid === course.lastWatchedUuid,
        );
        const toPlay = lastWatched || sorted[0];
        if (toPlay) {
            handlePlay(toPlay, course);
        }
    };

    const handleSaveCreds = async () => {
        const result = await window.webexApi.setCredentials({
            username,
            password,
        });
        setHasCreds(result.hasCredentials);
        setCredsDialogOpen(false);
        if (result.hasCredentials) {
            handleRefreshCourses();
        }
    };

    const handleToggleAutoLogin = async (checked: boolean) => {
        setAutoLogin(checked);
        await window.webexApi.setPreferences({ autoLogin: checked });
    };

    const handleCheckForUpdates = async () => {
        setUpdateActionPending(true);
        try {
            const result = await window.webexApi.checkForUpdates();
            if (!result.ok) {
                setStatus('Failed');
                setMessage(result.error || 'Update-Prüfung fehlgeschlagen.');
            }
        } finally {
            setUpdateActionPending(false);
        }
    };

    const handleQuitAndInstallUpdate = async () => {
        setUpdateActionPending(true);
        try {
            const result = await window.webexApi.quitAndInstallUpdate();
            if (!result.ok) {
                setStatus('Failed');
                setMessage(result.error || 'Update-Installation fehlgeschlagen.');
            }
        } finally {
            setUpdateActionPending(false);
        }
    };

    const handleRefreshCourses = async () => {
        setStatus('Syncing courses...');
        setMessage('');
        try {
            await refreshCourses();
            setStatus('Ready');
        } catch (error) {
            setStatus('Failed');
            setMessage(error instanceof Error ? error.message : String(error));
        }
    };

    const handleRefreshRecordings = async () => {
        if (!selectedCourseId) return;
        setStatus(`Syncing recordings...`);

        try {
            await loadCourseRecordings(selectedCourseId);
            setStatus('Ready');
        } catch (error) {
            setStatus('Failed');
            setMessage(error instanceof Error ? error.message : String(error));
        }
    };

    const handleRefreshCourse = async (courseId: string) => {
        setStatus(`Syncing recordings...`);
        try {
            await loadCourseRecordings(courseId);
            setStatus('Ready');
        } catch (error) {
            setStatus('Failed');
            setMessage(error instanceof Error ? error.message : String(error));
        }
    };

    // View Handlers
    const handleCourseSelect = async (course: CourseLibrary) => {
        setSelectedCourseId(course.courseId);
        setView('course');
    };

    const handleBackToHome = () => {
        setView('home');
    };

    const handlePlayerBack = () => {
        setView('course');
        // Library is already synced via the store - no need to manually refresh!
    };

    return (
        <div className="min-h-screen bg-[#0f131a] text-foreground font-sans w-full relative">
            {/* HEADER - Floating Overlay */}
            <header className="fixed top-0 left-0 right-0 z-[100] flex items-center justify-between px-8 py-3 transition-all duration-500 bg-gradient-to-b from-black/80 via-black/40 to-transparent backdrop-blur-md pointer-events-none">
                <div
                    className="pointer-events-auto flex items-center gap-4 cursor-pointer group"
                    onClick={handleBackToHome}
                >
                    <img
                        src={logoImage}
                        alt="Study Replay Logo"
                        className="w-16 h-16 object-contain drop-shadow-xl hover:scale-110 transition-transform duration-300"
                    />
                    <div className="flex flex-col">
                        <h1 className="text-xl font-bold text-white tracking-tight font-display leading-tight drop-shadow-lg opacity-90 group-hover:opacity-100 transition-opacity">
                            Study Replay
                        </h1>
                    </div>
                </div>
                <div className="pointer-events-auto flex items-center gap-2">
                    {/* Status Indicators */}
                    {status !== 'Idle' && status !== 'Ready' && (
                        <div className="text-xs font-mono text-emerald-400 animate-pulse bg-black/40 backdrop-blur-md border border-emerald-500/20 px-3 py-1.5 rounded-full flex items-center gap-2">
                            <div className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
                            {status}
                        </div>
                    )}

                    {isLoading && (
                        <div className="text-xs font-mono text-blue-400 bg-black/40 backdrop-blur-md border border-blue-500/20 px-3 py-1.5 rounded-full flex items-center gap-2">
                            <div className="w-1.5 h-1.5 rounded-full bg-blue-400 animate-pulse" />
                            Loading...
                        </div>
                    )}

                    {!hasCreds && (status === 'Idle' || status === 'Ready') && (
                        <div className="text-xs font-bold text-rose-400 bg-rose-500/10 border border-rose-500/20 px-3 py-1.5 rounded-full backdrop-blur-md flex items-center gap-2">
                            <AlertCircle className="w-3 h-3" />
                            No Auth
                        </div>
                    )}

                    {/* Sync Button */}
                    {hasCreds && (
                        <Button
                            onClick={() => handleRefreshCourses()}
                            isDisabled={isRefreshing}
                            className="w-10 h-10 flex items-center justify-center rounded-full text-slate-300 hover:text-white hover:bg-white/10 transition-all"
                            variant="ghost"
                            isIconOnly
                        >
                            <RefreshCw
                                className={`w-5 h-5 ${isRefreshing ? 'animate-spin' : ''}`}
                                strokeWidth={2}
                            />
                        </Button>
                    )}

                    {/* Settings Button */}
                    <Button
                        onClick={() => setCredsDialogOpen(true)}
                        className="w-10 h-10 flex items-center justify-center rounded-full text-slate-300 hover:text-white hover:bg-white/10 transition-all"
                        variant="ghost"
                        isIconOnly
                    >
                        <Settings className="w-5 h-5" strokeWidth={2} />
                    </Button>
                </div>
            </header>

            {/* Login / Settings Modal */}
            {credsDialogOpen && (
                <div className="fixed inset-0 z-[250] flex items-center justify-center p-4">
                    {/* Backdrop */}
                    <div
                        className="absolute inset-0 bg-black/90 backdrop-blur-md animate-in fade-in duration-300"
                        onClick={() => setCredsDialogOpen(false)}
                    />

                    {/* Dialog Card */}
                    <div className="relative w-full max-w-[400px] bg-gradient-to-b from-[#1a1c20] to-[#0f1115] border border-white/10 rounded-3xl p-10 shadow-[0_0_80px_rgba(0,0,0,0.6)] animate-in zoom-in-95 slide-in-from-bottom-2 duration-300 ring-1 ring-white/5">
                        <div className="flex flex-col items-center mb-8">
                            <div className="w-20 h-20 rounded-[24px] bg-gradient-to-br from-white/10 to-white/5 flex items-center justify-center mb-6 shadow-inner ring-1 ring-white/10 relative overflow-hidden group">
                                <div className="absolute inset-0 bg-emerald-500/20 blur-xl opacity-0 group-hover:opacity-100 transition-opacity duration-1000" />
                                <img
                                    src={logoImage}
                                    className="w-12 h-12 object-contain drop-shadow-xl relative z-10"
                                />
                            </div>
                            <h2 className="text-3xl font-black text-white font-display tracking-tight text-center">
                                Welcome Back
                            </h2>
                        </div>

                        <div className="space-y-6">
                            <div className="space-y-2">
                                <label className="text-[10px] uppercase tracking-widest font-bold text-slate-500 ml-1">
                                    Username
                                </label>
                                <input
                                    value={username}
                                    onChange={(e) =>
                                        setUsername(e.target.value)
                                    }
                                    className="w-full bg-white/5 border border-white/5 rounded-xl px-4 py-3 text-white placeholder:text-slate-600 focus:outline-none focus:bg-white/10 focus:border-emerald-500/50 focus:ring-1 focus:ring-emerald-500/50 transition-all font-medium"
                                    placeholder="Enter your username"
                                />
                            </div>

                            <div className="space-y-2">
                                <label className="text-[10px] uppercase tracking-widest font-bold text-slate-500 ml-1">
                                    Password
                                </label>
                                <input
                                    type="password"
                                    value={password}
                                    onChange={(e) =>
                                        setPassword(e.target.value)
                                    }
                                    className="w-full bg-white/5 border border-white/5 rounded-xl px-4 py-3 text-white placeholder:text-slate-600 focus:outline-none focus:bg-white/10 focus:border-emerald-500/50 focus:ring-1 focus:ring-emerald-500/50 transition-all font-medium font-mono tracking-widest"
                                    placeholder="••••••••"
                                />
                            </div>

                            <div
                                className="flex items-center gap-3 cursor-pointer group py-2"
                                onClick={() =>
                                    handleToggleAutoLogin(!autoLogin)
                                }
                            >
                                <div
                                    className={`w-5 h-5 rounded-md border flex items-center justify-center transition-all duration-300 ${autoLogin ? 'bg-emerald-500 border-emerald-500 shadow-[0_0_10px_rgba(16,185,129,0.3)]' : 'border-slate-700 bg-white/5 group-hover:border-slate-500'}`}
                                >
                                    {autoLogin && (
                                        <Check className="w-3.5 h-3.5 text-white stroke-[3px]" />
                                    )}
                                </div>
                                <span className="text-sm text-slate-400 font-medium group-hover:text-slate-300 transition-colors select-none">
                                    Keep me signed in
                                </span>
                            </div>

                            <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4 space-y-3">
                                <div className="flex items-start justify-between gap-4">
                                    <div className="space-y-1">
                                        <div className="text-[10px] uppercase tracking-widest font-bold text-slate-500">
                                            App Updates
                                        </div>
                                        <div className="text-sm font-semibold text-white">
                                            Version{' '}
                                            {updaterState?.currentVersion ||
                                                'unbekannt'}
                                        </div>
                                        <div className="text-xs text-slate-400">
                                            {updaterState?.error ||
                                                updaterState?.message ||
                                                'Update-Status wird geladen...'}
                                        </div>
                                    </div>
                                    <Button
                                        onPress={handleCheckForUpdates}
                                        isDisabled={
                                            updateActionPending ||
                                            updaterState?.stage ===
                                                'checking' ||
                                            updaterState?.stage ===
                                                'downloading'
                                        }
                                        className="rounded-full bg-white/8 text-white hover:bg-white/12 px-4 min-w-0"
                                    >
                                        <RefreshCw
                                            className={`w-4 h-4 ${
                                                updateActionPending ||
                                                updaterState?.stage ===
                                                    'checking'
                                                    ? 'animate-spin'
                                                    : ''
                                            }`}
                                        />
                                        Prüfen
                                    </Button>
                                </div>

                                {typeof updaterState?.progressPercent ===
                                    'number' && (
                                    <div className="space-y-1">
                                        <div className="h-1.5 rounded-full bg-white/10 overflow-hidden">
                                            <div
                                                className="h-full bg-emerald-500 transition-all duration-300"
                                                style={{
                                                    width: `${updaterState.progressPercent}%`,
                                                }}
                                            />
                                        </div>
                                        <div className="text-[11px] text-slate-500">
                                            {Math.round(
                                                updaterState.progressPercent,
                                            )}
                                            %
                                        </div>
                                    </div>
                                )}

                                {updaterState?.stage === 'downloaded' && (
                                    <Button
                                        onPress={handleQuitAndInstallUpdate}
                                        isDisabled={updateActionPending}
                                        className="w-full rounded-full bg-emerald-500 text-black font-bold hover:bg-emerald-400"
                                    >
                                        Neustart und installieren
                                    </Button>
                                )}
                            </div>

                            <div className="pt-6 grid grid-cols-2 gap-4">
                                <Button
                                    onPress={() => setCredsDialogOpen(false)}
                                    className="w-full h-auto py-3.5 rounded-full border border-white/10 text-slate-400 font-bold hover:bg-white/5 hover:text-white transition-all text-sm bg-transparent"
                                >
                                    Cancel
                                </Button>
                                <Button
                                    onPress={handleSaveCreds}
                                    className="w-full h-auto py-3.5 rounded-full bg-white text-black font-black hover:bg-slate-200 transition-all text-sm shadow-lg shadow-white/5 active:scale-[0.98]"
                                >
                                    Sign In
                                </Button>
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {/* ERROR MESSAGE TOAST */}
            {message && (
                <div
                    className={`mb-6 p-3 rounded-md text-sm border font-medium flex items-center gap-2 ${
                        status === 'Failed'
                            ? 'bg-rose-500/10 border-rose-500/20 text-rose-400'
                            : 'bg-emerald-500/10 border-emerald-500/20 text-emerald-400'
                    }`}
                >
                    <span className="text-lg">
                        {status === 'Failed' ? '!' : '✓'}
                    </span>
                    {message}
                </div>
            )}

            {/* CONTENT */}
            <main className="min-h-[400px]">
                {/* Home View */}
                {view !== 'player' && (
                    <HomeView
                        terms={terms}
                        onSelectCourse={handleCourseSelect}
                        onPlayCourse={handlePlayCourse}
                        heroRecording={heroRecording}
                        recentHistory={recentHistory}
                        watchlist={watchlist}
                        onToggleWatchlist={handleToggleWatchlist}
                        onRefreshCourse={handleRefreshCourse}
                    />
                )}

                {/* Course Detail Overlay */}
                {view === 'course' && selectedCourse && (
                    <CourseDetailView
                        course={selectedCourse}
                        onBack={handleBackToHome}
                        onRefresh={handleRefreshRecordings}
                        onToggleWatchlist={handleToggleWatchlist}
                        onPlay={(rec: RecordingRow) =>
                            handlePlay(rec, selectedCourse)
                        }
                        refreshing={isRefreshing}
                    />
                )}

                {/* Player Overlay */}
                {view === 'player' && selectedRecording && selectedCourse && (
                    <PlayerView
                        recording={selectedRecording}
                        courseName={selectedCourse.courseName}
                        onBack={handlePlayerBack}
                    />
                )}
            </main>
        </div>
    );
}
