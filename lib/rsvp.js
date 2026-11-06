import { appendRsvp } from './sheets.js'

/** What the committee reads in the Response column, keyed by what the page sends. */
export const RESPONSES = {
  accepted: 'Going',
  maybe: 'Not sure yet',
}

const MAX_NAME = 60

/**
 * Validate one RSVP and write it to the workbook.
 *
 * Shared by the Vercel function (api/rsvp.js) and the local dev server (server.mjs),
 * so both enforce the same rules. Returns an HTTP status and a JSON body.
 */
export async function recordRsvp(input) {
  const status = input?.status
  if (typeof status !== 'string' || !Object.hasOwn(RESPONSES, status)) {
    return { status: 400, body: { ok: false, error: 'Unknown RSVP response.' } }
  }

  const name =
    typeof input.name === 'string' ? input.name.trim().replace(/\s+/g, ' ').slice(0, MAX_NAME) : ''

  if (status === 'accepted' && !name) {
    return { status: 400, body: { ok: false, error: 'A name is required to accept.' } }
  }

  try {
    await appendRsvp({ name, response: RESPONSES[status] })
    return { status: 200, body: { ok: true } }
  } catch (err) {
    console.error('[recordRsvp]', err)
    return { status: 502, body: { ok: false, error: 'Could not reach the spreadsheet.' } }
  }
}
