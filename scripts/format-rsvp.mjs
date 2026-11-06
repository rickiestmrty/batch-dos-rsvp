// Lay the tally and charts out on the reunion workbook's RSVP tab. Re-runnable.
// Run with `pnpm format-rsvp` (loads .env.local).
import { formatRsvpTab } from '../lib/sheets.js'

const result = await formatRsvpTab()
console.log(`RSVP tab formatted: ${result.charts} charts (replaced ${result.replacedCharts}).`)
