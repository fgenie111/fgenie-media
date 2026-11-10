import { getSession, clearSession, sameOrigin, json } from '../../lib/session.js';

export default async function handler(req, res) {
  if (req.method !== 'POST' || !sameOrigin(req)) return json(res, 405, { error: 'POST from this site only' });
  const s = getSession(req);
  if (s?.rt) {
    // Revoke the grant at Google too, so disconnecting really disconnects.
    await fetch(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(s.rt)}`, { method: 'POST' }).catch(() => {});
  }
  clearSession(res);
  json(res, 200, { ok: true });
}
