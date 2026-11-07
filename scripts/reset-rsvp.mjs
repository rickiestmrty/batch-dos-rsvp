// Empty the reunion workbook's RSVP tab before the invite goes out: removes every
// response, keeps the header, and re-lays the tally and charts.
// Run with `pnpm reset-rsvp` to see what would go, `pnpm reset-rsvp --yes` to do it.
import { RSVP_TAB, resetRsvpTab } from '../lib/sheets.js'

if (!process.argv.includes('--yes')) {
  console.log(`This deletes every response on the ${RSVP_TAB} tab. Once the invite is out, those are real RSVPs.`)
  console.log('Re-run with --yes to go ahead:  pnpm reset-rsvp --yes')
  process.exit(1)
}

const removed = await resetRsvpTab()
console.log(`${RSVP_TAB} tab reset: removed ${removed.length} row(s); header, tally and charts are back.`)
for (const row of removed) console.log('  - ' + row.join(' | '))
