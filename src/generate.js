// Synthetic settlement claims. Every claim carries a hidden `truth` label so we can
// measure the detector honestly (precision / recall). No real people or real cases.

let seed = 42;
function rand() {
  // mulberry32 — deterministic so the demo is repeatable
  seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
const pick = (a) => a[Math.floor(rand() * a.length)];
const int = (lo, hi) => lo + Math.floor(rand() * (hi - lo + 1));

const FIRST = ['Maria','James','Aisha','Daniel','Priya','Kevin','Lena','Marcus','Sofia','Tyrone','Emily','Hector','Grace','Omar','Hannah','Luis','Chloe','Andre','Nina','Peter','Rosa','Sam','Keisha','Victor','Ruth','Ethan','Mei','Carlos','Dana','Isaac'];
const LAST = ['Garcia','Nguyen','Johnson','Okafor','Patel','Brooks','Kim','Rivera','Schmidt','Lopez','Walker','Haddad','Chen','Murphy','Silva','Turner','Adams','Reyes','Price','Novak','Diaz','Bell','Ortiz','Fischer','Hall'];
const STATES = [['OH','43'],['TX','75'],['CA','90'],['NY','10'],['FL','33'],['IL','60'],['WA','98'],['GA','30'],['PA','19'],['AZ','85']];
const STREETS = ['Maple Ave','Oak St','Pine Rd','Cedar Ln','Elm St','Lake Dr','Hill St','Park Ave','River Rd','2nd St'];
const STORES = ['a drugstore','Target','a grocery store','Walmart','an online shop','CVS','a beauty supply store'];

// Real claimants write in their own words — varied, specific, sometimes messy.
const REAL_STORIES = [
  (s) => `Bought it at ${s} for my daughter, she broke out after a week so we stopped.`,
  (s) => `I used the serum maybe a month. Picked it up at ${s} because it said "clinically proven".`,
  (s) => `Got two bottles from ${s} around spring, didn't do anything for my skin honestly`,
  (s) => `My wife and I both used it. Purchased at ${s}. Receipt is long gone sorry.`,
  (s) => `I remember buying it at ${s} when it was on sale. Used it every night.`,
  (s) => `Bought once from ${s}. Caused redness so I threw it out.`,
  (s) => `purchased at ${s}, used for a few weeks, no difference. saw the ad for this settlement on facebook`,
  (s) => `I bought it as a gift for my mom at ${s}. She used it for about two months.`,
];

// Bot rings reuse one template with light word swaps.
const BOT_TEMPLATE = ['I purchased','I bought','I acquired'];
const BOT_TAIL = ['the product and was misled by the label claims.','the product and was deceived by the labeling claims.','the item and was misled by the product label claims.'];

// AI-agent bulk filer: fluent, varied paraphrases that all follow the same structure.
const AGENT_STORIES = [
  (s) => `I purchased the SnapGlow serum at ${s} relying on its clinical claims, and the product did not deliver the advertised results.`,
  (s) => `After buying SnapGlow at ${s} based on its "clinically proven" marketing, I found it did not provide the promised benefits.`,
  (s) => `I relied on the advertised clinical results when I bought SnapGlow from ${s}; the product failed to perform as represented.`,
  (s) => `Based on the product's clinical claims, I purchased SnapGlow at ${s}, and it did not achieve the results described on the label.`,
];

function realPerson(i) {
  const f = pick(FIRST), l = pick(LAST);
  const [st, zip] = pick(STATES);
  return {
    name: `${f} ${l}`,
    email: `${f}.${l}${int(1, 99)}@${pick(['gmail.com','yahoo.com','outlook.com','icloud.com','aol.com'])}`.toLowerCase(),
    address: `${int(10, 9999)} ${pick(STREETS)}`,
    state: st, zip: `${zip}${String(int(100, 999))}`,
    ip: `${int(24, 220)}.${int(0, 255)}.${int(0, 255)}.${int(1, 254)}`,
    device: `dv-${(i * 7919 + int(0, 99999)).toString(36)}`,
  };
}

export function generateClaims({ total = 10000, real = 1200 } = {}) {
  seed = 42;
  const claims = [];
  const start = Date.parse('2026-09-01T00:00:00Z');
  const span = 60 * 24 * 3600 * 1000; // 60-day claim window
  let n = 0;
  const id = () => `CL-${String(++n).padStart(5, '0')}`;

  // 1) Real claimants
  for (let i = 0; i < real; i++) {
    const p = realPerson(i);
    claims.push({
      id: id(), ...p, filedAt: new Date(start + rand() * span).toISOString(),
      units: int(1, 2), proof: rand() < 0.35, filer: 'self',
      narrative: pick(REAL_STORIES)(pick(STORES)), truth: 'real',
    });
  }
  // A few real households share an IP (roommates, families) — the honest hard case.
  for (let i = 0; i < 40; i++) {
    const a = claims[int(0, real - 1)], b = claims[int(0, real - 1)];
    b.ip = a.ip; b.address = a.address; b.zip = a.zip; b.state = a.state;
  }

  // A campus email blast: ~35 real students file from one university network in one evening.
  const dorm = `${int(128, 160)}.${int(0, 255)}.${int(0, 255)}`;
  const blast = start + rand() * span;
  for (let i = 0; i < 35; i++) {
    const c = claims[i * 3];
    c.ip = `${dorm}.${int(1, 254)}`; c.filedAt = new Date(blast + i * int(20, 50) * 1000).toISOString();
    c.email = c.email.split('@')[0] + '@state.edu';
  }
  // Many honest people write the same short thing.
  for (let i = 0; i < 60; i++) claims[int(0, real - 1)].narrative = 'Bought it, used it, it did not work.';
  // Some families bought in bulk and kept no receipt.
  for (let i = 0; i < 20; i++) { const c = claims[int(0, real - 1)]; c.units = int(4, 6); c.proof = false; }

  const fraudTotal = total - real;
  const agentCount = Math.round(fraudTotal * 0.30);   // AI-agent bulk filer
  const dupCount = Math.round(fraudTotal * 0.08);     // same person, many claims
  const subtleCount = Math.round(fraudTotal * 0.03);  // hand-made fakes that look real
  const proxyCount = Math.round(fraudTotal * 0.04);   // ring hiding behind residential proxies
  const ringCount = fraudTotal - agentCount - dupCount - subtleCount - proxyCount;

  // Proxy ring: unique IPs and devices, normal-looking emails, but the same script.
  for (let k = 0; k < proxyCount; k++) {
    const p = realPerson(7000 + k);
    claims.push({
      id: id(), ...p, filedAt: new Date(start + rand() * span).toISOString(),
      units: int(3, 6), proof: false, filer: 'self',
      narrative: `${pick(BOT_TEMPLATE)} ${pick(BOT_TAIL)}`, truth: 'proxy_ring',
    });
  }

  // 2) Bot rings: 6 rings, each on one /24 subnet, shared devices, bursty, sequential emails
  const rings = 6;
  for (let r = 0; r < rings; r++) {
    const subnet = `${int(100, 200)}.${int(0, 255)}.${int(0, 255)}`;
    const ringStart = start + rand() * span;
    const base = pick(['jsmith','user','claimant','mike.r','anna.k','dealz']);
    const size = Math.floor(ringCount / rings) + (r < ringCount % rings ? 1 : 0);
    for (let k = 0; k < size; k++) {
      const [st] = pick(STATES);
      claims.push({
        id: id(), name: `${pick(FIRST)} ${pick(LAST)}`,
        email: `${base}${1000 + k}@${pick(['mailinator.com','tempmail.dev','gmail.com'])}`,
        address: `${int(10, 9999)} ${pick(STREETS)}`, state: st, zip: `${int(10000, 99999)}`,
        ip: `${subnet}.${int(1, 254)}`, device: `ring${r}-dev${k % 12}`,
        filedAt: new Date(ringStart + k * int(800, 4000)).toISOString(),
        units: int(4, 10), proof: false, filer: 'self',
        narrative: `${pick(BOT_TEMPLATE)} ${pick(BOT_TAIL)}`, truth: 'bot_ring', ring: r,
      });
    }
  }

  // 3) AI-agent bulk filer (third-party service filing on "behalf" of thousands)
  for (let k = 0; k < agentCount; k++) {
    const p = realPerson(5000 + k);
    claims.push({
      id: id(), ...p, ip: `34.${int(64, 127)}.${int(0, 255)}.${int(1, 254)}`, // cloud range
      filedAt: new Date(start + rand() * span).toISOString(),
      units: int(3, 6), proof: false, filer: 'ClaimRunner AI (agent)',
      narrative: pick(AGENT_STORIES)(pick(STORES)), truth: 'ai_agent',
    });
  }

  // 4) Duplicates: one person files many times with tiny name/email changes
  for (let k = 0; k < dupCount; k++) {
    const who = k % 30;
    const f = FIRST[who % FIRST.length], l = LAST[who % LAST.length];
    claims.push({
      id: id(), name: k % 2 ? `${f} ${l}` : `${f[0]}. ${l}`,
      email: `${f}${l}+${k}@gmail.com`.toLowerCase(), address: `${100 + who} ${STREETS[who % 10]}`,
      state: STATES[who % 10][0], zip: `${STATES[who % 10][1]}${100 + who}`,
      ip: `${int(24, 220)}.${int(0, 255)}.${int(0, 255)}.${int(1, 254)}`, device: `dup-${who}`,
      filedAt: new Date(start + rand() * span).toISOString(), units: int(2, 4), proof: false,
      filer: 'self', narrative: pick(REAL_STORIES)(pick(STORES)), truth: 'duplicate',
    });
  }

  // 5) Subtle fakes: individually crafted, no shared signals. The detector should miss some.
  for (let k = 0; k < subtleCount; k++) {
    const p = realPerson(9000 + k);
    claims.push({
      id: id(), ...p, filedAt: new Date(start + rand() * span).toISOString(),
      units: int(2, 3), proof: false, filer: 'self',
      narrative: pick(REAL_STORIES)(pick(STORES)), truth: 'subtle_fake',
    });
  }

  // shuffle so the grid is not pre-sorted by truth
  for (let i = claims.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [claims[i], claims[j]] = [claims[j], claims[i]];
  }
  return claims;
}
