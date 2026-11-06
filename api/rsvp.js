import { recordRsvp } from '../lib/rsvp.js'

/** Vercel serverless function: POST /api/rsvp  { status: 'accepted' | 'maybe', name? } */
export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('allow', 'POST')
    return res.status(405).json({ ok: false, error: 'Method not allowed.' })
  }

  let body = req.body
  if (typeof body === 'string') {
    try {
      body = JSON.parse(body)
    } catch {
      return res.status(400).json({ ok: false, error: 'Body must be JSON.' })
    }
  }

  const result = await recordRsvp(body)
  return res.status(result.status).json(result.body)
}
