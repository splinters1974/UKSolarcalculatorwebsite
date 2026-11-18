// Installed cost for the calculator, priced on the server.
//
// The pricing data is not in this repository or in the page. It is read from
// the PRICING_CONFIG environment variable, set in the Netlify dashboard, so the
// only thing a visitor ever receives is the final rounded price.
//
// PRICING_CONFIG is JSON:
//   upper        size band limits in kWp, ascending
//   rates        { mount: [£/kWp for each band, one more than upper] }
//   fixed        £ per project, before contingency
//   management   £ per project, after contingency
//   contingency  share of rates and fixed costs
//   margin       share of the sale price
//   uplift       share added to the sale price for the public figure
//   roundTo      £ to round the public figure to

const MAX_ITEMS = 20;
const MAX_KWP = 20000;

function loadConfig() {
  try {
    const c = JSON.parse(process.env.PRICING_CONFIG || '');
    const ok = Array.isArray(c.upper) && c.rates && typeof c.rates === 'object'
      && Object.values(c.rates).every(r => Array.isArray(r) && r.length === c.upper.length + 1);
    return ok ? c : null;
  } catch {
    return null;
  }
}

function bandOf(kwp, upper) {
  for (let i = 0; i < upper.length; i++) if (kwp < upper[i]) return i;
  return upper.length;
}

// Price for the given mix of mounts at total size `kwp`, using band `band`.
function priceAt(cfg, shares, kwp, band) {
  let direct = 0;
  for (const [mount, share] of shares) direct += kwp * share * cfg.rates[mount][band];
  const cost = (direct + cfg.fixed) * (1 + cfg.contingency) + cfg.management;
  return cost / (1 - cfg.margin) * (1 + cfg.uplift);
}

export function quote(cfg, items) {
  const total = items.reduce((s, it) => s + it.kwp, 0);
  if (!(total > 0)) return null;
  const shares = items.map(it => [it.mount, it.kwp / total]);
  const band = bandOf(total, cfg.upper);
  let price = priceAt(cfg, shares, total, band);
  // Rates fall at each band limit, so a system just over a limit would cost
  // less than one just under it. Never let a larger system cost less.
  for (let b = band - 1; b >= 0; b--) {
    price = Math.max(price, priceAt(cfg, shares, cfg.upper[b] - 0.001, b));
  }
  const step = cfg.roundTo || 1;
  return Math.round(price / step) * step;
}

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}

export default async (req) => {
  if (req.method !== 'POST') return json({ error: 'method not allowed' }, 405);
  const cfg = loadConfig();
  if (!cfg) return json({ error: 'pricing unavailable' }, 503);

  let body;
  try { body = await req.json(); } catch { return json({ error: 'bad request' }, 400); }
  const raw = Array.isArray(body && body.items) ? body.items : [];
  if (!raw.length || raw.length > MAX_ITEMS) return json({ error: 'bad request' }, 400);

  const items = [];
  for (const it of raw) {
    const kwp = Number(it && it.kwp);
    const mount = String(it && it.mount);
    if (!Object.hasOwn(cfg.rates, mount) || !(kwp > 0) || kwp > MAX_KWP) return json({ error: 'bad request' }, 400);
    items.push({ mount, kwp });
  }
  const total = quote(cfg, items);
  return total === null ? json({ error: 'bad request' }, 400) : json({ total });
};

export const config = { path: '/api/install-cost' };
