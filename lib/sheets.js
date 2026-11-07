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
export const RSVP_HEADERS = ['Timestamp', 'Name', 'Response', 'Paid']

/** The response that owes the ₱1,250 contribution, and so gets a Paid checkbox. */
export const PAYING_RESPONSE = 'Going'

/** 0-indexed column of the Paid checkboxes (D). */
const PAID_COLUMN = 3

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

/** A tickable Paid checkbox on rows [startRow, endRow) (0-indexed), for the committee. */
const paidCheckboxes = (sheetId, startRowIndex, endRowIndex) => ({
  setDataValidation: {
    range: { sheetId, startRowIndex, endRowIndex, startColumnIndex: PAID_COLUMN, endColumnIndex: PAID_COLUMN + 1 },
    rule: { condition: { type: 'BOOLEAN' }, strict: true, showCustomUi: true },
  },
})

/** The 1-based row an append landed on, from its updatedRange ("RSVP!A7:D7" -> 7). */
export const appendedRow = (updatedRange) => Number(/![A-Z]+(\d+)/.exec(updatedRange)?.[1])

/**
 * The header row and the formats under it: bold frozen header, column A as a real
 * date-time (so it sorts chronologically), readable widths for A:C and a narrow,
 * centred Paid column.
 */
async function writeHeader(tabId) {
  await call(`/values/${range('A1:D1')}?valueInputOption=RAW`, {
    method: 'PUT',
    body: JSON.stringify({ values: [RSVP_HEADERS] }),
  })

  await batchUpdate([
    {
      updateSheetProperties: {
        properties: { sheetId: tabId, gridProperties: { frozenRowCount: 1 } },
        fields: 'gridProperties.frozenRowCount',
      },
    },
    {
      repeatCell: {
        range: { sheetId: tabId, startRowIndex: 0, endRowIndex: 1, startColumnIndex: 0, endColumnIndex: 4 },
        cell: { userEnteredFormat: { textFormat: { bold: true }, numberFormat: { type: 'TEXT' } } },
        fields: 'userEnteredFormat.textFormat.bold,userEnteredFormat.numberFormat',
      },
    },
    {
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
    {
      updateDimensionProperties: {
        range: { sheetId: tabId, dimension: 'COLUMNS', startIndex: PAID_COLUMN, endIndex: PAID_COLUMN + 1 },
        properties: { pixelSize: 70 },
        fields: 'pixelSize',
      },
    },
    {
      repeatCell: {
        range: { sheetId: tabId, startColumnIndex: PAID_COLUMN, endColumnIndex: PAID_COLUMN + 1 },
        cell: { userEnteredFormat: { horizontalAlignment: 'CENTER' } },
        fields: 'userEnteredFormat.horizontalAlignment',
      },
    },
  ])
}

/**
 * Create the RSVP tab with its header row the first time anyone responds. Resolves to
 * the tab's sheetId.
 *
 * Never touches any other tab. Memoised per server instance; a failure clears the
 * memo so the next request tries again.
 */
let tabReady

function ensureRsvpTab() {
  tabReady ??= (async () => {
    const findTab = async () =>
      (await call('?fields=sheets.properties(title,sheetId)')).sheets.find((s) => s.properties.title === RSVP_TAB)
    const existing = await findTab()
    if (existing) return existing.properties.sheetId

    let tabId
    try {
      const created = await batchUpdate([
        { addSheet: { properties: { title: RSVP_TAB, gridProperties: { frozenRowCount: 1 } } } },
      ])
      tabId = created.replies[0].addSheet.properties.sheetId
    } catch (err) {
      // Another instance created it between our read and our write.
      if (String(err.message).includes('already exists')) return (await findTab()).properties.sheetId
      throw err
    }

    await writeHeader(tabId)
    return tabId
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
 * never evaluated as a formula. A "Going" row also gets an unticked Paid checkbox in D
 * for the committee; "Not sure yet" rows owe nothing, so they get none.
 *
 * OVERWRITE, not INSERT_ROWS: it fills the next empty row, which already carries the
 * date-time format. An inserted row copies the row above instead — the header — and
 * the timestamp shows as a bare serial like 46332.5451.
 */
export async function appendRsvp({ name, response }, at = new Date()) {
  const tabId = await ensureRsvpTab()
  const paying = response === PAYING_RESPONSE
  const row = [dateSerial(at), name, response, ...(paying ? [false] : [])]
  const result = await call(`/values/${range('A:D')}:append?valueInputOption=RAW&insertDataOption=OVERWRITE`, {
    method: 'POST',
    body: JSON.stringify({ values: [row] }),
  })
  if (paying) {
    const at1 = appendedRow(result.updates.updatedRange)
    await batchUpdate([paidCheckboxes(tabId, at1 - 1, at1)])
  }
}

/**
 * Make sure the header reads Timestamp | Name | Response | Paid and every "Going" row
 * has its Paid checkbox. Only ever adds an unticked box where D is empty, so a payment
 * the committee already ticked is never undone. For tabs from before the Paid column.
 */
async function ensurePaidColumn(tabId) {
  await writeHeader(tabId)
  const data = await call(`/values/${range('A2:D')}?valueRenderOption=UNFORMATTED_VALUE`)
  const rows = (data.values ?? []).flatMap((r, i) => (r[2] === PAYING_RESPONSE ? [{ row: i + 2, paid: r[3] }] : []))
  const missing = rows.filter((r) => r.paid === undefined || r.paid === '')

  if (missing.length) {
    await call('/values:batchUpdate', {
      method: 'POST',
      body: JSON.stringify({
        valueInputOption: 'RAW',
        data: missing.map((r) => ({ range: `${RSVP_TAB}!D${r.row}`, values: [[false]] })),
      }),
    })
  }
  if (rows.length) await batchUpdate(rows.map((r) => paidCheckboxes(tabId, r.row - 1, r.row)))
  return { goingRows: rows.length, boxesAdded: missing.length }
}

/**
 * Lay the committee's tally and charts out on the RSVP tab (lib/rsvp-sheet.js).
 * Safe to re-run: replaces its own charts, rule and cells, and leaves the responses alone.
 */
export async function formatRsvpTab() {
  const { TALLY, PER_DAY, TALLY_RANGE, PER_DAY_CELL, layoutRequests, isOwnRule } = await import('./rsvp-sheet.js')
  const paid = await ensurePaidColumn(await ensureRsvpTab())

  const meta = await call('?fields=sheets(properties(sheetId,title),charts(chartId),conditionalFormats)')
  const tab = meta.sheets.find((s) => s.properties.title === RSVP_TAB)
  const chartIds = (tab.charts ?? []).map((c) => c.chartId)
  const ruleIndexes = (tab.conditionalFormats ?? []).flatMap((rule, i) => (isOwnRule(rule) ? [i] : []))

  // E:K covers both this layout (F:K) and the one before the Paid column (E:J)
  await call(`/values/${range('E1:K' + 1000)}:clear`, { method: 'POST' })
  await call('/values:batchUpdate', {
    method: 'POST',
    body: JSON.stringify({
      valueInputOption: 'USER_ENTERED',
      data: [
        { range: `${RSVP_TAB}!${TALLY_RANGE}`, values: TALLY },
        { range: `${RSVP_TAB}!${PER_DAY_CELL}`, values: [[PER_DAY]] },
      ],
    }),
  })
  await batchUpdate(layoutRequests(tab.properties.sheetId, chartIds, ruleIndexes))
  return { charts: 2, replacedCharts: chartIds.length, ...paid }
}

/**
 * Empty the RSVP tab for a fresh send-out: every response row goes, the header is
 * rewritten (clearing by hand tends to take it too, and then the first RSVP lands in
 * row 1), and the tally and charts are laid out again. Returns the rows it removed.
 */
export async function resetRsvpTab() {
  const tabId = await ensureRsvpTab()

  const before = await call(`/values/${range('A:D')}?valueRenderOption=FORMATTED_VALUE`)
  const removed = (before.values ?? []).filter((row) => row.slice(0, 3).join('|') !== RSVP_HEADERS.slice(0, 3).join('|'))

  await call(`/values/${range('A:D')}:clear`, { method: 'POST' })
  // Clearing values leaves the checkboxes behind; a validation with no rule removes them
  await batchUpdate([{ setDataValidation: { range: { sheetId: tabId, startRowIndex: 1, startColumnIndex: PAID_COLUMN, endColumnIndex: PAID_COLUMN + 1 } } }])
  await writeHeader(tabId)
  await formatRsvpTab()
  return removed
}
