// Build drops: Genie Cube build updates FG has approved, newest first.
// Shape is shared with the founder page (/founder) — keep it stable:
//   { drops: [{ id, n, date, title, body, status, chain: { network, status, tx } }] }
import fs from 'node:fs/promises';
import path from 'node:path';

export default async function handler(req, res) {
  const raw = JSON.parse(await fs.readFile(path.join(process.cwd(), 'drops.json'), 'utf8'));
  const drops = raw.drops.filter(d => d.status === 'approved').sort((a, b) => b.n - a.n);
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'public, max-age=60');
  res.end(JSON.stringify({ drops }));
}
