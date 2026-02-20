import { Tooltip } from '@heroui/react';
import {
    ArrowLeft,
    FastForward,
    Maximize,
    Minimize,
    Pause,
    Play,
    Rewind,
    Volume2,
    VolumeX,
} from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { RecordingRow } from '../models';
import { useLibraryStore } from '../store';
import { formatRecordingDate } from '../utils';

interface PlayerViewProps {
    recording: RecordingRow;
    courseName: string;
    onBack: () => void;
}

export function PlayerView({ recording, courseName, onBack }: PlayerViewProps) {
    const containerRef = useRef<HTMLDivElement>(null);
    const videoRef = useRef<HTMLVideoElement>(null);
    const progressBarRef = useRef<HTMLDivElement>(null);

    // Get saveProgress from store for reactive updates
    const storeSaveProgress = useLibraryStore((state) => state.saveProgress);

    // Playback State
    const [isPlaying, setIsPlaying] = useState(true);
    const [isMuted, setIsMuted] = useState(false);
    const [currentTime, setCurrentTime] = useState(0);
    const [duration, setDuration] = useState(0);
    const [isFullscreen, setIsFullscreen] = useState(false);
    const speedOptions = [0.5, 1, 1.5, 2, 3];
    const [speed, setSpeed] = useState<number>(1);

    // UX State
    const [showControls, setShowControls] = useState(true);
    const [isDragging, setIsDragging] = useState(false);
    const [isHoveringControls, setIsHoveringControls] = useState(false);
    const [seekOverlay, setSeekOverlay] = useState<{
        type: 'forward' | 'rewind';
        id: number;
    } | null>(null);

    const lastSavedTime = useRef<number>(0);
    const controlsTimeoutRef = useRef<NodeJS.Timeout>(null);

    const playableUrl = recording.downloadUrl || recording.recordingUrl || '';

    // Helper to save progress immediately (uses store for reactive updates)
    const saveProgressNow = useCallback(
        (position?: number) => {
            if (!recording.recordingUuid) return;
            const pos = position ?? videoRef.current?.currentTime ?? 0;
            const dur = duration || videoRef.current?.duration;
            storeSaveProgress(recording.recordingUuid, pos, dur);
            lastSavedTime.current = pos;
        },
        [recording.recordingUuid, duration, storeSaveProgress],
    );

    // Restore position on load
    useEffect(() => {
        if (recording.lastPosition && videoRef.current) {
            videoRef.current.currentTime = recording.lastPosition;
        }
    }, [recording.recordingUuid]);

    // Save progress on unmount (cleanup)
    useEffect(() => {
        return () => {
            if (videoRef.current && recording.recordingUuid) {
                // Use API directly for cleanup (store might be unmounted)
                window.webexApi.saveProgress(
                    recording.recordingUuid,
                    videoRef.current.currentTime,
                    videoRef.current.duration,
                );
            }
        };
    }, [recording.recordingUuid]);

    // Auto-hide controls
    useEffect(() => {
        const resetTimer = () => {
            setShowControls(true);
            if (controlsTimeoutRef.current)
                clearTimeout(controlsTimeoutRef.current);

            // Only schedule hide if not hovering controls
            if (!isHoveringControls) {
                controlsTimeoutRef.current = setTimeout(() => {
                    if (!isDragging && isPlaying && !isHoveringControls) {
                        setShowControls(false);
                    }
                }, 3000);
            }
        };

        const onMouseMove = () => resetTimer();
        window.addEventListener('mousemove', onMouseMove);

        // Initial timer
        resetTimer();

        return () => {
            window.removeEventListener('mousemove', onMouseMove);
            if (controlsTimeoutRef.current)
                clearTimeout(controlsTimeoutRef.current);
        };
    }, [isDragging, isPlaying, isHoveringControls]);

    // Cleanup fullscreen listener
    useEffect(() => {
        const onFsChange = () => setIsFullscreen(!!document.fullscreenElement);
        document.addEventListener('fullscreenchange', onFsChange);
        return () =>
            document.removeEventListener('fullscreenchange', onFsChange);
    }, []);

    // Keyboard controls for arrow keys (skip forward/backward)
    useEffect(() => {
        let lastSkipTime = 0;
        const DEBOUNCE_MS = 200; // Debounce for key hold

        const handleKeyDown = (e: KeyboardEvent) => {
            // Ignore if user is typing in an input
            if (
                e.target instanceof HTMLInputElement ||
                e.target instanceof HTMLTextAreaElement
            ) {
                return;
            }

            const now = Date.now();
            if (now - lastSkipTime < DEBOUNCE_MS) return; // Debounce

            if (e.key === 'ArrowLeft') {
                e.preventDefault();
                lastSkipTime = now;
                skip(-10);
            } else if (e.key === 'ArrowRight') {
                e.preventDefault();
                lastSkipTime = now;
                skip(10);
            }
        };

        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, []);

    const formatTime = (seconds: number) => {
        const h = Math.floor(seconds / 3600);
        const m = Math.floor((seconds % 3600) / 60);
        const s = Math.floor(seconds % 60);
        if (h > 0)
            return `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
        return `${m}:${s.toString().padStart(2, '0')}`;
    };

    const handleLoadedMetadata = () => {
        if (videoRef.current) {
            const vidDur = videoRef.current.duration;
            if (Number.isFinite(vidDur)) {
                setDuration(vidDur);
            } else if (recording.durationSeconds) {
                setDuration(recording.durationSeconds);
            }
        }
    };

    const handleTimeUpdate = () => {
        const video = videoRef.current;
        if (!video || !recording.recordingUuid) return;

        // Don't update state while dragging to prevent jumping
        if (!isDragging) {
            setCurrentTime(video.currentTime);
        }

        // Save progress periodically (using store for reactive updates)
        if (Math.abs(video.currentTime - lastSavedTime.current) > 5) {
            lastSavedTime.current = video.currentTime;
            storeSaveProgress(
                recording.recordingUuid,
                video.currentTime,
                video.duration,
            );
        }
    };

    const togglePlay = useCallback(
        (e?: React.MouseEvent) => {
            e?.stopPropagation(); // Prevent toggling when clicking controls
            if (!videoRef.current) return;
            if (isPlaying) videoRef.current.pause();
            else videoRef.current.play();
            setIsPlaying(!isPlaying);
        },
        [isPlaying],
    );

    const toggleFullscreen = () => {
        if (!containerRef.current) return;
        if (!document.fullscreenElement) {
            containerRef.current.requestFullscreen();
        } else {
            document.exitFullscreen();
        }
    };

    const skip = useCallback((amount: number) => {
        if (!videoRef.current) return;
        videoRef.current.currentTime += amount;

        // Trigger generic overlay
        setSeekOverlay({
            type: amount > 0 ? 'forward' : 'rewind',
            id: Date.now(),
        });
        setTimeout(() => setSeekOverlay(null), 500);
    }, []);

    // --- Seek / Drag Logic ---
    const updateDragTime = (clientX: number) => {
        if (!duration || !progressBarRef.current) return 0;

        const rect = progressBarRef.current.getBoundingClientRect();
        const rawX = clientX - rect.left;
        const clampX = Math.max(0, Math.min(rawX, rect.width));
        const pct = clampX / rect.width;
        return pct * duration;
    };

    const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
        e.preventDefault();
        e.stopPropagation(); // Don't toggle play
        setIsDragging(true);
        (e.target as HTMLElement).setPointerCapture(e.pointerId);

        const t = updateDragTime(e.clientX);
        setCurrentTime(t);
    };

    const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
        if (!isDragging) return;
        e.preventDefault();
        e.stopPropagation();
        const t = updateDragTime(e.clientX);
        setCurrentTime(t);
    };

    const handlePointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
        if (!isDragging) return;
        e.preventDefault();
        e.stopPropagation();
        setIsDragging(false);
        (e.target as HTMLElement).releasePointerCapture(e.pointerId);

        // Commit seek and save progress immediately
        if (videoRef.current) {
            const t = updateDragTime(e.clientX);
            videoRef.current.currentTime = t;
            setCurrentTime(t);
            saveProgressNow(t);
        }
    };
    // -------------------------

    return (
        <div
            ref={containerRef}
            className={`fixed inset-0 z-[100] bg-black flex flex-col items-center justify-center animate-in fade-in duration-500 overflow-hidden ${!showControls ? 'cursor-none' : ''}`}
            onClick={togglePlay} // Click anywhere to toggle play
        >
            {/* Seek Overlay */}
            {seekOverlay && (
                <div
                    className={`absolute inset-y-0 w-1/2 flex items-center justify-center pointer-events-none z-30 ${
                        seekOverlay.type === 'forward' ? 'right-0' : 'left-0'
                    }`}
                >
                    <div className="bg-black/50 backdrop-blur-md rounded-full p-8 flex flex-col items-center justify-center animate-in zoom-in fade-in duration-200">
                        {seekOverlay.type === 'forward' ? (
                            <FastForward className="w-12 h-12 text-white fill-white/20" />
                        ) : (
                            <Rewind className="w-12 h-12 text-white fill-white/20" />
                        )}
                        <span className="text-white font-bold text-lg mt-2 font-mono">
                            {seekOverlay.type === 'forward' ? '+10s' : '-10s'}
                        </span>
                    </div>
                </div>
            )}

            {/* Top Bar */}
            <div
                className={`absolute top-0 left-0 right-0 p-8 flex items-center justify-between z-20 bg-gradient-to-b from-black/80 to-transparent transition-opacity duration-500 ${showControls ? 'opacity-100' : 'opacity-0'}`}
                onClick={(e) => e.stopPropagation()} // Stop click through
                onMouseEnter={() => setIsHoveringControls(true)}
                onMouseLeave={() => setIsHoveringControls(false)}
            >
                <button
                    onClick={onBack}
                    className="flex items-center gap-4 text-white hover:text-slate-300 transition-colors"
                >
                    <ArrowLeft className="w-8 h-8" />
                    <div className="flex flex-col items-start leading-none">
                        <span className="text-sm font-bold text-slate-400 uppercase tracking-widest">
                            {courseName}
                        </span>
                        <h1 className="text-xl font-black font-display">
                            {formatRecordingDate(recording.recordingDate) ||
                                recording.recordingName}
                        </h1>
                    </div>
                </button>
            </div>

            <video
                ref={videoRef}
                src={playableUrl}
                autoPlay
                className="w-full h-full object-contain"
                onTimeUpdate={handleTimeUpdate}
                onLoadedMetadata={handleLoadedMetadata}
                onDoubleClick={toggleFullscreen}
                onPlay={() => setIsPlaying(true)}
                onPause={() => setIsPlaying(false)}
            />

            {/* Bottom Controls */}
            <div
                className={`absolute bottom-0 left-0 right-0 p-12 flex flex-col gap-6 bg-gradient-to-t from-black/90 via-black/40 to-transparent transition-opacity duration-500 z-20 ${showControls ? 'opacity-100' : 'opacity-0'}`}
                onClick={(e) => e.stopPropagation()}
                onMouseEnter={() => setIsHoveringControls(true)}
                onMouseLeave={() => setIsHoveringControls(false)}
            >
                {/* Interactive Progress Bar */}
                <div
                    ref={progressBarRef}
                    className="w-full h-6 cursor-pointer relative group flex items-center touch-none select-none" // Height increased, no padding hack
                    onPointerDown={handlePointerDown}
                    onPointerMove={handlePointerMove}
                    onPointerUp={handlePointerUp}
                    onPointerLeave={handlePointerUp}
                >
                    {/* Background Track */}
                    <div className="absolute left-0 right-0 h-1 bg-white/30 rounded-full pointer-events-none backdrop-blur-sm" />

                    {/* Active Track */}
                    <div
                        className={`absolute left-0 h-1 bg-red-600 rounded-full pointer-events-none ${isDragging ? '' : 'transition-all duration-100 ease-linear'}`}
                        style={{
                            width: `${(currentTime / (duration || 1)) * 100}%`,
                        }}
                    />

                    {/* Thumb */}
                    <div
                        className={`w-4 h-4 bg-white rounded-full absolute shadow-xl pointer-events-none transition-transform duration-150 ${isDragging ? 'scale-125' : 'scale-0 group-hover:scale-100'}`}
                        style={{
                            left: `${(currentTime / (duration || 1)) * 100}%`,
                            transform: 'translateX(-50%)',
                        }}
                    />
                </div>

                <div className="flex items-center justify-between">
                    <div className="flex items-center gap-8">
                        <Tooltip
                            content={isPlaying ? 'Pause' : 'Play'}
                            closeDelay={0}
                        >
                            <button
                                onClick={(e) => togglePlay(e)}
                                className="text-white hover:scale-110 transition-transform"
                            >
                                {isPlaying ? (
                                    <Pause className="w-10 h-10 fill-current" />
                                ) : (
                                    <Play className="w-10 h-10 fill-current" />
                                )}
                            </button>
                        </Tooltip>

                        <Tooltip content="Rewind 10s" closeDelay={0}>
                            <button
                                onClick={() => skip(-10)}
                                className="text-white hover:scale-110 transition-transform"
                            >
                                <Rewind className="w-8 h-8 fill-current" />
                            </button>
                        </Tooltip>

                        <Tooltip content="Forward 10s" closeDelay={0}>
                            <button
                                onClick={() => skip(10)}
                                className="text-white hover:scale-110 transition-transform"
                            >
                                <FastForward className="w-8 h-8 fill-current" />
                            </button>
                        </Tooltip>

                        <Tooltip
                            content={isMuted ? 'Unmute' : 'Mute'}
                            closeDelay={0}
                        >
                            <button
                                onClick={() => setIsMuted(!isMuted)}
                                className="text-white hover:scale-110 transition-transform"
                            >
                                {isMuted ? (
                                    <VolumeX className="w-8 h-8" />
                                ) : (
                                    <Volume2 className="w-8 h-8" />
                                )}
                            </button>
                        </Tooltip>
                    </div>

                    <div className="flex items-center gap-8">
                        <select
                            aria-label="Playback Speed"
                            value={speed}
                            onChange={(e) => {
                                const newSpeed = parseFloat(e.target.value);
                                setSpeed(newSpeed);
                                if (videoRef.current) {
                                    videoRef.current.playbackRate = newSpeed;
                                }
                            }}
                            className="appearance-none bg-transparent text-white text-2xl font-bold tabular-nums cursor-pointer hover:scale-110 transition-transform focus:outline-none"
                        >
                            {speedOptions.map((sOption) => (
                                <option
                                    key={sOption}
                                    value={sOption}
                                    className="bg-black text-white text-base"
                                >
                                    {sOption}x
                                </option>
                            ))}
                        </select>
                        <span className="text-white text-sm font-medium tabular-nums">
                            {formatTime(currentTime)} / {formatTime(duration)}
                        </span>
                        <Tooltip
                            content={
                                isFullscreen ? 'Exit Fullscreen' : 'Fullscreen'
                            }
                            closeDelay={0}
                        >
                            <button
                                onClick={toggleFullscreen}
                                className="text-white hover:scale-110 transition-transform"
                            >
                                {isFullscreen ? (
                                    <Minimize className="w-6 h-6" />
                                ) : (
                                    <Maximize className="w-6 h-6" />
                                )}
                            </button>
                        </Tooltip>
                    </div>
                </div>
            </div>
        </div>
    );
}
