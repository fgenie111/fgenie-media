import { getSession, json } from '../../lib/session.js';
import { accessToken, todaysEvents, threadsNeedingReply, freeBusy } from '../../lib/google.js';
import { buildBrief, freeSlots } from '../../lib/genie.js';

export const config = { maxDuration: 60 };

export default async function handler(req, res) {
  const s = getSession(req);
  if (!s) return json(res, 401, { error: 'signin' });
  try {
    const token = await accessToken(s);
    const tz = new URL(req.url, 'http://x').searchParams.get('tz') || undefined;
    const cal = s.calendar ? await todaysEvents(token, validTz(tz)) : { zone: validTz(tz) || 'UTC', events: [], dayStart: new Date().toISOString() };
    const threads = s.gmail ? await threadsNeedingReply(token, s.email) : [];
    const busy = s.calendar ? await freeBusy(token, cal.dayStart, cal.dayEnd) : [];
    const free = freeSlots(busy, cal.dayStart, cal.zone);
    const brief = await buildBrief({ name: s.name, email: s.email, zone: cal.zone, events: cal.events, threads, free });

    // Join Genie's notes back onto the real data, dropping anything that doesn't match.
    const byThread = new Map(threads.map(t => [t.threadId, t]));
    const byEvent = new Map(cal.events.map(e => [e.id, e]));
    const replies = brief.replies.filter(r => byThread.has(r.threadId) && r.needsReply).map(r => {
      const t = byThread.get(r.threadId);
      return { threadId: t.threadId, from: t.from, to: t.replyTo, subject: t.subject, snippet: t.snippet, inReplyTo: t.messageId, references: t.references, why: r.why, draft: r.draft };
    });
    const notes = Object.fromEntries(brief.meetings.filter(m => byEvent.has(m.eventId)).map(m => [m.eventId, m.note]));
    const holds = brief.holds.filter(h => insideFree(h, free)).slice(0, 2);

    json(res, 200, {
      generatedAt: new Date().toISOString(), zone: cal.zone,
      headline: brief.headline, moved: brief.moved,
      meetings: cal.events.map(e => ({ ...e, note: notes[e.id] || '' })),
      replies, holds,
      counts: { threadsRead: threads.length, needReply: replies.length },
    });
  } catch (e) {
    console.error('brief', e.message);
    if (e.status === 401) return json(res, 401, { error: 'signin' });
    json(res, 500, { error: 'brief_failed', detail: e.message });
  }
}

function validTz(tz) {
  if (!tz) return undefined;
  try { new Intl.DateTimeFormat('en-US', { timeZone: tz }); return tz; } catch { return undefined; }
}

function insideFree(h, free) {
  const s = Date.parse(h.start), e = Date.parse(h.end);
  if (!(s < e)) return false;
  return free.some(f => s >= Date.parse(f.start) - 60e3 && e <= Date.parse(f.end) + 60e3);
}
