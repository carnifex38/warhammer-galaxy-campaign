// SQLite storage for the live-event server. Uses node:sqlite, which is built into Node 22.13+ (no package to install, nothing
// native to compile). Everything lives in one file, DATA_DIR/campaign.db. The server keeps its working copy in memory and writes
// each change through to here, so a restart (or a rebuilt container with the same volume) picks up where it left off.
import { DatabaseSync } from 'node:sqlite'
import { join } from 'node:path'

/** Bump when the tables change, and add a step to `upgrade` below. */
const SCHEMA_VERSION = 1

function upgrade(db, from) {
  if (from < 1) {
    db.exec(`
      CREATE TABLE event_state (
        id      INTEGER PRIMARY KEY CHECK (id = 1),  -- one row: the map setup the gamemaster edits
        data    TEXT NOT NULL,
        updated INTEGER NOT NULL
      );
      CREATE TABLE profiles (
        id      TEXT PRIMARY KEY,
        name    TEXT NOT NULL,
        key     TEXT NOT NULL UNIQUE,                -- lower-case name, for sign-in
        salt    TEXT NOT NULL,
        hash    TEXT NOT NULL,                       -- scrypt of the password; the password itself is never stored
        created INTEGER NOT NULL,
        updated INTEGER NOT NULL,
        armies  TEXT NOT NULL DEFAULT '[]'
      );
      CREATE TABLE battlezones (
        id     TEXT PRIMARY KEY,
        status TEXT NOT NULL CHECK (status IN ('open', 'in_play')),
        winner TEXT CHECK (winner IN ('A', 'B')),
        won_at INTEGER,
        seats  TEXT NOT NULL DEFAULT '[]'
      );
      CREATE TABLE calendar_events (
        id      TEXT PRIMARY KEY,
        name    TEXT NOT NULL,
        date    TEXT NOT NULL,
        notes   TEXT NOT NULL DEFAULT '',
        planets TEXT NOT NULL DEFAULT '[]'
      );
    `)
  }
}

/** Opens (or creates) the database and brings its tables up to date. */
export function openStore(dataDir) {
  const file = join(dataDir, 'campaign.db')
  const db = new DatabaseSync(file)
  db.exec('PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL; PRAGMA busy_timeout = 5000;')
  const from = db.prepare('PRAGMA user_version').get().user_version
  if (from > SCHEMA_VERSION) throw new Error(`${file} was made by a newer version of the server. Update the server first.`)
  if (from < SCHEMA_VERSION) {
    transaction(() => {
      upgrade(db, from)
      db.exec(`PRAGMA user_version = ${SCHEMA_VERSION}`)
    })
  }

  /** Runs fn inside one transaction: all of its writes land, or none do. Nested calls join the outer one. */
  function transaction(fn) {
    if (db.isTransaction) return fn()
    db.exec('BEGIN IMMEDIATE')
    try {
      const out = fn()
      db.exec('COMMIT')
      return out
    } catch (e) {
      db.exec('ROLLBACK')
      throw e
    }
  }

  const q = {
    getState: db.prepare('SELECT data FROM event_state WHERE id = 1'),
    putState: db.prepare('INSERT INTO event_state (id, data, updated) VALUES (1, ?, ?) ON CONFLICT (id) DO UPDATE SET data = excluded.data, updated = excluded.updated'),
    dropState: db.prepare('DELETE FROM event_state'),
    allProfiles: db.prepare('SELECT * FROM profiles ORDER BY rowid'),
    putProfile: db.prepare(`
      INSERT INTO profiles (id, name, key, salt, hash, created, updated, armies) VALUES ($id, $name, $key, $salt, $hash, $created, $updated, $armies)
      ON CONFLICT (id) DO UPDATE SET name = excluded.name, key = excluded.key, salt = excluded.salt, hash = excluded.hash, updated = excluded.updated, armies = excluded.armies`),
    dropProfile: db.prepare('DELETE FROM profiles WHERE id = ?'),
    allBattlezones: db.prepare('SELECT * FROM battlezones ORDER BY rowid'),
    clearBattlezones: db.prepare('DELETE FROM battlezones'),
    putBattlezone: db.prepare('INSERT INTO battlezones (id, status, winner, won_at, seats) VALUES (?, ?, ?, ?, ?)'),
    allEvents: db.prepare('SELECT * FROM calendar_events ORDER BY rowid'),
    clearEvents: db.prepare('DELETE FROM calendar_events'),
    putEvent: db.prepare('INSERT INTO calendar_events (id, name, date, notes, planets) VALUES (?, ?, ?, ?, ?)'),
  }

  return {
    /** True when nothing has been saved yet (no setup, profiles, battlezones or events). */
    isEmpty: () => !db.prepare(`SELECT EXISTS (SELECT 1 FROM event_state) OR EXISTS (SELECT 1 FROM profiles)
      OR EXISTS (SELECT 1 FROM battlezones) OR EXISTS (SELECT 1 FROM calendar_events) AS any`).get().any,
    transaction,
    close: () => { if (db.isOpen) db.close() },

    // the map setup: { config, hulks, info, locked, teams }, or null before the gamemaster saves
    loadState: () => { const row = q.getState.get(); return row ? JSON.parse(row.data) : null },
    saveState: (s) => { if (s) q.putState.run(JSON.stringify(s), Date.now()); else q.dropState.run() },

    // player profiles, one row each: saving one player's lists writes only that row
    loadProfiles: () => q.allProfiles.all().map((r) => ({ id: r.id, name: r.name, key: r.key, salt: r.salt, hash: r.hash, created: r.created, updated: r.updated, armies: JSON.parse(r.armies) })),
    saveProfile: (p) => q.putProfile.run({ $id: p.id, $name: p.name, $key: p.key, $salt: p.salt, $hash: p.hash, $created: p.created, $updated: p.updated, $armies: JSON.stringify(p.armies ?? []) }),
    deleteProfile: (id) => q.dropProfile.run(id),

    // battlezone claims: tableId -> { status, seats, winner?, wonAt? }. Small, so a change rewrites them all in one transaction.
    loadClaims: () => Object.fromEntries(q.allBattlezones.all().map((r) => [r.id, { status: r.status, seats: JSON.parse(r.seats), ...(r.winner ? { winner: r.winner, wonAt: r.won_at ?? 0 } : {}) }])),
    saveClaims: (claims) => transaction(() => {
      q.clearBattlezones.run()
      for (const [id, t] of Object.entries(claims)) q.putBattlezone.run(id, t.status, t.winner ?? null, t.winner ? (t.wonAt ?? 0) : null, JSON.stringify(t.seats))
    }),

    // the calendar: [{ id, name, date, notes, planets }], rewritten the same way
    loadCalendar: () => q.allEvents.all().map((r) => ({ id: r.id, name: r.name, date: r.date, notes: r.notes, planets: JSON.parse(r.planets) })),
    saveCalendar: (events) => transaction(() => {
      q.clearEvents.run()
      for (const e of events) q.putEvent.run(e.id, e.name, e.date, e.notes ?? '', JSON.stringify(e.planets))
    }),
  }
}
