import { test } from 'node:test'
import assert from 'node:assert/strict'
import { TALLY, TALLY_RANGE, PRICE_PHP, layoutRequests, isOwnRule } from './rsvp-sheet.js'
import { appendedRow } from './sheets.js'

test('the pie rows always add up to the batch, and Going counts each name once', () => {
  const [, going, rest, , dupes, batch] = TALLY
  assert.match(going[1], /^=COUNTUNIQUEIFS\(B2:B\d+, C2:C\d+, "Going"\)$/)
  assert.equal(rest[1], '=MAX(0, G6 - G2)')
  assert.match(dupes[1], /COUNTIF\(C2:C\d+, "Going"\) - G2/)
  assert.equal(batch[1], '=COUNTA(Attendees!A2:A)')
})

test('re-running replaces its own charts and rule, highest rule index first', () => {
  const requests = layoutRequests(9, [11, 22], [1, 4])
  assert.deepEqual(requests.slice(0, 4), [
    { deleteEmbeddedObject: { objectId: 11 } },
    { deleteEmbeddedObject: { objectId: 22 } },
    { deleteConditionalFormatRule: { sheetId: 9, index: 4 } },
    { deleteConditionalFormatRule: { sheetId: 9, index: 1 } },
  ])
  assert.equal(requests.filter((r) => r.addChart).length, 2)
  assert.equal(requests.filter((r) => r.addConditionalFormatRule).length, 1)
})

test('nothing is laid out over the responses and Paid column in A:D', () => {
  const touched = layoutRequests(9).flatMap((r) => {
    const range = r.repeatCell?.range ?? r.addConditionalFormatRule?.rule.ranges[0]
    const anchor = r.addChart?.chart.position.overlayPosition.anchorCell
    return range ? [range.startColumnIndex] : anchor ? [anchor.columnIndex] : []
  })
  assert.ok(touched.length > 0)
  assert.ok(touched.every((column) => column >= 5), `columns: ${touched}`)
})

test('only the duplicate-rows flag counts as our own rule', () => {
  assert.equal(isOwnRule({ ranges: [{ startRowIndex: 4, startColumnIndex: 6 }] }), true)
  assert.equal(isOwnRule({ ranges: [{ startRowIndex: 4, startColumnIndex: 5 }] }), true) // the pre-Paid layout's
  assert.equal(isOwnRule({ ranges: [{ startRowIndex: 1, startColumnIndex: 2 }] }), false)
})

test('the payments block counts only Going rows with Paid ticked, at the contribution each', () => {
  const [paid, owing, total] = TALLY.slice(8)
  assert.equal(PRICE_PHP, 1250)
  assert.match(paid[1], /^=COUNTIFS\(C2:C\d+, "Going", D2:D\d+, TRUE\)$/)
  assert.equal(paid[2], '=G9 * 1250')
  assert.equal(owing[1], '=MAX(0, G2 - G9)')
  assert.equal(total[1], '=G2')
  assert.equal(TALLY_RANGE, `F1:H${TALLY.length}`)
  assert.ok(TALLY.every((row) => row.length === 3))
})

test('the row an append landed on is read from its updatedRange', () => {
  assert.equal(appendedRow('RSVP!A7:D7'), 7)
  assert.equal(appendedRow("'RSVP'!A12:C12"), 12)
})
