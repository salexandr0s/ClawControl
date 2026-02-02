# @savorg/adapters-openclaw

OpenClaw adapter implementations for savORG.

## Agent Messaging

The `sendToAgent` method routes messages to OpenClaw agents:

```typescript
const adapter = createAdapter({ mode: 'remote_http', httpBaseUrl: 'https://api.openclaw.io' })

// Stream responses (default)
for await (const chunk of adapter.sendToAgent('alpha', 'Hello')) {
  process.stdout.write(chunk)
}

// Non-streaming
for await (const chunk of adapter.sendToAgent('alpha', 'Hello', { stream: false })) {
  console.log(chunk)
}
```

**HTTP Request Mapping:**

`sendToAgent("alpha", "Hello")` produces:

```
POST ${baseUrl}/v1/chat/completions
Header: x-openclaw-agent-id: alpha
Body: {
  "model": "openclaw:alpha",
  "messages": [{ "role": "user", "content": "Hello" }],
  "stream": true
}
```
