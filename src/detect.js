// Signal-based claim review. Each signal produces a plain-English reason a claimant
// or a judge can read. The detector never denies a claim on its own: it only sorts
// claims into "clear", "needs review" and "held", and a person decides.

const STOP = new Set('i the a an and was it at my for to of on in so after based its did not from this that with be by as is'.split(' '));
const SYN = { bought: 'buy', purchased: 'buy', acquired: 'buy', buying: 'buy', misled: 'mislead', deceived: 'mislead', item: 'product', labeling: 'label' };
const DISPOSABLE = new Set(['mailinator.com', 'tempmail.dev']);

function skeleton(text) {
  return text.toLowerCase().replace(/[^a-z\s]/g, ' ').split(/\s+/)
    .filter((w) => w && !STOP.has(w)).map((w) => SYN[w] || w).sort().join(' ');
}
const count = (map, k) => map.set(k, (map.get(k) || 0) + 1);

export const SIGNALS = {
  subnet: { weight: 30, label: 'Shared network' },
  device: { weight: 30, label: 'Reused device' },
  burst: { weight: 15, label: 'Filing burst' },
  email: { weight: 15, label: 'Throwaway or sequential email' },
  template: { weight: 25, label: 'Copy-paste story' },
  agent: { weight: 35, label: 'Filed by an automated agent' },
  identity: { weight: 40, label: 'Same person, many claims' },
  units: { weight: 10, label: 'Unusual quantity without proof' },
};

export function review(claims) {
  const subnet = new Map(), device = new Map(), skel = new Map(), filer = new Map(), person = new Map(), subnetTimes = new Map();
  for (const c of claims) {
    const sn = c.ip.split('.').slice(0, 3).join('.');
    c._sn = sn; c._skel = skeleton(c.narrative);
    c._person = `${c.name.split(' ').pop().toLowerCase()}|${c.address.toLowerCase()}|${c.zip}`;
    count(subnet, sn); count(device, c.device); count(skel, c._skel); count(filer, c.filer); count(person, c._person);
    if (!subnetTimes.has(sn)) subnetTimes.set(sn, []);
    subnetTimes.get(sn).push(Date.parse(c.filedAt));
  }
  for (const t of subnetTimes.values()) t.sort((a, b) => a - b);

  for (const c of claims) {
    const hits = [];
    const sn = subnet.get(c._sn);
    if (sn >= 8) hits.push(['subnet', `${sn} claims came from the same internet network (${c._sn}.x). Households rarely file more than two or three.`]);
    const dv = device.get(c.device);
    if (dv >= 4) hits.push(['device', `The same device was used to file ${dv} separate claims.`]);
    if (sn >= 8) {
      const times = subnetTimes.get(c._sn), t = Date.parse(c.filedAt);
      const near = times.filter((x) => Math.abs(x - t) < 10 * 60 * 1000).length;
      if (near >= 10) hits.push(['burst', `${near} claims from this network were filed within 10 minutes of this one.`]);
    }
    const domain = c.email.split('@')[1];
    if (DISPOSABLE.has(domain) || /\d{4}@/.test(c.email)) hits.push(['email', `The email address looks machine-made (${DISPOSABLE.has(domain) ? 'a throwaway inbox' : 'a numbered series'}).`]);
    const sk = skel.get(c._skel);
    if (sk >= 40) hits.push(['template', `The written description matches ${sk} other claims almost word for word.`]);
    if (c.filer !== 'self' && filer.get(c.filer) >= 50) hits.push(['agent', `Submitted by "${c.filer}", which filed ${filer.get(c.filer).toLocaleString()} claims. Each needs the class member's own confirmation.`]);
    const pc = person.get(c._person);
    if (pc >= 3) hits.push(['identity', `This name and address appear on ${pc} claims. Each class member can be paid once.`]);
    if (c.units >= 4 && !c.proof) hits.push(['units', `Claims ${c.units} units with no proof of purchase; most buyers report 1 or 2.`]);

    const score = Math.min(100, hits.reduce((s, [k]) => s + SIGNALS[k].weight, 0));
    c.score = score;
    c.signals = hits.map(([k]) => k);
    c.reasons = hits.map(([, r]) => r);
    c.status = score >= 60 ? 'held' : score >= 30 ? 'review' : 'clear';
    c.decision = c.decision || null; // human decision: 'approve' | 'reject' | null
    delete c._sn; delete c._skel; delete c._person;
  }
  return claims;
}

// Honest scoreboard against the hidden labels. "Positive" = predicted fraud (held).
export function metrics(claims) {
  let tp = 0, fp = 0, fn = 0, tn = 0, review = 0;
  const missedBy = {};
  for (const c of claims) {
    const fraud = c.truth !== 'real';
    if (c.status === 'review') { review++; continue; }
    const flagged = c.status === 'held';
    if (flagged && fraud) tp++; else if (flagged) fp++; else if (fraud) { fn++; missedBy[c.truth] = (missedBy[c.truth] || 0) + 1; } else tn++;
  }
  const precision = tp / Math.max(1, tp + fp), recall = tp / Math.max(1, tp + fn);
  return { tp, fp, fn, tn, review, precision, recall, missedBy };
}
