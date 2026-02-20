import { create } from 'zustand';
import {
    CourseLibrary,
    HeroRecording,
    LibraryState,
    RecordingRow,
    TermLibrary,
} from './models';

interface LibraryStore extends LibraryState {
    // Additional computed/cached data
    watchlist: CourseLibrary[];
    heroRecording: HeroRecording | null;
    recentHistory: RecordingRow[];

    // Loading states
    isLoading: boolean;
    isRefreshing: boolean;

    // Actions - these update state AND persist to DB
    loadLibrary: () => Promise<void>;
    refreshCourses: () => Promise<void>;
    loadCourseRecordings: (courseId: string) => Promise<void>;

    saveProgress: (
        recordingUuid: string,
        position: number,
        duration?: number,
    ) => Promise<void>;
    saveCourseProgress: (
        courseId: string,
        recordingUuid: string,
    ) => Promise<void>;
    toggleWatchlist: (courseId: string, status: boolean) => Promise<void>;

    // Helpers
    getCourse: (courseId: string) => CourseLibrary | null;
    getRecording: (recordingUuid: string) => RecordingRow | null;
}

// Helper to extract watchlist from terms
function extractWatchlist(terms: TermLibrary[]): CourseLibrary[] {
    return terms.flatMap((t) => t.courses).filter((c) => c.isWatchlist);
}

// Helper to find and update a recording in the terms structure
function updateRecordingInTerms(
    terms: TermLibrary[],
    recordingUuid: string,
    updates: Partial<RecordingRow>,
): TermLibrary[] {
    return terms.map((term) => ({
        ...term,
        courses: term.courses.map((course) => ({
            ...course,
            recordings: course.recordings.map((rec) =>
                rec.recordingUuid === recordingUuid
                    ? { ...rec, ...updates }
                    : rec,
            ),
        })),
    }));
}

// Helper to update course in terms
function updateCourseInTerms(
    terms: TermLibrary[],
    courseId: string,
    updates: Partial<CourseLibrary>,
): TermLibrary[] {
    return terms.map((term) => ({
        ...term,
        courses: term.courses.map((course) =>
            course.courseId === courseId ? { ...course, ...updates } : course,
        ),
    }));
}

export const useLibraryStore = create<LibraryStore>((set, get) => ({
    // Initial state
    terms: [],
    watchlist: [],
    heroRecording: null,
    recentHistory: [],
    isLoading: true,
    isRefreshing: false,

    // Load all library data from DB
    loadLibrary: async () => {
        set({ isLoading: true });
        try {
            const [library, hero, recent] = await Promise.all([
                window.webexApi.getLibrary(),
                window.webexApi.getHeroRecording(),
                window.webexApi.getRecentHistory(10),
            ]);

            set({
                terms: library.terms,
                watchlist: extractWatchlist(library.terms),
                heroRecording: hero,
                recentHistory: recent,
                isLoading: false,
            });
        } catch (error) {
            console.error('Failed to load library:', error);
            set({ isLoading: false });
        }
    },

    // Refresh courses from remote
    refreshCourses: async () => {
        set({ isRefreshing: true });
        try {
            const library = await window.webexApi.refreshCourses();
            set({
                terms: library.terms,
                watchlist: extractWatchlist(library.terms),
                isRefreshing: false,
            });
        } catch (error) {
            console.error('Failed to refresh courses:', error);
            set({ isRefreshing: false });
            throw error;
        }
    },

    // Load recordings for a specific course
    loadCourseRecordings: async (courseId: string) => {
        set({ isRefreshing: true });
        try {
            const library =
                await window.webexApi.loadCourseRecordings(courseId);
            set({
                terms: library.terms,
                watchlist: extractWatchlist(library.terms),
                isRefreshing: false,
            });
        } catch (error) {
            console.error('Failed to load course recordings:', error);
            set({ isRefreshing: false });
            throw error;
        }
    },

    // Save playback progress - updates state optimistically then persists
    saveProgress: async (
        recordingUuid: string,
        position: number,
        duration?: number,
    ) => {
        const { terms, recentHistory, heroRecording } = get();

        // Optimistic update values
        const updates: Partial<RecordingRow> = {
            lastPosition: position,
            lastWatchedAt: new Date().toISOString(),
        };
        if (duration) {
            updates.durationSeconds = duration;
        }

        // Update in Terms
        const newTerms = updateRecordingInTerms(terms, recordingUuid, updates);

        // Update Recent History
        // 1. Find the recording object (either in existing history or in terms)
        let targetRecording = recentHistory.find(
            (r) => r.recordingUuid === recordingUuid,
        );

        if (!targetRecording) {
            // Not in history yet, find in library
            for (const t of terms) {
                for (const c of t.courses) {
                    const found = c.recordings.find(
                        (r) => r.recordingUuid === recordingUuid,
                    );
                    if (found) {
                        targetRecording = found;
                        break;
                    }
                }
                if (targetRecording) break;
            }
        }

        // 2. Construct new history list
        let newRecentHistory = [...recentHistory];
        let newHeroRecording = heroRecording;

        if (targetRecording) {
            // Merge updates
            const updatedRec = { ...targetRecording, ...updates };

            // Remove existing entry for this recording if present
            newRecentHistory = newRecentHistory.filter(
                (r) => r.recordingUuid !== recordingUuid,
            );

            // Add (or re-add) to the front
            newRecentHistory.unshift(updatedRec);

            // Keep only last 10
            if (newRecentHistory.length > 10) {
                newRecentHistory = newRecentHistory.slice(0, 10);
            }

            // --- Update Hero ---
            if (updatedRec.courseId) {
                const courseObj = newTerms
                    .flatMap((t) => t.courses)
                    .find((c) => c.courseId === updatedRec.courseId);

                if (courseObj) {
                    newHeroRecording = {
                        ...updatedRec,
                        courseId: updatedRec.courseId,
                        courseName:
                            updatedRec.courseName || courseObj.courseName,
                        courseImage: courseObj.courseImage,
                    } as HeroRecording;
                }
            }
        }

        set({
            terms: newTerms,
            watchlist: extractWatchlist(newTerms),
            recentHistory: newRecentHistory,
            heroRecording: newHeroRecording,
        });

        // Persist to DB
        await window.webexApi.saveProgress(recordingUuid, position, duration);
    },

    // Save course progress (which episode was last watched)
    saveCourseProgress: async (courseId: string, recordingUuid: string) => {
        const { terms } = get();

        // Optimistic update
        const newTerms = updateCourseInTerms(terms, courseId, {
            lastWatchedUuid: recordingUuid,
        });
        set({
            terms: newTerms,
            watchlist: extractWatchlist(newTerms),
        });

        // Persist to DB
        await window.webexApi.saveCourseProgress(courseId, recordingUuid);
    },

    // Toggle watchlist status
    toggleWatchlist: async (courseId: string, status: boolean) => {
        const { terms } = get();

        // Optimistic update
        const newTerms = updateCourseInTerms(terms, courseId, {
            isWatchlist: status ? 1 : 0,
        });
        set({
            terms: newTerms,
            watchlist: extractWatchlist(newTerms),
        });

        // Persist to DB
        await window.webexApi.toggleWatchlist(courseId, status);
    },

    // Helper to get a course by ID
    getCourse: (courseId: string) => {
        const { terms } = get();
        for (const term of terms) {
            const course = term.courses.find((c) => c.courseId === courseId);
            if (course) return course;
        }
        return null;
    },

    // Helper to get a recording by UUID
    getRecording: (recordingUuid: string) => {
        const { terms } = get();
        for (const term of terms) {
            for (const course of term.courses) {
                const rec = course.recordings.find(
                    (r) => r.recordingUuid === recordingUuid,
                );
                if (rec) return rec;
            }
        }
        return null;
    },
}));
