import Database from 'better-sqlite3'
import { app } from 'electron'
import { mkdirSync } from 'node:fs'
import path from 'node:path'

export type RecordingRecord = {
    term: string
    courseId: string
    courseName: string
    sessionTitle: string
    recordingName: string
    recordingDate: string
    recordingUuid: string | null
    recordingUrl: string | null
    downloadUrl: string | null
    coverUrl: string | null
    durationSeconds?: number
    lastPosition?: number
    lastWatchedAt?: string
}

export type CourseRecord = {
    term: string
    courseId: string
    courseName: string
    courseImage?: string
    isWatchlist?: number
    lastWatchedUuid?: string
}

export type CourseLibrary = {
    courseId: string
    courseName: string
    courseImage?: string
    isWatchlist?: number
    lastWatchedUuid?: string
    recordings: RecordingRecord[]
}

export type TermLibrary = {
    term: string
    courses: CourseLibrary[]
}

export type LibraryState = {
    terms: TermLibrary[]
}

let db: Database.Database | null = null

function normalizeNullable(value: string | undefined | null): string | null {
    const trimmed = value?.trim()
    return trimmed ? trimmed : null
}

function clearExpiredWebexCoverUrls(dbInstance: Database.Database): void {
    dbInstance
        .prepare(
            `UPDATE recordings
             SET coverUrl = NULL
             WHERE coverUrl LIKE '%webex.com%'
               AND coverUrl LIKE '%ticket=%'
               AND coverUrl LIKE '%recordingViewerInfoToken=%';`,
        )
        .run()
}

export function deriveTerm(courseName: string): string {
    const match = courseName.match(/\b(FS|HS)\s?(\d{2})\b/i)
    if (!match) return 'Unknown'
    return `${match[1].toUpperCase()}${match[2]}`
}

function getDb(): Database.Database {
    if (db) return db

    const userData = app.getPath('userData')
    mkdirSync(userData, { recursive: true })
    const dbPath = path.join(userData, 'study-replay.db')

    db = new Database(dbPath)
    db.pragma('journal_mode = WAL')

    db.exec(`CREATE TABLE IF NOT EXISTS courses (
      courseId TEXT PRIMARY KEY,
      term TEXT NOT NULL,
      courseName TEXT NOT NULL,
      courseImage TEXT,
      isWatchlist INTEGER DEFAULT 0,
      lastWatchedUuid TEXT,
      updatedAt TEXT DEFAULT CURRENT_TIMESTAMP
    );`)

    // Migrations for existing tables (ignore errors if columns already exist)
    const tryAlter = (sql: string) => {
        try {
            db!.exec(sql)
        } catch {}
    }
    tryAlter(`ALTER TABLE courses ADD COLUMN courseImage TEXT;`)
    tryAlter(`ALTER TABLE courses ADD COLUMN isWatchlist INTEGER DEFAULT 0;`)
    tryAlter(`ALTER TABLE courses ADD COLUMN lastWatchedUuid TEXT;`)

    db.exec(`CREATE TABLE IF NOT EXISTS recordings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      term TEXT NOT NULL,
      courseId TEXT NOT NULL,
      courseName TEXT NOT NULL,
      sessionTitle TEXT,
      recordingName TEXT NOT NULL,
      recordingDate TEXT,
      recordingUuid TEXT,
      recordingUrl TEXT,
      downloadUrl TEXT,
      coverUrl TEXT,
      durationSeconds REAL,
      lastPosition REAL DEFAULT 0,
      lastWatchedAt TEXT,
      createdAt TEXT DEFAULT CURRENT_TIMESTAMP
    );`)

    // Migrations for progress tracking
    tryAlter(`ALTER TABLE recordings ADD COLUMN lastPosition REAL DEFAULT 0;`)
    tryAlter(`ALTER TABLE recordings ADD COLUMN lastWatchedAt TEXT;`)
    tryAlter(`ALTER TABLE recordings ADD COLUMN durationSeconds REAL;`)
    tryAlter(`ALTER TABLE recordings ADD COLUMN coverUrl TEXT;`)

    db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_recording_uuid ON recordings(recordingUuid);`)
    db.exec(`CREATE INDEX IF NOT EXISTS idx_course_term ON recordings(term, courseId);`)
    clearExpiredWebexCoverUrls(db)

    return db
}

export async function upsertCourses(courses: CourseRecord[]): Promise<void> {
    if (courses.length === 0) return
    const dbInstance = getDb()

    const stmt = dbInstance.prepare(
        `INSERT INTO courses (courseId, term, courseName, courseImage)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(courseId) DO UPDATE SET
         term=excluded.term,
         courseName=excluded.courseName,
         courseImage=excluded.courseImage,
         updatedAt=CURRENT_TIMESTAMP;`,
    )

    const insertMany = dbInstance.transaction((items: CourseRecord[]) => {
        for (const course of items) {
            stmt.run(course.courseId, course.term, course.courseName, course.courseImage ?? null)
        }
    })

    insertMany(courses)
}

export async function upsertRecordings(records: RecordingRecord[]): Promise<void> {
    if (records.length === 0) return
    const dbInstance = getDb()

    const stmt = dbInstance.prepare(
        `INSERT INTO recordings (
        term, courseId, courseName, sessionTitle, recordingName, recordingDate, recordingUuid, recordingUrl, downloadUrl, coverUrl, durationSeconds
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(recordingUuid) DO UPDATE SET
        term=excluded.term,
        courseId=excluded.courseId,
        courseName=excluded.courseName,
        sessionTitle=excluded.sessionTitle,
        recordingName=excluded.recordingName,
        recordingDate=excluded.recordingDate,
        recordingUrl=excluded.recordingUrl,
        downloadUrl=excluded.downloadUrl,
        coverUrl=excluded.coverUrl,
        durationSeconds=excluded.durationSeconds;`,
    )

    const insertMany = dbInstance.transaction((items: RecordingRecord[]) => {
        for (const record of items) {
            stmt.run(
                record.term,
                record.courseId,
                record.courseName,
                normalizeNullable(record.sessionTitle),
                record.recordingName,
                normalizeNullable(record.recordingDate),
                normalizeNullable(record.recordingUuid),
                normalizeNullable(record.recordingUrl),
                normalizeNullable(record.downloadUrl),
                normalizeNullable(record.coverUrl),
                record.durationSeconds ?? null,
            )
        }
    })

    insertMany(records)
}

export async function getLibrary(): Promise<LibraryState> {
    const dbInstance = getDb()
    const courses = dbInstance
        .prepare(
            `SELECT courseId, term, courseName, courseImage, isWatchlist, lastWatchedUuid FROM courses ORDER BY term DESC, courseName ASC;`,
        )
        .all() as CourseRecord[]
    const recordings = dbInstance
        .prepare(
            `SELECT term, courseId, courseName, sessionTitle, recordingName, recordingDate, recordingUuid, recordingUrl, downloadUrl, coverUrl, durationSeconds, lastPosition, lastWatchedAt
     FROM recordings
     ORDER BY recordingDate DESC, recordingName ASC;`,
        )
        .all() as RecordingRecord[]

    const termMap = new Map<string, TermLibrary>()
    for (const course of courses) {
        if (!termMap.has(course.term)) {
            termMap.set(course.term, { term: course.term, courses: [] })
        }
        const termEntry = termMap.get(course.term)!
        termEntry.courses.push({
            courseId: course.courseId,
            courseName: course.courseName,
            courseImage: course.courseImage,
            isWatchlist: course.isWatchlist,
            lastWatchedUuid: course.lastWatchedUuid,
            recordings: [],
        })
    }

    for (const recording of recordings) {
        const termEntry = termMap.get(recording.term) ?? {
            term: recording.term,
            courses: [],
        }
        if (!termMap.has(recording.term)) {
            termMap.set(recording.term, termEntry)
        }
        let courseEntry = termEntry.courses.find((course) => course.courseId === recording.courseId)
        if (!courseEntry) {
            courseEntry = {
                courseId: recording.courseId,
                courseName: recording.courseName,
                recordings: [],
            }
            termEntry.courses.push(courseEntry)
        }
        courseEntry.recordings.push(recording)
    }

    const terms = Array.from(termMap.values()).sort((a, b) => b.term.localeCompare(a.term))
    for (const term of terms) {
        term.courses.sort((a, b) => a.courseName.localeCompare(b.courseName))
    }

    return { terms }
}

export async function saveProgress(
    recordingUuid: string,
    position: number,
    duration?: number,
): Promise<void> {
    const dbInstance = getDb()
    if (duration) {
        dbInstance
            .prepare(
                `UPDATE recordings SET lastPosition = ?, durationSeconds = ?, lastWatchedAt = CURRENT_TIMESTAMP WHERE recordingUuid = ?;`,
            )
            .run(position, duration, recordingUuid)
    } else {
        dbInstance
            .prepare(
                `UPDATE recordings SET lastPosition = ?, lastWatchedAt = CURRENT_TIMESTAMP WHERE recordingUuid = ?;`,
            )
            .run(position, recordingUuid)
    }
}

export async function getRecentHistory(limit: number = 10): Promise<RecordingRecord[]> {
    const dbInstance = getDb()
    return dbInstance
        .prepare(
            `SELECT term, courseId, courseName, sessionTitle, recordingName, recordingDate, recordingUuid, recordingUrl, downloadUrl, coverUrl, durationSeconds, lastPosition, lastWatchedAt
     FROM recordings
     WHERE lastWatchedAt IS NOT NULL
     ORDER BY lastWatchedAt DESC
     LIMIT ?;`,
        )
        .all(limit) as RecordingRecord[]
}

export async function getHeroRecording(): Promise<
    (RecordingRecord & { courseImage?: string }) | null
> {
    const dbInstance = getDb()
    const rows = dbInstance
        .prepare(
            `SELECT r.*, c.courseImage
     FROM recordings r
     JOIN courses c ON r.courseId = c.courseId
     ORDER BY r.lastWatchedAt DESC, r.recordingDate DESC
     LIMIT 1;`,
        )
        .all() as (RecordingRecord & { courseImage?: string })[]
    return rows[0] || null
}

export async function toggleWatchlist(courseId: string, status: boolean): Promise<void> {
    const dbInstance = getDb()
    dbInstance
        .prepare(`UPDATE courses SET isWatchlist = ? WHERE courseId = ?;`)
        .run(status ? 1 : 0, courseId)
}

export async function saveCourseProgress(courseId: string, recordingUuid: string): Promise<void> {
    const dbInstance = getDb()
    dbInstance
        .prepare(`UPDATE courses SET lastWatchedUuid = ? WHERE courseId = ?;`)
        .run(recordingUuid, courseId)
}
