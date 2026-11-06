import { JWT } from 'google-auth-library'

/**
 * Google Sheets access — the same service account and workbook as batch-dos-reunion.
 *
 * Talks to the Sheets REST API over `fetch` with a service-account JWT, exactly as the
 * reunion app's lib/sheets.ts does, rather than pulling in the full `googleapis` package.
 * Credentials come from server-only env vars, so this file must never reach the browser.
 */

const SHEETS_API = 'https://sheets.googleapis.com/v4/spreadsheets'
const SCOPES = ['https://www.googleapis.com/auth/spreadsheets']

export const RSVP_TAB = 'RSVP'
export const RSVP_HEADERS = ['Timestamp', 'Name', 'Response']

/** The workbook's own timezone, so a 9pm RSVP in Cebu is dated that evening. */
export const SHEET_TIME_ZONE = 'Asia/Manila'

/** Sheets counts days from 1899-12-30. */
const SHEET_EPOCH_UTC = Date.UTC(1899, 11, 30)

/** An instant as the serial number Sheets stores a date-time in, on Manila's wall clock. */
export function dateSerial(at, timeZone = SHEET_TIME_ZONE) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(at)

  const field = (type) => Number(parts.find((p) => p.type === type)?.value)

  const wallClock = Date.UTC(
    field('year'),
    field('month') - 1,
    field('day'),
    field('hour'),
    field('minute'),
    field('second'),
  )
  return (wallClock - SHEET_EPOCH_UTC) / 86_400_000
}

let cached

function client() {
  if (cached) return cached

  const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL
  const rawKey = process.env.GOOGLE_PRIVATE_KEY

  if (!email || !rawKey) {
    throw new Error(
      'Missing GOOGLE_SERVICE_ACCOUNT_EMAIL or GOOGLE_PRIVATE_KEY. Copy .env.example to .env.local and fill it in.',
    )
  }

  // The key keeps its newlines escaped as literal "\n" in the env var; unescape here.
  cached = new JWT({ email, key: rawKey.replace(/\\n/g, '\n'), scopes: SCOPES })
  return cached
}

function sheetId() {
  const id = process.env.SHEET_ID
  if (!id) throw new Error('Missing SHEET_ID')
  return id
}

async function call(path, init) {
  const { token } = await client().getAccessToken()
  const res = await fetch(`${SHEETS_API}/${sheetId()}${path}`, {
    ...init,
    headers: {
      ...init?.headers,
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
    },
    cache: 'no-store',
  })

  if (!res.ok) {
    const body = await res.text()
    throw new Error(`Sheets API ${res.status} on ${path}: ${body.slice(0, 300)}`)
  }
  return res.json()
}

const range = (a1) => encodeURIComponent(`${RSVP_TAB}!${a1}`)

async function batchUpdate(requests) {
  return call(':batchUpdate', { method: 'POST', body: JSON.stringify({ requests }) })
}

/**
 * Create the RSVP tab with its header row the first time anyone responds.
 *
 * Never touches any other tab. Memoised per server instance; a failure clears the
 * memo so the next request tries again.
 */
let tabReady

function ensureRsvpTab() {
  tabReady ??= (async () => {
    const data = await call('?fields=sheets.properties(title,sheetId)')
    if (data.sheets.some((s) => s.properties.title === RSVP_TAB)) return

    let tabId
    try {
      const created = await batchUpdate([
        { addSheet: { properties: { title: RSVP_TAB, gridProperties: { frozenRowCount: 1 } } } },
      ])
      tabId = created.replies[0].addSheet.properties.sheetId
    } catch (err) {
      // Another instance created it between our read and our write.
      if (String(err.message).includes('already exists')) return
      throw err
    }

    await call(`/values/${range('A1:C1')}?valueInputOption=RAW`, {
      method: 'PUT',
      body: JSON.stringify({ values: [RSVP_HEADERS] }),
    })

    await batchUpdate([
      {
        repeatCell: {
          range: { sheetId: tabId, startRowIndex: 0, endRowIndex: 1 },
          cell: { userEnteredFormat: { textFormat: { bold: true } } },
          fields: 'userEnteredFormat.textFormat.bold',
        },
      },
      {
        // Column A is a real date-time, so it sorts chronologically.
        repeatCell: {
          range: { sheetId: tabId, startRowIndex: 1, startColumnIndex: 0, endColumnIndex: 1 },
          cell: { userEnteredFormat: { numberFormat: { type: 'DATE_TIME', pattern: 'mmmm d yyyy, h:mm am/pm' } } },
          fields: 'userEnteredFormat.numberFormat',
        },
      },
      {
        updateDimensionProperties: {
          range: { sheetId: tabId, dimension: 'COLUMNS', startIndex: 0, endIndex: 3 },
          properties: { pixelSize: 220 },
          fields: 'pixelSize',
        },
      },
    ])
  })().catch((err) => {
    tabReady = undefined
    throw err
  })
  return tabReady
}

export const ATTENDEES_TAB = 'Attendees'

/** How long one server instance trusts its copy of the batch list. */
const ROSTER_TTL_MS = 5 * 60 * 1000
let roster

/**
 * The batch list: column A of the Attendees tab, below its "Names" header.
 * Read-only — this app never writes to that tab. Cached briefly per instance, so a
 * name the committee adds shows up within a few minutes without a redeploy.
 */
export async function readAttendees() {
  if (roster && Date.now() - roster.at < ROSTER_TTL_MS) return roster.names

  const data = await call(`/values/${encodeURIComponent(`${ATTENDEES_TAB}!A2:A`)}`)
  const names = (data.values ?? []).map((row) => String(row[0] ?? '').trim()).filter(Boolean)
  roster = { names, at: Date.now() }
  return names
}

/** The name on every RSVP row whose Response column reads `response`. */
export async function readNamesWith(response) {
  // Only ever called right before an append, so creating the tab here costs nothing extra.
  await ensureRsvpTab()
  const data = await call(`/values/${range('B2:C')}`)
  return (data.values ?? []).filter((row) => row[1] === response).map((row) => String(row[0] ?? ''))
}

/**
 * One row per response. RAW, so a name like "=HYPERLINK(...)" is stored as text,
 * never evaluated as a formula.
 *
 * OVERWRITE, not INSERT_ROWS: it fills the next empty row, which already carries the
 * date-time format. An inserted row copies the row above instead — the header — and
 * the timestamp shows as a bare serial like 46332.5451.
 */
export async function appendRsvp({ name, response }, at = new Date()) {
  await ensureRsvpTab()
  await call(`/values/${range('A:C')}:append?valueInputOption=RAW&insertDataOption=OVERWRITE`, {
    method: 'POST',
    body: JSON.stringify({ values: [[dateSerial(at), name, response]] }),
  })
}
