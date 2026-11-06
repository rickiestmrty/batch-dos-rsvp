import { test } from 'node:test'
import assert from 'node:assert/strict'
import { TALLY, layoutRequests, isOwnRule } from './rsvp-sheet.js'

test('the pie rows always add up to the batch, and Going counts each name once', () => {
  const [, going, rest, , dupes, batch] = TALLY
  assert.match(going[1], /COUNTUNIQUE\(FILTER\(B2:B\d+, C2:C\d+="Going"\)\)/)
  assert.equal(rest[1], '=MAX(0, F6 - F2)')
  assert.match(dupes[1], /COUNTIF\(C2:C\d+, "Going"\) - F2/)
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

test('nothing is laid out over the responses in A:C or the D gutter', () => {
  const touched = layoutRequests(9).flatMap((r) => {
    const range = r.repeatCell?.range ?? r.addConditionalFormatRule?.rule.ranges[0]
    const anchor = r.addChart?.chart.position.overlayPosition.anchorCell
    return range ? [range.startColumnIndex] : anchor ? [anchor.columnIndex] : []
  })
  assert.ok(touched.length > 0)
  assert.ok(touched.every((column) => column >= 4), `columns: ${touched}`)
})

test('only the duplicate-rows flag counts as our own rule', () => {
  assert.equal(isOwnRule({ ranges: [{ startRowIndex: 4, startColumnIndex: 5 }] }), true)
  assert.equal(isOwnRule({ ranges: [{ startRowIndex: 1, startColumnIndex: 2 }] }), false)
})
