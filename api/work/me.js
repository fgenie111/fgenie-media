import { getSession, json } from '../../lib/session.js';
import { configured } from '../../lib/google.js';

export default function handler(req, res) {
  const ready = configured() && Boolean(process.env.ANTHROPIC_API_KEY);
  const s = configured() ? getSession(req) : null;
  if (!s) return json(res, 200, { signedIn: false, ready });
  json(res, 200, {
    signedIn: true, ready, email: s.email, name: s.name, picture: s.picture, founderNo: s.founderNo,
    access: { gmail: s.gmail, send: s.send, calendar: s.calendar },
  });
}
