// Who gets into the Genie Work private beta. Gmail is a restricted Google scope, so the app
// is capped at 100 test users until Google verifies it.
// Order of checks:
//   1. GENIE_WORK_ALLOWLIST (comma-separated emails), if set.
//   2. Supabase founders table (founder_no <= 100), if SUPABASE_URL + SUPABASE_SERVICE_KEY are set.
//   3. Otherwise open (preview / FG testing only).
export async function betaAccess(email) {
  const e = String(email || '').toLowerCase();
  const allow = (process.env.GENIE_WORK_ALLOWLIST || '').split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
  if (allow.length) return { ok: allow.includes(e), founderNo: null, via: 'allowlist' };

  if (process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_KEY) {
    const url = `${process.env.SUPABASE_URL}/rest/v1/founders?select=founder_no,tier&email=eq.${encodeURIComponent(e)}`;
    const r = await fetch(url, { headers: { apikey: process.env.SUPABASE_SERVICE_KEY, Authorization: `Bearer ${process.env.SUPABASE_SERVICE_KEY}` } });
    if (!r.ok) return { ok: false, founderNo: null, via: 'founders', error: `founders lookup ${r.status}` };
    const row = (await r.json())[0];
    const cap = Number(process.env.GENIE_WORK_BETA_CAP || 100);
    return { ok: Boolean(row && row.founder_no <= cap), founderNo: row?.founder_no ?? null, tier: row?.tier ?? null, via: 'founders' };
  }
  return { ok: true, founderNo: null, via: 'open' };
}
