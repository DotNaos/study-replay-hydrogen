import { Button } from '@heroui/react'
import { ArrowLeft, Check, Play, Plus, RefreshCw, RotateCcw } from 'lucide-react'
import 'media-chrome'
import { useEffect, useMemo, useRef, useState } from 'react'
import { CourseLibrary, RecordingRow } from '../models'
import { formatDuration, formatRecordingDate, hasValidUrls } from '../utils'

interface CourseDetailViewProps {
    course: CourseLibrary
    onBack: () => void
    onRefresh: () => void
    onToggleWatchlist: (courseId: string, status: boolean) => void
    onPlay: (recording: RecordingRow) => void
    refreshing?: boolean
}

function pickPlayableUrl(row: RecordingRow | null): string {
    if (!row) return ''
    return row.downloadUrl || row.recordingUrl || ''
}

export function CourseDetailView({
    course,
    onBack,
    onRefresh,
    onToggleWatchlist,
    onPlay,
    refreshing,
}: CourseDetailViewProps) {
    const sortedRows = useMemo(() => {
        return course.recordings
            .filter((r) => !!r.coverUrl)
            .sort((a, b) => a.recordingDate.localeCompare(b.recordingDate))
    }, [course])

    const activeEpIdx = useMemo(() => {
        const idx = sortedRows.findIndex((r) => r.recordingUuid === course.lastWatchedUuid)
        return idx !== -1 ? idx : 0
    }, [sortedRows, course.lastWatchedUuid])

    const [selected, setSelected] = useState<RecordingRow | null>(
        sortedRows.length > 0 ? sortedRows[activeEpIdx] : null,
    )

    const videoRef = useRef<HTMLVideoElement>(null)
    const lastSavedTime = useRef<number>(0)

    const inWatchlist = !!course.isWatchlist

    // Check if course has valid URLs
    const urlsAvailable = useMemo(() => hasValidUrls(course.recordings), [course.recordings])

    // Progress State
    const [progress, setProgress] = useState({
        completed: 0,
        total: 0,
        label: '',
    })

    useEffect(() => {
        if (!refreshing) {
            setProgress({ completed: 0, total: 0, label: '' })
            return
        }

        const handleProgress = (
            _event: any,
            payload: { completed: number; total: number; label: string },
        ) => {
            setProgress(payload)
        }

        window.webexApi.onLoadRecordingsProgress(handleProgress)
        return () => {
            window.webexApi.offLoadRecordingsProgress()
        }
    }, [refreshing])
    const handleTimeUpdate = () => {
        const video = videoRef.current
        if (!video || !selected?.recordingUuid) return

        if (Math.abs(video.currentTime - lastSavedTime.current) > 5) {
            lastSavedTime.current = video.currentTime
            window.webexApi.saveProgress(selected.recordingUuid, video.currentTime)
        }
    }

    const playableUrl = pickPlayableUrl(selected)

    // Lock body scroll
    useEffect(() => {
        document.body.style.overflow = 'hidden'
        return () => {
            document.body.style.overflow = 'unset'
        }
    }, [])

    return (
        <div
            className="fixed inset-0 z-[200] overflow-y-auto bg-black/80 backdrop-blur-sm animate-in fade-in duration-200"
            onClick={onBack}
        >
            <div
                className="max-w-6xl mx-auto min-h-[calc(100vh-4rem)] mt-8 mb-8 bg-[#141414] shadow-2xl relative rounded-xl overflow-hidden ring-1 ring-white/10"
                onClick={(e) => e.stopPropagation()}
            >
                {/* Back Button */}
                <Button
                    isIconOnly
                    onPress={onBack}
                    className="absolute top-6 left-6 z-[60] bg-black/50 hover:bg-black/80 text-white rounded-full min-w-0 w-10 h-10 p-0"
                >
                    <ArrowLeft className="w-6 h-6" />
                </Button>

                {/* Hero Header */}
                <div className="relative aspect-[21/9] w-full group">
                    <div className="absolute inset-0 bg-black">
                        {playableUrl ? (
                            <video
                                ref={videoRef}
                                src={playableUrl}
                                autoPlay
                                muted
                                loop
                                className="w-full h-full object-cover"
                                onTimeUpdate={handleTimeUpdate}
                            />
                        ) : (
                            course.courseImage && (
                                <img
                                    src={course.courseImage}
                                    className="w-full h-full object-cover opacity-50"
                                />
                            )
                        )}
                    </div>

                    {/* Gradients */}
                    <div className="absolute inset-0 bg-gradient-to-t from-[#141414] via-transparent to-transparent" />
                    <div className="absolute inset-0 bg-gradient-to-r from-[#141414]/90 via-[#141414]/20 to-transparent" />

                    {/* Controls */}
                    <div className="absolute bottom-12 left-12 right-12 flex flex-col gap-6">
                        <h1 className="text-5xl md:text-7xl font-black text-white tracking-tighter font-display drop-shadow-2xl max-w-2xl leading-[0.9]">
                            {course.courseName}
                        </h1>

                        <div className="flex items-center gap-3">
                            {/* Show warning and refresh button if URLs are expired */}
                            {!urlsAvailable ? (
                                <Button
                                    onPress={onRefresh}
                                    isDisabled={refreshing}
                                    className="bg-amber-500 hover:bg-amber-400 text-black font-black px-10 h-14 rounded-full text-xl"
                                >
                                    <RefreshCw
                                        className={`w-6 h-6 ${refreshing ? 'animate-spin' : ''}`}
                                    />
                                    URLs aktualisieren
                                </Button>
                            ) : (
                                <Button
                                    onPress={() => selected && onPlay(selected)}
                                    className="bg-white hover:bg-slate-200 text-black font-black px-10 h-14 rounded-full text-xl"
                                >
                                    <Play className="w-6 h-6 fill-current" />
                                    {activeEpIdx > 0 ||
                                    (sortedRows[activeEpIdx]?.lastPosition ?? 0) > 0
                                        ? `Weiter E${activeEpIdx + 1}`
                                        : 'Abspielen'}
                                </Button>
                            )}
                            <Button
                                isIconOnly
                                onPress={() => onToggleWatchlist(course.courseId, !inWatchlist)}
                                className={`w-14 h-14 min-w-0 rounded-full border-2 bg-transparent backdrop-blur-sm ${inWatchlist ? 'border-emerald-500 bg-emerald-500/10 hover:border-emerald-700 hover:bg-emerald-500/20' : 'border-white/20 hover:border-white bg-black/40'}`}
                            >
                                {inWatchlist ? (
                                    <Check className="w-6 h-6 text-emerald-500" />
                                ) : (
                                    <Plus className="w-6 h-6 text-white" />
                                )}
                            </Button>

                            <div className="ml-auto flex items-center gap-3">
                                {refreshing && progress.total > 0 && (
                                    <div className="flex flex-col items-end gap-1 mr-4">
                                        <div className="text-xs font-bold text-emerald-400 uppercase tracking-wider">
                                            {progress.label}
                                        </div>
                                        <div className="w-32 h-1.5 bg-white/10 rounded-full overflow-hidden">
                                            <div
                                                className="h-full bg-emerald-500 transition-all duration-300"
                                                style={{
                                                    width: `${(progress.completed / progress.total) * 100}%`,
                                                }}
                                            />
                                        </div>
                                    </div>
                                )}
                                <Button
                                    isIconOnly
                                    variant="ghost"
                                    onPress={onRefresh}
                                    isDisabled={refreshing}
                                    className="w-14 h-14 min-w-0 rounded-full border-2 border-white/20 hover:border-white/80 transition-colors text-white bg-black/40 hover:bg-black/10! backdrop-blur-sm bg-transparent"
                                >
                                    <RefreshCw
                                        className={`w-6 h-6 ${refreshing ? 'animate-spin' : ''}`}
                                    />
                                </Button>
                            </div>
                        </div>
                    </div>
                </div>

                {/* Episodes List */}
                <div className="px-12 pb-12 space-y-8">
                    <div className="flex items-center justify-between border-b border-white/10 pb-4">
                        <h2 className="text-2xl font-black text-white font-display">Folgen</h2>
                        {/* <div className="text-white text-lg font-bold flex items-center gap-1 group cursor-pointer hover:text-emerald-500 transition-colors">
                            Staffel 1{' '}
                            <ChevronDown className="w-5 h-5 group-hover:translate-y-0.5 transition-transform" />
                        </div> */}
                    </div>

                    <div className="flex flex-col">
                        {sortedRows.map((row, idx) => {
                            const isSelected = selected?.recordingUuid === row.recordingUuid
                            const isCurrent = row.recordingUuid === course.lastWatchedUuid

                            // Progress Calculation - only if duration is known
                            const progress =
                                row.lastPosition && row.durationSeconds
                                    ? Math.min(100, (row.lastPosition / row.durationSeconds) * 100)
                                    : 0
                            const isWatched = progress >= 95 // Consider >= 95% as "watched"

                            return (
                                <div
                                    key={row.recordingUuid}
                                    onClick={() => {
                                        if (isSelected) onPlay(row)
                                        else setSelected(row)
                                    }}
                                    className={`group flex items-center gap-5 p-4 border-b border-white/10 cursor-pointer transition-all hover:bg-white/5 ${
                                        isSelected ? 'bg-white/5' : ''
                                    }`}
                                >
                                    {/* Index */}
                                    <div
                                        className={`text-2xl font-bold w-12 text-center flex-shrink-0 ${isCurrent ? 'text-emerald-500' : 'text-slate-500'}`}
                                    >
                                        {idx + 1}
                                    </div>

                                    {/* Thumbnail - use recording cover if available, fallback to course image */}
                                    <div className="relative w-40 aspect-video flex-shrink-0 rounded bg-slate-800 overflow-hidden shadow-md group-hover:shadow-lg transition-all">
                                        {row.coverUrl || course.courseImage ? (
                                            <img
                                                src={row.coverUrl || course.courseImage}
                                                className="w-full h-full object-cover opacity-80 group-hover:opacity-100 transition-all duration-500"
                                            />
                                        ) : (
                                            <div className="w-full h-full bg-gradient-to-br from-slate-700 to-black" />
                                        )}

                                        {/* Watched Overlay (Rewatch UI) */}
                                        {isWatched && (
                                            <div
                                                className="absolute inset-0 flex items-center justify-center bg-black/60"
                                                onClick={(e) => {
                                                    e.stopPropagation()
                                                    // Reset to beginning when clicking rewatch
                                                    if (row.recordingUuid) {
                                                        window.webexApi.saveProgress(
                                                            row.recordingUuid,
                                                            0,
                                                        )
                                                    }
                                                    onPlay(row)
                                                }}
                                            >
                                                <RotateCcw className="w-6 h-6 text-white/80" />
                                            </div>
                                        )}

                                        {/* Play Overlay (only for non-watched) */}
                                        {!isWatched && (
                                            <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity bg-black/40">
                                                <Play className="w-8 h-8 text-white fill-current drop-shadow-lg" />
                                            </div>
                                        )}

                                        {/* Progress Bar (only show if in progress, not watched) */}
                                        {progress > 0 && !isWatched && (
                                            <div className="absolute bottom-0 left-0 right-0 h-1 bg-white/20">
                                                <div
                                                    className="h-full bg-red-600"
                                                    style={{
                                                        width: `${progress}%`,
                                                    }}
                                                />
                                            </div>
                                        )}
                                    </div>

                                    {/* Content */}
                                    <div className="flex-1 min-w-0 flex items-center justify-between gap-4">
                                        <div className="space-y-1">
                                            <h3
                                                className={`font-bold text-lg truncate ${isCurrent ? 'text-white' : 'text-slate-200 group-hover:text-white'}`}
                                            >
                                                {formatRecordingDate(row.recordingDate)}
                                            </h3>
                                        </div>

                                        {/* Right Side: Duration & Date */}
                                        <div className="text-right flex flex-col items-end gap-1">
                                            <span className="text-slate-300 font-bold text-sm">
                                                {formatDuration(row.durationSeconds)}
                                            </span>
                                        </div>
                                    </div>
                                </div>
                            )
                        })}
                    </div>
                </div>
            </div>
        </div>
    )
}
