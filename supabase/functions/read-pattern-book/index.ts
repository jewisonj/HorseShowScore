// Supabase Edge Function: read a pattern book PDF. The work is in handler.ts.
import { handle } from './handler.ts'

Deno.serve((req) => handle(req, { env: (name) => Deno.env.get(name), fetch, log: (line) => console.log(line) }))
