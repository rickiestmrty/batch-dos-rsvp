import { appendRsvp, readAttendees, readNamesWith } from './sheets.js'
import { findMember, fold } from '../names.js'

/** What the committee reads in the Response column, keyed by what the page sends. */
export const RESPONSES = {
  accepted: 'Going',
  maybe: 'Not sure yet',
}

const MAX_NAME = 60

const SHEETS = { appendRsvp, readAttendees, readNamesWith }

/**
 * The batch list for the name picker, and which of those names already said yes —
 * like the reunion app's "Voted" chip. recordRsvp still checks for itself; this only
 * lets the picker say so before anyone presses Send.
 */
export async function readRoster(sheets = SHEETS) {
  const [names, going] = await Promise.all([
    sheets.readAttendees(),
    sheets.readNamesWith(RESPONSES.accepted),
  ])
  const goingKeys = new Set(going.map(fold))
  return { names, going: names.filter((n) => goingKeys.has(fold(n))) }
}

/**
 * Validate one RSVP and write it to the workbook.
 *
 * Shared by the Vercel function (api/rsvp.js) and the local dev server (server.mjs),
 * so both enforce the same rules. Returns an HTTP status and a JSON body.
 *
 * An acceptance must name someone on the Attendees tab, and is stored under the
 * list's own spelling. A name already marked Going is not written again — the page
 * tells them they've already responded.
 *
 * `sheets` is only swapped out by the tests.
 */
export async function recordRsvp(input, sheets = SHEETS) {
  const status = input?.status
  if (typeof status !== 'string' || !Object.hasOwn(RESPONSES, status)) {
    return { status: 400, body: { ok: false, error: 'Unknown RSVP response.' } }
  }

  const typed =
    typeof input.name === 'string' ? input.name.trim().replace(/\s+/g, ' ').slice(0, MAX_NAME) : ''

  if (status === 'accepted' && !typed) {
    return { status: 400, body: { ok: false, error: 'A name is required to accept.' } }
  }

  try {
    let name = typed

    if (status === 'accepted') {
      const member = findMember(await sheets.readAttendees(), typed)
      if (!member) {
        return {
          status: 422,
          body: { ok: false, code: 'not-on-list', error: "That name isn't on the batch list." },
        }
      }
      name = member

      const going = await sheets.readNamesWith(RESPONSES.accepted)
      if (going.some((n) => fold(n) === fold(member))) {
        return { status: 409, body: { ok: false, code: 'already-responded', name: member } }
      }
    }

    await sheets.appendRsvp({ name, response: RESPONSES[status] })
    return { status: 200, body: { ok: true, name } }
  } catch (err) {
    console.error('[recordRsvp]', err)
    return { status: 502, body: { ok: false, error: 'Could not reach the spreadsheet.' } }
  }
}
