import { sql } from "drizzle-orm";
import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const participants = sqliteTable("participants", {
  id: text("id").primaryKey(),
  role: text("role", { enum: ["beekeeper", "grower"] }).notNull(),
  displayName: text("display_name").notNull().default("Unnamed participant"),
  operationName: text("operation_name"),
  location: text("location"),
  contactPreference: text("contact_preference"),
  seasonStart: text("season_start"),
  seasonEnd: text("season_end"),
  hiveCapacity: integer("hive_capacity"),
  hivesNeeded: integer("hives_needed"),
  crop: text("crop"),
  acres: integer("acres"),
  travelRadiusMiles: integer("travel_radius_miles"),
  priceExpectation: text("price_expectation"),
  requirements: text("requirements"),
  profileJson: text("profile_json").notNull().default("{}"),
  transcriptJson: text("transcript_json").notNull().default("[]"),
  interviewStatus: text("interview_status", {
    enum: ["draft", "review", "confirmed"],
  })
    .notNull()
    .default("draft"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const observations = sqliteTable("observations", {
  id: text("id").primaryKey(),
  participantId: text("participant_id")
    .notNull()
    .references(() => participants.id, { onDelete: "cascade" }),
  category: text("category").notNull(),
  note: text("note").notNull(),
  evidenceType: text("evidence_type", {
    enum: ["spoken", "visual", "measured", "documented"],
  }).notNull(),
  confidence: text("confidence", {
    enum: ["low", "medium", "high"],
  }).notNull(),
  panoramaYaw: integer("panorama_yaw"),
  panoramaPitch: integer("panorama_pitch"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});
