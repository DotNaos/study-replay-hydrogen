import { config } from 'dotenv';
import { homedir } from 'os';
import { resolve } from 'path';
import readline from 'readline';
import {
    ensureMoodleSession,
    fetchCourseRecordings,
    fetchCourses,
    shutdownBrowser,
} from './main/scrape';

// Load .env from home dir (standard for this user's apps apparently)
config({ path: resolve(homedir(), '.env') });

const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
});

function ask(question: string): Promise<string> {
    return new Promise((resolve) => rl.question(question, resolve));
}

async function main() {
    console.log('--- Study Replay Scraper CLI ---');

    const username = process.env.MOODLE_USERNAME || (await ask('Username: '));
    const password = process.env.MOODLE_PASSWORD || (await ask('Password: '));

    if (!username || !password) {
        console.error('Credentials missing.');
        process.exit(1);
    }

    console.log(`\n🔑 Authenticating as ${username}...`);
    try {
        await ensureMoodleSession({ username, password });
        console.log('✅ Authenticated!');

        const courses = await fetchCourses({ username, password });
        console.log(`✅ Found ${courses.length} courses.`);

        // Sort by name
        courses.sort((a, b) => a.fullname.localeCompare(b.fullname));

        courses.forEach((c, idx) => {
            console.log(
                `${idx + 1}. [${c.id}] ${c.fullname} (${c.category || 'No Category'})`
            );
        });

        const choice = await ask(
            "\nSelect a course # to scrape recordings (or 'q' to quit): "
        );
        if (choice.toLowerCase() === 'q') return;

        const idx = parseInt(choice) - 1;
        if (isNaN(idx) || idx < 0 || idx >= courses.length) {
            console.error('Invalid selection.');
            return;
        }

        const selectedCourse = courses[idx];
        console.log(
            `\n🎥 Fetching recordings for: ${selectedCourse.fullname}...`
        );

        const recordings = await fetchCourseRecordings(
            { username, password },
            selectedCourse
        );

        console.log(`✅ Found ${recordings.length} recordings.\n`);

        recordings.forEach((r) => {
            console.log(`- [${r.recordingDate}] ${r.recordingName}`);
            console.log(`  URL: ${r.recordingUrl || 'N/A'}`);
            console.log(`  Download: ${r.downloadUrl ? 'YES' : 'NO'}`);
        });
    } catch (error) {
        console.error('❌ Error:', error);
    } finally {
        await shutdownBrowser();
        rl.close();
    }
}

main();
