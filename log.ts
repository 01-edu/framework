/**
 * Add support for sending logs to our devtools.
 * Our Logger also help shapping logs and recognize our context module.
 * @module
 */

import {
  blue,
  brightBlue,
  brightCyan,
  brightGreen,
  brightMagenta,
  brightRed,
  brightYellow,
  cyan,
  gray,
  green,
  magenta,
  red,
  yellow,
} from '@std/fmt/colors'
import { now, startTime } from './time.ts'
import { getContext } from './context.ts'
import { APP_ENV, type AppEnvironments } from './env.ts'

// Types
type LogLevel = 'info' | 'error' | 'warn' | 'debug'
type LogFunction = (
  level: LogLevel,
  event: string,
  props?: Record<string, unknown>,
) => void
type BoundLogFunction = (event: string, props?: Record<string, unknown>) => void

interface Log extends LogFunction {
  error: BoundLogFunction
  debug: BoundLogFunction
  warn: BoundLogFunction
  info: BoundLogFunction
}

type LogLevelDetails = {
  ico: string
  color: (text: string) => string
  level: number
}

// Constants
const levels: Record<LogLevel, LogLevelDetails> = {
  debug: { ico: '🐛', color: green, level: 5 },
  info: { ico: 'ℹ️', color: cyan, level: 9 },
  warn: { ico: '⚠️', color: yellow, level: 13 },
  error: { ico: '💥', color: red, level: 17 },
} as const

const colors = [
  green,
  yellow,
  blue,
  magenta,
  cyan,
  brightRed,
  brightGreen,
  brightYellow,
  brightBlue,
  brightMagenta,
  brightCyan,
]
const colored: Record<string, string> = { 'Object.fetch': cyan('serve') }

const makePrettyTimestamp = (level: LogLevel, event: string) => {
  const at = new Date()
  const hh = String(at.getHours()).padStart(2, '0')
  const mm = String(at.getMinutes()).padStart(2, '0')
  const ss = String(at.getSeconds()).padStart(2, '0')
  const ms = String(at.getMilliseconds()).padStart(2, '0').slice(0, 2)
  const lvl = levels[level]
  return `${gray(`${hh}h${mm}:${ss}.${ms}`)} ${lvl.ico} ${lvl.color(event)}`
}

const redactLongString = (_: string, value: unknown) => {
  if (typeof value !== 'string') return value
  return value.length > 100 ? 'long_string' : value
}

export const logger = async ({
  logToken,
  logUrl,
  filters,
  batchInterval = 5000,
  maxBatchSize = 50,
  version,
}: {
  logToken?: string
  logUrl?: string
  version?: string
  batchInterval?: number
  maxBatchSize?: number
  filters?: Record<AppEnvironments, Set<string> | undefined>
}): Promise<Log> => {
  let logBatch: unknown[] = []
  if (APP_ENV === 'prod' && (!logToken || !logUrl)) {
    throw Error('DEVTOOLS configuration is required in production')
  }

  if (!version) {
    try {
      const p = new Deno.Command('git', {
        args: ['rev-parse', 'HEAD'],
        stdout: 'piped',
        stderr: 'null',
      })
      const output = await p.output()
      if (output.success) {
        version = new TextDecoder().decode(output.stdout).trim()
      }
    } catch (err) {
      if (err && APP_ENV === 'prod') {
        throw Error('CI_COMMIT_SHA env needed for production')
      }
      version = 'unknown'
    }
  }

  // DEVTOOLS Batch Logic
  async function flushLogs() {
    if (logBatch.length === 0) return

    const batchToSend = logBatch
    logBatch = []

    try {
      const response = await fetch(logUrl!, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${logToken}`,
        },
        body: JSON.stringify(batchToSend, redactLongString),
      })

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${await response.text()}`)
      }
    } catch (err) {
      console.error('DEVTOOLS batch send failed:', err)
      logBatch = [...batchToSend, ...logBatch] // Requeue failed logs
    }
  }

  // Loggers Implementation
  const rootDir =
    import.meta.dirname?.slice(0, -'/lib'.length).replaceAll('\\', '/') || ''

  const loggers: Record<typeof APP_ENV, LogFunction> = {
    test: (level, event, props) => {
      if (filters?.test?.has(event)) return
      const ev = makePrettyTimestamp(level, event)
      props ? console[level](ev, props) : console[level](ev)
    },

    dev: (level, event, props) => {
      if (filters?.dev?.has(event)) return
      let callChain = ''
      for (const s of Error('').stack!.split('\n').slice(2).reverse()) {
        if (!s.includes(rootDir)) continue
        const fnName = s.split(' ').at(-2)
        if (!fnName || fnName === 'async' || fnName === 'at') continue
        const coloredName = colored[fnName] ||
          (colored[fnName] = colors
            [Object.keys(colored).length % colors.length](
              fnName,
            ))
        callChain = callChain ? `${callChain}/${coloredName}` : coloredName
      }

      const ev = `${makePrettyTimestamp(level, event)} ${callChain}`.trim()
      props ? console[level](ev, props) : console[level](ev)
    },

    prod: (level, event, props) => {
      if (filters?.prod?.has(event)) return
      const { trace, span } = getContext()
      const logData = {
        severity_number: levels[level].level,
        trace_id: trace,
        span_id: span,
        event_name: event,
        attributes: props,
        timestamp: now(),
        service_version: version,
        service_instance_id: startTime.toString(),
      }
      // Local logging
      console.log(event, props)

      logBatch.push(logData)
      logBatch.length >= maxBatchSize && flushLogs()
    },
  }

  if (APP_ENV === 'prod') {
    // Initialize batch interval
    const interval = setInterval(flushLogs, batchInterval)

    // Cleanup on exit
    const cleanup = async () => {
      clearInterval(interval)
      await flushLogs()
      Deno.exit()
    }

    Deno.addSignalListener('SIGINT', cleanup)
    Deno.addSignalListener('SIGTERM', cleanup)
  }

  // Export the log function with bound methods
  return Object.assign(loggers[APP_ENV], {
    error: loggers[APP_ENV].bind(null, 'error'),
    debug: loggers[APP_ENV].bind(null, 'debug'),
    warn: loggers[APP_ENV].bind(null, 'warn'),
    info: loggers[APP_ENV].bind(null, 'info'),
  }) as Log
}
