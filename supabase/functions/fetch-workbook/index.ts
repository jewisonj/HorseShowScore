// Supabase Edge Function: fetch a show workbook from its Google Sheets link. The work is in handler.ts.
import { handle } from './handler.ts'

Deno.serve((req) => handle(req, { env: (name) => Deno.env.get(name), fetch, log: (line) => console.log(line) }))
