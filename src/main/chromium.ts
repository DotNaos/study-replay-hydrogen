import { Browser, detectBrowserPlatform, install, resolveBuildId } from '@puppeteer/browsers'
import { app } from 'electron'
import { existsSync, readdirSync } from 'node:fs'
import { homedir } from 'node:os'
import path from 'node:path'
import { log as rootLog } from './logger'

const log = rootLog.child({ mod: 'chromium' })

const CHROME_DIR_NAME = 'chromium'

function getChromeBaseDir(): string {
    if (typeof app?.getPath === 'function') {
        return path.join(app.getPath('userData'), CHROME_DIR_NAME)
    }

    // Allow scraper smoke scripts to run outside Electron runtime.
    if (process.platform === 'darwin') {
        return path.join(homedir(), 'Library', 'Application Support', '@aryazos', 'study-replay-app', CHROME_DIR_NAME)
    }
    if (process.platform === 'win32') {
        const appData = process.env.APPDATA ?? path.join(homedir(), 'AppData', 'Roaming')
        return path.join(appData, '@aryazos', 'study-replay-app', CHROME_DIR_NAME)
    }
    const configHome = process.env.XDG_CONFIG_HOME ?? path.join(homedir(), '.config')
    return path.join(configHome, '@aryazos', 'study-replay-app', CHROME_DIR_NAME)
}

function getPlatformPrefix(): string {
    const p = process.platform
    const a = process.arch
    if (p === 'darwin') return a === 'arm64' ? 'mac_arm' : 'mac'
    if (p === 'win32') return a === 'ia32' ? 'win32' : 'win64'
    return 'linux'
}

function findVersionDir(baseDir: string, prefix: string): string {
    try {
        const entries = readdirSync(baseDir)
        const versionDir = entries.find((e) => e.startsWith(prefix))
        return versionDir || ''
    } catch {
        return ''
    }
}

export function getChromiumExecutablePath(): string | null {
    const baseDir = getChromeBaseDir()
    const prefix = getPlatformPrefix()
    const versionDir = findVersionDir(baseDir, prefix)
    if (!versionDir) return null

    if (process.platform === 'darwin') {
        return path.join(
            baseDir,
            versionDir,
            'chrome-mac-arm64',
            'Google Chrome for Testing.app',
            'Contents',
            'MacOS',
            'Google Chrome for Testing',
        )
    } else if (process.platform === 'win32') {
        return path.join(baseDir, versionDir, 'chrome-win64', 'chrome.exe')
    } else {
        return path.join(baseDir, versionDir, 'chrome-linux64', 'chrome')
    }
}

export function isChromiumInstalled(): boolean {
    const execPath = getChromiumExecutablePath()
    return execPath !== null && existsSync(execPath)
}

export async function ensureChromium(onProgress?: (percent: number) => void): Promise<string> {
    const existing = getChromiumExecutablePath()
    if (existing && existsSync(existing)) {
        return existing
    }

    const platform = detectBrowserPlatform()
    if (!platform) throw new Error('Could not detect browser platform')

    const buildId = await resolveBuildId(Browser.CHROME, platform, 'stable')
    const cacheDir = getChromeBaseDir()

    log.info({ buildId, platform }, 'downloading Chrome')

    const result = await install({
        browser: Browser.CHROME,
        buildId,
        cacheDir,
        platform,
        downloadProgressCallback: (downloadedBytes, totalBytes) => {
            if (onProgress && totalBytes > 0) {
                onProgress(Math.round((downloadedBytes / totalBytes) * 100))
            }
        },
    })

    log.info({ path: result.executablePath }, 'Chrome installed')
    return result.executablePath
}
