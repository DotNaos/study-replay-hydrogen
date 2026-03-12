export {}

declare global {
    type StudyReplayUpdaterStage =
        | 'idle'
        | 'unsupported'
        | 'checking'
        | 'available'
        | 'not-available'
        | 'downloading'
        | 'downloaded'
        | 'error'

    type StudyReplayUpdaterState = {
        enabled: boolean
        stage: StudyReplayUpdaterStage
        currentVersion: string
        latestVersion: string | null
        message: string | null
        error: string | null
        progressPercent: number | null
        checkedAt: number | null
    }

    interface Window {
        webexApi: {
            selectOutput: () => Promise<string | null>
            openExternal: (url: string) => Promise<boolean>
            getLibrary: () => Promise<any>
            refreshCourses: () => Promise<any>
            loadCourseRecordings: (courseId: string) => Promise<any>
            getCredentials: () => Promise<{
                credentials: { username?: string; password?: string }
                hasCredentials: boolean
                preferences: { autoLogin: boolean }
            }>
            setCredentials: (payload: { username: string; password: string }) => Promise<{
                ok: boolean
                hasCredentials: boolean
                credentials: { username?: string; password?: string }
            }>
            saveCourseProgress: (
                courseId: string,
                recordingUuid: string,
            ) => Promise<{ ok: boolean }>
            setPreferences: (payload: { autoLogin?: boolean }) => Promise<{
                ok: boolean
                preferences: { autoLogin: boolean }
            }>
            saveProgress: (
                recordingUuid: string,
                position: number,
                duration?: number,
            ) => Promise<{ ok: boolean }>
            getUpdaterState: () => Promise<StudyReplayUpdaterState>
            checkForUpdates: () => Promise<{ ok: boolean; error?: string }>
            quitAndInstallUpdate: () => Promise<{ ok: boolean; error?: string }>
            getRecentHistory: (limit: number) => Promise<any[]>
            getHeroRecording: () => Promise<any>
            toggleWatchlist: (courseId: string, status: boolean) => Promise<{ ok: boolean }>
            onLoadRecordingsProgress: (
                callback: (
                    event: any,
                    payload: { completed: number; total: number; label: string },
                ) => void,
            ) => void
            offLoadRecordingsProgress: () => void
            onUpdaterState: (
                callback: (event: any, payload: StudyReplayUpdaterState) => void,
            ) => void
            offUpdaterState: () => void
        }
    }

    namespace JSX {
        interface IntrinsicElements {
            webview: React.DetailedHTMLProps<React.HTMLAttributes<HTMLElement>, HTMLElement> & {
                src?: string
                partition?: string
            }
            'media-controller': React.DetailedHTMLProps<
                React.HTMLAttributes<HTMLElement>,
                HTMLElement
            >
            'media-control-bar': React.DetailedHTMLProps<
                React.HTMLAttributes<HTMLElement>,
                HTMLElement
            >
            'media-play-button': any
            'media-seek-backward-button': any
            'media-seek-forward-button': any
            'media-time-range': any
            'media-time-display': any
            'media-mute-button': any
            'media-volume-range': any
            'media-fullscreen-button': any
        }
    }
}
