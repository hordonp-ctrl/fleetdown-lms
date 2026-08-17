const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');
const bcrypt = require('bcryptjs');

const DATA_DIR = path.join(__dirname, 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const db = new Database(path.join(DATA_DIR, 'lms.sqlite'));
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');
db.exec(`
        CREATE TABLE IF NOT EXISTS members (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL UNIQUE,
            pin_hash TEXT NOT NULL,
            is_admin INTEGER NOT NULL DEFAULT 0,
            eliminated INTEGER NOT NULL DEFAULT 0,
            eliminated_gameweek_id INTEGER,
            eliminated_reason TEXT,
            created_at TEXT NOT NULL DEFAULT (datetime('now'))
          );

        CREATE TABLE IF NOT EXISTS teams (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL UNIQUE
          );

        CREATE TABLE IF NOT EXISTS gameweeks (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            number INTEGER NOT NULL UNIQUE,
            deadline TEXT NOT NULL,
            locked INTEGER NOT NULL DEFAULT 0,
            processed INTEGER NOT NULL DEFAULT 0,
            wiped_out_reprieve INTEGER NOT NULL DEFAULT 0,
            created_at TEXT NOT NULL DEFAULT (datetime('now'))
          );

        CREATE TABLE IF NOT EXISTS fixtures (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            gameweek_id INTEGER NOT NULL REFERENCES gameweeks(id) ON DELETE CASCADE,
            home_team_id INTEGER NOT NULL REFERENCES teams(id),
            away_team_id INTEGER NOT NULL REFERENCES teams(id),
            result TEXT NOT NULL DEFAULT 'pending', -- pending | home_win | away_win | draw
            UNIQUE(gameweek_id, home_team_id),
            UNIQUE(gameweek_id, away_team_id)
          );

        CREATE TABLE IF NOT EXISTS picks (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            member_id INTEGER NOT NULL REFERENCES members(id) ON DELETE CASCADE,
            gameweek_id INTEGER NOT NULL REFERENCES gameweeks(id) ON DELETE CASCADE,
            team_id INTEGER NOT NULL REFERENCES teams(id),
            outcome TEXT NOT NULL DEFAULT 'pending', -- pending | survived | eliminated | reprieved
            created_at TEXT NOT NULL DEFAULT (datetime('now')),
            updated_at TEXT NOT NULL DEFAULT (datetime('now')),
            UNIQUE(member_id, gameweek_id)
          );

        CREATE TABLE IF NOT EXISTS settings (
            key TEXT PRIMARY KEY,
            value TEXT
          );
        `);

        const PL_TEAMS_2026_27 = [
            'Arsenal', 'Aston Villa', 'Bournemouth', 'Brentford', 'Brighton & Hove Albion',
            'Chelsea', 'Coventry City', 'Crystal Palace', 'Everton', 'Fulham',
            'Hull City', 'Ipswich Town', 'Leeds United', 'Liverpool', 'Manchester City',
            'Manchester United', 'Newcastle United', 'Nottingham Forest', 'Sunderland', 'Tottenham Hotspur'
          ];

        const insertTeam = db.prepare('INSERT OR IGNORE INTO teams (name) VALUES (?)');
        const seedTeams = db.transaction((teams) => {
            for (const t of teams) insertTeam.run(t);
        });
        seedTeams(PL_TEAMS_2026_27);

        // Seed default admin account if no admin exists yet
        const adminCount = db.prepare('SELECT COUNT(*) AS c FROM members WHERE is_admin = 1').get().c;
        if (adminCount === 0) {
            const defaultAdminPin = process.env.ADMIN_PIN || '1234';
            const hash = bcrypt.hashSync(defaultAdminPin, 10);
            db.prepare('INSERT INTO members (name, pin_hash, is_admin) VALUES (?, ?, 1)')
                  .run(process.env.ADMIN_NAME || 'Admin', hash);
            console.log(`Seeded default admin account: name="${process.env.ADMIN_NAME || 'Admin'}" PIN="${defaultAdminPin}" — change this PIN after first login!`);
        }

        // Seed a competition name setting
        const compName = db.prepare("SELECT value FROM settings WHERE key = 'competition_name'").get();
        if (!compName) {
            db.prepare("INSERT INTO settings (key, value) VALUES ('competition_name', ?)")
                  .run('Fleetdown Last Man Standing');
        }

        module.exports = db;
