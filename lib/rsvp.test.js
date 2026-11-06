import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readRoster, recordRsvp } from './rsvp.js'
import { findMember, rankRoster } from '../names.js'

const ROSTER = ['Rondina, Wayne', 'Perez, Niña Marie Joana', 'Ygot, Kaye', 'Tumabini, Mary Kaye']

/** An in-memory workbook standing in for the Sheets API. */
function fakeSheets(rows = []) {
  return {
    rows,
    readAttendees: async () => ROSTER,
    readNamesWith: async (response) => rows.filter((r) => r.response === response).map((r) => r.name),
    appendRsvp: async (row) => { rows.push(row) },
  }
}

test('an accepted name on the list is stored under the list spelling', async () => {
  const sheets = fakeSheets()
  const res = await recordRsvp({ status: 'accepted', name: '  RONDINA,   wayne ' }, sheets)
  assert.equal(res.status, 200)
  assert.deepEqual(sheets.rows, [{ name: 'Rondina, Wayne', response: 'Going' }])
})

test('accents and the comma are optional', async () => {
  const sheets = fakeSheets()
  const res = await recordRsvp({ status: 'accepted', name: 'Perez Nina Marie Joana' }, sheets)
  assert.equal(res.status, 200)
  assert.equal(sheets.rows[0].name, 'Perez, Niña Marie Joana')
})

test('a name not on the list is refused and nothing is written', async () => {
  const sheets = fakeSheets()
  const res = await recordRsvp({ status: 'accepted', name: 'Someone Else' }, sheets)
  assert.equal(res.status, 422)
  assert.equal(res.body.code, 'not-on-list')
  assert.equal(sheets.rows.length, 0)
})

test('a partial name is not enough on its own', async () => {
  const res = await recordRsvp({ status: 'accepted', name: 'Wayne' }, fakeSheets())
  assert.equal(res.status, 422)
})

test('the same name twice says already responded and writes once', async () => {
  const sheets = fakeSheets()
  await recordRsvp({ status: 'accepted', name: 'Rondina, Wayne' }, sheets)
  const again = await recordRsvp({ status: 'accepted', name: 'rondina wayne' }, sheets)
  assert.equal(again.status, 409)
  assert.equal(again.body.code, 'already-responded')
  assert.equal(again.body.name, 'Rondina, Wayne')
  assert.equal(sheets.rows.length, 1)
})

test('an earlier "not sure yet" does not block accepting', async () => {
  const sheets = fakeSheets([{ name: '', response: 'Not sure yet' }])
  const res = await recordRsvp({ status: 'accepted', name: 'Ygot, Kaye' }, sheets)
  assert.equal(res.status, 200)
})

test('maybe needs no name and skips the list', async () => {
  const sheets = fakeSheets()
  const res = await recordRsvp({ status: 'maybe' }, sheets)
  assert.equal(res.status, 200)
  assert.deepEqual(sheets.rows, [{ name: '', response: 'Not sure yet' }])
})

test('a sheet outage is a 502, not a crash', async () => {
  const sheets = { ...fakeSheets(), readAttendees: async () => { throw new Error('down') } }
  const res = await recordRsvp({ status: 'accepted', name: 'Rondina, Wayne' }, sheets)
  assert.equal(res.status, 502)
})

test('search ranks by how the name starts and folds accents', () => {
  assert.deepEqual(rankRoster(ROSTER, 'kaye'), ['Tumabini, Mary Kaye', 'Ygot, Kaye'])
  assert.deepEqual(rankRoster(ROSTER, 'nina'), ['Perez, Niña Marie Joana'])
  assert.deepEqual(rankRoster(ROSTER, '   '), [])
  assert.equal(findMember(ROSTER, 'kaye ygot'), null) // order matters for an exact match
  assert.equal(findMember(ROSTER, 'ygot kaye'), 'Ygot, Kaye')
})

test('the roster marks who is already going, in list spelling', async () => {
  const sheets = fakeSheets([
    { name: 'Rondina, Wayne', response: 'Going' },
    { name: 'ygot,  kaye', response: 'Going' },
    { name: 'Wayne', response: 'Going' }, // free text from before the picker
    { name: '', response: 'Not sure yet' },
  ])
  assert.deepEqual(await readRoster(sheets), { names: ROSTER, going: ['Rondina, Wayne', 'Ygot, Kaye'] })
})
