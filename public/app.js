const $ = (s) => document.querySelector(s);
const money = (n) => '$' + Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const api = async (url, opts = {}) => {
  const r = await fetch(url, { headers: { 'Content-Type': 'application/json' }, ...opts });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw Object.assign(new Error(j.error || r.statusText), j);
  return j;
};

let summary, grid, filter = 'review', firstPaint = true;

// ---- Summary + the check ------------------------------------------------
async function loadSummary() {
  summary = await api('/api/summary');
  const s = summary;
  $('#caseName').textContent = s.settlement.name;
  $('#docket').textContent = s.settlement.docket;
  $('#modePaypal').textContent = `PayPal: ${s.modes.paypal}`;
  $('#modeAi').textContent = `AI: ${s.modes.ai}`;
  $('#fund').textContent = money(s.settlement.fund).replace('.00', '');
  $('#filed').textContent = s.total.toLocaleString();
  $('#eligible').textContent = s.payable.toLocaleString();
  $('#held').textContent = (s.counts.held + s.counts.review).toLocaleString();
  $('#paid').textContent = s.counts.paid.toLocaleString();
  $('#was').textContent = money(s.shareIfPaidToAll);
  ['review', 'held', 'clear'].forEach((k) => ($('#c-' + k).textContent = s.counts[k].toLocaleString()));
  setAmount(s.shareAfterReview);
  renderBatches(); renderActivity(); renderAccuracy();
  const toPay = s.payable - (s.batches.reduce((n, b) => n + b.sent, 0));
  $('#payInfo').innerHTML = `<b>${s.payable.toLocaleString()}</b> class members are eligible for <b>${money(s.shareAfterReview)}</b> each. In this sandbox demo, the first ${s.modes.demoPayoutLimit} payments of each batch are sent to PayPal.`;
  $('#confirm').placeholder = `Type PAY ${Math.max(0, toPay)} to confirm`;
}

// The one animated moment: the per-person amount climbs from "paid to everyone" to "paid to real people".
function setAmount(target) {
  const el = $('#now');
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (!firstPaint || reduce) { el.textContent = money(target); return; }
  firstPaint = false;
  const from = summary.shareIfPaidToAll, t0 = performance.now(), dur = 1600;
  const step = (t) => {
    const p = Math.min(1, (t - t0) / dur), e = 1 - Math.pow(1 - p, 3);
    el.textContent = money(from + (target - from) * e);
    if (p < 1) requestAnimationFrame(step);
  };
  setTimeout(() => requestAnimationFrame(step), 500);
}

// ---- Review queue (AG Grid) ---------------------------------------------
const statusCell = (p) => `<span class="status ${p.value}">${{ clear: 'Cleared', review: 'Needs a person', held: 'Held' }[p.value]}</span>`;
const decisionCell = (p) => (p.value ? `<span class="status ${p.value}">${p.value === 'approve' ? 'Approved' : 'Rejected'}</span>` : '');

function makeGrid() {
  grid = agGrid.createGrid($('#grid'), {
    columnDefs: [
      { field: 'id', headerName: 'Claim', width: 105 },
      { field: 'name', headerName: 'Claimant', flex: 1, minWidth: 140 },
      { field: 'status', headerName: 'Review', width: 165, cellRenderer: statusCell },
      { field: 'score', headerName: 'Risk', width: 95, sort: 'desc' },
      { field: 'signals', headerName: 'Why', flex: 2, minWidth: 200, valueFormatter: (p) => (p.value || []).map((k) => summary.signals[k].label).join(', ') },
      { field: 'filer', headerName: 'Filed by', width: 170 },
      { field: 'decision', headerName: 'Decision', width: 110, cellRenderer: decisionCell },
    ],
    defaultColDef: { sortable: true, filter: true, resizable: true },
    rowSelection: { mode: 'singleRow', checkboxes: false, enableClickSelection: true },
    getRowId: (p) => p.data.id,
    onRowClicked: (e) => showDetail(e.data.id),
    pagination: true, paginationPageSize: 50,
  });
  loadRows();
}
async function loadRows() {
  const rows = await api('/api/claims' + (filter ? `?status=${filter}` : ''));
  grid.setGridOption('rowData', rows);
}
document.querySelectorAll('.chip').forEach((b) => b.addEventListener('click', () => {
  document.querySelectorAll('.chip').forEach((x) => x.setAttribute('aria-pressed', x === b));
  filter = b.dataset.f; loadRows();
}));

async function showDetail(id) {
  const c = await api('/api/claims/' + id);
  const op = c.opinion;
  $('#detail').innerHTML = `
    <h3>${esc(c.id)} · ${esc(c.name)}</h3>
    <div class="who">${esc(c.state)} · ${c.units} unit${c.units > 1 ? 's' : ''} · ${c.proof ? 'has proof of purchase' : 'no receipt'} · filed by ${esc(c.filer)}</div>
    <p class="story">“${esc(c.narrative)}”</p>
    ${c.reasons.length ? `<ul class="reasons">${c.reasons.map((r) => `<li>${esc(r)}</li>`).join('')}</ul>` : '<p>No warning signs found.</p>'}
    <div class="opinion" id="op">${op ? opinionHtml(op) : '<button class="btn" id="askAi">Ask AI for a second opinion</button>'}</div>
    <div class="actions">
      <button class="btn good" data-d="approve">Approve for payment</button>
      <button class="btn bad" data-d="reject">Reject claim</button>
      ${c.decision ? '<button class="btn" data-d="">Undo decision</button>' : ''}
    </div>
    <p class="who" style="margin-top:1rem">Claimant view: <a href="/claim.html?id=${esc(c.id)}" target="_blank" rel="noopener">what ${esc(c.name.split(' ')[0])} sees</a></p>`;
  $('#askAi')?.addEventListener('click', async (e) => {
    e.target.disabled = true; e.target.textContent = 'Reading the claim…';
    try { $('#op').innerHTML = opinionHtml(await api(`/api/claims/${id}/opinion`, { method: 'POST' })); }
    catch (err) { $('#op').innerHTML = `<div class="msg error">${esc(err.message)}</div>`; }
  });
  $('#detail').querySelectorAll('[data-d]').forEach((b) => b.addEventListener('click', async () => {
    const updated = await api(`/api/claims/${id}/decision`, { method: 'POST', body: JSON.stringify({ decision: b.dataset.d || null }) });
    grid.getRowNode(id)?.setData(updated);
    await loadSummary(); showDetail(id);
  }));
}
const opinionHtml = (o) => o.error ? `<div class="msg error">${esc(o.error)}</div>` :
  `<b>AI suggests: ${o.recommendation === 'approve' ? 'approve' : 'keep on hold'}</b> (${Math.round((o.confidence || 0) * 100)}% sure)<br>${esc(o.reason)}<br><small>Source: ${esc(o.source)}. A person makes the final call.</small>`;

$('#aiBand').addEventListener('click', async (e) => {
  e.target.disabled = true; e.target.textContent = 'Reviewing…';
  try { const r = await api('/api/review-band/opinions', { method: 'POST', body: JSON.stringify({ limit: 20 }) }); e.target.textContent = `AI reviewed ${r.reviewed}`; loadRows(); loadSummary(); }
  catch (err) { e.target.textContent = 'AI review failed'; }
  setTimeout(() => { e.target.disabled = false; e.target.textContent = 'Get AI second opinion on 20'; }, 2500);
});

// ---- Payouts --------------------------------------------------------------
$('#payBtn').addEventListener('click', async () => {
  const btn = $('#payBtn'); btn.disabled = true; $('#payMsg').innerHTML = '';
  try {
    const b = await api('/api/payouts', { method: 'POST', body: JSON.stringify({ confirm: $('#confirm').value.trim() }) });
    $('#payMsg').innerHTML = `<div class="msg ok">PayPal accepted batch ${esc(b.id)}: ${b.sent} payments of ${money(b.share)}.</div>`;
    $('#confirm').value = '';
    await loadSummary(); pollBatch(b.id);
  } catch (err) { $('#payMsg').innerHTML = `<div class="msg error">${esc(err.message)}</div>`; }
  btn.disabled = false;
});
const batchItems = {};
async function pollBatch(id, tries = 0) {
  try {
    const r = await api('/api/payouts/' + id);
    batchItems[id] = r.items; renderBatches();
    if (['PENDING', 'PROCESSING'].includes(r.status) && tries < 20) setTimeout(() => pollBatch(id, tries + 1), 3000);
    else loadSummary();
  } catch (e) { /* shown on next refresh */ }
}
function renderBatches() {
  if (!summary.batches.length) return;
  $('#batches').innerHTML = summary.batches.map((b) => `
    <h3 style="margin:1rem 0 .4rem">Batch ${esc(b.id)} <span class="status ${b.status === 'SUCCESS' ? 'clear' : 'review'}">${esc(b.status)}</span></h3>
    <p class="who">${b.sent} sent of ${b.eligible.toLocaleString()} eligible · ${money(b.share)} each · ${esc(b.mode)} · retry key ${esc(b.senderBatchId)}</p>
    ${batchItems[b.id] ? `<table class="items"><thead><tr><th>Claim</th><th>Paid to</th><th>Amount</th><th>PayPal status</th></tr></thead><tbody>
      ${batchItems[b.id].map((i) => `<tr><td>${esc(i.claimId)}</td><td>${esc(i.receiver)}</td><td>${money(i.value)}</td><td>${esc(i.status)}${i.status === 'UNCLAIMED' ? ' (no PayPal account yet, returned after 30 days)' : ''}</td></tr>`).join('')}
    </tbody></table>` : `<button class="btn" onclick="pollBatch('${esc(b.id)}')">Check status with PayPal</button>`}`).join('');
}
window.pollBatch = pollBatch;

// ---- Accuracy + activity ----------------------------------------------
async function renderAccuracy() {
  const e = await api('/api/evaluation');
  const pct = (x) => (x * 100).toFixed(1) + '%';
  $('#scores').innerHTML = `
    <div><div class="v">${pct(e.precision)}</div><div class="k">of held claims are really fake</div></div>
    <div><div class="v">${pct(e.recall)}</div><div class="k">of fake claims were caught</div></div>
    <div><div class="v">${e.fp}</div><div class="k">real people held by mistake (they can clear themselves with PayPal)</div></div>
    <div><div class="v">${e.review}</div><div class="k">claims sent to a person</div></div>`;
  const kinds = { real: 'Real class member', bot_ring: 'Bot ring', ai_agent: 'AI agent bulk filer', duplicate: 'Same person, many claims', proxy_ring: 'Ring behind proxies', subtle_fake: 'Hand-made fake' };
  const cols = ['clear', 'review', 'held'];
  $('#matrix').innerHTML = `<thead><tr><th>What the claim really is</th><th>Cleared</th><th>Needs a person</th><th>Held</th></tr></thead><tbody>${
    Object.entries(kinds).map(([k, label]) => `<tr><td>${label}</td>${cols.map((c) => `<td>${(e.byTruth[`${k}|${c}`] || 0).toLocaleString()}</td>`).join('')}</tr>`).join('')}</tbody>`;
}
function renderActivity() {
  $('#activity').innerHTML = summary.audit.map((a) => `<li><time>${new Date(a.at).toLocaleTimeString()}</time><span>${esc(a.detail)}</span></li>`).join('');
}

// ---- Tabs --------------------------------------------------------------
document.querySelectorAll('[role=tab]').forEach((t) => t.addEventListener('click', () => {
  document.querySelectorAll('[role=tab]').forEach((x) => { x.setAttribute('aria-selected', x === t); $('#' + x.getAttribute('aria-controls')).hidden = x !== t; });
}));

loadSummary().then(makeGrid);
