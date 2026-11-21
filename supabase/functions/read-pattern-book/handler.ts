// The pattern book reader.
//
// A show admin sends a pattern book PDF. This sends it to Claude with the
// Anthropic key that only the server holds, and answers with the patterns
// found: a name, the kind of class, and one short code and a few words per
// scored maneuver. A person checks the result in setup before it is used.
//
// Only web-standard APIs are used here, so the tests run this same code.
// index.ts is the three lines that hand it to Supabase.
//
// API details, checked 2026-11-21:
//   PDF document blocks        https://platform.claude.com/docs/en/build-with-claude/pdf-support
//   output_config.format       https://platform.claude.com/docs/en/build-with-claude/structured-outputs
//   output_config.effort       https://platform.claude.com/docs/en/build-with-claude/effort
//   model ids                  https://platform.claude.com/docs/en/models/overview

export const DEFAULT_MODEL = 'claude-sonnet-5-5'
export const DEFAULT_EFFORT = 'medium'
export const ANTHROPIC_VERSION = '2026-10-21'
/** About 8 MB of PDF once it is written as base64. */
export const MAX_PDF_BASE64 = 11_200_000
/** Supabase gives up on a request after 150 seconds. Stop a little before that with a clear message. */
export const TIMEOUT_MS = 140_000

export interface ReaderDeps {
  env(name: string): string | undefined
  fetch: typeof fetch
  log?(line: string): void
}

export const KINDS = ['reining', 'ranch_riding', 'horsemanship', 'other'] as const

/** What Claude must answer with. Every field is required: optional ones make the schema slow to compile. */
export const SCHEMA = {
  type: 'object',
  properties: {
    patterns: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'The pattern as the book titles it, short. "NRHA Reining Pattern 17", "Level I Horsemanship T".' },
          kind: { type: 'string', enum: KINDS },
          page: { type: 'integer', description: 'The PDF page the pattern is on, counting from 1.' },
          classes: {
            type: 'array',
            items: { type: 'string' },
            description: 'The classes the book says ride this pattern, as written. Empty when it does not say.',
          },
          boxes: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                code: { type: 'string', description: 'A short code for the box, 8 characters at most.' },
                words: { type: 'string', description: 'Six words at most, in your own words.' },
              },
              required: ['code', 'words'],
              additionalProperties: false,
            },
          },
          unsure: { type: 'string', description: 'Anything you could not make out about this pattern. Empty when it was clear.' },
        },
        required: ['name', 'kind', 'page', 'classes', 'boxes', 'unsure'],
        additionalProperties: false,
      },
    },
    notes: { type: 'string', description: 'One or two sentences for the person setting up the show. Empty when there is nothing to say.' },
  },
  required: ['patterns', 'notes'],
  additionalProperties: false,
} as const

export const INSTRUCTIONS = `This PDF is the pattern book for a horse show. A scoring app needs each pattern as a list of scored boxes, the way a judge's score sheet lists them across the top. List every pattern in the book, in the order it appears.

For each pattern give:
- name: as the book titles it, kept short.
- kind: reining, ranch_riding or horsemanship. Use other for anything else, such as trail or showmanship.
- page: the PDF page it is on, counting from 1.
- classes: the classes the book says ride this pattern, as written (for example "Level II Horsemanship" or "Class 5"). Leave it empty when the book does not say.
- boxes: one entry per scored maneuver, in order.
- unsure: what you could not read or had to guess. Leave it empty when the pattern was clear.

How to divide a pattern into boxes:
- If the book shows a score sheet, or says how the maneuvers are grouped for scoring, follow that.
- Reining: use the maneuver groups of the association's score sheet for that pattern. A set of circles in one direction with its stop or lead change is one box. A set of spins is one box. A run-down with its stop and rollback or back-up is one box.
- Ranch riding and horsemanship: one box for each numbered step of the pattern.

Each box has a code and a few words.
- code: 8 characters at most, the short form a judge would recognise. Examples: "Rr S" right circles, large fast then small slow, then stop. "Ll S" the same to the left. "LlL CL" left circles large, small, large, then a lead change. "4 LS" four spins left. "4 RS" four spins right. "RRB" right rollback. "LRB" left rollback. "SB" stop and back. "Fig 8" figure eight. "W" walk. "J" jog. "Ex J" extended jog. "Ex T" extended trot. "LL" lope left lead. "RL" lope right lead. "Ex RL" extended lope, right lead. "CL" lead change. "S&B" stop and back. "360 L" full turn left. "S, 90 R" stop, quarter turn right. "SPL" side pass left. In circle codes a capital letter is a large fast circle and a small letter is a small slow one.
- words: six words at most, in your own plain words, such as "LF right, SS right, stop" or "Jog to center cone". Do not copy sentences from the book.

Do not describe diagrams. Do not invent a pattern that is not in the book. Leave out pages that are not patterns, such as covers, schedules and rules. If the PDF holds no patterns, answer with an empty list and say so in notes.`

/** The request sent to the Messages API. */
export function buildRequest(pdfBase64: string, model: string, effort: string) {
  return {
    model,
    // Room for thinking as well as the answer. Thinking counts toward this.
    max_tokens: 24000,
    messages: [
      {
        role: 'user',
        content: [
          { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: pdfBase64 } },
          { type: 'text', text: INSTRUCTIONS },
        ],
      },
    ],
    output_config: { effort, format: { type: 'json_schema', schema: SCHEMA } },
  }
}

export interface FoundBox {
  code: string
  words: string
}
export interface FoundPattern {
  name: string
  kind: string
  page: number
  classes: string[]
  boxes: FoundBox[]
  unsure: string
}
export type Reply = { ok: true; patterns: FoundPattern[]; notes: string } | { ok: false; error: string }

const text = (v: unknown, max: number) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, max) : '')

/** Turn Claude's answer into patterns. Never trusts its shape. */
export function readReply(reply: unknown): Reply {
  const r = reply as { stop_reason?: unknown; content?: unknown } | null
  if (!r || typeof r !== 'object') return { ok: false, error: 'The reader gave no answer.' }
  if (r.stop_reason === 'refusal') return { ok: false, error: 'The reader would not read this file.' }
  if (r.stop_reason === 'max_tokens') {
    return { ok: false, error: 'This pattern book is too long to read in one go. Split it into two PDFs and read each one.' }
  }
  const blocks = Array.isArray(r.content) ? (r.content as { type?: unknown; text?: unknown }[]) : []
  const last = blocks.filter((b) => b && b.type === 'text' && typeof b.text === 'string').pop()
  if (!last) return { ok: false, error: 'The reader gave no answer.' }
  let parsed: { patterns?: unknown; notes?: unknown }
  try {
    parsed = JSON.parse(last.text as string) as { patterns?: unknown; notes?: unknown }
  } catch {
    return { ok: false, error: 'The reader gave an answer that could not be understood. Try again.' }
  }
  if (!parsed || !Array.isArray(parsed.patterns)) return { ok: false, error: 'The reader gave an answer that could not be understood. Try again.' }
  const patterns: FoundPattern[] = []
  for (const raw of parsed.patterns.slice(0, 60) as Record<string, unknown>[]) {
    if (!raw || typeof raw !== 'object') continue
    const boxes = (Array.isArray(raw.boxes) ? (raw.boxes as Record<string, unknown>[]) : [])
      .slice(0, 30)
      .map((b) => ({ code: text(b?.code, 12), words: text(b?.words, 80) }))
      .filter((b) => b.code !== '' || b.words !== '')
    const name = text(raw.name, 80)
    if (name === '' || boxes.length === 0) continue
    const kind = text(raw.kind, 20).toLowerCase()
    patterns.push({
      name,
      kind: (KINDS as readonly string[]).includes(kind) ? kind : 'other',
      page: typeof raw.page === 'number' && Number.isFinite(raw.page) ? Math.max(0, Math.round(raw.page)) : 0,
      classes: (Array.isArray(raw.classes) ? raw.classes : []).map((c) => text(c, 60)).filter((c) => c !== '').slice(0, 20),
      boxes,
      unsure: text(raw.unsure, 300),
    })
  }
  return { ok: true, patterns, notes: text(parsed.notes, 500) }
}

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

function answer(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } })
}

export async function handle(req: Request, deps: ReaderDeps): Promise<Response> {
  const log = deps.log ?? (() => {})
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  if (req.method !== 'POST') return answer(405, { error: 'Send the pattern book with POST.' })

  // 1. Who is asking. The database checks the sign-in and says whether this
  //    person is on the list of show admins. Nobody else reaches the Anthropic key.
  const authorization = req.headers.get('Authorization') ?? ''
  const apikey = req.headers.get('apikey') ?? ''
  const base = deps.env('SUPABASE_URL')
  if (!base) return answer(500, { error: 'The server is not set up: SUPABASE_URL is missing.' })
  if (!/^Bearer\s+\S+/.test(authorization) || apikey === '') return answer(401, { error: 'Sign in first.' })
  let admin: unknown
  try {
    const check = await deps.fetch(`${base}/rest/v1/rpc/is_show_admin`, {
      method: 'POST',
      headers: { apikey, Authorization: authorization, 'Content-Type': 'application/json' },
      body: '{}',
    })
    if (check.status === 401 || check.status === 403) return answer(401, { error: 'Sign in again, then try once more.' })
    if (!check.ok) {
      log(`admin check failed: ${check.status}`)
      return answer(500, { error: 'The server could not check who you are. Has the database been set up?' })
    }
    admin = await check.json()
  } catch (e) {
    log(`admin check threw: ${e instanceof Error ? e.message : String(e)}`)
    return answer(500, { error: 'The server could not check who you are.' })
  }
  if (admin !== true) return answer(403, { error: 'This account is not on the list of people who can set up shows.' })

  // 2. The file.
  const key = deps.env('ANTHROPIC_API_KEY')
  if (!key) return answer(500, { error: 'The server has no Anthropic key yet. Add ANTHROPIC_API_KEY to the function secrets.' })
  let body: { pdf_base64?: unknown }
  try {
    body = (await req.json()) as { pdf_base64?: unknown }
  } catch {
    return answer(400, { error: 'No file arrived.' })
  }
  const pdf = typeof body?.pdf_base64 === 'string' ? body.pdf_base64 : ''
  if (pdf === '') return answer(400, { error: 'No file arrived.' })
  if (pdf.length > MAX_PDF_BASE64) return answer(413, { error: 'That file is larger than 8 MB. Save just the pattern pages as their own PDF.' })
  // "%PDF-" in base64.
  if (!pdf.startsWith('JVBERi0')) return answer(400, { error: 'That file is not a PDF.' })

  // 3. Ask Claude.
  const model = deps.env('PATTERN_READER_MODEL') || DEFAULT_MODEL
  const effort = deps.env('PATTERN_READER_EFFORT') || DEFAULT_EFFORT
  let res: Response
  try {
    res = await deps.fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': key, 'anthropic-version': ANTHROPIC_VERSION, 'content-type': 'application/json' },
      body: JSON.stringify(buildRequest(pdf, model, effort)),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
  } catch (e) {
    const timedOut = e instanceof Error && (e.name === 'TimeoutError' || e.name === 'AbortError')
    log(`anthropic call threw: ${e instanceof Error ? e.name : String(e)}`)
    return answer(504, {
      error: timedOut
        ? 'Reading took too long. Save just the pattern pages as their own PDF, or split the book in two, and try again.'
        : 'The server could not reach Anthropic. Try again in a minute.',
    })
  }
  if (!res.ok) {
    const detail = (await res.json().catch(() => null)) as { error?: { type?: unknown; message?: unknown } } | null
    const type = typeof detail?.error?.type === 'string' ? detail.error.type : ''
    log(`anthropic answered ${res.status} ${type}: ${typeof detail?.error?.message === 'string' ? detail.error.message.slice(0, 300) : ''}`)
    if (res.status === 401) return answer(502, { error: 'Anthropic did not accept the key on the server. Check ANTHROPIC_API_KEY.' })
    if (res.status === 429) return answer(502, { error: 'The Anthropic account is over its limit right now. Try again in a minute.' })
    if (res.status === 413) return answer(502, { error: 'That file is too large for the reader. Save just the pattern pages as their own PDF.' })
    return answer(502, { error: `The reader could not read this file (Anthropic error ${res.status}${type ? `, ${type}` : ''}).` })
  }
  const reply = (await res.json().catch(() => null)) as { usage?: { input_tokens?: unknown; output_tokens?: unknown } } | null
  log(`read with ${model}: ${String(reply?.usage?.input_tokens ?? '?')} tokens in, ${String(reply?.usage?.output_tokens ?? '?')} out`)
  const out = readReply(reply)
  if (!out.ok) return answer(502, { error: out.error })
  return answer(200, { patterns: out.patterns, notes: out.notes })
}
