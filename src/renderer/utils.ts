/**
 * Format a recording date string (YYYY-MM-DD or YYYYMMDD) to a human-readable format.
 * Example: "2025-09-19" -> "19. September 2025"
 */
export function formatRecordingDate(
    dateStr: string | undefined | null,
): string {
    if (!dateStr) return '';

    // Handle YYYYMMDD format
    let normalized = dateStr;
    if (/^\d{8}$/.test(dateStr)) {
        normalized = `${dateStr.slice(0, 4)}-${dateStr.slice(4, 6)}-${dateStr.slice(6, 8)}`;
    }

    // Parse the date
    const date = new Date(normalized);
    if (isNaN(date.getTime())) return dateStr; // fallback to original

    const months = [
        'Januar',
        'Februar',
        'März',
        'April',
        'Mai',
        'Juni',
        'Juli',
        'August',
        'September',
        'Oktober',
        'November',
        'Dezember',
    ];

    const day = date.getDate();
    const month = months[date.getMonth()];
    const year = date.getFullYear();

    return `${day}. ${month} ${year}`;
}

/**
 * Check if a course has valid, playable URLs for its recordings.
 * Returns true if at least one recording has a downloadUrl or recordingUrl.
 */
export function hasValidUrls(
    recordings: { downloadUrl?: string | null; recordingUrl?: string | null }[],
): boolean {
    if (!recordings || recordings.length === 0) return false;
    return recordings.some((r) => r.downloadUrl || r.recordingUrl);
}

/**
 * Format duration in seconds to "1h 30m" or "45m".
 * Returns null if duration is 0, null, or undefined.
 */
export function formatDuration(
    seconds: number | undefined | null,
): string | null {
    if (!seconds || seconds <= 0) return null;

    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);

    if (h > 0) {
        return `${h}h ${String(m).padStart(2, '0')}m`;
    }
    return `${m}m`;
}

/**
 * Calculate the chronological index of a recording (e.g. Episode 1, 2, 3).
 * Filters out recordings without coverUrl and sorts by date ascending.
 * Returns -1 if not found.
 */
export function getChronologicalIndex(
    recordings: {
        recordingUuid: string | null;
        recordingDate: string;
        coverUrl: string | null;
    }[],
    targetUuid: string | null,
): number {
    if (!targetUuid || !recordings) return -1;

    // Filter & Sort exactly like CourseDetailView
    const sorted = recordings
        .filter((r) => !!r.coverUrl)
        .sort((a, b) => a.recordingDate.localeCompare(b.recordingDate));

    return sorted.findIndex((r) => r.recordingUuid === targetUuid);
}
