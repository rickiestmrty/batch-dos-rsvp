import { readRoster } from '../lib/rsvp.js'

/** Vercel serverless function: GET /api/roster -> { names, going } for the name picker. */
export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('allow', 'GET')
    return res.status(405).json({ ok: false, error: 'Method not allowed.' })
  }

  try {
    const roster = await readRoster()
    // Short edge cache: the list barely changes, but `going` should feel current.
    res.setHeader('cache-control', 'public, s-maxage=30, stale-while-revalidate=300')
    return res.status(200).json(roster)
  } catch (err) {
    console.error('[roster]', err)
    return res.status(502).json({ ok: false, error: 'Could not reach the spreadsheet.' })
  }
}
