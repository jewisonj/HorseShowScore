import { createClient } from '@supabase/supabase-js'
import type { ShowFile } from '../data/fixture'
import type { CloudBackend, CloudUser, PublicPlacing, SentRow } from './backend'

function toUser(u: { id: string; email?: string } | null | undefined): CloudUser | null {
  return u ? { id: u.id, email: u.email ?? '' } : null
}

/** First and last day of a show, for the columns the server sorts by. */
export function showSpan(show: ShowFile): { start: string | null; end: string | null } {
  const dates = show.meets.map((m) => m.date).filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d)).sort()
  return { start: dates[0] ?? null, end: dates[dates.length - 1] ?? null }
}

export function createSupabaseBackend(url: string, key: string): CloudBackend {
  const sb = createClient(url, key)
  return {
    async user() {
      const { data } = await sb.auth.getSession()
      return toUser(data.session?.user)
    },
    onUserChange(fn) {
      // Supabase asks that nothing else is awaited inside this callback, so hand the news on afterwards.
      const { data } = sb.auth.onAuthStateChange((_event, session) => {
        const user = toUser(session?.user)
        setTimeout(() => fn(user), 0)
      })
      return () => data.subscription.unsubscribe()
    },
    async signIn(email, password) {
      const { error } = await sb.auth.signInWithPassword({ email, password })
      if (!error) return null
      if (/invalid login/i.test(error.message)) return 'That email and password do not match an account.'
      if (/fetch|network/i.test(error.message)) return 'Could not reach the server. Check the connection and try again.'
      return error.message
    },
    async signOut() {
      await sb.auth.signOut({ scope: 'local' })
    },
    async isShowAdmin() {
      const { data, error } = await sb.rpc('is_show_admin')
      if (error) throw new Error(error.message)
      return data === true
    },
    async listShows() {
      const { data, error } = await sb
        .from('shows')
        .select('definition')
        .eq('published', true)
        .order('start_date', { ascending: false, nullsFirst: false })
      if (error) throw new Error(error.message)
      return (data ?? []).map((row: { definition: unknown }) => row.definition)
    },
    async publishShow(show) {
      const span = showSpan(show)
      const { error } = await sb.from('shows').upsert(
        { id: show.id, name: show.name, host: show.host, start_date: span.start, end_date: span.end, definition: show, published: true },
        { onConflict: 'id' },
      )
      if (error) throw new Error(error.message)
    },
    async removeShow(id) {
      const { error } = await sb.from('shows').delete().eq('id', id)
      if (error) throw new Error(error.message)
    },
    async sendClassScores(send) {
      // No .select(): a judging device may add a row but may not read one back.
      const { error } = await sb.from('class_scores').insert({ show_id: send.showId, class_key: send.classKey, device: send.device, judge: send.judge, results: send.rows })
      if (error) throw new Error(error.message)
    },
    async listClassScores(showId) {
      const { data, error } = await sb
        .from('class_scores')
        .select('class_key, device, judge, results, sent_at')
        .eq('show_id', showId)
        .order('sent_at', { ascending: false })
        .limit(1000)
      if (error) throw new Error(error.message)
      return (data ?? []).map((r: { class_key: string; device: string; judge: string; results: unknown; sent_at: string }) => ({
        classKey: r.class_key,
        device: r.device,
        judge: r.judge,
        rows: Array.isArray(r.results) ? (r.results as SentRow[]) : [],
        sentAt: r.sent_at,
      }))
    },
    async publishPlacings(showId, classKey, placings) {
      const { error } = await sb
        .from('class_results')
        .upsert({ show_id: showId, class_key: classKey, placings, published_at: new Date().toISOString() }, { onConflict: 'show_id,class_key' })
      if (error) throw new Error(error.message)
    },
    async removePlacings(showId, classKey) {
      const { error } = await sb.from('class_results').delete().eq('show_id', showId).eq('class_key', classKey)
      if (error) throw new Error(error.message)
    },
    async listPlacings(showId) {
      const { data, error } = await sb.from('class_results').select('class_key, placings, published_at').eq('show_id', showId)
      if (error) throw new Error(error.message)
      return (data ?? []).map((r: { class_key: string; placings: unknown; published_at: string }) => ({
        classKey: r.class_key,
        placings: Array.isArray(r.placings) ? (r.placings as PublicPlacing[]) : [],
        publishedAt: r.published_at,
      }))
    },
    async uploadPatternPage(path, image) {
      const { error } = await sb.storage.from('pattern-pages').upload(path, image, {
        contentType: image.type || 'image/jpeg',
        // The path is new for every picture, so a phone may keep its copy for good.
        cacheControl: '31536000',
        upsert: false,
      })
      if (error) throw new Error(error.message)
    },
    patternPageUrl(path) {
      return `${url}/storage/v1/object/public/pattern-pages/${path}`
    },
    async fetchWorkbook(link) {
      const { data } = await sb.auth.getSession()
      const token = data.session?.access_token
      if (!token) throw new Error('Sign in first.')
      const res = await fetch(`${url}/functions/v1/fetch-workbook`, {
        method: 'POST',
        headers: { apikey: key, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ link }),
      })
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: unknown; message?: unknown } | null
        const said = body && typeof body.error === 'string' ? body.error : ''
        // Supabase itself answers 404 with its own words when the function has not been deployed.
        if (res.status === 404 && !said) throw new Error('Reading a sheet from its link is not set up on the server yet.')
        throw new Error(said || `The server did not answer (error ${res.status}).`)
      }
      return res.arrayBuffer()
    },
    async readPatternBook(pdfBase64) {
      const { data } = await sb.auth.getSession()
      const token = data.session?.access_token
      if (!token) throw new Error('Sign in first.')
      const res = await fetch(`${url}/functions/v1/read-pattern-book`, {
        method: 'POST',
        headers: { apikey: key, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ pdf_base64: pdfBase64 }),
      })
      const body = (await res.json().catch(() => null)) as { error?: unknown; message?: unknown } | null
      if (!res.ok) {
        const said = body && typeof body.error === 'string' ? body.error : body && typeof body.message === 'string' ? body.message : ''
        if (res.status === 404) throw new Error('The pattern book reader is not set up on the server yet.')
        throw new Error(said || `The reader did not answer (error ${res.status}).`)
      }
      return body
    },
  }
}
