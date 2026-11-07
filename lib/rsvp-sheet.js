/**
 * The committee's audit layout for the RSVP tab: a live tally beside the responses,
 * and two charts — who's in out of the whole batch, and when the yeses came in.
 *
 * Same approach as batch-dos-reunion's Votes tab: the counts are formulas, not numbers
 * worked out here, so the tab stays right while RSVPs keep arriving. Apply (or re-apply)
 * with `pnpm format-rsvp`; it replaces its own cells and charts and touches nothing else.
 *
 * Responses own A:D (D is the committee's Paid checkbox) and E is left empty, so the
 * app's appends (range A:D) never see the tally as part of the table.
 */
import { ATTENDEES_TAB } from './sheets.js'

/** The bottom of the ranges the formulas cover — far below any batch this size. */
const LAST_ROW = 1000

const NAMES = `B2:B${LAST_ROW}`
const RESPONSES = `C2:C${LAST_ROW}`
const PAID = `D2:D${LAST_ROW}`

/** The contribution, per person who's going. */
export const PRICE_PHP = 1250

/** 0-indexed columns. */
const COLUMN = { label: 5, count: 6, share: 7, day: 9, perDay: 10, chart: 12 } // F G H · J K · M

/**
 * F1:H11 — the tally. Rows 2 and 3 are the pie: they always add up to the batch.
 * Rows 8-11 are the money: who's ticked Paid in column D, and what that comes to.
 */
export const TALLY = [
  ['RSVP summary', 'People', 'Of batch'],
  // COUNTUNIQUEIFS, not COUNTUNIQUE(FILTER(...)): with no "Going" rows FILTER returns
  // #N/A, which COUNTUNIQUE counts as one value, so an empty tab read Going 1, Duplicates -1.
  ['Going', `=COUNTUNIQUEIFS(${NAMES}, ${RESPONSES}, "Going")`, '=IF(G6, G2/G6, 0)'],
  ['No yes yet', '=MAX(0, G6 - G2)', '=IF(G6, G3/G6, 0)'],
  ['"Not sure yet" taps', `=COUNTIF(${RESPONSES}, "Not sure yet")`, ''],
  ['Duplicate "Going" rows', `=COUNTIF(${RESPONSES}, "Going") - G2`, ''],
  ['Batch size', `=COUNTA(${ATTENDEES_TAB}!A2:A)`, ''],
  ['', '', ''],
  [`Payments (₱${PRICE_PHP.toLocaleString('en-US')} each)`, 'People', 'Amount'],
  ['Paid', `=COUNTIFS(${RESPONSES}, "Going", ${PAID}, TRUE)`, `=G9 * ${PRICE_PHP}`],
  ['Yet to pay', '=MAX(0, G2 - G9)', `=G10 * ${PRICE_PHP}`],
  ['Total if everyone going pays', '=G2', `=G11 * ${PRICE_PHP}`],
]

/** Where the tally and the per-day list are written. */
export const TALLY_RANGE = `F1:H${TALLY.length}`
export const PER_DAY_CELL = 'J1'

/** J1 — one row per day that had a new "Going", for the timeline chart. */
export const PER_DAY =
  `=IFERROR(QUERY(A2:C${LAST_ROW}, "select toDate(A), count(A) where C = 'Going' group by toDate(A) ` +
  `label toDate(A) 'Day', count(A) 'New Going'", 0), {"Day", "New Going"})`

const GREEN = { red: 0.118, green: 0.557, blue: 0.243 } // #1e8e3e, the app's "sent" green

const rangeOf = (sheetId, firstRow, lastRow, column) => ({
  sheetId,
  startRowIndex: firstRow,
  endRowIndex: lastRow,
  startColumnIndex: column,
  endColumnIndex: column + 1,
})

const at = (sheetId, rowIndex, columnIndex, widthPixels, heightPixels) => ({
  overlayPosition: {
    anchorCell: { sheetId, rowIndex, columnIndex },
    offsetXPixels: 8,
    offsetYPixels: 8,
    widthPixels,
    heightPixels,
  },
})

/**
 * Is this conditional-format rule the duplicate-rows flag laid out below? Matched on
 * row 5 anywhere right of the responses, so the copy from before the Paid column
 * (one column further left) is replaced too.
 */
export const isOwnRule = (rule) =>
  (rule.ranges ?? []).some((r) => (r.startRowIndex ?? 0) === 4 && (r.startColumnIndex ?? 0) >= 4)

/** Every request that lays the tally and charts out, replacing any earlier copy. */
export function layoutRequests(sheetId, existingChartIds = [], ownRuleIndexes = []) {
  const format = (startRow, endRow, startCol, endCol, userEnteredFormat, fields) => ({
    repeatCell: {
      range: { sheetId, startRowIndex: startRow, endRowIndex: endRow, startColumnIndex: startCol, endColumnIndex: endCol },
      cell: { userEnteredFormat },
      fields,
    },
  })
  const width = (column, pixelSize) => ({
    updateDimensionProperties: {
      range: { sheetId, dimension: 'COLUMNS', startIndex: column, endIndex: column + 1 },
      properties: { pixelSize },
      fields: 'pixelSize',
    },
  })

  return [
    ...existingChartIds.map((objectId) => ({ deleteEmbeddedObject: { objectId } })),
    // Highest index first, so each delete leaves the next one's index unchanged
    ...[...ownRuleIndexes].sort((x, y) => y - x).map((index) => ({ deleteConditionalFormatRule: { sheetId, index } })),

    format(0, 1, COLUMN.label, COLUMN.share + 1, { textFormat: { bold: true } }, 'userEnteredFormat.textFormat.bold'),
    format(0, 1, COLUMN.day, COLUMN.perDay + 1, { textFormat: { bold: true } }, 'userEnteredFormat.textFormat.bold'),
    format(1, 3, COLUMN.share, COLUMN.share + 1, { numberFormat: { type: 'PERCENT', pattern: '0%' } }, 'userEnteredFormat.numberFormat'),
    // The payments block: its own header row, and pesos in the Amount column
    format(7, 8, COLUMN.label, COLUMN.share + 1, { textFormat: { bold: true } }, 'userEnteredFormat.textFormat.bold'),
    format(8, 11, COLUMN.share, COLUMN.share + 1, { numberFormat: { type: 'CURRENCY', pattern: '"₱"#,##0' } }, 'userEnteredFormat.numberFormat'),
    // Head counts, not percentages: the layout before the Paid column had "Of batch" here
    format(1, 11, COLUMN.count, COLUMN.count + 1, { numberFormat: { type: 'NUMBER', pattern: '0' } }, 'userEnteredFormat.numberFormat'),
    format(1, LAST_ROW, COLUMN.day, COLUMN.day + 1, { numberFormat: { type: 'DATE', pattern: 'mmm d' } }, 'userEnteredFormat.numberFormat'),
    // The audit flag reads red whenever it is above zero
    {
      addConditionalFormatRule: {
        index: 0,
        rule: {
          ranges: [rangeOf(sheetId, 4, 5, COLUMN.count)],
          booleanRule: {
            condition: { type: 'NUMBER_GREATER', values: [{ userEnteredValue: '0' }] },
            format: { textFormat: { bold: true, foregroundColor: { red: 0.77, green: 0.13, blue: 0.12 } } },
          },
        },
      },
    },

    width(COLUMN.label - 1, 24), // the E gutter
    width(COLUMN.label, 210),
    width(COLUMN.count, 80),
    width(COLUMN.share, 80),
    width(COLUMN.day, 90),
    width(COLUMN.perDay, 90),

    {
      addChart: {
        chart: {
          spec: {
            title: 'Going, out of the whole batch',
            titleTextFormat: { bold: true, fontSize: 11 },
            fontName: 'Arial',
            pieChart: {
              legendPosition: 'LABELED_LEGEND',
              pieHole: 0.55,
              domain: { sourceRange: { sources: [rangeOf(sheetId, 1, 3, COLUMN.label)] } },
              series: { sourceRange: { sources: [rangeOf(sheetId, 1, 3, COLUMN.count)] } },
            },
          },
          position: at(sheetId, 0, COLUMN.chart, 420, 300),
        },
      },
    },
    {
      addChart: {
        chart: {
          spec: {
            title: 'New "Going" RSVPs per day',
            titleTextFormat: { bold: true, fontSize: 11 },
            fontName: 'Arial',
            basicChart: {
              chartType: 'COLUMN',
              legendPosition: 'NO_LEGEND',
              headerCount: 1,
              axis: [
                { position: 'BOTTOM_AXIS', title: 'Day' },
                { position: 'LEFT_AXIS', title: 'RSVPs' },
              ],
              domains: [{ domain: { sourceRange: { sources: [rangeOf(sheetId, 0, LAST_ROW, COLUMN.day)] } } }],
              series: [
                {
                  series: { sourceRange: { sources: [rangeOf(sheetId, 0, LAST_ROW, COLUMN.perDay)] } },
                  targetAxis: 'LEFT_AXIS',
                  colorStyle: { rgbColor: GREEN },
                },
              ],
            },
          },
          position: at(sheetId, 16, COLUMN.chart, 420, 280),
        },
      },
    },
  ]
}
