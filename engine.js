// Core Last Man Standing rules engine.
// Rule set (as configured for Fleetdown):
//  - Each member picks ONE Premier League team per gameweek.
//  - A team can only be picked ONCE per member for the whole season.
//  - Your pick must WIN. A draw or a loss eliminates you (no draw-survives rule).
//  - No pick submitted before the deadline = eliminated.
//  - "Wipe-out reprieve": if EVERY remaining member would be eliminated in the
//    same gameweek, they are all reprieved (spared) and carry on to the next
//    round instead of ending the competition with zero survivors.

const db = require('./db');

function getAliveMembers() {
return db.prepare('SELECT * FROM members WHERE is_admin = 0 AND eliminated = 0').all();
}

function teamResultFor(fixture, teamId) {
if (fixture.result === 'pending') return 'pending';
if (fixture.result === 'draw') return 'draw';
if (fixture.result === 'home_win') return teamId === fixture.home_team_id ? 'win' : 'loss';
if (fixture.result === 'away_win') return teamId === fixture.away_team_id ? 'win' : 'loss';
return 'pending';
}

function processGameweek(gameweekId) {
const gw = db.prepare('SELECT * FROM gameweeks WHERE id = ?').get(gameweekId);
if (!gw) throw new Error('Gameweek not found');
if (gw.processed) throw new Error('Gameweek already processed');

const fixtures = db.prepare('SELECT * FROM fixtures WHERE gameweek_id = ?').all(gameweekId);
if (fixtures.length === 0) throw new Error('Gameweek has no fixtures yet');
const incomplete = fixtures.some(f => f.result === 'pending');
if (incomplete) throw new Error('All fixtures must have a result before processing this gameweek');

const aliveMembers = getAliveMembers();
if (aliveMembers.length === 0) throw new Error('No active members to process');

const fixturesByTeam = new Map();
for (const f of fixtures) {
fixturesByTeam.set(f.home_team_id, f);
fixturesByTeam.set(f.away_team_id, f);
}

const results = []; // { member, pick, outcome, reason }

const tx = db.transaction(() => {
for (const member of aliveMembers) {
const pick = db.prepare('SELECT * FROM picks WHERE member_id = ? AND gameweek_id = ?')
.get(member.id, gameweekId);

if (!pick) {
results.push({ member, pick: null, outcome: 'eliminated', reason: 'no_pick' });
continue;
}

const fixture = fixturesByTeam.get(pick.team_id);
if (!fixture) {
results.push({ member, pick, outcome: 'eliminated', reason: 'team_not_playing' });
continue;
}

const teamResult = teamResultFor(fixture, pick.team_id);
if (teamResult === 'win') {
results.push({ member, pick, outcome: 'survived', reason: null });
} else {
results.push({ member, pick, outcome: 'eliminated', reason: teamResult === 'draw' ? 'draw' : 'loss' });
}
}

const wouldBeEliminated = results.filter(r => r.outcome === 'eliminated');
const wipeOut = wouldBeEliminated.length === results.length && results.length > 0;

const updatePickOutcome = db.prepare('UPDATE picks SET outcome = ?, updated_at = datetime(\'now\') WHERE id = ?');
const eliminateMember = db.prepare(`UPDATE members SET eliminated = 1, eliminated_gameweek_id = ?, eliminated_reason = ? WHERE id = ?`);

for (const r of results) {
if (r.outcome === 'survived') {
if (r.pick) updatePickOutcome.run('survived', r.pick.id);
} else if (r.outcome === 'eliminated') {
if (wipeOut) {
if (r.pick) updatePickOutcome.run('reprieved', r.pick.id);
} else {
if (r.pick) updatePickOutcome.run('eliminated', r.pick.id);
eliminateMember.run(gameweekId, r.reason, r.member.id);
}
}
}

db.prepare('UPDATE gameweeks SET processed = 1, locked = 1, wiped_out_reprieve = ? WHERE id = ?')
.run(wipeOut ? 1 : 0, gameweekId);

return { wipeOut, results };
});

return tx();
}

module.exports = { processGameweek, getAliveMembers, teamResultFor };
