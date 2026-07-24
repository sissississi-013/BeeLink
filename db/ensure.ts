import { env } from "cloudflare:workers";

let schemaPromise: Promise<unknown> | null = null;

const participantTable = `CREATE TABLE IF NOT EXISTS participants (
  id TEXT PRIMARY KEY NOT NULL,
  role TEXT NOT NULL,
  display_name TEXT DEFAULT 'Unnamed participant' NOT NULL,
  operation_name TEXT,
  location TEXT,
  contact_preference TEXT,
  season_start TEXT,
  season_end TEXT,
  hive_capacity INTEGER,
  hives_needed INTEGER,
  crop TEXT,
  acres INTEGER,
  travel_radius_miles INTEGER,
  price_expectation TEXT,
  requirements TEXT,
  profile_json TEXT DEFAULT '{}' NOT NULL,
  transcript_json TEXT DEFAULT '[]' NOT NULL,
  interview_status TEXT DEFAULT 'draft' NOT NULL,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL
)`;

const observationTable = `CREATE TABLE IF NOT EXISTS observations (
  id TEXT PRIMARY KEY NOT NULL,
  participant_id TEXT NOT NULL,
  category TEXT NOT NULL,
  note TEXT NOT NULL,
  evidence_type TEXT NOT NULL,
  confidence TEXT NOT NULL,
  panorama_yaw INTEGER,
  panorama_pitch INTEGER,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL,
  FOREIGN KEY (participant_id) REFERENCES participants(id) ON DELETE CASCADE
)`;

const participantUpdatedIndex =
  "CREATE INDEX IF NOT EXISTS participants_updated_idx ON participants(updated_at)";

export function ensureSchema() {
  schemaPromise ??= env.DB.batch([
    env.DB.prepare(participantTable),
    env.DB.prepare(observationTable),
    env.DB.prepare(participantUpdatedIndex),
  ]);
  return schemaPromise;
}
