import { TextLineStream } from '@std/streams/text-line-stream'
import { PORT, WITH_DEVTOOLS } from './env.ts'

export const defaultSocketPath: string = Deno.build.os === 'windows'
  ? '\\\\.\\pipe\\01-devtools'
  : `${Deno.env.get('XDG_RUNTIME_DIR') || '/tmp'}/01-devtools/01-devtools.sock`

const encoder = new TextEncoder()
const decoder = new TextDecoder()

async function sendCommand(
  socketPath: string,
  command: string,
): Promise<Record<string, unknown> | null> {
  try {
    const conn = await Deno.connect({ transport: 'unix', path: socketPath })
    await conn.write(encoder.encode(`${command}\n`))
    const reader = conn.readable
      .pipeThrough(new TextDecoderStream())
      .pipeThrough(new TextLineStream())
      .getReader()
    const { value } = await reader.read()
    reader.releaseLock()
    conn.close()
    return value ? JSON.parse(value) : null
  } catch {
    return null
  }
}

export let devtoolsPort: number | null = null

const getGitRepoName = async () => {
  try {
    const command = new Deno.Command('git', {
      args: ['remote', 'get-url', 'origin'],
    })
    const { success, stdout } = await command.output()
    if (!success) return null
    const url = decoder.decode(stdout).trim()
    return url.replace(/\.git$/, '').split(/[/:]/).pop() ?? null
  } catch {
    // Fail silently
  }
  return null
}

const getDirectoryName = () =>
  Deno.cwd().replaceAll('\\', '/').split('/').pop() ?? 'project'

export async function registerToDevtools(
  socketPath = defaultSocketPath,
): Promise<null | void> {
  if (!WITH_DEVTOOLS) return

  const checkRunning = await new Deno.Command('docker', {
    args: ['ps', '-q', '-f', 'name=devtools', '-f', 'status=running'],
    stdout: 'piped',
    stderr: 'null',
  }).output()

  const isRunning = decoder.decode(checkRunning.stdout).trim().length > 0

  if (!isRunning) {
    await new Deno.Command('docker', {
      args: ['rm', '-f', 'devtools'],
      stdout: 'null',
      stderr: 'null',
    }).output()

    const socketDir = `${Deno.env.get('XDG_RUNTIME_DIR') ?? '/tmp'}/01-devtools`

    await Deno.mkdir(socketDir, { recursive: true })

    const { success } = await new Deno.Command('docker', {
      args: [
        'run',
        '-d',
        '--rm',
        '--name',
        'devtools',
        '--network',
        'host',
        '-e',
        'GEMINI_API_KEY',
        '-v',
        `${socketDir}:/tmp/01-devtools`,
        '-v',
        'devtools-db:/app/db',
        'ghcr.io/01-edu/devtools:latest-dev',
      ],
      stdout: 'inherit',
      stderr: 'inherit',
    }).output()

    if (!success) return null
  }

  const name = (await getGitRepoName()) ?? getDirectoryName()
  const projectId = name.toLowerCase().replace(/[^a-z0-9-_]/g, '')
  const url = `localhost:${PORT}`
  const sqlEndpoint = `http://${url}/api/sql`

  const payload = {
    projectId,
    name,
    url,
    sqlEndpoint,
  }

  const res = await sendCommand(
    socketPath,
    `register/${JSON.stringify(payload)}`,
  )
  if (!res) return null

  devtoolsPort = res.port as number
  console.info(`DevTools is running on: http://localhost:${devtoolsPort}`)
}
