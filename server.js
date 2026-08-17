require('dotenv').config();
const path = require('path');
const express = require('express');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const db = require('./db');
const { processGameweek } = require('./engine');

const app = express();
app.use(express.json());
app.use(session({
secret: process.env.SESSION_SECRET || 'fleetdown-lms-dev-secret-change-me',
resave: false,
saveUninitialized: false,
cookie: { maxAge: 1000 * 60 * 60 * 24 * 30 }
}));
app.use(express.static(path.join(__dirname, 'public')));

function requireAuth(req, res, next) {
if (!req.session.memberId) return res.status(401).json({ error: 'Not logged in' });
const member = db.prepare('SELECT * FROM members WHERE id = ?').get(req.session.memberId);
if (!member) return res.status(401).json({ error: 'Not logged in' });
req.member = member;
next();
}
function requireAdmin(req, res, next) {
requireAuth(req, res, () => {
if (!req.member.is_admin) return res.status(403).json({ error: 'Admin only' });
next();
});
}
function publicMember(m) {
return {
id: m.id, name: m.name, is_admin: !!m.is_admin, eliminated: !!m.eliminated,
eliminated_gameweek_id: m.eliminated_gameweek_id, eliminated_reason: m.eliminated_reason
};
}
function getSetting(key) {
const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
return row ? row.value : null;
}
function currentGameweek() {
const upcoming = db.prepare('SELECT * FROM gameweeks WHERE processed = 0 ORDER BY number ASC LIMIT 1').get();
if (upcoming) return upcoming;
return db.prepare('SELECT * FROM gameweeks ORDER BY number DESC LIMIT 1').get();
}

app.post('/api/auth/login', (req, res) => {
const { name, pin } = req.body || {};
if (!name || !pin) return res.status(400).json({ error: 'Name and PIN required' });
const member = db.prepare('SELECT * FROM members WHERE name = ?').get(String(name).trim());
if (!member || !bcrypt.compareSync(String(pin), member.pin_hash)) {
return res.status(401).json({ error: 'Invalid name or PIN' });
}
req.session.memberId = member.id;
res.json({ member: publicMember(member) });
});

app.post('/api/auth/logout', (req, res) => {
req.session.destroy(() => res.json({ ok: true }));
});

app.get('/api/auth/me', (req, res) => {
if (!req.session.memberId) return res.json({ member: null });
const member = db.prepare('SELECT * FROM members WHERE id = ?').get(req.session.memberId);
res.json({ member: member ? publicMember(member) : null });
});

app.post('/api/auth/change-pin', requireAuth, (req, res) => {
const { currentPin, newPin } = req.body || {};
if (!newPin || String(newPin).length < 4) return res.status(400).json({ error: 'New PIN must be at least 4 characters' });
if (!bcrypt.compareSync(String(currentPin || ''), req.member.pin_hash)) {
return res.status(401).json({ error: 'Current PIN is incorrect' });
}
const hash = bcrypt.hashSync(String(newPin), 10);
db.prepare('UPDATE members SET pin_hash = ? WHERE id = ?').run(hash, req.member.id);
res.json({ ok: true });
});

app.get('/api/teams', requireAuth, (req, res) => {
res.json({ teams: db.prepare('SELECT * FROM teams ORDER BY name').all() });
});

app.get('/api/state', requireAuth, (req, res) => {
const competitionName = getSetting('competition_name');
const gw = currentGameweek();
const allGameweeks = db.prepare('SELECT * FROM gameweeks ORDER BY number').all();

let gwView = null;
let myPick = null;
let availableTeams = [];
let deadlinePassed = false;

if (gw) {
const fixtures = db.prepare(`
SELECT f.*, ht.name AS home_name, at.name AS away_name
FROM fixtures f
JOIN teams ht ON ht.id = f.home_team_id
JOIN teams at ON at.id = f.away_team_id
WHERE f.gameweek_id = ?
ORDER BY f.id
`).all(gw.id);

deadlinePassed = new Date(gw.deadline).getTime() <= Date.now();

myPick = db.prepare(`
SELECT p.*, t.name AS team_name FROM picks p JOIN teams t ON t.id = p.team_id
WHERE p.member_id = ? AND p.gameweek_id = ?
`).get(req.member.id, gw.id);

if (!req.member.eliminated && !gw.processed && !gw.locked && !deadlinePassed) {
const usedTeamIds = new Set(
db.prepare('SELECT team_id FROM picks WHERE member_id = ? AND gameweek_id != ?')
.all(req.member.id, gw.id).map(r => r.team_id)
);
const playingTeamIds = new Set();
fixtures.forEach(f => { playingTeamIds.add(f.home_team_id); playingTeamIds.add(f.away_team_id); });
availableTeams = db.prepare('SELECT * FROM teams ORDER BY name').all()
.filter(t => playingTeamIds.has(t.id) && !usedTeamIds.has(t.id));
}

gwView = {
id: gw.id, number: gw.number, deadline: gw.deadline,
locked: !!gw.locked, processed: !!gw.processed, wiped_out_reprieve: !!gw.wiped_out_reprieve,
deadlinePassed,
fixtures: fixtures.map(f => ({
id: f.id, home_team_id: f.home_team_id, home_name: f.home_name,
away_team_id: f.away_team_id, away_name: f.away_name, result: f.result
}))
};
}

const aliveCount = db.prepare('SELECT COUNT(*) c FROM members WHERE is_admin = 0 AND eliminated = 0').get().c;
const totalCount = db.prepare('SELECT COUNT(*) c FROM members WHERE is_admin = 0').get().c;

res.json({
competitionName,
member: publicMember(req.member),
gameweek: gwView,
myPick: myPick ? { team_id: myPick.team_id, team_name: myPick.team_name, outcome: myPick.outcome } : null,
availableTeams,
aliveCount,
totalCount,
winnerDeclared: totalCount > 0 && aliveCount === 1,
seasonOver: totalCount > 0 && aliveCount === 0,
totalGameweeks: allGameweeks.length
});
});

app.get('/api/standings', requireAuth, (req, res) => {
const members = db.prepare('SELECT * FROM members WHERE is_admin = 0 ORDER BY eliminated ASC, name ASC').all();
const gw = currentGameweek();

const result = members.map(m => {
const picks = db.prepare(`
SELECT p.*, t.name AS team_name, g.number AS gw_number, g.processed AS gw_processed
FROM picks p JOIN teams t ON t.id = p.team_id JOIN gameweeks g ON g.id = p.gameweek_id
WHERE p.member_id = ? ORDER BY g.number
`).all(m.id);

const visiblePicks = picks.map(p => {
const isCurrentOpenGw = gw && p.gw_number === gw.number && !p.gw_processed;
const hide = isCurrentOpenGw && m.id !== req.member.id;
return {
gameweek: p.gw_number,
team_name: hide ? null : p.team_name,
outcome: hide ? 'pending' : p.outcome
};
});

return {
id: m.id,
name: m.name,
eliminated: !!m.eliminated,
eliminated_gameweek_id: m.eliminated_gameweek_id,
eliminated_reason: m.eliminated_reason,
picks: visiblePicks
};
});

res.json({ standings: result });
});

app.post('/api/pick', requireAuth, (req, res) => {
if (req.member.eliminated) return res.status(403).json({ error: 'You have been eliminated' });
const { gameweek_id, team_id } = req.body || {};
const gw = db.prepare('SELECT * FROM gameweeks WHERE id = ?').get(gameweek_id);
if (!gw) return res.status(404).json({ error: 'Gameweek not found' });
if (gw.locked || gw.processed) return res.status(403).json({ error: 'Picks are locked for this gameweek' });
if (new Date(gw.deadline).getTime() <= Date.now()) return res.status(403).json({ error: 'Deadline has passed' });

const fixture = db.prepare('SELECT * FROM fixtures WHERE gameweek_id = ? AND (home_team_id = ? OR away_team_id = ?)')
.get(gameweek_id, team_id, team_id);
if (!fixture) return res.status(400).json({ error: 'That team is not playing this gameweek' });

const alreadyUsed = db.prepare('SELECT 1 FROM picks WHERE member_id = ? AND gameweek_id != ? AND team_id = ?')
.get(req.member.id, gameweek_id, team_id);
if (alreadyUsed) return res.status(400).json({ error: 'You have already picked this team earlier this season' });

const existing = db.prepare('SELECT * FROM picks WHERE member_id = ? AND gameweek_id = ?').get(req.member.id, gameweek_id);
if (existing) {
db.prepare('UPDATE picks SET team_id = ?, updated_at = datetime(\'now\') WHERE id = ?').run(team_id, existing.id);
} else {
db.prepare('INSERT INTO picks (member_id, gameweek_id, team_id) VALUES (?, ?, ?)').run(req.member.id, gameweek_id, team_id);
}
res.json({ ok: true });
});

app.get('/api/admin/members', requireAdmin, (req, res) => {
const members = db.prepare('SELECT * FROM members ORDER BY is_admin DESC, name ASC').all();
res.json({ members: members.map(publicMember) });
});

app.post('/api/admin/members', requireAdmin, (req, res) => {
const { name, pin } = req.body || {};
if (!name || !pin) return res.status(400).json({ error: 'Name and PIN required' });
if (String(pin).length < 4) return res.status(400).json({ error: 'PIN must be at least 4 characters' });
const exists = db.prepare('SELECT 1 FROM members WHERE name = ?').get(String(name).trim());
if (exists) return res.status(400).json({ error: 'A member with that name already exists' });
const hash = bcrypt.hashSync(String(pin), 10);
const info = db.prepare('INSERT INTO members (name, pin_hash) VALUES (?, ?)').run(String(name).trim(), hash);
res.json({ member: publicMember(db.prepare('SELECT * FROM members WHERE id = ?').get(info.lastInsertRowid)) });
});

app.post('/api/admin/members/:id/reset-pin', requireAdmin, (req, res) => {
const { pin } = req.body || {};
if (!pin || String(pin).length < 4) return res.status(400).json({ error: 'PIN must be at least 4 characters' });
const hash = bcrypt.hashSync(String(pin), 10);
const result = db.prepare('UPDATE members SET pin_hash = ? WHERE id = ?').run(hash, req.params.id);
if (result.changes === 0) return res.status(404).json({ error: 'Member not found' });
res.json({ ok: true });
});

app.post('/api/admin/members/:id/reinstate', requireAdmin, (req, res) => {
db.prepare('UPDATE members SET eliminated = 0, eliminated_gameweek_id = NULL, eliminated_reason = NULL WHERE id = ?')
.run(req.params.id);
res.json({ ok: true });
});

app.delete('/api/admin/members/:id', requireAdmin, (req, res) => {
const hasPicks = db.prepare('SELECT 1 FROM picks WHERE member_id = ?').get(req.params.id);
if (hasPicks) return res.status(400).json({ error: 'Cannot delete a member who has already made picks. Eliminate/reinstate instead.' });
db.prepare('DELETE FROM members WHERE id = ? AND is_admin = 0').run(req.params.id);
res.json({ ok: true });
});

app.get('/api/admin/gameweeks', requireAdmin, (req, res) => {
const gameweeks = db.prepare('SELECT * FROM gameweeks ORDER BY number').all();
const withFixtures = gameweeks.map(gw => {
const fixtures = db.prepare(`
SELECT f.*, ht.name AS home_name, at.name AS away_name
FROM fixtures f JOIN teams ht ON ht.id = f.home_team_id JOIN teams at ON at.id = f.away_team_id
WHERE f.gameweek_id = ? ORDER BY f.id
`).all(gw.id);
const pickCount = db.prepare('SELECT COUNT(*) c FROM picks WHERE gameweek_id = ?').get(gw.id).c;
return { ...gw, locked: !!gw.locked, processed: !!gw.processed, wiped_out_reprieve: !!gw.wiped_out_reprieve, fixtures, pickCount };
});
res.json({ gameweeks: withFixtures });
});

app.post('/api/admin/gameweeks', requireAdmin, (req, res) => {
const { number, deadline } = req.body || {};
if (!number || !deadline) return res.status(400).json({ error: 'Gameweek number and deadline required' });
try {
const info = db.prepare('INSERT INTO gameweeks (number, deadline) VALUES (?, ?)').run(number, deadline);
res.json({ gameweek: db.prepare('SELECT * FROM gameweeks WHERE id = ?').get(info.lastInsertRowid) });
} catch (e) {
res.status(400).json({ error: 'A gameweek with that number already exists' });
}
});

app.put('/api/admin/gameweeks/:id', requireAdmin, (req, res) => {
const { deadline, locked } = req.body || {};
const gw = db.prepare('SELECT * FROM gameweeks WHERE id = ?').get(req.params.id);
if (!gw) return res.status(404).json({ error: 'Not found' });
db.prepare('UPDATE gameweeks SET deadline = COALESCE(?, deadline), locked = COALESCE(?, locked) WHERE id = ?')
.run(deadline ?? null, typeof locked === 'boolean' ? (locked ? 1 : 0) : null, req.params.id);
res.json({ ok: true });
});

app.delete('/api/admin/gameweeks/:id', requireAdmin, (req, res) => {
const gw = db.prepare('SELECT * FROM gameweeks WHERE id = ?').get(req.params.id);
if (!gw) return res.status(404).json({ error: 'Not found' });
if (gw.processed) return res.status(400).json({ error: 'Cannot delete a processed gameweek' });
db.prepare('DELETE FROM gameweeks WHERE id = ?').run(req.params.id);
res.json({ ok: true });
});

app.post('/api/admin/gameweeks/:id/fixtures', requireAdmin, (req, res) => {
const { home_team_id, away_team_id } = req.body || {};
const gw = db.prepare('SELECT * FROM gameweeks WHERE id = ?').get(req.params.id);
if (!gw) return res.status(404).json({ error: 'Gameweek not found' });
if (gw.processed) return res.status(400).json({ error: 'Gameweek already processed' });
if (!home_team_id || !away_team_id || home_team_id === away_team_id) {
return res.status(400).json({ error: 'Choose two different teams' });
}
try {
db.prepare('INSERT INTO fixtures (gameweek_id, home_team_id, away_team_id) VALUES (?, ?, ?)')
.run(req.params.id, home_team_id, away_team_id);
res.json({ ok: true });
} catch (e) {
res.status(400).json({ error: 'One of these teams already has a fixture in this gameweek' });
}
});

app.delete('/api/admin/fixtures/:id', requireAdmin, (req, res) => {
db.prepare('DELETE FROM fixtures WHERE id = ?').run(req.params.id);
res.json({ ok: true });
});

app.put('/api/admin/fixtures/:id/result', requireAdmin, (req, res) => {
const { result } = req.body || {};
if (!['pending', 'home_win', 'away_win', 'draw'].includes(result)) {
return res.status(400).json({ error: 'Invalid result' });
}
db.prepare('UPDATE fixtures SET result = ? WHERE id = ?').run(result, req.params.id);
res.json({ ok: true });
});

app.post('/api/admin/gameweeks/:id/process', requireAdmin, (req, res) => {
try {
const outcome = processGameweek(Number(req.params.id));
res.json({
ok: true,
wipeOut: outcome.wipeOut,
results: outcome.results.map(r => ({ member: r.member.name, outcome: r.outcome, reason: r.reason }))
});
} catch (e) {
res.status(400).json({ error: e.message });
}
});

app.get('/api/admin/settings', requireAdmin, (req, res) => {
res.json({ competitionName: getSetting('competition_name') });
});

app.put('/api/admin/settings', requireAdmin, (req, res) => {
const { competitionName } = req.body || {};
if (competitionName) {
db.prepare("INSERT INTO settings (key, value) VALUES ('competition_name', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value")
.run(competitionName);
}
res.json({ ok: true });
});

app.post('/api/admin/reset-season', requireAdmin, (req, res) => {
const { confirm } = req.body || {};
if (confirm !== 'RESET') return res.status(400).json({ error: 'Send confirm: RESET to proceed. This wipes all gameweeks, fixtures and picks.' });
const tx = db.transaction(() => {
db.prepare('DELETE FROM picks').run();
db.prepare('DELETE FROM fixtures').run();
db.prepare('DELETE FROM gameweeks').run();
db.prepare('UPDATE members SET eliminated = 0, eliminated_gameweek_id = NULL, eliminated_reason = NULL').run();
});
tx();
res.json({ ok: true });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
console.log(`Fleetdown Last Man Standing running on http://localhost:${PORT}`);
});
