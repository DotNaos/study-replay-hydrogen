import {
    Browser,
    BrowserPlatform,
    detectBrowserPlatform,
    install,
    resolveBuildId,
} from '@puppeteer/browsers'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const cacheDir = path.join(__dirname, '..', '.chromium')

// Support downloading for a specific platform via CLI arg (e.g. "win64", "mac_arm", "linux")
// Falls back to auto-detecting the current platform
const platformArg = process.argv[2]

const PLATFORM_MAP = {
    win64: BrowserPlatform.WIN64,
    win32: BrowserPlatform.WIN32,
    mac: BrowserPlatform.MAC,
    mac_arm: BrowserPlatform.MAC_ARM,
    linux: BrowserPlatform.LINUX,
}

const platform =
    platformArg && PLATFORM_MAP[platformArg] ? PLATFORM_MAP[platformArg] : detectBrowserPlatform()

console.log('Downloading Chrome for Testing for platform:', platform)
console.log('Cache directory:', cacheDir)

try {
    const buildId = await resolveBuildId(Browser.CHROME, platform, 'stable')
    console.log('Resolved build ID:', buildId)

    const result = await install({
        browser: Browser.CHROME,
        buildId,
        cacheDir,
        platform,
    })
    console.log('Chrome installed at:', result.executablePath)
} catch (error) {
    console.error('Failed to download Chrome:', error)
    process.exit(1)
}
