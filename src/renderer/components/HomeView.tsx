import { Button } from '@heroui/react';
import { Check, Info, Play, Plus, RefreshCw } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
    CourseLibrary,
    HeroRecording,
    RecordingRow,
    TermLibrary,
} from '../models';
import {
    formatRecordingDate,
    getChronologicalIndex,
    hasValidUrls,
} from '../utils';

interface HomeViewProps {
    terms: TermLibrary[];
    onSelectCourse: (course: CourseLibrary) => void;
    onPlayCourse: (course: CourseLibrary) => void;
    heroRecording: HeroRecording | null;
    recentHistory: RecordingRow[];
    watchlist: CourseLibrary[];
    onToggleWatchlist: (courseId: string, status: boolean) => void;
    onRefreshCourse?: (courseId: string) => Promise<void>;
}

export function HomeView({
    terms,
    onSelectCourse,
    onPlayCourse,
    heroRecording,
    recentHistory,
    watchlist,
    onToggleWatchlist,
    onRefreshCourse,
}: HomeViewProps) {
    const [hoveredCardKey, setHoveredCardKey] = useState<string | null>(null);

    const filteredTerms = useMemo(() => {
        // Regex to match FS24, HS25, etc.
        const termRegex = /^(FS|HS)\d{2}$/;
        return terms.filter((term) => termRegex.test(term.term));
    }, [terms]);

    // Group courses for easy lookup
    const allCourses = useMemo(() => terms.flatMap((t) => t.courses), [terms]);

    const recentCourses = useMemo(() => {
        const unique = new Map<string, any>();
        recentHistory.forEach((rec) => {
            const courseId = (rec as any).courseId;
            if (!unique.has(courseId)) {
                const course = allCourses.find((c) => c.courseId === courseId);
                if (course) {
                    unique.set(courseId, { ...course, recentRec: rec });
                }
            }
        });
        return Array.from(unique.values());
    }, [recentHistory, allCourses]);

    const isCourseInWatchlist = (courseId: string) =>
        watchlist.some((c) => c.courseId === courseId);

    return (
        <div className="pb-32 animate-in fade-in duration-1000">
            {/* HERO SECTION */}
            {heroRecording ? (
                <div className="relative w-full aspect-[21/9] min-h-[700px] overflow-hidden group">
                    {/* Live Preview Video - NO BLENDING */}
                    {heroRecording.recordingUrl || heroRecording.downloadUrl ? (
                        <video
                            src={
                                heroRecording.downloadUrl ||
                                heroRecording.recordingUrl ||
                                ''
                            }
                            autoPlay
                            muted
                            loop
                            className="absolute inset-0 w-full h-full object-cover z-0"
                        />
                    ) : (
                        heroRecording.courseImage && (
                            <div
                                className="absolute inset-0 bg-cover bg-center"
                                style={{
                                    backgroundImage: `url(${heroRecording.courseImage})`,
                                }}
                            />
                        )
                    )}

                    {/* Netflix-style Overlays */}
                    <div className="absolute inset-0 bg-gradient-to-r from-[#0f131a] via-[#0f131a]/40 to-transparent z-10" />
                    <div className="absolute inset-0 bg-gradient-to-t from-[#0f131a] via-transparent to-transparent z-10" />
                    <div className="absolute inset-0 bg-gradient-to-b from-[#0f131a]/80 via-transparent to-transparent z-10" />

                    {/* Content */}
                    <div className="absolute bottom-0 left-0 p-6 md:p-10 space-y-6 max-w-2xl z-20">
                        <div className="space-y-2">
                            <span className="text-sky-400 font-black uppercase tracking-[0.3em] text-xs">
                                Continue Watching
                            </span>
                            <h1 className="text-4xl md:text-6xl font-black text-white tracking-tighter font-display drop-shadow-2xl">
                                {heroRecording.courseName}
                            </h1>
                            <p className="text-lg text-slate-300 font-medium line-clamp-2 drop-shadow-md">
                                {formatRecordingDate(
                                    heroRecording.recordingDate,
                                ) || 'Latest Recording'}
                            </p>
                        </div>

                        <div className="flex items-center gap-4">
                            {/* Show Refresh button if URLs are expired */}
                            {!(
                                heroRecording.recordingUrl ||
                                heroRecording.downloadUrl
                            ) ? (
                                <Button
                                    onPress={() =>
                                        onRefreshCourse?.(
                                            heroRecording.courseId,
                                        )
                                    }
                                    className="bg-amber-500 text-black font-black px-8 py-6 hover:bg-amber-400 transition-all text-lg shadow-xl"
                                >
                                    <RefreshCw className="w-6 h-6" />
                                    URLs aktualisieren
                                </Button>
                            ) : (
                                <Button
                                    onPress={() => {
                                        const course = allCourses.find(
                                            (c) =>
                                                c.courseId ===
                                                heroRecording.courseId,
                                        );
                                        if (course) onPlayCourse(course);
                                    }}
                                    className="bg-white text-black font-black px-8 py-6 hover:bg-white/90 transition-all text-lg shadow-xl"
                                >
                                    <Play className="w-6 h-6 fill-current" />
                                    {(() => {
                                        const course = allCourses.find(
                                            (c) =>
                                                c.courseId ===
                                                heroRecording.courseId,
                                        );
                                        const idx = course
                                            ? getChronologicalIndex(
                                                  course.recordings,
                                                  heroRecording.recordingUuid,
                                              )
                                            : -1;
                                        return idx !== -1
                                            ? `Weiter E${idx + 1}`
                                            : 'Fortsetzen';
                                    })()}
                                </Button>
                            )}
                            <Button
                                onPress={() => {
                                    const course = allCourses.find(
                                        (c) =>
                                            c.courseId ===
                                            heroRecording.courseId,
                                    );
                                    if (course) onSelectCourse(course);
                                }}
                                className="bg-slate-500/30 backdrop-blur-md border-transparent text-white font-bold px-8 py-6 hover:bg-slate-500/50 transition-all text-lg"
                            >
                                <Info className="w-6 h-6" />
                                More Info
                            </Button>
                        </div>
                    </div>
                </div>
            ) : null}

            {/* ROWS SECTION */}
            <div className={`space-y-12 ${!heroRecording ? 'pt-40' : 'pt-12'}`}>
                {/* RECURRING ROW COMPONENT FOR CONSISTENCY */}
                {recentCourses.length > 0 && (
                    <CourseRow
                        id="recent"
                        title="Recently Watched"
                        courses={recentCourses}
                        onSelectCourse={onSelectCourse}
                        onPlayCourse={onPlayCourse}
                        onToggleWatchlist={onToggleWatchlist}
                        isCourseInWatchlist={isCourseInWatchlist}
                        hoveredCardKey={hoveredCardKey}
                        setHoveredCardKey={setHoveredCardKey}
                        onRefreshCourse={onRefreshCourse}
                    />
                )}

                {watchlist.length > 0 && (
                    <CourseRow
                        id="watchlist"
                        title="My List"
                        courses={watchlist}
                        onSelectCourse={onSelectCourse}
                        onPlayCourse={onPlayCourse}
                        onToggleWatchlist={onToggleWatchlist}
                        isCourseInWatchlist={isCourseInWatchlist}
                        hoveredCardKey={hoveredCardKey}
                        setHoveredCardKey={setHoveredCardKey}
                        onRefreshCourse={onRefreshCourse}
                    />
                )}

                {filteredTerms.map((term) => (
                    <CourseRow
                        key={term.term}
                        id={term.term}
                        title={term.term}
                        courses={term.courses}
                        onSelectCourse={onSelectCourse}
                        onPlayCourse={onPlayCourse}
                        onToggleWatchlist={onToggleWatchlist}
                        isCourseInWatchlist={isCourseInWatchlist}
                        hoveredCardKey={hoveredCardKey}
                        setHoveredCardKey={setHoveredCardKey}
                        onRefreshCourse={onRefreshCourse}
                    />
                ))}
            </div>
        </div>
    );
}

interface CourseRowProps {
    id: string;
    title: string;
    courses: any[];
    onSelectCourse: (course: CourseLibrary) => void;
    onPlayCourse: (course: CourseLibrary) => void;
    onToggleWatchlist: (courseId: string, status: boolean) => void;
    isCourseInWatchlist: (courseId: string) => boolean;
    hoveredCardKey: string | null;
    setHoveredCardKey: (key: string | null) => void;
    onRefreshCourse?: (courseId: string) => Promise<void>;
}

function CourseRow({
    id,
    title,
    courses,
    onSelectCourse,
    onPlayCourse,
    onToggleWatchlist,
    isCourseInWatchlist,
    hoveredCardKey,
    setHoveredCardKey,
    onRefreshCourse,
}: CourseRowProps) {
    return (
        <div className="space-y-4 relative pl-6 md:pl-10">
            <h2 className="text-2xl font-bold text-white font-display">
                {title}
            </h2>
            <div className="flex gap-4 overflow-x-auto pb-48 -mb-48 pt-16 -mt-16 scrollbar-hide snap-x pr-20 items-start overflow-y-visible">
                {courses.map((course, index) => {
                    const cardKey = `${id}-${course.courseId}`;
                    return (
                        <CourseCard
                            key={course.courseId}
                            course={course}
                            onSelectCourse={onSelectCourse}
                            onPlayCourse={onPlayCourse}
                            onToggleWatchlist={onToggleWatchlist}
                            isInWatchlist={isCourseInWatchlist(course.courseId)}
                            isHovered={hoveredCardKey === cardKey}
                            isFirst={index === 0}
                            onHoverChange={(hovered) =>
                                setHoveredCardKey(hovered ? cardKey : null)
                            }
                            onRefreshCourse={onRefreshCourse}
                        />
                    );
                })}
            </div>
        </div>
    );
}

function CourseCard({
    course,
    onSelectCourse,
    onPlayCourse,
    onToggleWatchlist,
    isInWatchlist,
    isHovered,
    isFirst,
    onHoverChange,
    onRefreshCourse,
}: {
    course: CourseLibrary & { recentRec?: RecordingRow };
    onSelectCourse: (c: CourseLibrary) => void;
    onPlayCourse: (c: CourseLibrary) => void;
    onToggleWatchlist: (id: string, s: boolean) => void;
    isInWatchlist: boolean;
    isHovered: boolean;
    isFirst: boolean;
    onHoverChange: (hovered: boolean) => void;
    onRefreshCourse?: (courseId: string) => void;
}) {
    const videoRef = useRef<HTMLVideoElement>(null);

    // Check if course has valid URLs
    const hasUrls = useMemo(
        () => hasValidUrls(course.recordings),
        [course.recordings],
    );

    // Pick a preview recording
    const previewRec = useMemo(() => {
        if (course.recentRec) return course.recentRec;
        const sorted = [...course.recordings].sort((a, b) =>
            b.recordingDate.localeCompare(a.recordingDate),
        );
        const lastWatched = sorted.find(
            (r) => r.recordingUuid === course.lastWatchedUuid,
        );
        return lastWatched || sorted[0];
    }, [course]);

    const previewUrl =
        previewRec?.downloadUrl || previewRec?.recordingUrl || '';

    // Calculate progress percentage - only if duration is known
    const progressPercent = useMemo(() => {
        if (!previewRec?.lastPosition || !previewRec?.durationSeconds) return 0;
        return Math.min(
            100,
            (previewRec.lastPosition / previewRec.durationSeconds) * 100,
        );
    }, [previewRec]);

    // Set video to saved position when hovered
    useEffect(() => {
        if (isHovered && videoRef.current && previewRec?.lastPosition) {
            videoRef.current.currentTime = previewRec.lastPosition;
        }
    }, [isHovered, previewRec?.lastPosition]);

    const currentEpIdx = getChronologicalIndex(
        course.recordings,
        course.lastWatchedUuid,
    );

    const episodeLabel =
        currentEpIdx !== -1
            ? `E${currentEpIdx + 1}`
            : `${course.recordings.length} Episodes`;

    return (
        <div
            className="flex-none w-[360px] aspect-video relative snap-start group cursor-pointer"
            onMouseEnter={() => onHoverChange(true)}
            onMouseLeave={() => onHoverChange(false)}
            onClick={() => onPlayCourse(course)}
        >
            <div
                className={`absolute top-0 left-0 w-full rounded-md bg-[#141414] border border-white/5 overflow-hidden transition-all duration-500 ease-out shadow-[0_4px_10px_rgba(0,0,0,0.5)]
                ${
                    isHovered
                        ? `scale-125 z-50 shadow-[0_20px_50px_-15px_rgba(0,0,0,0.8)] -translate-y-[20%] ${isFirst ? 'origin-left' : ''}`
                        : 'z-10'
                }`}
            >
                {/* Media Container (top part) */}
                <div className="relative aspect-video w-full overflow-hidden bg-slate-900">
                    {course.courseImage && !isHovered && (
                        <div
                            className="absolute inset-0 bg-cover bg-center transition-opacity duration-300"
                            style={{
                                backgroundImage: `url(${course.courseImage})`,
                            }}
                        />
                    )}

                    {/* Show Refresh button if no valid URLs */}
                    {isHovered && !hasUrls && (
                        <div className="absolute inset-0 flex items-center justify-center bg-black/70 animate-in fade-in duration-300">
                            <button
                                onClick={(e) => {
                                    e.stopPropagation();
                                    onRefreshCourse?.(course.courseId);
                                }}
                                className="flex flex-col items-center gap-2 text-white hover:scale-105 transition-transform"
                            >
                                <RefreshCw className="w-8 h-8" />
                                <span className="text-xs font-bold">
                                    URLs abgelaufen
                                </span>
                            </button>
                        </div>
                    )}

                    {/* Video preview - only if has URLs */}
                    {isHovered && hasUrls && previewUrl ? (
                        <video
                            ref={videoRef}
                            src={previewUrl}
                            autoPlay
                            muted
                            loop
                            className="absolute inset-0 w-full h-full object-cover animate-in fade-in duration-700"
                        />
                    ) : !course.courseImage ? (
                        <div className="absolute inset-0 bg-gradient-to-br from-slate-800 to-black" />
                    ) : null}

                    {/* Gradient overlay for static view */}
                    {!isHovered && (
                        <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-transparent" />
                    )}

                    {/* Static Title (Visible when not hovered) */}
                    {!isHovered && (
                        <div className="absolute bottom-2 left-3 right-3 transition-opacity">
                            <h3 className="font-extrabold text-white text-sm leading-tight line-clamp-2 drop-shadow-md">
                                {course.courseName}
                            </h3>
                        </div>
                    )}
                </div>

                {/* Bottom Info (Appended on hover) */}
                <div
                    className={`transition-all duration-500 origin-top ${
                        isHovered
                            ? 'opacity-100 translate-y-0 h-auto visible p-4 bg-[#181818]'
                            : 'opacity-0 h-0 -translate-y-4 invisible p-0'
                    }`}
                >
                    <div className="flex items-center justify-between mb-4">
                        <div className="flex items-center gap-2">
                            <div
                                onClick={(e) => {
                                    e.stopPropagation();
                                    onPlayCourse(course);
                                }}
                                className="w-8 h-8 rounded-full bg-white flex items-center justify-center hover:bg-slate-300 transition-colors shadow-lg"
                            >
                                <Play className="w-4 h-4 fill-black text-black ml-0.5" />
                            </div>
                            <button
                                onClick={(e) => {
                                    e.stopPropagation();
                                    onToggleWatchlist(
                                        course.courseId,
                                        !isInWatchlist,
                                    );
                                }}
                                className={`w-8 h-8 rounded-full border-2 flex items-center justify-center transition-colors hover:cursor-pointer ${
                                    isInWatchlist
                                        ? 'border-emerald-500 hover:border-emerald-700 bg-emerald-500/10'
                                        : 'border-slate-500 hover:border-white'
                                }`}
                            >
                                {isInWatchlist ? (
                                    <Check className="w-4 h-4 text-emerald-500" />
                                ) : (
                                    <Plus className="w-4 h-4 text-white" />
                                )}
                            </button>
                        </div>
                        <button
                            onClick={(e) => {
                                e.stopPropagation();
                                onSelectCourse(course);
                            }}
                            className="w-8 h-8 rounded-full border-2 border-slate-500 flex items-center justify-center hover:border-white/80 transition-colors hover:cursor-pointer hover:bg-white/10"
                        >
                            <Info className="w-4 h-4 text-white" />
                        </button>
                    </div>

                    {/* Course Name */}
                    <h3 className="font-black text-white text-sm leading-tight mb-1.5 font-display truncate w-full">
                        {course.courseName}
                    </h3>

                    {/* Episode • Date */}
                    <div className="flex items-center gap-2 text-xs text-slate-300 font-bold">
                        <span>{episodeLabel}</span>
                        {course.recentRec && (
                            <>
                                <span className="text-slate-600">•</span>
                                <span className="text-slate-400 font-medium">
                                    {formatRecordingDate(
                                        course.recentRec.recordingDate,
                                    )}
                                </span>
                            </>
                        )}
                    </div>
                </div>

                {/* Progress Bar */}
                {progressPercent > 0 && (
                    <div className="absolute bottom-0 left-0 right-0 h-1 bg-black/50">
                        <div
                            className="h-full bg-red-600"
                            style={{ width: `${progressPercent}%` }}
                        />
                    </div>
                )}
            </div>
        </div>
    );
}
