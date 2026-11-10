import { exchangeCode, decodeIdToken } from '../../lib/google.js';
import { readCookies, setSession, clearTemp } from '../../lib/session.js';
import { betaAccess } from '../../lib/gate.js';

function back(res, qs) { res.statusCode = 302; res.setHeader('Location', `/work${qs}`); res.end(); }

export default async function handler(req, res) {
  const url = new URL(req.url, 'http://x');
  const { code, state, error } = Object.fromEntries(url.searchParams);
  clearTemp(res, 'gw_state');
  if (error) return back(res, '?error=denied');
  if (!code || !state || readCookies(req).gw_state !== state) return back(res, '?error=state');
  try {
    const tok = await exchangeCode(code, req);
    if (!tok.refresh_token) return back(res, '?error=norefresh');
    const id = decodeIdToken(tok.id_token);
    const granted = String(tok.scope || '');
    const access = await betaAccess(id.email);
    if (!access.ok) return back(res, '?error=beta');
    setSession(res, {
      rt: tok.refresh_token, email: id.email, name: id.given_name || id.name || '', picture: id.picture || '',
      gmail: granted.includes('gmail.readonly'), send: granted.includes('gmail.send'), calendar: granted.includes('calendar.events'),
      founderNo: access.founderNo, at: Date.now(),
    });
    back(res, '');
  } catch (e) {
    console.error('callback', e.message);
    back(res, '?error=exchange');
  }
}
