import puppeteer, { type Browser, type BrowserContext, type Page } from 'puppeteer-core'
import { ensureChromium } from './chromium'
import { deriveTerm, type RecordingRecord } from './libraryDb'
import { log as rootLog } from './logger'

const log = rootLog.child({ mod: 'scrape' })

const FHGR = {
    moodleUrl: 'https://moodle.fhgr.ch',
    loginUrl: 'https://moodle.fhgr.ch/login/index.php',
    selectors: {
        username:
            'input[name="username"], input[name="login"], input[type="email"], input#username, input#login',
        password: 'input[name="password"], input[type="password"], input#password',
        submit: 'button[type="submit"], input[type="submit"], button#login, button.btn-primary',
    },
    webexSite: 'fhgr.webex.com',
    webexSiteId: '14682867',
}

export type CourseSummary = {
    id: string
    fullname: string
    category?: string
    courseimage?: string
}

type SessionCache = {
    cookies: string
    timestamp: number
}

let browser: Browser | null = null
let headful = false

export function setHeadful(value: boolean): void {
    headful = value
}
let sessionCache: SessionCache | null = null

const ONE_DAY_MS = 24 * 60 * 60 * 1000

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

async function pMap<T, R>(
    items: T[],
    mapper: (item: T, index: number) => Promise<R>,
    concurrency: number,
): Promise<R[]> {
    const results = new Array<R>(items.length)
    const iterator = items.entries()
    const workers = Array(Math.min(concurrency, items.length))
        .fill(null)
        .map(async () => {
            // eslint-disable-next-line no-restricted-syntax
            for (const [index, item] of iterator) {
                results[index] = await mapper(item, index)
            }
        })
    await Promise.all(workers)
    return results
}

async function ensureBrowser(): Promise<Browser> {
    // Check if browser is still connected (only if we have one)
    if (browser && !browser.connected) {
        log.warn('browser disconnected, recreating')
        browser = null
        authContext = null
        authPage = null
        authContextCreds = null
    }

    if (!browser) {
        const chromiumPath = await ensureChromium()
        browser = await puppeteer.launch({
            headless: headful ? false : true,
            executablePath: chromiumPath,
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-gpu',
                '--disable-dev-shm-usage',
            ],
        })
    }
    return browser
}

export async function shutdownBrowser(): Promise<void> {
    if (browser) {
        await browser.close()
        browser = null
    }
}

function parseCookieHeader(cookies: string): Array<{ name: string; value: string }> {
    return cookies
        .split(';')
        .map((pair) => pair.trim())
        .filter(Boolean)
        .map((pair) => {
            const index = pair.indexOf('=')
            return {
                name: pair.slice(0, index),
                value: pair.slice(index + 1),
            }
        })
}

async function waitForUrlMatch(page: Page, pattern: RegExp, timeout: number): Promise<void> {
    const deadline = Date.now() + timeout
    while (Date.now() < deadline) {
        if (pattern.test(page.url())) {
            return
        }
        await new Promise((resolve) => setTimeout(resolve, 100))
    }
    throw new Error(`Timeout waiting for URL to match ${pattern}`)
}

async function fillLoginForm(
    context: BrowserContext,
    username: string,
    password: string,
): Promise<void> {
    const page = await context.newPage()
    try {
        await page.goto(FHGR.loginUrl, { waitUntil: 'domcontentloaded' })

        // Step 1: Check for "Continue" button specific to FHGR AAI
        const continueButton = await page.$(
            'button#wayf_submit_button, input#wayf_submit_button, button[name="Select"], a.btn-primary',
        )

        if (continueButton) {
            const isVisible = (await continueButton.boundingBox()) !== null
            if (isVisible) {
                log.info('clicking AAI continue button')
                await continueButton.click()
                await page.waitForNavigation({ waitUntil: 'domcontentloaded' }).catch(() => {})
            }
        }

        // Step 2: Fill AAI Login form
        log.info({ url: page.url() }, 'waiting for username field')
        await page.waitForSelector(FHGR.selectors.username, { visible: true, timeout: 10000 })

        const usernameField = await page.$(FHGR.selectors.username)
        if (usernameField) {
            log.info('filling username')
            await usernameField.click({ clickCount: 3 }) // Select all
            await usernameField.type(username)
        } else {
            log.error({ url: page.url() }, 'username field not found after navigation')
        }

        const passwordField = await page.$(FHGR.selectors.password)
        if (passwordField) {
            log.info('filling password')
            await passwordField.click({ clickCount: 3 }) // Select all
            await passwordField.type(password)
        }

        const submitButton = await page.$(FHGR.selectors.submit)
        if (submitButton) {
            log.info('clicking submit')
            await submitButton.click()
            const redirectStart = Date.now()
            log.info('waiting for redirect to Moodle')
            try {
                await waitForUrlMatch(page, /^https:\/\/moodle\.fhgr\.ch/, 30000)
                log.info({ ms: Date.now() - redirectStart }, 'redirected to Moodle')
            } catch (e) {
                log.warn(
                    { ms: Date.now() - redirectStart, url: page.url() },
                    'login redirect timed out, proceeding if cookie is present',
                )
            }
        } else {
            log.error({ url: page.url() }, 'submit button not found')
        }

        log.info({ url: page.url() }, 'login form completed')
    } catch (err) {
        log.error({ err }, 'error during login form interaction')
        throw err
    } finally {
        // Safely close the page
        if (!page.isClosed()) {
            await page.close().catch(() => {})
        }
    }
}

async function waitForSessionCookie(context: BrowserContext, page: Page): Promise<string> {
    const deadline = Date.now() + 120_000
    while (Date.now() < deadline) {
        const cookies = await page.cookies()
        const hasSession = cookies.some((cookie) =>
            cookie.name.toLowerCase().includes('moodlesession'),
        )
        if (hasSession) {
            return cookies.map((cookie) => `${cookie.name}=${cookie.value}`).join('; ')
        }
        await new Promise((resolve) => setTimeout(resolve, 1000))
    }
    throw new Error('Login timed out before Moodle session cookie appeared.')
}

let authContext: BrowserContext | null = null
let authContextCreds: { username: string } | null = null
let authPage: Page | null = null

async function ensureAuthContext(credentials: {
    username: string
    password: string
}): Promise<{ context: BrowserContext; page: Page }> {
    const browserInstance = await ensureBrowser()

    if (authContext && authContextCreds?.username === credentials.username && authPage) {
        return { context: authContext, page: authPage }
    }

    if (authContext) {
        await authContext.close().catch(() => {})
        authContext = null
        authPage = null
    }

    const context = await browserInstance.createBrowserContext()
    const authStart = Date.now()
    log.info({ user: credentials.username }, 'creating new auth context')
    await fillLoginForm(context, credentials.username, credentials.password)

    // Create a persistent page for cookie management
    log.info('creating persistent auth page')
    const page = await context.newPage()
    await page.goto(FHGR.moodleUrl, { waitUntil: 'domcontentloaded' })
    log.info('waiting for session cookie')
    await waitForSessionCookie(context, page)
    log.info({ ms: Date.now() - authStart }, 'session cookie obtained')

    authContext = context
    authContextCreds = { username: credentials.username }
    authPage = page
    return { context, page }
}

export async function ensureMoodleSession(credentials: {
    username: string
    password: string
}): Promise<string> {
    const { page } = await ensureAuthContext(credentials)
    const cookies = await page.cookies()
    return cookies.map((c) => `${c.name}=${c.value}`).join('; ')
}

async function fetchHtml(url: string, cookies: string): Promise<string> {
    const browserInstance = await ensureBrowser()
    const context = await browserInstance.createBrowserContext()
    const page = await context.newPage()

    const cookieObjs = parseCookieHeader(cookies).map((c) => ({
        name: c.name.trim(),
        value: c.value.trim(),
        url: FHGR.moodleUrl,
    }))
    await page.setCookie(...cookieObjs)

    try {
        await page.goto(url, { waitUntil: 'domcontentloaded' })

        // Logic to detect login redirect
        if (page.url().includes('login')) {
            throw new Error('Session invalid (redirected to login page)')
        }

        return await page.content()
    } finally {
        await context.close()
    }
}

async function getSessionData(page: Page): Promise<{ sesskey: string; userid: number }> {
    const tempPage = await page.browserContext().newPage()
    try {
        await tempPage.goto(`${FHGR.moodleUrl}/my/`, {
            waitUntil: 'domcontentloaded',
        })
        const html = await tempPage.content()

        // Extract sesskey
        let sesskey = ''
        const skMatch = html.match(/"sesskey":"([^"]+)"/)
        if (skMatch) sesskey = skMatch[1]
        else {
            const fb = html.match(/sesskey=([a-zA-Z0-9]+)/)
            if (fb) sesskey = fb[1]
        }

        // Extract userid
        let userid = 0
        const uidMatch = html.match(/"userid":(\d+)/)
        if (uidMatch) userid = parseInt(uidMatch[1], 10)
        else {
            const fbUid = html.match(/data-userid="(\d+)"/)
            if (fbUid) userid = parseInt(fbUid[1], 10)
            else {
                const linkMatch = html.match(/user\/profile\.php\?id=(\d+)/)
                if (linkMatch) userid = parseInt(linkMatch[1], 10)
            }
        }

        if (!sesskey) {
            log.error({ htmlSnippet: html.slice(0, 500) }, 'could not extract sesskey from Moodle')
            throw new Error('Could not extract sesskey from Moodle.')
        }

        return { sesskey, userid }
    } finally {
        await tempPage.close()
    }
}

// Ported types from study-sync
export interface MoodleApiResponse {
    error: boolean
    data?:
        | {
              courses: any[]
          }
        | any[]
    exception?: string
}

async function fetchCoursesFromHtml(page: Page): Promise<CourseSummary[]> {
    const tempPage = await page.browserContext().newPage()
    try {
        await tempPage.goto(`${FHGR.moodleUrl}/my/`, {
            waitUntil: 'domcontentloaded',
        })

        // Wait for courses to load
        try {
            await tempPage.waitForSelector('.coursename', { timeout: 10000 })
        } catch {
            log.warn('timeout waiting for .coursename on dashboard')
        }

        const courses = await tempPage.evaluate(() => {
            const nodes = document.querySelectorAll('.coursename')
            const results: any[] = []
            nodes.forEach((node) => {
                let link = node.getAttribute('href')
                if (!link) {
                    const a = node.closest('a') ?? node.querySelector('a')
                    link = a?.getAttribute('href') || null
                }

                if (link) {
                    const idMatch = link.match(/id=(\d+)/)
                    if (idMatch) {
                        results.push({
                            id: idMatch[1],
                            fullname: node.textContent?.trim() || '',
                            category: undefined,
                        })
                    }
                }
            })
            return results
        })
        return courses
    } catch (err) {
        log.error({ err }, 'HTML fallback failed')
        return []
    } finally {
        await tempPage.close()
    }
}

export async function fetchCourses(credentials: {
    username: string
    password: string
}): Promise<CourseSummary[]> {
    const t0 = Date.now()
    log.info('fetchCourses: ensuring auth context')
    const { page } = await ensureAuthContext(credentials)
    log.info({ ms: Date.now() - t0 }, 'fetchCourses: auth context ready')
    const t1 = Date.now()
    const { sesskey } = await getSessionData(page)
    log.info({ ms: Date.now() - t1 }, 'fetchCourses: sesskey obtained')
    const apiUrl = `${FHGR.moodleUrl}/lib/ajax/service.php?sesskey=${sesskey}&info=core_course_get_enrolled_courses_by_timeline_classification`

    // Get cookies for the fetch request
    const cookies = await page.cookies()
    const cookieHeader = cookies.map((c) => `${c.name}=${c.value}`).join('; ')

    const fetchStart = Date.now()
    const response = await fetch(apiUrl, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'X-Requested-With': 'XMLHttpRequest',
            Cookie: cookieHeader,
        },
        body: JSON.stringify([
            {
                index: 0,
                methodname: 'core_course_get_enrolled_courses_by_timeline_classification',
                args: {
                    offset: 0,
                    limit: 0,
                    classification: 'all',
                    sort: 'fullname',
                    customfieldname: '',
                    customfieldvalue: '',
                    requiredfields: [
                        'id',
                        'fullname',
                        'shortname',
                        'showcoursecategory',
                        'showshortname',
                        'visible',
                        'enddate',
                        'coursecategory',
                        'courseimage',
                    ],
                },
            },
        ]),
    })
    log.info({ ms: Date.now() - fetchStart, status: response.status }, 'fetchCourses: API response')

    if (!response.ok) {
        throw new Error(`Moodle API error ${response.status}: ${response.statusText}`)
    }

    const json = (await response.json()) as MoodleApiResponse[]
    const result = json[0]
    log.info(
        { error: result.error, hasCourses: !!result.data && 'courses' in result.data },
        'fetchCourses: parsed response',
    )

    if (
        !result.error &&
        result.data &&
        'courses' in result.data &&
        Array.isArray(result.data.courses) &&
        result.data.courses.length > 0
    ) {
        return result.data.courses.map((course: any) => ({
            id: String(course.id),
            fullname: String(course.fullname ?? ''),
            category: course.coursecategory ? String(course.coursecategory) : undefined,
            courseimage: course.courseimage ? String(course.courseimage) : undefined,
        }))
    }

    log.warn('Moodle API returned no courses, falling back to HTML parsing')
    return await fetchCoursesFromHtml(page)
}

function decodeHtmlEntities(value: string): string {
    return value
        .replace(/&amp;/g, '&')
        .replace(/&quot;/g, '"')
        .replace(/&#039;/g, "'")
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .trim()
}

function parseWebexLtiLinks(html: string, baseUrl: string): Array<{ name: string; url: string }> {
    const results: Array<{ name: string; url: string }> = []
    const seen = new Set<string>()
    const activityRegex =
        /<li[^>]*class="[^"]*activity[^"]*modtype_lti[^"]*"[^>]*>([\s\S]*?)<\/li>/gi
    let match: RegExpExecArray | null

    while ((match = activityRegex.exec(html)) !== null) {
        const liContent = match[1]
        const linkMatch = liContent.match(/href="([^"]*\/mod\/lti\/view\.php\?id=\d+)"/i)
        if (!linkMatch) continue

        let name = 'Webex'
        const nameMatch = liContent.match(/data-activityname="([^"]+)"/i)
        if (nameMatch) name = decodeHtmlEntities(nameMatch[1])

        const haystack = `${name} ${liContent}`.toLowerCase()
        if (!haystack.includes('webex')) continue

        const url = linkMatch[1].startsWith('http') ? linkMatch[1] : `${baseUrl}${linkMatch[1]}`
        if (seen.has(url)) continue
        seen.add(url)
        results.push({ name, url })
    }

    return results
}

async function openWebexLti(
    context: BrowserContext,
    ltiUrl: string,
): Promise<{ csrfToken?: string; cookies: string; siteId: string }> {
    const extractAuthFromBrowser = async (
        page: Page,
        timeoutMs: number,
    ): Promise<{ csrfToken?: string; cookies: string; siteId: string }> => {
        const deadline = Date.now() + timeoutMs
        let csrfToken: string | undefined
        let cookieHeader = ''
        let siteId = FHGR.webexSiteId

        while (Date.now() < deadline) {
            const cookies = await context.cookies()
            const webexCookies = cookies.filter((cookie) => cookie.domain.includes('webex.com'))
            cookieHeader = webexCookies.map((cookie) => `${cookie.name}=${cookie.value}`).join('; ')
            siteId =
                webexCookies
                    .map((cookie) => cookie.name.match(/_(\d{6,})$/))
                    .find((match) => match)?.[1] ?? FHGR.webexSiteId

            csrfToken = await page
                .evaluate(() => {
                    const meta = document.querySelector(
                        'meta[name="csrf-token"], meta[name="csrfToken"], meta[name="_csrf"]',
                    )
                    return meta?.getAttribute('content') || undefined
                })
                .catch(() => undefined)

            const hasSessionCookie = webexCookies.some((cookie) =>
                cookie.name.toLowerCase().includes('session'),
            )
            if (cookieHeader && (csrfToken || hasSessionCookie)) {
                break
            }
            await delay(250)
        }

        return { csrfToken, cookies: cookieHeader, siteId }
    }

    const page = await context.newPage()
    const t0 = Date.now()

    try {
        // The course page gives us view.php URLs, but the LTI handoff is on launch.php.
        const launchUrl = ltiUrl.replace('/mod/lti/view.php?', '/mod/lti/launch.php?')
        await page.goto(launchUrl, { waitUntil: 'domcontentloaded' })
        log.info({ ms: Date.now() - t0, url: page.url() }, 'openWebexLti: goto resolved')

        // Most Moodle setups auto-post and redirect to Webex immediately.
        try {
            await waitForUrlMatch(page, /https:\/\/(?:lti\.)?webex\.com/i, 15_000)
        } catch {
            // Fallback for pages that still require explicit form submission.
            const submitted = await page.evaluate(() => {
                const forms = Array.from(document.querySelectorAll('form'))
                const ltiForm =
                    forms.find((f) => f.id === 'ltiLaunchForm') ||
                    forms.find((f) => f.getAttribute('target') === '_blank') ||
                    forms.find((f) => {
                        const action = f.action || ''
                        return action.includes('webex') || action.includes('lti')
                    }) ||
                    forms.find((f) => {
                        const action = f.action || ''
                        const host = new URL(action, location.href).hostname
                        return host !== location.hostname
                    })

                if (!ltiForm) return false
                ;(ltiForm as HTMLFormElement).submit()
                return true
            })

            if (submitted) {
                await waitForUrlMatch(page, /https:\/\/(?:lti\.)?webex\.com/i, 15_000).catch(() => {})
            } else {
                log.warn({ url: page.url() }, 'openWebexLti: no launch form found, extracting available auth')
            }
        }

        const auth = await extractAuthFromBrowser(page, 10_000)
        log.info(
            {
                ms: Date.now() - t0,
                hasCsrf: !!auth.csrfToken,
                cookieCount: auth.cookies ? auth.cookies.split(';').filter(Boolean).length : 0,
                siteId: auth.siteId,
                url: page.url(),
            },
            'openWebexLti: browser auth extracted',
        )
        return auth
    } finally {
        await page.close().catch(() => {})
    }
}

function extractItems(payload: any): any[] {
    if (Array.isArray(payload)) return payload
    if (Array.isArray(payload?.items)) return payload.items
    if (Array.isArray(payload?.data)) return payload.data
    if (Array.isArray(payload?.meeting_sessions)) return payload.meeting_sessions
    if (Array.isArray(payload?.recordings)) return payload.recordings
    return []
}

function nextPage(payload: any, currentPage: number): number | null {
    const pagination = payload?.pagination

    if (pagination) {
        const perPage = pagination.per_page ?? 10
        const totalRecords = pagination.total_records ?? pagination.total ?? 0
        const totalPages = Math.ceil(totalRecords / perPage)

        log.debug({ currentPage, totalPages, totalRecords, perPage }, 'pagination')

        if (currentPage < totalPages) {
            log.debug({ nextPage: currentPage + 1 }, 'pagination: next page')
            return currentPage + 1
        }

        log.debug({ currentPage }, 'pagination: no more pages')
        return null
    }

    const totalPages =
        (typeof payload?.total_pages === 'number' && payload.total_pages) ||
        (typeof payload?.totalPages === 'number' && payload.totalPages) ||
        (typeof payload?.page_count === 'number' && payload.page_count) ||
        (typeof payload?.pages === 'number' && payload.pages) ||
        null

    if (totalPages && currentPage < totalPages) {
        log.debug({ nextPage: currentPage + 1, totalPages }, 'pagination: next page')
        return currentPage + 1
    }

    const next = payload?.next_page ?? payload?.nextPage
    if (typeof next === 'number' && next > currentPage) {
        log.debug({ nextPage: next }, 'pagination: next page from API')
        return next
    }

    if (payload?.has_more === true || payload?.hasMore === true) {
        log.debug({ nextPage: currentPage + 1 }, 'pagination: has_more=true')
        return currentPage + 1
    }

    const items = extractItems(payload)
    const perPage = payload?.per_page ?? payload?.perPage ?? payload?.limit ?? 10
    const total = payload?.total ?? payload?.totalCount ?? payload?.total_count
    if (typeof total === 'number' && items.length > 0) {
        const expectedPages = Math.ceil(total / perPage)
        if (currentPage < expectedPages) {
            log.debug({ expectedPages, total, nextPage: currentPage + 1 }, 'pagination: calculated pages')
            return currentPage + 1
        }
    }

    log.debug({ currentPage }, 'pagination: no more pages')
    return null
}

async function fetchPaged<T>(fetchPage: (page: number) => Promise<any>): Promise<T[]> {
    const results: T[] = []
    let page = 1
    while (true) {
        const pageStart = Date.now()
        const payload = await fetchPage(page)
        const items = extractItems(payload) as T[]
        log.debug({ page, items: items.length, ms: Date.now() - pageStart }, 'fetchPaged: page done')
        results.push(...items)
        const next = nextPage(payload, page)
        if (!next) break
        page = next
    }
    log.info({ total: results.length }, 'fetchPaged: complete')
    return results
}

function extractRecordUuidFromUrl(value: string): string {
    if (!value) return ''
    const match =
        value.match(/recording\/playback\/([a-f0-9]{32})/i) ||
        value.match(/recording\/([a-f0-9]{32})\/playback/i) ||
        value.match(/playback\/([a-f0-9]{32})/i) ||
        value.match(/recording\/([a-f0-9]{32})/i)
    return match ? match[1] : ''
}

async function resolveRecordUuidFromRecordingUrl(
    cookies: string,
    recordingUrl: string,
): Promise<string> {
    if (!recordingUrl) return ''
    const response = await fetch(recordingUrl, {
        headers: {
            Cookie: cookies,
            Referer: `https://${FHGR.webexSite}/`,
        },
        redirect: 'follow',
    })
    const finalUrl = response.url
    const uuidFromFinal = extractRecordUuidFromUrl(finalUrl)
    if (uuidFromFinal) return uuidFromFinal
    const body = await response.text().catch(() => '')
    return extractRecordUuidFromUrl(body)
}

function normalizeDateValue(value: string): string {
    if (!value) return ''
    const trimmed = value.trim()
    const isoMatch = trimmed.match(/^(\d{4}-\d{2}-\d{2})/)
    if (isoMatch) return isoMatch[1]
    const compactMatch = trimmed.match(/(\d{8})/)
    if (compactMatch) {
        const compact = compactMatch[1]
        return `${compact.slice(0, 4)}-${compact.slice(4, 6)}-${compact.slice(6, 8)}`
    }
    return ''
}

function deriveRecordingDate(
    recordingName: string,
    ...candidates: Array<string | undefined>
): string {
    for (const candidate of candidates) {
        if (!candidate) continue
        const normalized = normalizeDateValue(candidate)
        if (normalized) return normalized
    }
    return normalizeDateValue(recordingName)
}

async function fetchMeetingSessions(
    cookies: string,
    csrfToken: string | undefined,
    startDate: string,
    endDate: string,
): Promise<any[]> {
    const headers: Record<string, string> = {
        accept: 'application/json',
        referer: 'https://lti.webex.com/application',
        Cookie: cookies,
    }
    if (csrfToken) headers['x-csrf-token'] = csrfToken

    return fetchPaged(async (page) => {
        const url = `https://lti.webex.com/api/webex/meeting_sessions?start_date=${startDate}&end_date=${endDate}&with_recordings=true&page=${page}`
        const response = await fetch(url, { headers })
        if (!response.ok) {
            throw new Error(
                `meeting_sessions failed (${response.status}): ${await response.text()}`,
            )
        }
        return response.json()
    })
}

async function fetchSessionRecordings(
    cookies: string,
    csrfToken: string | undefined,
    sessionId: string,
): Promise<any[]> {
    const headers: Record<string, string> = {
        accept: 'application/json',
        referer: 'https://lti.webex.com/application',
        Cookie: cookies,
    }
    if (csrfToken) headers['x-csrf-token'] = csrfToken

    return fetchPaged(async (page) => {
        const url = `https://lti.webex.com/api/webex/meeting_sessions/${sessionId}/recordings?page=${page}`
        const response = await fetch(url, { headers })
        if (!response.ok) {
            throw new Error(`recordings failed (${response.status}): ${await response.text()}`)
        }
        return response.json()
    })
}

async function fetchStreamInfo(
    cookies: string,
    recordUuid: string,
    accessPwd: string | undefined,
    siteId: string,
): Promise<any | null> {
    const headers: Record<string, string> = {
        Accept: 'application/json, text/plain, */*',
        Referer: `https://${FHGR.webexSite}/recordingservice/sites/fhgr/recording/playback/${recordUuid}`,
        clientType: 'web',
        siteFullUrl: FHGR.webexSite,
        Cookie: cookies,
        siteId,
    }
    if (accessPwd) headers.accessPwd = accessPwd
    const url = `https://${FHGR.webexSite}/webappng/api/v1/recordings/${recordUuid}/stream?siteurl=fhgr`
    const response = await fetch(url, { headers })
    if (!response.ok) return null
    return response.json()
}

export async function fetchCourseRecordings(
    credentials: { username: string; password: string },
    course: CourseSummary,
    onProgress?: (completed: number, total: number, label: string) => void,
): Promise<RecordingRecord[]> {
    const { context, page: authPage } = await ensureAuthContext(credentials)
    const cookies = await authPage.cookies()
    const cookieHeader = cookies.map((c) => `${c.name}=${c.value}`).join('; ')

    onProgress?.(0, 1, 'Loading course page...')
    const courseStart = Date.now()
    const page = await context.newPage()
    let courseHtml = ''
    try {
        await page.goto(`${FHGR.moodleUrl}/course/view.php?id=${course.id}`, {
            waitUntil: 'domcontentloaded',
        })
        courseHtml = await page.content()
    } finally {
        await page.close()
    }
    log.info({ ms: Date.now() - courseStart, courseId: course.id }, 'course page loaded')

    const webexActivities = parseWebexLtiLinks(courseHtml, FHGR.moodleUrl)
    log.info({ count: webexActivities.length, courseId: course.id }, 'webex activities found')
    if (webexActivities.length === 0) {
        return []
    }

    const term = deriveTerm(course.fullname || course.category || '')
    const recordings: RecordingRecord[] = []
    const endDate = new Date()
    endDate.setFullYear(endDate.getFullYear() + 2)
    const startDate = new Date()
    startDate.setFullYear(startDate.getFullYear() - 5)
    const startStr = startDate.toISOString().slice(0, 10)
    const endStr = endDate.toISOString().slice(0, 10)

    for (const activity of webexActivities) {
        onProgress?.(0, 1, `Opening Webex: ${activity.name}...`)
        const ltiStart = Date.now()
        const webexAuth = await openWebexLti(context, activity.url)
        log.info({ ms: Date.now() - ltiStart, activity: activity.name }, 'webex LTI opened')

        onProgress?.(0, 1, 'Fetching meeting sessions...')
        const sessionsStart = Date.now()
        const sessions = await fetchMeetingSessions(
            webexAuth.cookies,
            webexAuth.csrfToken,
            startStr,
            endStr,
        )

        log.info({ ms: Date.now() - sessionsStart, count: sessions.length }, 'meeting sessions fetched')

        const totalSessions = sessions.length
        let completedSessions = 0

        const sessionResults = await pMap(
            sessions,
            async (session) => {
                const sessionId = String(session?.id ?? session?.meetingSessionId ?? '')
                if (!sessionId) return []
                const sessionTitle = String(session?.title ?? session?.name ?? '')
                const sessionRecordings = await fetchSessionRecordings(
                    webexAuth.cookies,
                    webexAuth.csrfToken,
                    sessionId,
                )

                // Small jitter between sessions to avoid hammering the server
                await delay(Math.random() * 200 + 100)

                const processed = await pMap(
                    sessionRecordings,
                    async (recording) => {
                        await delay(Math.random() * 100 + 50)

                        const rawDuration =
                            recording?.duration ??
                            recording?.recordingDuration ??
                            recording?.durationSeconds ??
                            0
                        const durationSeconds = Number(rawDuration)

                        if (durationSeconds > 0 && durationSeconds < 60) {
                            return null
                        }

                        const recordingUrl = String(
                            recording?.recording_url ?? recording?.recordingUrl ?? '',
                        )
                        let recordingUuid = String(
                            recording?.recordUUID ??
                                recording?.recordUuid ??
                                recording?.record_uuid ??
                                recording?.recordingUuid ??
                                recording?.recording_uuid ??
                                recording?.uuid ??
                                extractRecordUuidFromUrl(recordingUrl) ??
                                '',
                        )

                        if (!recordingUuid && recordingUrl) {
                            recordingUuid = await resolveRecordUuidFromRecordingUrl(
                                webexAuth.cookies,
                                recordingUrl,
                            )
                        }

                        const recordingName = String(
                            recording?.name ?? recording?.recordName ?? sessionTitle ?? '',
                        )
                        const recordingDate = deriveRecordingDate(
                            recordingName,
                            String(
                                recording?.created_at ??
                                    recording?.createTime ??
                                    recording?.gmtCreateTime ??
                                    '',
                            ),
                        )
                        let accessPwd = String(
                            recording?.accessPwd ??
                                recording?.password ??
                                recording?.recordingPassword ??
                                '',
                        )
                        let downloadUrl = String(
                            recording?.downloadUrl ??
                                recording?.download_url ??
                                recording?.downloadURL ??
                                recording?.downloadRecordingInfo?.downloadInfo?.mp4URL ??
                                recording?.downloadRecordingInfo?.downloadInfo?.hlsURL ??
                                recording?.downloadRecordingInfo?.downloadInfo?.dashURL ??
                                recording?.downloadRecordingInfo?.downloadInfo?.audioURL ??
                                '',
                        )

                        let coverUrl = ''

                        if (recordingUuid) {
                            const streamInfo = await fetchStreamInfo(
                                webexAuth.cookies,
                                recordingUuid,
                                accessPwd || undefined,
                                webexAuth.siteId,
                            )
                            if (streamInfo) {
                                accessPwd = accessPwd || String(streamInfo.accessPwd ?? '')
                                const downloadInfo =
                                    streamInfo?.downloadRecordingInfo?.downloadInfo ??
                                    streamInfo?.downloadInfo ??
                                    streamInfo?.downloadRecordingInfo ??
                                    null
                                const streamDownloadUrl = String(
                                    downloadInfo?.mp4URL ??
                                        downloadInfo?.hlsURL ??
                                        downloadInfo?.dashURL ??
                                        downloadInfo?.audioURL ??
                                        streamInfo?.downloadUrl ??
                                        streamInfo?.downloadURL ??
                                        '',
                                )
                                if (streamDownloadUrl) downloadUrl = streamDownloadUrl

                                coverUrl = String(
                                    downloadInfo?.playerCoverURL ??
                                        downloadInfo?.playerCoverUrl ??
                                        downloadInfo?.coverUrl ??
                                        downloadInfo?.thumbnailUrl ??
                                        streamInfo?.playerCoverURL ??
                                        '',
                                )
                            }
                        }

                        return {
                            term,
                            courseId: course.id,
                            courseName: course.fullname,
                            sessionTitle,
                            recordingName,
                            recordingDate,
                            recordingUuid: recordingUuid || null,
                            recordingUrl: recordingUrl || null,
                            downloadUrl: downloadUrl || null,
                            coverUrl: coverUrl || null,
                            durationSeconds: durationSeconds > 0 ? durationSeconds : undefined,
                        } as RecordingRecord
                    },
                    3, // Inner concurrency limit
                )

                completedSessions++
                onProgress?.(
                    completedSessions,
                    totalSessions,
                    `Sessions: ${completedSessions}/${totalSessions}`,
                )
                log.info(
                    { completed: completedSessions, total: totalSessions, session: sessionTitle, recordings: processed.filter(Boolean).length },
                    'session processed',
                )

                return processed.filter((r): r is RecordingRecord => r !== null)
            },
            3, // Outer concurrency limit
        )

        recordings.push(...sessionResults.flat())
    }

    log.info({ total: recordings.length, courseId: course.id }, 'fetchCourseRecordings: complete')
    return recordings
}
