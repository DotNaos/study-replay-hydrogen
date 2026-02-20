import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron'
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

if (process.env.HEADFUL === '1') setHeadful(true)

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

    createWindow()

    if (process.platform === 'darwin') {
        app.dock?.setIcon(path.join(__dirname, '../../assets/dock-icon.png'))
    }

    app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) {
            createWindow()
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
