# Fleetdown Last Man Standing

A simple, self-hosted "Last Man Standing" (survivor pool) web app for Fleetdown
members, covering the Premier League only.

Each member picks one Premier League team every gameweek. Pick a winner and
you survive; a draw or a loss and you're out. You can never pick the same
team twice in a season. Last member standing wins.

## Rules built into this app

- Premier League only - the 20 clubs confirmed for the 2026/27 season are
pre-loaded (Arsenal, Aston Villa, Bournemouth, Brentford, Brighton & Hove
Albion, Chelsea, Coventry City, Crystal Palace, Everton, Fulham, Hull City,
Ipswich Town, Leeds United, Liverpool, Manchester City, Manchester United,
Newcastle United, Nottingham Forest, Sunderland, Tottenham Hotspur).
- One pick per member per gameweek, chosen from teams actually playing that
gameweek.
- A team can only be picked once per member for the whole season.
- Your picked team must win - a draw or a loss eliminates you.
- No pick submitted before the deadline = eliminated.
- Wipe-out reprieve: if every remaining member would be eliminated in the
same gameweek, they're all spared instead of ending the pool with zero
survivors, and play continues into the next round.
- Members can't see each other's picks for the current, still-open gameweek
- no copying - but everything is revealed once that gameweek is processed.

None of this is hardcoded to be unchangeable - it's plain Node.js code
(engine.js has the elimination logic) if you ever want to tweak a rule,
e.g. switch to "draw survives."

## How it works

- Members log in with their name and a PIN (an admin creates their
account and gives them a PIN to start with). They pick a team each
gameweek, see the live standings, and can change their own PIN.
- The admin (that's you) adds members, creates each gameweek with its
fixtures, enters results once matches are played, and clicks "Process
gameweek" to apply eliminations automatically.

This is a real multi-user web app with its own database (SQLite, stored in
a single file), so everyone's picks are stored centrally and update live -
it just needs to be hosted somewhere reachable by your members (see below).

## Running it locally

Requires Node.js 18+.

npm install
cp .env.example .env
npm start

Open http://localhost:3000. On first run it creates one admin account -
name and PIN come from ADMIN_NAME / ADMIN_PIN in your .env (defaults
to Admin / 1234 if you skip this - change it immediately from the
Account tab after logging in).

All data lives in data/lms.sqlite, created automatically. Back that file
up if you want to keep a season's history.

## Getting it in front of your members (hosting)

Running it on your own laptop only works while your laptop is on and members
are on the same network. For members to log in from their own phones, host
it somewhere always-on:

1. Render.com (free/low-cost web service) - create a new "Web Service",
point it at this GitHub repo, set the start command to npm start, add the
environment variables from .env.example in Render's dashboard, and add
a persistent disk mounted at the data folder path so the SQLite database
survives restarts/redeploys.
2. Railway.app - similar flow: deploy the repo, set env vars, attach a
volume for the data folder.
3. Any VPS - install Node, clone the repo, npm install, run it with a
process manager like pm2, and put it behind a domain with HTTPS.

Whichever you choose, the one thing to get right is persistent storage
for the data folder - if the host wipes the filesystem on every deploy,
your season's picks and standings will be lost, so look for a
"persistent disk" / "volume" option.

## Running each gameweek (admin workflow)

1. Admin tab -> Gameweeks & Fixtures -> Add gameweek: enter the gameweek
number and the pick deadline (kick-off of the first match is a sensible
choice).
2. Add fixtures: add each Premier League match being played that
gameweek so members can only pick from teams actually playing.
3. Members pick from the Pick tab until the deadline. Picks lock
automatically once the deadline passes.
4. After the matches are played, set each fixture's result (home win /
draw / away win), click Save results, then Process gameweek. This
automatically eliminates anyone whose pick didn't win, applies the
wipe-out reprieve rule if it applies, and updates the standings.
5. Repeat each gameweek until one member remains - the app announces a
winner on the Pick tab once only one member is left.

Use Admin -> Settings -> Reset season at the end of the season to wipe
gameweeks/fixtures/picks and reinstate everyone, while keeping your
member list and their PINs.

## Project structure

server.js - Express app & all API routes
engine.js - Elimination / wipe-out-reprieve rules engine
db.js     - SQLite schema + seed data (teams, default admin)
public/   - Front end (plain HTML/CSS/JS, no build step)
