import { describe, expect, it, vi, beforeEach } from 'vitest'

const mocks = vi.hoisted(() => {
  type WsListener = (data: string) => void

  let lastSentFrame: string | null = null
  const allSentFrames: string[] = []

  const mockWsInstance = {
    on: vi.fn((_event: string, _cb: (...args: unknown[]) => void) => {}),
    send: vi.fn((data: string) => {
      lastSentFrame = data
      allSentFrames.push(data)
    }),
    close: vi.fn(),
    readyState: 1, // WebSocket.OPEN
  }

  const WebSocket = vi.fn(() => mockWsInstance) as unknown as {
    new (url: string): typeof mockWsInstance
    OPEN: number
  }
  ;(WebSocket as unknown as Record<string, unknown>).OPEN = 1

  return {
    WebSocket,
    mockWsInstance,
    getLastSentFrame: () => lastSentFrame,
    getAllSentFrames: () => [...allSentFrames],
    reset: () => {
      lastSentFrame = null
      allSentFrames.length = 0
      mockWsInstance.on.mockReset()
      mockWsInstance.send.mockReset()
      mockWsInstance.close.mockReset()
      ;(mocks.WebSocket as unknown as ReturnType<typeof vi.fn>).mockReset()
      ;(mocks.WebSocket as unknown as ReturnType<typeof vi.fn>).mockImplementation(() => mockWsInstance)
      mockWsInstance.send.mockImplementation((data: string) => {
        lastSentFrame = data
        allSentFrames.push(data)
      })
    },
    simulateOpen: () => {
      const openCb = mockWsInstance.on.mock.calls.find(
        (c: unknown[]) => c[0] === 'open'
      )?.[1] as (() => void) | undefined
      openCb?.()
    },
    simulateMessage: (data: string) => {
      const msgCb = mockWsInstance.on.mock.calls.find(
        (c: unknown[]) => c[0] === 'message'
      )?.[1] as WsListener | undefined
      msgCb?.(data)
    },
  }
})

vi.mock('ws', () => ({
  default: mocks.WebSocket,
}))

describe('WsAdapter instanceId stability', () => {
  beforeEach(() => {
    vi.resetModules()
    mocks.reset()
  })

  async function createAdapter() {
    const mod = await import(
      '../../../packages/adapters-openclaw/src/ws-adapter'
    )
    return new mod.WsAdapter({ mode: 'remote_ws' })
  }

  function extractInstanceId(sentFrame: string): string {
    const parsed = JSON.parse(sentFrame)
    return parsed.params?.client?.instanceId ?? ''
  }

  it('instanceId is stable across multiple connect() calls on the same adapter', async () => {
    const adapter = await createAdapter()

    // First connect — trigger challenge + connect frame
    const p1 = adapter.connect()
    mocks.simulateMessage(
      JSON.stringify({ type: 'event', event: 'connect.challenge', payload: { nonce: 'abc' } })
    )
    const frame1 = mocks.getLastSentFrame()!
    const id1 = extractInstanceId(frame1)

    // Resolve the connect
    mocks.simulateMessage(
      JSON.stringify({
        type: 'res',
        id: 'connect',
        ok: true,
        payload: {
          type: 'hello-ok',
          protocol: 3,
          server: { version: '2026.2.27', connId: 'c1' },
          features: { methods: [], events: [] },
          snapshot: null,
          policy: { maxPayload: 1048576, maxBufferedBytes: 4194304, tickIntervalMs: 30000 },
        },
      })
    )
    await p1

    // Disconnect and reconnect
    await adapter.disconnect()

    // Reset mock to capture new frames from the second connect
    mocks.mockWsInstance.on.mockReset()
    mocks.mockWsInstance.send.mockReset()
    mocks.mockWsInstance.send.mockImplementation((data: string) => {
      mocks.getAllSentFrames().push(data)
    })

    const p2 = adapter.connect()
    mocks.simulateMessage(
      JSON.stringify({ type: 'event', event: 'connect.challenge', payload: { nonce: 'def' } })
    )

    // Get the frame from the second connect
    const frame2 = mocks.mockWsInstance.send.mock.calls[0]?.[0] as string
    const id2 = extractInstanceId(frame2)

    expect(id1).toBeTruthy()
    expect(id2).toBeTruthy()
    expect(id1).toBe(id2)

    // Resolve second connect to avoid dangling promise
    mocks.simulateMessage(
      JSON.stringify({
        type: 'res',
        id: 'connect',
        ok: true,
        payload: {
          type: 'hello-ok',
          protocol: 3,
          server: { version: '2026.2.27', connId: 'c2' },
          features: { methods: [], events: [] },
          snapshot: null,
          policy: { maxPayload: 1048576, maxBufferedBytes: 4194304, tickIntervalMs: 30000 },
        },
      })
    )
    await p2
  })

  it('instanceId differs between different adapter instances', async () => {
    const adapter1 = await createAdapter()
    const adapter2 = await createAdapter()

    // Connect adapter1
    const p1 = adapter1.connect()
    mocks.simulateMessage(
      JSON.stringify({ type: 'event', event: 'connect.challenge', payload: { nonce: 'n1' } })
    )
    const frame1 = mocks.mockWsInstance.send.mock.calls[0]?.[0] as string
    const id1 = extractInstanceId(frame1)

    mocks.simulateMessage(
      JSON.stringify({
        type: 'res',
        id: 'connect',
        ok: true,
        payload: {
          type: 'hello-ok',
          protocol: 3,
          server: { version: '2026.2.27', connId: 'c1' },
          features: { methods: [], events: [] },
          snapshot: null,
          policy: { maxPayload: 1048576, maxBufferedBytes: 4194304, tickIntervalMs: 30000 },
        },
      })
    )
    await p1

    // Reset to capture adapter2 frames
    mocks.reset()

    const p2 = adapter2.connect()
    mocks.simulateMessage(
      JSON.stringify({ type: 'event', event: 'connect.challenge', payload: { nonce: 'n2' } })
    )
    const frame2 = mocks.mockWsInstance.send.mock.calls[0]?.[0] as string
    const id2 = extractInstanceId(frame2)

    mocks.simulateMessage(
      JSON.stringify({
        type: 'res',
        id: 'connect',
        ok: true,
        payload: {
          type: 'hello-ok',
          protocol: 3,
          server: { version: '2026.2.27', connId: 'c2' },
          features: { methods: [], events: [] },
          snapshot: null,
          policy: { maxPayload: 1048576, maxBufferedBytes: 4194304, tickIntervalMs: 30000 },
        },
      })
    )
    await p2

    expect(id1).toBeTruthy()
    expect(id2).toBeTruthy()
    expect(id1).not.toBe(id2)
  })

  it('protocol version in handshake matches WS_PROTOCOL_VERSION', async () => {
    const typesModule = await import(
      '../../../packages/adapters-openclaw/src/types'
    )
    const adapter = await createAdapter()

    const p = adapter.connect()
    mocks.simulateMessage(
      JSON.stringify({ type: 'event', event: 'connect.challenge', payload: { nonce: 'x' } })
    )
    const frame = mocks.mockWsInstance.send.mock.calls[0]?.[0] as string
    const parsed = JSON.parse(frame)

    expect(parsed.params.minProtocol).toBe(typesModule.WS_PROTOCOL_VERSION)
    expect(parsed.params.maxProtocol).toBe(typesModule.WS_PROTOCOL_VERSION)

    mocks.simulateMessage(
      JSON.stringify({
        type: 'res',
        id: 'connect',
        ok: true,
        payload: {
          type: 'hello-ok',
          protocol: 3,
          server: { version: '2026.2.27', connId: 'c1' },
          features: { methods: [], events: [] },
          snapshot: null,
          policy: { maxPayload: 1048576, maxBufferedBytes: 4194304, tickIntervalMs: 30000 },
        },
      })
    )
    await p
  })

  it('cleanup() does not reset instanceId', async () => {
    const adapter = await createAdapter()

    // First connect to capture instanceId
    const p1 = adapter.connect()
    mocks.simulateMessage(
      JSON.stringify({ type: 'event', event: 'connect.challenge', payload: { nonce: 'c1' } })
    )
    const frame1 = mocks.mockWsInstance.send.mock.calls[0]?.[0] as string
    const idBefore = extractInstanceId(frame1)

    mocks.simulateMessage(
      JSON.stringify({
        type: 'res',
        id: 'connect',
        ok: true,
        payload: {
          type: 'hello-ok',
          protocol: 3,
          server: { version: '2026.2.27', connId: 'c1' },
          features: { methods: [], events: [] },
          snapshot: null,
          policy: { maxPayload: 1048576, maxBufferedBytes: 4194304, tickIntervalMs: 30000 },
        },
      })
    )
    await p1

    // Disconnect triggers cleanup
    await adapter.disconnect()

    // Reconnect
    mocks.mockWsInstance.on.mockReset()
    mocks.mockWsInstance.send.mockReset()
    mocks.mockWsInstance.send.mockImplementation(() => {})

    const p2 = adapter.connect()
    mocks.simulateMessage(
      JSON.stringify({ type: 'event', event: 'connect.challenge', payload: { nonce: 'c2' } })
    )
    const frame2 = mocks.mockWsInstance.send.mock.calls[0]?.[0] as string
    const idAfter = extractInstanceId(frame2)

    expect(idBefore).toBeTruthy()
    expect(idAfter).toBeTruthy()
    expect(idBefore).toBe(idAfter)

    mocks.simulateMessage(
      JSON.stringify({
        type: 'res',
        id: 'connect',
        ok: true,
        payload: {
          type: 'hello-ok',
          protocol: 3,
          server: { version: '2026.2.27', connId: 'c2' },
          features: { methods: [], events: [] },
          snapshot: null,
          policy: { maxPayload: 1048576, maxBufferedBytes: 4194304, tickIntervalMs: 30000 },
        },
      })
    )
    await p2
  })
})
