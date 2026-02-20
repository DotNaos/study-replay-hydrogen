export type RecordingRow = {
    recordingDate: string;
    recordingName: string;
    downloadUrl: string | null;
    recordingUrl: string | null;
    recordingUuid: string | null;
    coverUrl: string | null;
    sessionTitle: string;
    lastPosition?: number;
    lastWatchedAt?: string;
    durationSeconds?: number;
    courseId?: string;
    courseName?: string;
    term?: string;
};

export type HeroRecording = RecordingRow & {
    courseImage?: string;
    courseId: string;
    courseName: string;
};

export type CourseLibrary = {
    courseId: string;
    courseName: string;
    courseImage?: string;
    isWatchlist?: number;
    lastWatchedUuid?: string;
    recordings: RecordingRow[];
};

export type TermLibrary = {
    term: string;
    courses: CourseLibrary[];
};

export type LibraryState = {
    terms: TermLibrary[];
};
