import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('webexApi', {
    selectOutput: () => ipcRenderer.invoke('select-output'),
    openExternal: (url: string) => ipcRenderer.invoke('open-external', url),
    getLibrary: () => ipcRenderer.invoke('get-library'),
    refreshCourses: () => ipcRenderer.invoke('refresh-courses'),
    loadCourseRecordings: (courseId: string) =>
        ipcRenderer.invoke('load-course-recordings', courseId),
    getCredentials: () => ipcRenderer.invoke('get-credentials'),
    setCredentials: (payload: { username: string; password: string }) =>
        ipcRenderer.invoke('set-credentials', payload),
    setPreferences: (payload: { autoLogin?: boolean }) =>
        ipcRenderer.invoke('set-preferences', payload),
    saveProgress: (recordingUuid: string, position: number, duration?: number) =>
        ipcRenderer.invoke('save-progress', {
            recordingUuid,
            position,
            duration,
        }),
    getRecentHistory: (limit: number) => ipcRenderer.invoke('get-recent-history', limit),
    getHeroRecording: () => ipcRenderer.invoke('get-hero-recording'),
    toggleWatchlist: (courseId: string, status: boolean) =>
        ipcRenderer.invoke('toggle-watchlist', { courseId, status }),
    saveCourseProgress: (courseId: string, recordingUuid: string) =>
        ipcRenderer.invoke('save-course-progress', { courseId, recordingUuid }),
    onLoadRecordingsProgress: (
        callback: (
            event: any,
            payload: { completed: number; total: number; label: string },
        ) => void,
    ) => ipcRenderer.on('load-recordings-progress', callback),
    offLoadRecordingsProgress: () => ipcRenderer.removeAllListeners('load-recordings-progress'),
})
