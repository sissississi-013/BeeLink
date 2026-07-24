import { desc, eq } from "drizzle-orm";
import { getDb } from "@/db";
import { ensureSchema } from "@/db/ensure";
import { participants } from "@/db/schema";
import { PROFILE_FIELDS, type ProfileFacts } from "@/lib/domain";

export const dynamic = "force-dynamic";

function messageFor(error: unknown) {
  const message = error instanceof Error ? error.message : "Unexpected error";
  return message.includes("no such table")
    ? "Participant storage is not ready yet."
    : message;
}

export async function GET() {
  try {
    await ensureSchema();
    const db = getDb();
    const rows = await db
      .select()
      .from(participants)
      .orderBy(desc(participants.updatedAt));
    return Response.json({ participants: rows });
  } catch (error) {
    return Response.json({ error: messageFor(error) }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    await ensureSchema();
    const body = (await request.json()) as {
      id?: string;
      role?: "beekeeper" | "grower";
      fact?: {
        field?: string;
        value?: string | number;
        evidence?: string;
        confidence?: "low" | "medium" | "high";
      };
      transcriptLine?: {
        speaker?: "participant" | "agent";
        text?: string;
        at?: string;
      };
      interviewStatus?: "draft" | "review" | "confirmed";
    };
    if (!body.id || !["beekeeper", "grower"].includes(body.role ?? "")) {
      return Response.json({ error: "id and role are required" }, { status: 400 });
    }

    const db = getDb();
    const existing = await db
      .select()
      .from(participants)
      .where(eq(participants.id, body.id))
      .limit(1);
    const current = existing[0];
    const profile = current
      ? (JSON.parse(current.profileJson) as ProfileFacts)
      : {};
    const transcript = current
      ? (JSON.parse(current.transcriptJson) as Array<Record<string, string>>)
      : [];

    const changes: Record<string, string | number | null> = {
      updatedAt: new Date().toISOString(),
    };
    if (body.fact && PROFILE_FIELDS.includes(body.fact.field as never)) {
      const field = body.fact.field as (typeof PROFILE_FIELDS)[number];
      const numberFields = new Set([
        "hiveCapacity",
        "hivesNeeded",
        "acres",
        "travelRadiusMiles",
      ]);
      const rawValue = body.fact.value;
      const value = numberFields.has(field) ? Number(rawValue) : rawValue;
      if (typeof value === "string" || typeof value === "number") {
        if (typeof value === "number" && !Number.isFinite(value)) {
          return Response.json(
            { error: `${field} must be a number` },
            { status: 400 },
          );
        }
        profile[field] = {
          value,
          source: "live_interview",
          evidence: body.fact.evidence?.slice(0, 500) || "Captured in live interview",
          confidence: body.fact.confidence ?? "medium",
          capturedAt: new Date().toISOString(),
        };
        changes[field] = value;
        changes.profileJson = JSON.stringify(profile);
      }
    }
    if (
      body.transcriptLine?.text &&
      ["participant", "agent"].includes(body.transcriptLine.speaker ?? "")
    ) {
      transcript.push({
        speaker: body.transcriptLine.speaker!,
        text: body.transcriptLine.text.slice(0, 2000),
        at: body.transcriptLine.at ?? new Date().toISOString(),
      });
      changes.transcriptJson = JSON.stringify(transcript.slice(-200));
    }
    if (body.interviewStatus) {
      changes.interviewStatus = body.interviewStatus;
    }

    if (!current) {
      await db.insert(participants).values({
        id: body.id,
        role: body.role!,
        displayName:
          typeof changes.displayName === "string"
            ? changes.displayName
            : "Unnamed participant",
        ...(changes as Record<string, string | number>),
      });
    } else {
      await db
        .update(participants)
        .set(changes)
        .where(eq(participants.id, body.id));
    }
    const [participant] = await db
      .select()
      .from(participants)
      .where(eq(participants.id, body.id))
      .limit(1);
    return Response.json({ participant }, { status: current ? 200 : 201 });
  } catch (error) {
    return Response.json({ error: messageFor(error) }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  try {
    await ensureSchema();
    const id = new URL(request.url).searchParams.get("id");
    if (!id) {
      return Response.json({ error: "id is required" }, { status: 400 });
    }
    await getDb().delete(participants).where(eq(participants.id, id));
    return Response.json({ deleted: true });
  } catch (error) {
    return Response.json({ error: messageFor(error) }, { status: 500 });
  }
}
