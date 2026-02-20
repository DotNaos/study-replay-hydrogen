import pino from 'pino'
import pinoPretty from 'pino-pretty'

export const log = pino(
    { level: 'debug' },
    pinoPretty({ colorize: true, translateTime: 'HH:MM:ss.l', ignore: 'pid,hostname' }),
)
