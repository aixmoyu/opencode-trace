import { spawn } from 'node:child_process'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))

export async function cmdViewer(args: string[]): Promise<void> {
  const viewerPath = resolve(__dirname, '..', '..', 'viewer', 'cli.js')
  
  const child = spawn('node', [viewerPath, ...args], { stdio: 'inherit' })

  child.on('error', (err) => {
    console.error(`Failed to spawn viewer: ${err.message}`)
    process.exit(1)
  })

  child.on('exit', (code) => {
    process.exit(code ?? 0)
  })
}