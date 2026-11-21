// Fetch a show workbook from its Google Sheets link.
//
// A show admin pastes the sheet's link in setup. This asks Google for an Excel
// copy of that sheet and hands the bytes back to the page, which reads them
// exactly as it reads a downloaded file. It works only for a sheet shared so
// that anyone with the link can view. The sheet is only ever read: one GET of
// Google's export address. Nothing is stored here.
//
// Only the sheet's id is taken from the link. The address fetched is always
// docs.google.com, so this cannot be pointed at any other site.
//
// Only web-standard APIs are used, so the tests run this same code. The admin
// check is the same as in read-pattern-book; each function is kept whole so it
// can be deployed on its own.

/** A workbook for a show is well under 1 MB. This stops anything absurd. */
export const MAX_BYTES = 15 * 1024 * 1024
export const TIMEOUT_MS = 30_000

export interface FetchDeps {
  env(name: string): string | undefined
  fetch: typeof fetch
  log?(line: string): void
}

/** The sheet id from a Google Sheets link, or null when it is not one. */
export function sheetIdFrom(link: string): string | null {
  const m = /^https:\/\/docs\.google\.com\/spreadsheets\/d\/([A-Za-z0-9_-]{25,100})(?:[/?#]|$)/.exec(link.trim())
  // "/d/e/..." is a published-to-web address, which has no export of the workbook.
  return m && m[1] !== 'e' ? m[1] : null
}

export const NOT_SHARED =
  'Google would not hand over that sheet. It has to be shared so anyone with the link can view: in Google Sheets choose Share, then General access, Anyone with the link, Viewer. Or download it as an Excel file and choose that instead.'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

function answer(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } })
}

export async function handle(req: Request, deps: FetchDeps): Promise<Response> {
  const log = deps.log ?? (() => {})
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  if (req.method !== 'POST') return answer(405, { error: 'Send the link with POST.' })

  // 1. Who is asking. Only show admins may use this, so it is not an open door to Google for anyone.
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

  // 2. The link.
  let body: { link?: unknown }
  try {
    body = (await req.json()) as { link?: unknown }
  } catch {
    return answer(400, { error: 'No link arrived.' })
  }
  const id = typeof body?.link === 'string' ? sheetIdFrom(body.link) : null
  if (!id) {
    return answer(400, { error: 'That is not a Google Sheets link. Copy it from the address bar while the sheet is open, or from the Share button.' })
  }

  // 3. Ask Google for an Excel copy.
  let res: Response
  try {
    res = await deps.fetch(`https://docs.google.com/spreadsheets/d/${id}/export?format=xlsx`, {
      method: 'GET',
      redirect: 'follow',
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
  } catch (e) {
    log(`google fetch threw: ${e instanceof Error ? e.name : String(e)}`)
    return answer(504, { error: 'The server could not reach Google. Try again, or download the sheet as an Excel file and choose that.' })
  }
  if (res.status === 404) return answer(404, { error: 'Google has no sheet at that link. Check that the whole link was copied.' })
  if (!res.ok) {
    log(`google answered ${res.status}`)
    return answer(502, { error: NOT_SHARED })
  }
  const bytes = new Uint8Array(await res.arrayBuffer())
  if (bytes.length > MAX_BYTES) return answer(413, { error: 'That sheet is too large to be a show workbook.' })
  // An Excel file is a zip, which starts with "PK". A sign-in page does not.
  if (!(bytes[0] === 0x50 && bytes[1] === 0x4b)) return answer(502, { error: NOT_SHARED })
  log(`fetched a workbook of ${bytes.length} bytes`)
  return new Response(bytes, {
    status: 200,
    headers: { ...CORS, 'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' },
  })
}
