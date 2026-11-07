/**
 * The committee's audit layout for the RSVP tab: a live tally beside the responses,
 * and two charts — who's in out of the whole batch, and when the yeses came in.
 *
 * Same approach as batch-dos-reunion's Votes tab: the counts are formulas, not numbers
 * worked out here, so the tab stays right while RSVPs keep arriving. Apply (or re-apply)
 * with `pnpm format-rsvp`; it replaces its own cells and charts and touches nothing else.
 *
 * Responses own A:C and D is left empty, so the app's appends (range A:C) never see the
 * tally as part of the table.
 */
import { ATTENDEES_TAB } from './sheets.js'

/** The bottom of the ranges the formulas cover — far below any batch this size. */
const LAST_ROW = 1000

const NAMES = `B2:B${LAST_ROW}`
const RESPONSES = `C2:C${LAST_ROW}`

/** 0-indexed columns. */
const COLUMN = { label: 4, count: 5, share: 6, day: 8, perDay: 9, chart: 11 } // E F G · I J · L

/** E1:G6 — the tally. Row 2 and 3 are the pie: they always add up to the batch. */
export const TALLY = [
  ['RSVP summary', 'People', 'Of batch'],
  // COUNTUNIQUEIFS, not COUNTUNIQUE(FILTER(...)): with no "Going" rows FILTER returns
  // #N/A, which COUNTUNIQUE counts as one value, so an empty tab read Going 1, Duplicates -1.
  ['Going', `=COUNTUNIQUEIFS(${NAMES}, ${RESPONSES}, "Going")`, '=IF(F6, F2/F6, 0)'],
  ['No yes yet', '=MAX(0, F6 - F2)', '=IF(F6, F3/F6, 0)'],
  ['"Not sure yet" taps', `=COUNTIF(${RESPONSES}, "Not sure yet")`, ''],
  ['Duplicate "Going" rows', `=COUNTIF(${RESPONSES}, "Going") - F2`, ''],
  ['Batch size', `=COUNTA(${ATTENDEES_TAB}!A2:A)`, ''],
]

/** I1 — one row per day that had a new "Going", for the timeline chart. */
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

/** Is this conditional-format rule the duplicate-rows flag laid out below? */
export const isOwnRule = (rule) =>
  (rule.ranges ?? []).some((r) => (r.startRowIndex ?? 0) === 4 && (r.startColumnIndex ?? 0) === COLUMN.count)

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

    width(COLUMN.label, 190),
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
