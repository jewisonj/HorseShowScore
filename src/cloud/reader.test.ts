// @vitest-environment node
import { describe, expect, it } from 'vitest'
import {
  ANTHROPIC_VERSION,
  DEFAULT_MODEL,
  MAX_PDF_BASE64,
  SCHEMA,
  handle,
  readReply,
  type ReaderDeps,
} from '../../supabase/functions/read-pattern-book/handler'

const PDF = 'JVBERi0xLjQK' // "%PDF-1.4\n"
const SECRET = 'test-key-not-a-real-one'

const good = {
  patterns: [
    {
      name: 'Made-up Reining Pattern 3',
      kind: 'reining',
      page: 2,
      classes: ['Open Reining'],
      boxes: [
        { code: 'Rr S', words: 'LF right, SS right, stop' },
        { code: '4 RS', words: '4 spins right' },
      ],
      unsure: '',
    },
  ],
  notes: '',
}

interface Call {
  url: string
  init: RequestInit
}

/** A stand-in for the network: the database's admin check and the Anthropic API. */
function deps(opts: { admin?: unknown; adminStatus?: number; reply?: unknown; status?: number; throws?: Error; env?: Record<string, string> } = {}) {
  const calls: Call[] = []
  const lines: string[] = []
  const env: Record<string, string> = { SUPABASE_URL: 'https://example.supabase.co', ANTHROPIC_API_KEY: SECRET, ...opts.env }
  const d: ReaderDeps = {
    env: (name) => env[name] || undefined,
    log: (line) => lines.push(line),
    fetch: (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      calls.push({ url, init: init ?? {} })
      if (url.includes('/rest/v1/rpc/is_show_admin')) {
        return new Response(JSON.stringify(opts.admin ?? true), { status: opts.adminStatus ?? 200 })
      }
      if (opts.throws) throw opts.throws
      const reply = opts.reply ?? { stop_reason: 'end_turn', content: [{ type: 'text', text: JSON.stringify(good) }], usage: { input_tokens: 5, output_tokens: 7 } }
      return new Response(JSON.stringify(reply), { status: opts.status ?? 200 })
    }) as typeof fetch,
  }
  return { d, calls, lines, anthropic: () => calls.filter((c) => c.url.includes('api.anthropic.com')) }
}

function request(body: unknown = { pdf_base64: PDF }, headers: Record<string, string> = { Authorization: 'Bearer user-token', apikey: 'sb_publishable_test' }) {
  return new Request('https://example.supabase.co/functions/v1/read-pattern-book', { method: 'POST', headers, body: JSON.stringify(body) })
}

describe('the pattern book reader on the server', () => {
  it('reads a book for a show admin', async () => {
    const t = deps()
    const res = await handle(request(), t.d)
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual(good)
    // It asked the database who this is, with the caller's own sign-in.
    expect(t.calls[0].url).toBe('https://example.supabase.co/rest/v1/rpc/is_show_admin')
    expect((t.calls[0].init.headers as Record<string, string>).Authorization).toBe('Bearer user-token')
    // Then sent the PDF to Anthropic in the documented shape.
    const call = t.anthropic()[0]
    expect(call.url).toBe('https://api.anthropic.com/v1/messages')
    const headers = call.init.headers as Record<string, string>
    expect(headers['x-api-key']).toBe(SECRET)
    expect(headers['anthropic-version']).toBe(ANTHROPIC_VERSION)
    const sent = JSON.parse(call.init.body as string)
    expect(sent.model).toBe(DEFAULT_MODEL)
    expect(sent.messages[0].content[0]).toEqual({ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: PDF } })
    expect(sent.output_config.format).toEqual({ type: 'json_schema', schema: SCHEMA })
    expect(sent.output_config.effort).toBe('medium')
    // Forced tool use is refused by this model family, and citations cannot be mixed with a schema.
    expect(sent.tool_choice).toBeUndefined()
    expect(JSON.stringify(sent)).not.toContain('citations')
  })

  it('never hands the Anthropic key back, or logs it', async () => {
    for (const opts of [{}, { status: 401, reply: { error: { type: 'authentication_error', message: 'invalid x-api-key' } } }, { admin: false }]) {
      const t = deps(opts)
      const res = await handle(request(), t.d)
      expect(await res.text()).not.toContain(SECRET)
      expect(t.lines.join('\n')).not.toContain(SECRET)
    }
  })

  it('turns away someone who is not signed in, before anything else', async () => {
    const t = deps()
    const res = await handle(request({ pdf_base64: PDF }, {}), t.d)
    expect(res.status).toBe(401)
    expect(t.calls).toHaveLength(0)
  })

  it('turns away a signed-in person who is not a show admin, and does not call Anthropic', async () => {
    const t = deps({ admin: false })
    const res = await handle(request(), t.d)
    expect(res.status).toBe(403)
    expect(t.anthropic()).toHaveLength(0)
  })

  it('turns away a sign-in the database does not accept', async () => {
    const t = deps({ adminStatus: 401, admin: { message: 'JWT expired' } })
    const res = await handle(request(), t.d)
    expect(res.status).toBe(401)
    expect(t.anthropic()).toHaveLength(0)
  })

  it('says so when the key has not been set on the server', async () => {
    const t = deps({ env: { ANTHROPIC_API_KEY: '' } })
    const res = await handle(request(), t.d)
    expect(res.status).toBe(500)
    expect((await res.json()).error).toMatch(/ANTHROPIC_API_KEY/)
  })

  it('refuses a file that is not a PDF, and one that is too large', async () => {
    const notPdf = deps()
    expect((await handle(request({ pdf_base64: 'aGVsbG8=' }), notPdf.d)).status).toBe(400)
    const big = deps()
    expect((await handle(request({ pdf_base64: PDF + 'A'.repeat(MAX_PDF_BASE64) }), big.d)).status).toBe(413)
    expect(notPdf.anthropic().length + big.anthropic().length).toBe(0)
  })

  it('uses another model when the server is set to', async () => {
    const t = deps({ env: { PATTERN_READER_MODEL: 'claude-opus-5-5', PATTERN_READER_EFFORT: 'low' } })
    await handle(request(), t.d)
    const sent = JSON.parse(t.anthropic()[0].init.body as string)
    expect(sent.model).toBe('claude-opus-5-5')
    expect(sent.output_config.effort).toBe('low')
  })

  it('explains a refusal, a cut-off answer and a broken answer in plain words', async () => {
    const cases: [unknown, RegExp][] = [
      [{ stop_reason: 'refusal', content: [{ type: 'text', text: 'I cannot help with that.' }] }, /would not read/],
      [{ stop_reason: 'max_tokens', content: [{ type: 'text', text: '{"patterns":[{"name":"Cut' }] }, /too long/],
      [{ stop_reason: 'end_turn', content: [{ type: 'text', text: 'not json' }] }, /could not be understood/],
      [{ stop_reason: 'end_turn', content: [] }, /no answer/],
    ]
    for (const [reply, words] of cases) {
      const res = await handle(request(), deps({ reply }).d)
      expect(res.status).toBe(502)
      expect((await res.json()).error).toMatch(words)
    }
  })

  it('explains a rejected key, and a read that took too long', async () => {
    const rejected = await handle(request(), deps({ status: 401, reply: { error: { type: 'authentication_error', message: 'x' } } }).d)
    expect((await rejected.json()).error).toMatch(/did not accept the key/)
    const slow = await handle(request(), deps({ throws: Object.assign(new Error('timed out'), { name: 'TimeoutError' }) }).d)
    expect(slow.status).toBe(504)
    expect((await slow.json()).error).toMatch(/took too long/)
  })

  it('answers the browser\'s permission check', async () => {
    const res = await handle(new Request('https://example.supabase.co/functions/v1/read-pattern-book', { method: 'OPTIONS' }), deps().d)
    expect(res.headers.get('Access-Control-Allow-Headers')).toContain('apikey')
  })

  it('reads the answer after any thinking, and drops what is not a pattern', () => {
    const out = readReply({
      stop_reason: 'end_turn',
      content: [
        { type: 'thinking', thinking: 'reading' },
        {
          type: 'text',
          text: JSON.stringify({
            patterns: [
              good.patterns[0],
              { name: '', kind: 'reining', page: 1, classes: [], boxes: [{ code: 'W', words: 'Walk' }], unsure: '' },
              { name: 'No boxes', kind: 'reining', page: 1, classes: [], boxes: [], unsure: '' },
              { name: 'Odd kind', kind: 'Trail', page: 3.4, classes: ['x', 7], boxes: [{ code: 'W', words: 'Walk' }], unsure: 'faint scan' },
            ],
            notes: 'Two pages were covers.',
          }),
        },
      ],
    })
    expect(out.ok && out.patterns.map((p) => [p.name, p.kind, p.page])).toEqual([
      ['Made-up Reining Pattern 3', 'reining', 2],
      ['Odd kind', 'other', 3],
    ])
    expect(out.ok && out.patterns[1].classes).toEqual(['x'])
  })

  it('the schema keeps to what structured outputs accept', () => {
    // Every object closed, every property required, no length or size limits.
    const walk = (node: unknown) => {
      if (!node || typeof node !== 'object') return
      const n = node as Record<string, unknown>
      if (n.type === 'object') {
        expect(n.additionalProperties).toBe(false)
        expect([...(n.required as string[])].sort()).toEqual(Object.keys(n.properties as object).sort())
      }
      for (const banned of ['minLength', 'maxLength', 'minimum', 'maximum', 'maxItems', 'oneOf']) expect(n[banned]).toBeUndefined()
      Object.values(n).forEach(walk)
    }
    walk(SCHEMA)
  })
})
