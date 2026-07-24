import { desc } from "drizzle-orm";
import { getDb } from "@/db";
import { ensureSchema } from "@/db/ensure";
import { observations } from "@/db/schema";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await ensureSchema();
    const rows = await getDb()
      .select()
      .from(observations)
      .orderBy(desc(observations.createdAt))
      .limit(100);
    return Response.json({ observations: rows });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Could not load observations.";
    return Response.json({ error: message }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    await ensureSchema();
    const body = (await request.json()) as {
      id?: string;
      participantId?: string;
      category?: string;
      note?: string;
      evidenceType?: "spoken" | "visual" | "measured" | "documented";
      confidence?: "low" | "medium" | "high";
      panoramaYaw?: number | null;
      panoramaPitch?: number | null;
    };
    if (!body.participantId || !body.category || !body.note) {
      return Response.json(
        { error: "participantId, category, and note are required" },
        { status: 400 },
      );
    }
    const [observation] = await getDb()
      .insert(observations)
      .values({
        id: body.id ?? crypto.randomUUID(),
        participantId: body.participantId,
        category: body.category.slice(0, 120),
        note: body.note.slice(0, 1000),
        evidenceType: body.evidenceType ?? "spoken",
        confidence: body.confidence ?? "medium",
        panoramaYaw: body.panoramaYaw ?? null,
        panoramaPitch: body.panoramaPitch ?? null,
      })
      .returning();
    return Response.json({ observation }, { status: 201 });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Could not save observation.";
    return Response.json({ error: message }, { status: 500 });
  }
}
