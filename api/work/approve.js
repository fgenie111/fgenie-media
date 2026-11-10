// The only route that acts. It runs only when the founder taps Approve on the page.
import { getSession, json, sameOrigin, readBody } from '../../lib/session.js';
import { accessToken, sendReply, createHold } from '../../lib/google.js';

export default async function handler(req, res) {
  if (req.method !== 'POST' || !sameOrigin(req)) return json(res, 405, { error: 'POST from this site only' });
  const s = getSession(req);
  if (!s) return json(res, 401, { error: 'signin' });
  let b;
  try { b = await readBody(req); } catch { return json(res, 400, { error: 'bad_body' }); }

  try {
    const token = await accessToken(s);
    if (b.kind === 'reply') {
      if (!s.send) return json(res, 403, { error: 'no_send_permission' });
      const body = String(b.body || '').trim();
      if (!body || body.length > 20000 || !b.to || !b.threadId) return json(res, 400, { error: 'bad_reply' });
      const sent = await sendReply(token, { from: s.email, to: b.to, subject: b.subject || '', body, threadId: b.threadId, inReplyTo: b.inReplyTo, references: b.references });
      return json(res, 200, { ok: true, receipt: { kind: 'reply', at: new Date().toISOString(), to: b.to, subject: b.subject, gmailId: sent.id, threadId: sent.threadId } });
    }
    if (b.kind === 'hold') {
      if (!s.calendar) return json(res, 403, { error: 'no_calendar_permission' });
      const st = Date.parse(b.start), en = Date.parse(b.end);
      if (!(st < en) || en - st > 4 * 3600e3 || st < Date.now() - 3600e3 || st > Date.now() + 14 * 864e5) return json(res, 400, { error: 'bad_hold' });
      const title = String(b.title || 'Hold').slice(0, 200);
      const ev = await createHold(token, { title, start: new Date(st).toISOString(), end: new Date(en).toISOString(), zone: b.zone || 'UTC' });
      return json(res, 200, { ok: true, receipt: { kind: 'hold', at: new Date().toISOString(), title, start: ev.start?.dateTime, end: ev.end?.dateTime, eventId: ev.id, link: ev.htmlLink } });
    }
    json(res, 400, { error: 'unknown_kind' });
  } catch (e) {
    console.error('approve', e.message);
    if (e.status === 401) return json(res, 401, { error: 'signin' });
    json(res, 502, { error: 'google_failed', detail: e.message });
  }
}
