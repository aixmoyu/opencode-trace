/**
 * @vitest-environment node
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import * as childProcess from 'node:child_process'

vi.mock('node:child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:child_process')>()
  return {
    ...actual,
    default: actual,
    spawn: vi.fn()
  }
})

describe('cmdViewer', () => {
  let mockSpawn: ReturnType<typeof vi.fn>
  let exitSpy: ReturnType<typeof vi.spyOn>

  beforeEach(async () => {
    vi.resetModules()
    mockSpawn = vi.mocked(childProcess.spawn)
    exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never)
    vi.clearAllMocks()
  })

  afterEach(() => {
    exitSpy.mockRestore()
    vi.restoreAllMocks()
  })

  it('should spawn viewer CLI with args', async () => {
    const mockChild = {
      on: vi.fn((event, callback) => {
        if (event === 'exit') {
          callback(0)
        }
        return mockChild
      })
    }
    mockSpawn.mockReturnValue(mockChild as any)

    const { cmdViewer } = await import('./viewer.js')
    await cmdViewer(['--port', '3000'])

    expect(mockSpawn).toHaveBeenCalledWith(
      'node',
      [expect.stringMatching(/viewer[\/\\]cli\.js$/), '--port', '3000'],
      { stdio: 'inherit' }
    )
    expect(exitSpy).toHaveBeenCalledWith(0)
  })

  it('should pass through exit code', async () => {
    const mockChild = {
      on: vi.fn((event, callback) => {
        if (event === 'exit') {
          callback(1)
        }
        return mockChild
      })
    }
    mockSpawn.mockReturnValue(mockChild as any)

    const { cmdViewer } = await import('./viewer.js')
    await cmdViewer([])

    expect(exitSpy).toHaveBeenCalledWith(1)
  })

  it('should handle spawn errors', async () => {
    const mockError = new Error('spawn error')
    const mockChild = {
      on: vi.fn((event, callback) => {
        if (event === 'error') {
          callback(mockError)
        }
        return mockChild
      })
    }
    mockSpawn.mockReturnValue(mockChild as any)

    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    const { cmdViewer } = await import('./viewer.js')
    await cmdViewer([])

    expect(consoleErrorSpy).toHaveBeenCalledWith('Failed to spawn viewer: spawn error')
    expect(exitSpy).toHaveBeenCalledWith(1)

    consoleErrorSpy.mockRestore()
  })
})