const state = { member: null, teams: [], activeTab: 'pick' };

async function api(path, opts = {}) {
const res = await fetch(path, {
method: opts.method || 'GET',
headers: { 'Content-Type': 'application/json' },
credentials: 'same-origin',
body: opts.body ? JSON.stringify(opts.body) : undefined
});
const data = await res.json().catch(() => ({}));
if (!res.ok) throw new Error(data.error || 'Something went wrong');
return data;
}

function fmtDate(iso) {
if (!iso) return '';
const d = new Date(iso);
return d.toLocaleString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}

function reasonLabel(reason) {
return { no_pick: 'No pick submitted', draw: 'Team drew', loss: 'Team lost', team_not_playing: 'Pick invalid' }[reason] || reason || '';
}

// ---------- boot ----------
async function boot() {
try {
const { member } = await api('/api/auth/me');
if (member) {
state.member = member;
showApp();
} else {
showLogin();
}
} catch (e) {
showLogin();
}
}

function showLogin() {
document.getElementById('login-screen').style.display = 'flex';
document.getElementById('app').style.display = 'none';
}

async function showApp() {
document.getElementById('login-screen').style.display = 'none';
document.getElementById('app').style.display = 'block';
document.getElementById('who-name').textContent = state.member.name + (state.member.is_admin ? ' (admin)' : '');
document.getElementById('admin-tab-btn').style.display = state.member.is_admin ? 'inline-block' : 'none';
const teamsRes = await api('/api/teams');
state.teams = teamsRes.teams;
await renderAll();
}

document.getElementById('login-form').addEventListener('submit', async (e) => {
e.preventDefault();
const name = document.getElementById('login-name').value.trim();
const pin = document.getElementById('login-pin').value;
const errEl = document.getElementById('login-error');
errEl.textContent = '';
try {
const { member } = await api('/api/auth/login', { method: 'POST', body: { name, pin } });
state.member = member;
await showApp();
} catch (e) {
errEl.textContent = e.message;
}
});

document.getElementById('logout-btn').addEventListener('click', async () => {
await api('/api/auth/logout', { method: 'POST' });
state.member = null;
showLogin();
});

document.getElementById('tabs').addEventListener('click', (e) => {
const btn = e.target.closest('button[data-tab]');
if (!btn) return;
document.querySelectorAll('#tabs button').forEach(b => b.classList.remove('active'));
btn.classList.add('active');
document.querySelectorAll('.tab-panel').forEach(p => p.style.display = 'none');
document.getElementById('tab-' + btn.dataset.tab).style.display = 'block';
state.activeTab = btn.dataset.tab;
renderAll();
});

async function renderAll() {
if (state.activeTab === 'pick') await renderPick();
if (state.activeTab === 'standings') await renderStandings();
if (state.activeTab === 'mypicks') await renderMyPicks();
if (state.activeTab === 'account') renderAccount();
if (state.activeTab === 'admin' && state.member.is_admin) await renderAdmin();
}

// ---------- pick tab ----------
async function renderPick() {
const el = document.getElementById('tab-pick');
el.innerHTML = '<div class="muted">Loading...</div>';
const s = await api('/api/state');
document.getElementById('comp-name').textContent = s.competitionName || 'Fleetdown Last Man Standing';

let banner = '';
if (s.winnerDeclared) {
banner = `<div class="status-banner winner">We have a Last Man Standing winner!</div>`;
} else if (s.member.eliminated) {
banner = `<div class="status-banner out">You're out — eliminated in Gameweek ${gwNumberFromId(s, s.member.eliminated_gameweek_id)} (${reasonLabel(s.member.eliminated_reason)}). You can still follow along below.</div>`;
} else {
banner = `<div class="status-banner alive">You're still in! ${s.aliveCount} of ${s.totalCount} members remain.</div>`;
}

let gwHtml = '<div class="card"><p class="muted">No gameweeks have been set up yet. Check back once the admin adds the next Premier League gameweek.</p></div>';

if (s.gameweek) {
const gw = s.gameweek;
const fixturesHtml = gw.fixtures.map(f => `
<div class="fixture-row">
<span>${f.home_name} vs ${f.away_name}</span>
<span class="res ${f.result !== 'pending' ? 'done' : ''}">${resultLabel(f)}</span>
</div>
`).join('') || '<div class="muted">Fixtures not added yet.</div>';

let pickArea = '';
if (s.member.eliminated) {
pickArea = '<p class="muted">You have been eliminated, so picks are no longer available to you.</p>';
} else if (gw.processed) {
pickArea = `<p class="muted">Gameweek ${gw.number} has been processed. ${s.myPick ? `You picked <strong>${s.myPick.team_name}</strong> — ${outcomeLabel(s.myPick.outcome)}.` : 'You did not submit a pick.'}</p>`;
} else if (gw.locked || gw.deadlinePassed) {
pickArea = `<p class="muted">Picks are locked for Gameweek ${gw.number}. ${s.myPick ? `Your pick: <strong>${s.myPick.team_name}</strong>` : 'You did not submit a pick before the deadline.'}</p>`;
} else {
const teamButtons = s.availableTeams.map(t => `
<button class="team-btn ${s.myPick && s.myPick.team_id === t.id ? 'selected' : ''}" data-team-id="${t.id}">${t.name}</button>
`).join('');
pickArea = `
<p class="muted">Pick the team you think will WIN this gameweek. A draw or loss eliminates you. Each team can only be used once all season.</p>
<div class="team-grid" id="team-grid">${teamButtons || '<span class="muted">No eligible teams left to pick — all playing teams have been used already.</span>'}</div>
<div id="pick-msg" style="margin-top:10px;"></div>
${s.myPick ? `<p class="small" style="margin-top:8px;">Current pick: <strong>${s.myPick.team_name}</strong> (tap another team to change it before the deadline)</p>` : ''}
`;
}

gwHtml = `
<div class="card">
<h2>Gameweek ${gw.number}</h2>
<p class="small">Deadline: ${fmtDate(gw.deadline)} ${gw.deadlinePassed ? '(passed)' : ''}</p>
<div class="fixture-list">${fixturesHtml}</div>
<hr class="sep" />
${pickArea}
</div>
`;
}

el.innerHTML = banner + gwHtml;

const grid = document.getElementById('team-grid');
if (grid) {
grid.addEventListener('click', async (e) => {
const btn = e.target.closest('.team-btn');
if (!btn) return;
const teamId = Number(btn.dataset.teamId);
const msg = document.getElementById('pick-msg');
msg.textContent = '';
try {
await api('/api/pick', { method: 'POST', body: { gameweek_id: s.gameweek.id, team_id: teamId } });
await renderPick();
} catch (err) {
msg.innerHTML = `<div class="error">${err.message}</div>`;
}
});
}
}

function resultLabel(f) {
if (f.result === 'pending') return 'Not played yet';
if (f.result === 'draw') return 'Draw';
if (f.result === 'home_win') return `${f.home_name} won`;
if (f.result === 'away_win') return `${f.away_name} won`;
return f.result;
}
function outcomeLabel(o) {
return { survived: 'survived', eliminated: 'eliminated', reprieved: 'reprieved (everyone was out, so the round was spared)', pending: 'result pending' }[o] || o;
}
function gwNumberFromId(s, id) {
return id || '?';
}

// ---------- standings tab ----------
async function renderStandings() {
const el = document.getElementById('tab-standings');
el.innerHTML = '<div class="muted">Loading...</div>';
const { standings } = await api('/api/standings');

const maxGw = Math.max(0, ...standings.map(m => m.picks.length ? Math.max(...m.picks.map(p => p.gameweek)) : 0));
const gwCols = Array.from({ length: maxGw }, (_, i) => i + 1);

const rows = standings.map(m => {
const pickCells = gwCols.map(gwNum => {
const p = m.picks.find(pp => pp.gameweek === gwNum);
if (!p) return '<td class="pick-cell pending">—</td>';
let cls = 'pending';
if (p.outcome === 'survived') cls = 'win';
else if (p.outcome === 'eliminated') cls = 'lose';
else if (p.outcome === 'reprieved') cls = 'reprieved';
return `<td class="pick-cell ${cls}">${p.team_name || 'Pick made'}</td>`;
}).join('');
return `
<tr>
<td>${m.name}</td>
<td><span class="pill ${m.eliminated ? 'out' : 'alive'}">${m.eliminated ? 'Out' : 'Alive'}</span></td>
${pickCells}
</tr>
`;
}).join('');

el.innerHTML = `
<div class="card">
<h2>Standings</h2>
<p class="small">Picks for the current, unfinished gameweek stay hidden until it's processed — no copying!</p>
<div style="overflow-x:auto;">
<table>
<thead><tr><th>Member</th><th>Status</th>${gwCols.map(n => `<th>GW${n}</th>`).join('')}</tr></thead>
<tbody>${rows || '<tr><td colspan="99" class="muted">No members yet.</td></tr>'}</tbody>
</table>
</div>
</div>
`;
}

// ---------- my picks tab ----------
async function renderMyPicks() {
const el = document.getElementById('tab-mypicks');
el.innerHTML = '<div class="muted">Loading...</div>';
const { standings } = await api('/api/standings');
const me = standings.find(m => m.name === state.member.name);
if (!me || me.picks.length === 0) {
el.innerHTML = '<div class="card"><p class="muted">You haven\'t made any picks yet.</p></div>';
return;
}
const rows = me.picks.map(p => `
<tr>
<td>GW${p.gameweek}</td>
<td>${p.team_name || 'Pending'}</td>
<td>${outcomeLabel(p.outcome)}</td>
</tr>
`).join('');
el.innerHTML = `
<div class="card">
<h2>My Picks</h2>
<table>
<thead><tr><th>Gameweek</th><th>Team</th><th>Result</th></tr></thead>
<tbody>${rows}</tbody>
</table>
</div>
`;
}

// ---------- account tab ----------
function renderAccount() {
const el = document.getElementById('tab-account');
el.innerHTML = `
<div class="card">
<h2>Change PIN</h2>
<form class="stack" id="pin-form">
<input type="password" id="current-pin" placeholder="Current PIN" required />
<input type="password" id="new-pin" placeholder="New PIN (min 4 characters)" required />
<button class="primary" type="submit">Update PIN</button>
<div id="pin-msg"></div>
</form>
</div>
`;
document.getElementById('pin-form').addEventListener('submit', async (e) => {
e.preventDefault();
const msg = document.getElementById('pin-msg');
msg.innerHTML = '';
try {
await api('/api/auth/change-pin', {
method: 'POST',
body: { currentPin: document.getElementById('current-pin').value, newPin: document.getElementById('new-pin').value }
});
msg.innerHTML = '<div class="success">PIN updated.</div>';
document.getElementById('pin-form').reset();
} catch (err) {
msg.innerHTML = `<div class="error">${err.message}</div>`;
}
});
}

// ---------- admin tab ----------
async function renderAdmin() {
const el = document.getElementById('tab-admin');
el.innerHTML = '<div class="muted">Loading admin panel...</div>';
const [{ members }, { gameweeks }, settingsRes] = await Promise.all([
api('/api/admin/members'), api('/api/admin/gameweeks'), api('/api/admin/settings')
]);

const memberRows = members.filter(m => !m.is_admin).map(m => `
<tr>
<td>${m.name}</td>
<td><span class="pill ${m.eliminated ? 'out' : 'alive'}">${m.eliminated ? 'Out' : 'Alive'}</span></td>
<td>
${m.eliminated ? `<button class="secondary" data-reinstate="${m.id}">Reinstate</button>` : ''}
<button class="secondary" data-resetpin="${m.id}" data-name="${m.name}">Reset PIN</button>
<button class="danger" data-delete="${m.id}">Delete</button>
</td>
</tr>
`).join('');

const teamOptions = state.teams.map(t => `<option value="${t.id}">${t.name}</option>`).join('');

const gwBlocks = gameweeks.map(gw => {
const fixtureRows = gw.fixtures.map(f => `
<div class="fixture-row">
<span>${f.home_name} vs ${f.away_name}</span>
<span style="display:flex; gap:6px; align-items:center;">
<select data-result-for="${f.id}" ${gw.processed ? 'disabled' : ''}>
<option value="pending" ${f.result === 'pending' ? 'selected' : ''}>Pending</option>
<option value="home_win" ${f.result === 'home_win' ? 'selected' : ''}>${f.home_name} won</option>
<option value="draw" ${f.result === 'draw' ? 'selected' : ''}>Draw</option>
<option value="away_win" ${f.result === 'away_win' ? 'selected' : ''}>${f.away_name} won</option>
</select>
${!gw.processed ? `<button class="secondary" data-delfixture="${f.id}">✕</button>` : ''}
</span>
</div>
`).join('') || '<p class="muted">No fixtures added yet.</p>';

return `
<div class="gw-block">
<div class="gw-head">
<strong>Gameweek ${gw.number}</strong>
<span>
<span class="tag ${gw.locked ? 'locked' : ''}">${gw.locked ? 'Locked' : 'Open'}</span>
<span class="tag ${gw.processed ? 'processed' : ''}">${gw.processed ? 'Processed' : 'Not processed'}</span>
${gw.wiped_out_reprieve ? '<span class="tag locked">Wipe-out reprieve applied</span>' : ''}
</span>
</div>
<p class="small">Deadline: ${fmtDate(gw.deadline)} · ${gw.pickCount} pick(s) submitted</p>
<div class="fixture-list">${fixtureRows}</div>
${!gw.processed ? `
<div class="inline-form">
<select data-home="${gw.id}"><option value="">Home team</option>${teamOptions}</select>
<select data-away="${gw.id}"><option value="">Away team</option>${teamOptions}</select>
<button class="secondary" data-addfixture="${gw.id}">Add fixture</button>
</div>
<div class="inline-form">
<button class="secondary" data-savresults="${gw.id}">Save results</button>
<button class="primary" data-process="${gw.id}">Process gameweek</button>
<button class="secondary" data-lock="${gw.id}" data-locked="${gw.locked ? '0' : '1'}">${gw.locked ? 'Unlock picks' : 'Lock picks now'}</button>
<button class="danger" data-delgw="${gw.id}">Delete gameweek</button>
</div>` : ''}
<div id="gw-msg-${gw.id}"></div>
</div>
`;
}).join('') || '<p class="muted">No gameweeks yet — add the first one below.</p>';

el.innerHTML = `
<div class="card">
<h2>Members (${members.filter(m => !m.is_admin).length})</h2>
<table>
<thead><tr><th>Name</th><th>Status</th><th></th></tr></thead>
<tbody>${memberRows}</tbody>
</table>
<hr class="sep" />
<h3>Add member</h3>
<form class="inline-form" id="add-member-form">
<input type="text" id="new-member-name" placeholder="Name" required />
<input type="text" id="new-member-pin" placeholder="PIN (min 4 digits)" required />
<button class="primary" type="submit">Add</button>
</form>
<div id="member-msg"></div>
</div>

<div class="card">
<h2>Gameweeks &amp; Fixtures</h2>
${gwBlocks}
<hr class="sep" />
<h3>Add gameweek</h3>
<form class="inline-form" id="add-gw-form">
<input type="number" id="new-gw-number" placeholder="GW number" min="1" required style="width:110px;" />
<input type="datetime-local" id="new-gw-deadline" required />
<button class="primary" type="submit">Add gameweek</button>
</form>
<div id="gw-msg"></div>
</div>

<div class="card">
<h2>Settings</h2>
<form class="inline-form" id="settings-form">
<input type="text" id="comp-name-input" value="${settingsRes.competitionName || ''}" style="width:260px;" />
<button class="secondary" type="submit">Save name</button>
</form>
<hr class="sep" />
<h3>Reset season</h3>
<p class="small">Wipes all gameweeks, fixtures and picks, and reinstates every member. Members and their PINs are kept. This cannot be undone.</p>
<form class="inline-form" id="reset-form">
<input type="text" id="reset-confirm" placeholder="Type RESET to confirm" />
<button class="danger" type="submit">Reset season</button>
</form>
<div id="reset-msg"></div>
</div>
`;

bindAdminEvents(el);
}

function bindAdminEvents(el) {
el.querySelector('#add-member-form').addEventListener('submit', async (e) => {
e.preventDefault();
const msg = document.getElementById('member-msg');
msg.innerHTML = '';
try {
await api('/api/admin/members', { method: 'POST', body: {
name: document.getElementById('new-member-name').value.trim(),
pin: document.getElementById('new-member-pin').value.trim()
}});
await renderAdmin();
} catch (err) { msg.innerHTML = `<div class="error">${err.message}</div>`; }
});

el.querySelectorAll('[data-resetpin]').forEach(btn => btn.addEventListener('click', async () => {
const pin = prompt(`New PIN for ${btn.dataset.name}:`);
if (!pin) return;
try {
await api(`/api/admin/members/${btn.dataset.resetpin}/reset-pin`, { method: 'POST', body: { pin } });
alert('PIN reset.');
} catch (err) { alert(err.message); }
}));

el.querySelectorAll('[data-reinstate]').forEach(btn => btn.addEventListener('click', async () => {
await api(`/api/admin/members/${btn.dataset.reinstate}/reinstate`, { method: 'POST' });
await renderAdmin();
}));

el.querySelectorAll('[data-delete]').forEach(btn => btn.addEventListener('click', async () => {
if (!confirm('Delete this member? Only possible if they have never made a pick.')) return;
try {
await api(`/api/admin/members/${btn.dataset.delete}`, { method: 'DELETE' });
await renderAdmin();
} catch (err) { alert(err.message); }
}));

el.querySelector('#add-gw-form').addEventListener('submit', async (e) => {
e.preventDefault();
const msg = document.getElementById('gw-msg');
msg.innerHTML = '';
try {
const deadlineLocal = document.getElementById('new-gw-deadline').value;
await api('/api/admin/gameweeks', { method: 'POST', body: {
number: Number(document.getElementById('new-gw-number').value),
deadline: new Date(deadlineLocal).toISOString()
}});
await renderAdmin();
} catch (err) { msg.innerHTML = `<div class="error">${err.message}</div>`; }
});

el.querySelectorAll('[data-addfixture]').forEach(btn => btn.addEventListener('click', async () => {
const gwId = btn.dataset.addfixture;
const home = el.querySelector(`[data-home="${gwId}"]`).value;
const away = el.querySelector(`[data-away="${gwId}"]`).value;
const msg = document.getElementById(`gw-msg-${gwId}`);
if (!home || !away) { msg.innerHTML = '<div class="error">Choose both teams.</div>'; return; }
try {
await api(`/api/admin/gameweeks/${gwId}/fixtures`, { method: 'POST', body: { home_team_id: Number(home), away_team_id: Number(away) } });
await renderAdmin();
} catch (err) { msg.innerHTML = `<div class="error">${err.message}</div>`; }
}));

el.querySelectorAll('[data-delfixture]').forEach(btn => btn.addEventListener('click', async () => {
await api(`/api/admin/fixtures/${btn.dataset.delfixture}`, { method: 'DELETE' });
await renderAdmin();
}));

el.querySelectorAll('[data-savresults]').forEach(btn => btn.addEventListener('click', async () => {
const gwId = btn.dataset.savresults;
const selects = el.querySelectorAll(`[data-result-for]`);
const msg = document.getElementById(`gw-msg-${gwId}`);
try {
for (const sel of selects) {
await api(`/api/admin/fixtures/${sel.dataset.resultFor}/result`, { method: 'PUT', body: { result: sel.value } });
}
msg.innerHTML = '<div class="success">Results saved.</div>';
await renderAdmin();
} catch (err) { msg.innerHTML = `<div class="error">${err.message}</div>`; }
}));

el.querySelectorAll('[data-process]').forEach(btn => btn.addEventListener('click', async () => {
const gwId = btn.dataset.process;
const msg = document.getElementById(`gw-msg-${gwId}`);
if (!confirm('Process this gameweek? This locks it and eliminates members whose pick did not win.')) return;
try {
const out = await api(`/api/admin/gameweeks/${gwId}/process`, { method: 'POST' });
msg.innerHTML = `<div class="success">Processed. ${out.wipeOut ? 'Everyone would have been eliminated, so the round was spared (wipe-out reprieve).' : ''}</div>`;
await renderAdmin();
} catch (err) { msg.innerHTML = `<div class="error">${err.message}</div>`; }
}));

el.querySelectorAll('[data-lock]').forEach(btn => btn.addEventListener('click', async () => {
await api(`/api/admin/gameweeks/${btn.dataset.lock}`, { method: 'PUT', body: { locked: btn.dataset.locked === '1' } });
await renderAdmin();
}));

el.querySelectorAll('[data-delgw]').forEach(btn => btn.addEventListener('click', async () => {
if (!confirm('Delete this gameweek and its fixtures?')) return;
try {
await api(`/api/admin/gameweeks/${btn.dataset.delgw}`, { method: 'DELETE' });
await renderAdmin();
} catch (err) { alert(err.message); }
}));

el.querySelector('#settings-form').addEventListener('submit', async (e) => {
e.preventDefault();
await api('/api/admin/settings', { method: 'PUT', body: { competitionName: document.getElementById('comp-name-input').value } });
document.getElementById('comp-name').textContent = document.getElementById('comp-name-input').value;
});

el.querySelector('#reset-form').addEventListener('submit', async (e) => {
e.preventDefault();
const msg = document.getElementById('reset-msg');
try {
await api('/api/admin/reset-season', { method: 'POST', body: { confirm: document.getElementById('reset-confirm').value } });
msg.innerHTML = '<div class="success">Season reset.</div>';
await renderAdmin();
} catch (err) { msg.innerHTML = `<div class="error">${err.message}</div>`; }
});
}

boot();
