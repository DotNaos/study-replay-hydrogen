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
            for (const [index, item] of iterator) {
                results[index] = await mapper(item, index)
            }
        })
    await Promise.all(workers)
    return results
}

async function runSimulation() {
    console.log('--- Starting Concurrency Simulation ---')

    // Config matches our real app
    const NUM_Sessions = 10
    const RECORDINGS_PER_SESSION = 5
    const SESSION_CONCURRENCY = 3
    const RECORDING_CONCURRENCY = 3

    let activeSessionFetches = 0
    let activeRecordingFetches = 0
    let maxConcurrentRecordingFetches = 0

    const sessions = Array.from({ length: NUM_Sessions }, (_, i) => ({
        id: i,
        name: `Session ${i + 1}`,
    }))

    console.log(`Processing ${NUM_Sessions} sessions...`)
    console.log(
        `Limits: ${SESSION_CONCURRENCY} concurrent sessions, ${RECORDING_CONCURRENCY} concurrent recordings/session`,
    )
    console.log(
        `Theoretical Max Concurrent Requests: ${SESSION_CONCURRENCY * RECORDING_CONCURRENCY}`,
    )

    const start = Date.now()

    await pMap(
        sessions,
        async (session) => {
            activeSessionFetches++
            // Simulate fetching session list
            await delay(Math.random() * 100 + 50)

            const recordings = Array.from({ length: RECORDINGS_PER_SESSION }, (_, i) => ({
                id: i,
                name: `Rec ${i + 1}`,
            }))

            await pMap(
                recordings,
                async (rec) => {
                    activeRecordingFetches++
                    maxConcurrentRecordingFetches = Math.max(
                        maxConcurrentRecordingFetches,
                        activeRecordingFetches,
                    )

                    // Log if we exceed limits (should not happen if logic is correct)
                    if (activeRecordingFetches > SESSION_CONCURRENCY * RECORDING_CONCURRENCY) {
                        console.error(
                            `!!! WARNING: Overload detected! Active: ${activeRecordingFetches}`,
                        )
                    }

                    // Simulate fetching stream info (API call)
                    await delay(Math.random() * 200 + 100)

                    activeRecordingFetches--
                },
                RECORDING_CONCURRENCY,
            )

            activeSessionFetches--
        },
        SESSION_CONCURRENCY,
    )

    const duration = Date.now() - start
    console.log('--- Simulation Complete ---')
    console.log(`Total time: ${duration}ms`)
    console.log(`Max Concurrent Recording Fetches Observed: ${maxConcurrentRecordingFetches}`)
    console.log(`Target Limit: ${SESSION_CONCURRENCY * RECORDING_CONCURRENCY}`)

    if (maxConcurrentRecordingFetches <= SESSION_CONCURRENCY * RECORDING_CONCURRENCY) {
        console.log('✅ TEST PASSED: Concurrency limits respected.')
    } else {
        console.error('❌ TEST FAILED: Limits exceeded.')
    }
}

runSimulation()
