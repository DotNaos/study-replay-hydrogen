import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron'
import { autoUpdater } from 'electron-updater'
import { readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import path from 'node:path'
import { ensureChromium, getChromiumExecutablePath, isChromiumInstalled } from './chromium'
import {
    deriveTerm,
    getHeroRecording,
    getLibrary,
    getRecentHistory,
    saveCourseProgress,
    saveProgress,
    toggleWatchlist,
    upsertCourses,
    upsertRecordings,
} from './libraryDb'
import { fetchCourseRecordings, fetchCourses, setHeadful, shutdownBrowser } from './scrape'
import {
    getCredentials,
    getPreferences,
    hasCredentials,
    setCredentials,
    setPreferences,
} from './store'

const isMac = process.platform === 'darwin'
const UPDATER_STATE_CHANNEL = 'study-replay:updater:state'

type UpdaterStage =
    | 'idle'
    | 'unsupported'
    | 'checking'
    | 'available'
    | 'not-available'
    | 'downloading'
    | 'downloaded'
    | 'error'

type UpdaterState = {
    enabled: boolean
    stage: UpdaterStage
    currentVersion: string
    latestVersion: string | null
    message: string | null
    error: string | null
    progressPercent: number | null
    checkedAt: number | null
}

if (process.env.HEADFUL === '1') setHeadful(true)

let mainWindow: BrowserWindow | null = null
let updaterInitialized = false
let updaterCheckInFlight: Promise<void> | null = null
let updaterState: UpdaterState = {
    enabled: false,
    stage: 'unsupported',
    currentVersion: app.getVersion(),
    latestVersion: null,
    message: 'Auto-Update ist nur in der installierten App verfügbar.',
    error: null,
    progressPercent: null,
    checkedAt: null,
}

function sendUpdaterState(targetWindow?: BrowserWindow | null): void {
    const window = targetWindow ?? mainWindow
    if (!window || window.isDestroyed()) return
    window.webContents.send(UPDATER_STATE_CHANNEL, updaterState)
}

function setUpdaterState(patch: Partial<UpdaterState>): void {
    updaterState = {
        ...updaterState,
        ...patch,
        currentVersion: app.getVersion(),
    }
    sendUpdaterState()
}

function supportsAutoUpdatesOnPlatform(): boolean {
    return process.platform === 'darwin' || process.platform === 'win32'
}

function isUpdaterEnabled(): boolean {
    return updaterState.enabled && supportsAutoUpdatesOnPlatform() && app.isPackaged
}

function toUpdaterErrorMessage(error: unknown): string {
    if (error instanceof Error) return error.message
    return String(error)
}

function normalizeVersion(version: string | null | undefined): string {
    return String(version ?? '')
        .trim()
        .replace(/^v/i, '')
}

function isSameVersion(left: string | null | undefined, right: string | null | undefined): boolean {
    const normalizedLeft = normalizeVersion(left)
    const normalizedRight = normalizeVersion(right)
    return Boolean(normalizedLeft) && normalizedLeft === normalizedRight
}

async function checkForAppUpdates(reason: 'startup' | 'manual'): Promise<void> {
    if (!isUpdaterEnabled()) return
    if (updaterCheckInFlight) {
        await updaterCheckInFlight
        return
    }

    updaterCheckInFlight = (async () => {
        try {
            if (reason === 'manual') {
                setUpdaterState({
                    stage: 'checking',
                    message: 'Prüfe auf Updates...',
                    error: null,
                })
            }
            await autoUpdater.checkForUpdates()
        } catch (error) {
            setUpdaterState({
                stage: 'error',
                error: toUpdaterErrorMessage(error),
                message: 'Update-Prüfung fehlgeschlagen.',
                checkedAt: Date.now(),
            })
            throw error
        } finally {
            updaterCheckInFlight = null
        }
    })()

    await updaterCheckInFlight
}

function initializeAutoUpdater(): void {
    if (updaterInitialized) return
    updaterInitialized = true

    if (!app.isPackaged) {
        setUpdaterState({
            enabled: false,
            stage: 'unsupported',
            message: 'Auto-Update ist im Dev-Modus deaktiviert.',
            error: null,
        })
        return
    }

    if (!supportsAutoUpdatesOnPlatform()) {
        setUpdaterState({
            enabled: false,
            stage: 'unsupported',
            message: 'Auto-Update wird auf dieser Plattform aktuell nicht unterstützt.',
            error: null,
        })
        return
    }

    if (isMac && !app.isInApplicationsFolder()) {
        setUpdaterState({
            enabled: false,
            stage: 'unsupported',
            message: 'Auto-Update ist nur verfügbar, wenn die App im Programme-Ordner liegt.',
            error: null,
        })
        return
    }

    autoUpdater.autoDownload = true
    autoUpdater.autoInstallOnAppQuit = true
    autoUpdater.allowPrerelease = false

    autoUpdater.on('checking-for-update', () => {
        setUpdaterState({
            enabled: true,
            stage: 'checking',
            message: 'Prüfe auf Updates...',
            error: null,
            progressPercent: null,
            checkedAt: Date.now(),
        })
    })

    autoUpdater.on('update-available', (info) => {
        if (isSameVersion(info.version ?? null, app.getVersion())) {
            setUpdaterState({
                enabled: true,
                stage: 'not-available',
                latestVersion: info.version ?? null,
                message: 'App ist aktuell.',
                error: null,
                progressPercent: null,
                checkedAt: Date.now(),
            })
            return
        }

        setUpdaterState({
            enabled: true,
            stage: 'available',
            latestVersion: info.version ?? null,
            message: `Version ${info.version ?? 'neu'} gefunden. Download startet...`,
            error: null,
            progressPercent: null,
            checkedAt: Date.now(),
        })
    })

    autoUpdater.on('update-not-available', (info) => {
        setUpdaterState({
            enabled: true,
            stage: 'not-available',
            latestVersion: info.version ?? null,
            message: 'App ist aktuell.',
            error: null,
            progressPercent: null,
            checkedAt: Date.now(),
        })
    })

    autoUpdater.on('download-progress', (progress) => {
        setUpdaterState({
            enabled: true,
            stage: 'downloading',
            message: 'Update wird heruntergeladen...',
            error: null,
            progressPercent:
                typeof progress.percent === 'number'
                    ? Math.max(0, Math.min(100, progress.percent))
                    : null,
        })
    })

    autoUpdater.on('update-downloaded', (info) => {
        const alreadyCurrent = isSameVersion(info.version ?? null, app.getVersion())
        setUpdaterState({
            enabled: true,
            stage: alreadyCurrent ? 'not-available' : 'downloaded',
            latestVersion: info.version ?? null,
            message: alreadyCurrent
                ? 'App ist aktuell.'
                : `Version ${info.version ?? 'neu'} ist bereit zur Installation.`,
            error: null,
            progressPercent: alreadyCurrent ? null : 100,
            checkedAt: Date.now(),
        })
    })

    autoUpdater.on('error', (error) => {
        setUpdaterState({
            enabled: true,
            stage: 'error',
            message: 'Update fehlgeschlagen.',
            error: toUpdaterErrorMessage(error),
            checkedAt: Date.now(),
        })
    })

    setUpdaterState({
        enabled: true,
        stage: 'idle',
        message: null,
        error: null,
    })
}

function createWindow(): BrowserWindow {
    const preloadPath = path.join(__dirname, '../preload/index.js')
    const win = new BrowserWindow({
        width: 1100,
        height: 720,
        backgroundColor: '#0f131a',
        webPreferences: {
            preload: preloadPath,
            contextIsolation: true,
            nodeIntegration: false,
            webviewTag: true,
            webSecurity: false, // Required for Webex streams without CORS
        },
        icon: path.join(__dirname, '../../assets/icon.png'),
    })

    const rendererUrl = process.env['ELECTRON_RENDERER_URL']
    if (rendererUrl) {
        win.loadURL(rendererUrl)
    } else {
        win.loadFile(path.join(__dirname, '../renderer/index.html'))
    }

    win.webContents.on('did-finish-load', () => {
        sendUpdaterState(win)
    })

    return win
}

function parseEnvFile(contents: string): Record<string, string> {
    const env: Record<string, string> = {}
    for (const rawLine of contents.split(/\r?\n/)) {
        const line = rawLine.trim()
        if (!line || line.startsWith('#')) continue
        const normalized = line.startsWith('export ') ? line.slice(7).trim() : line
        const eqIndex = normalized.indexOf('=')
        if (eqIndex === -1) continue
        const key = normalized.slice(0, eqIndex).trim()
        let value = normalized.slice(eqIndex + 1).trim()
        if (
            (value.startsWith('"') && value.endsWith('"')) ||
            (value.startsWith("'") && value.endsWith("'"))
        ) {
            value = value.slice(1, -1)
        }
        if (key) env[key] = value
    }
    return env
}

async function loadEnvVars(): Promise<Record<string, string>> {
    const envPath = path.join(homedir(), '.env')
    try {
        const contents = await readFile(envPath, 'utf8')
        return parseEnvFile(contents)
    } catch {
        return {}
    }
}

ipcMain.handle('select-output', async () => {
    const result = await dialog.showSaveDialog({
        title: 'Save CSV',
        defaultPath: path.join(process.cwd(), 'study-replay.csv'),
        filters: [{ name: 'CSV', extensions: ['csv'] }],
    })

    return result.canceled ? null : result.filePath
})

ipcMain.handle('ensure-chromium', async (event) => {
    if (isChromiumInstalled()) {
        return { status: 'ready', path: getChromiumExecutablePath() }
    }
    const execPath = await ensureChromium((percent) => {
        event.sender.send('chromium-download-progress', percent)
    })
    return { status: 'ready', path: execPath }
})

ipcMain.handle('is-chromium-installed', async () => {
    return isChromiumInstalled()
})

ipcMain.handle('refresh-courses', async () => {
    const creds = getCredentials()
    if (!creds.username || !creds.password) {
        throw new Error('Missing credentials. Configure login first.')
    }

    const courses = await fetchCourses({
        username: creds.username,
        password: creds.password,
    })
    await upsertCourses(
        courses.map((course) => ({
            courseId: course.id,
            courseName: course.fullname,
            term: deriveTerm(course.category || course.fullname || ''),
            courseImage: course.courseimage,
        })),
    )

    return getLibrary()
})

ipcMain.handle('load-course-recordings', async (_event, courseId: string) => {
    const creds = getCredentials()
    if (!creds.username || !creds.password) {
        throw new Error('Missing credentials. Configure login first.')
    }

    const courses = await fetchCourses({
        username: creds.username,
        password: creds.password,
    })
    const target = courses.find((course) => course.id === courseId)
    if (!target) {
        throw new Error('Course not found.')
    }

    const recordings = await fetchCourseRecordings(
        { username: creds.username, password: creds.password },
        target,
        (completed, total, label) => {
            _event.sender.send('load-recordings-progress', { completed, total, label })
        },
    )
    await upsertRecordings(recordings)

    return getLibrary()
})

ipcMain.handle('open-external', async (_event, url: string) => {
    if (!url) return false
    await shell.openExternal(url)
    return true
})

ipcMain.handle('get-library', async () => {
    return getLibrary()
})

ipcMain.handle('get-credentials', async () => {
    return {
        credentials: getCredentials(),
        hasCredentials: hasCredentials(),
        preferences: getPreferences(),
    }
})

ipcMain.handle(
    'set-credentials',
    async (_event, payload: { username: string; password: string }) => {
        setCredentials(payload)
        return {
            ok: true,
            hasCredentials: hasCredentials(),
            credentials: getCredentials(),
        }
    },
)

ipcMain.handle('set-preferences', async (_event, payload: { autoLogin?: boolean }) => {
    const next = setPreferences(payload)
    return { ok: true, preferences: next }
})

ipcMain.handle(
    'save-progress',
    async (
        _event,
        {
            recordingUuid,
            position,
            duration,
        }: { recordingUuid: string; position: number; duration?: number },
    ) => {
        await saveProgress(recordingUuid, position, duration)
        return { ok: true }
    },
)

ipcMain.handle('get-recent-history', async (_event, limit: number) => {
    return getRecentHistory(limit)
})

ipcMain.handle('get-hero-recording', async () => {
    return getHeroRecording()
})

ipcMain.handle(
    'toggle-watchlist',
    async (_event, { courseId, status }: { courseId: string; status: boolean }) => {
        await toggleWatchlist(courseId, status)
        return { ok: true }
    },
)

ipcMain.handle(
    'save-course-progress',
    async (_event, { courseId, recordingUuid }: { courseId: string; recordingUuid: string }) => {
        await saveCourseProgress(courseId, recordingUuid)
        return { ok: true }
    },
)

ipcMain.handle('study-replay:updater:getState', async () => updaterState)

ipcMain.handle('study-replay:updater:checkForUpdates', async () => {
    try {
        await checkForAppUpdates('manual')
        return { ok: true }
    } catch (error) {
        return { ok: false, error: toUpdaterErrorMessage(error) }
    }
})

ipcMain.handle('study-replay:updater:quitAndInstall', async () => {
    if (!isUpdaterEnabled()) {
        return { ok: false, error: 'Auto-Updater ist nicht verfügbar.' }
    }

    if (updaterState.stage !== 'downloaded') {
        return { ok: false, error: 'Es ist noch kein geladenes Update vorhanden.' }
    }

    setImmediate(() => {
        autoUpdater.quitAndInstall()
    })
    return { ok: true }
})

app.whenReady().then(async () => {
    app.setName('Study Replay')
    if (process.platform === 'win32') {
        app.setAppUserModelId('com.aryazos.studyreplay')
    }

    const envVars = await loadEnvVars()
    if (envVars['MOODLE_USERNAME'] && envVars['MOODLE_PASSWORD'] && !hasCredentials()) {
        setCredentials({
            username: envVars['MOODLE_USERNAME'],
            password: envVars['MOODLE_PASSWORD'],
        })
    }

    mainWindow = createWindow()
    initializeAutoUpdater()
    void checkForAppUpdates('startup')

    if (process.platform === 'darwin') {
        app.dock?.setIcon(path.join(__dirname, '../../assets/dock-icon.png'))
    }

    app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) {
            mainWindow = createWindow()
        }
    })
})

app.on('window-all-closed', () => {
    if (!isMac) {
        app.quit()
    }
})

app.on('before-quit', async () => {
    await shutdownBrowser()
})
