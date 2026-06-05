import { TextLineStream } from '@std/streams/text-line-stream'

export const defaultSocketPath: string = Deno.build.os === 'windows'
  ? '\\\\.\\pipe\\01-devtools'
  : `${Deno.env.get('XDG_RUNTIME_DIR') || '/tmp'}/01-devtools/01-devtools.sock`

const encoder = new TextEncoder()

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

export interface RegisterPayload {
  projectId: string
  name?: string
  url: string
  sqlEndpoint?: string | null
}

export async function register(
  payload: RegisterPayload,
  socketPath = defaultSocketPath,
): Promise<null | void> {
  const res = await sendCommand(
    socketPath,
    `register/${JSON.stringify(payload)}`,
  )
  if (!res) return null

  devtoolsPort = res.port as number
}
