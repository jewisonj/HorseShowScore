// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { MAX_BYTES, NOT_SHARED, handle, sheetIdFrom, type FetchDeps } from '../../supabase/functions/fetch-workbook/handler'

const ID = '1AbCdEfGhIjKlMnOpQrStUvWxYz0123456789abcdefgh'
const LINK = `https://docs.google.com/spreadsheets/d/${ID}/edit?usp=drivesdk`
const XLSX = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 1, 2, 3])

/** A stand-in for the network: the database's admin check, and Google. */
function deps(opts: { admin?: unknown; google?: Response | Error } = {}) {
  const urls: string[] = []
  const d: FetchDeps = {
    env: (name) => (name === 'SUPABASE_URL' ? 'https://example.supabase.co' : undefined),
    fetch: (async (input: RequestInfo | URL) => {
      const url = String(input)
      urls.push(url)
      if (url.includes('/rest/v1/rpc/is_show_admin')) return new Response(JSON.stringify(opts.admin ?? true))
      if (opts.google instanceof Error) throw opts.google
      return opts.google ?? new Response(XLSX, { status: 200 })
    }) as typeof fetch,
  }
  return { d, urls, google: () => urls.filter((u) => !u.includes('example.supabase.co')) }
}

function request(body: unknown = { link: LINK }, headers: Record<string, string> = { Authorization: 'Bearer user-token', apikey: 'sb_publishable_test' }) {
  return new Request('https://example.supabase.co/functions/v1/fetch-workbook', { method: 'POST', headers, body: JSON.stringify(body) })
}

describe('fetching a workbook from its Google Sheets link, on the server', () => {
  it('hands a show admin the Excel copy of the sheet', async () => {
    const t = deps()
    const res = await handle(request(), t.d)
    expect(res.status).toBe(200)
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(XLSX)
    // One read-only request, to Google's export address for that sheet and nothing else.
    expect(t.google()).toEqual([`https://docs.google.com/spreadsheets/d/${ID}/export?format=xlsx`])
  })

  it('takes only the sheet id from a link, so it cannot be pointed anywhere else', async () => {
    expect(sheetIdFrom(LINK)).toBe(ID)
    expect(sheetIdFrom(`  https://docs.google.com/spreadsheets/d/${ID}  `)).toBe(ID)
    for (const bad of [
      'https://evil.example/spreadsheets/d/' + ID,
      'https://docs.google.com.evil.example/spreadsheets/d/' + ID,
      'http://docs.google.com/spreadsheets/d/' + ID,
      'https://docs.google.com/document/d/' + ID,
      `https://docs.google.com/spreadsheets/d/${ID}@evil.example/x`,
      'https://docs.google.com/spreadsheets/d/../../etc',
      'https://docs.google.com/spreadsheets/d/e/2PACX-published/pubhtml',
      'http://169.254.169.254/latest/meta-data',
      '',
    ]) {
      expect(sheetIdFrom(bad)).toBeNull()
      const t = deps()
      expect((await handle(request({ link: bad }), t.d)).status).toBe(400)
      expect(t.google()).toEqual([])
    }
  })

  it('turns away anyone who is not a signed-in show admin, without asking Google', async () => {
    const signedOut = deps()
    expect((await handle(request({ link: LINK }, {}), signedOut.d)).status).toBe(401)
    expect(signedOut.urls).toEqual([])
    const stranger = deps({ admin: false })
    expect((await handle(request(), stranger.d)).status).toBe(403)
    expect(stranger.google()).toEqual([])
  })

  it('says how to share the sheet when Google sends a sign-in page instead of a file', async () => {
    for (const google of [new Response('<html>Sign in</html>', { status: 200 }), new Response('', { status: 401 }), new Response('', { status: 403 })]) {
      const res = await handle(request(), deps({ google }).d)
      expect(res.status).toBe(502)
      expect((await res.json()).error).toBe(NOT_SHARED)
    }
  })

  it('explains a missing sheet, a sheet far too large, and Google being out of reach', async () => {
    expect((await handle(request(), deps({ google: new Response('', { status: 404 }) }).d)).status).toBe(404)
    const huge = new Uint8Array(MAX_BYTES + 1)
    huge.set([0x50, 0x4b])
    expect((await handle(request(), deps({ google: new Response(huge) }).d)).status).toBe(413)
    const down = await handle(request(), deps({ google: new Error('connect failed') }).d)
    expect(down.status).toBe(504)
    expect((await down.json()).error).toMatch(/could not reach Google/)
  })
})
