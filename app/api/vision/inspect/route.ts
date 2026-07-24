import { GoogleGenAI } from "@google/genai";
import { env } from "cloudflare:workers";

export const dynamic = "force-dynamic";

const VISION_MODEL = "gemini-2.5-flash";
const ALLOWED_IMAGE_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
]);

type VisionResult = {
  summary: string;
  observations: string[];
  limitations: string[];
};

function cleanList(value: unknown, limit: number) {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim().slice(0, 240))
    .filter(Boolean)
    .slice(0, limit);
}

export async function POST(request: Request) {
  const apiKey = process.env.GOOGLE_AI_APIKEY ?? env.GOOGLE_AI_APIKEY;
  if (!apiKey) {
    return Response.json(
      { error: "Visual verification is not configured." },
      { status: 503 },
    );
  }

  try {
    const body = (await request.json()) as {
      data?: string;
      mimeType?: string;
      sceneKind?: "real" | "synthetic";
      yaw?: number | null;
      pitch?: number | null;
    };
    if (
      !body.data ||
      !body.mimeType ||
      !ALLOWED_IMAGE_TYPES.has(body.mimeType)
    ) {
      return Response.json(
        { error: "A supported image frame is required." },
        { status: 400 },
      );
    }
    if (body.data.length > 4_500_000) {
      return Response.json(
        { error: "The visual frame is too large to verify." },
        { status: 413 },
      );
    }

    const ai = new GoogleGenAI({ apiKey, apiVersion: "v1beta" });
    const response = await ai.models.generateContent({
      model: VISION_MODEL,
      contents: [
        {
          role: "user",
          parts: [
            {
              inlineData: {
                data: body.data,
                mimeType: body.mimeType,
              },
            },
            {
              text: `Inspect this exact browser-captured field frame.

Return only conservative, directly visible evidence. Do not use outside knowledge. Do not infer hive health, colony strength, pests, disease, queen status, ownership, dates, capacity, pricing, or intent. If an object is unclear, omit it. The frame comes from a ${body.sceneKind ?? "real"} scene at yaw ${body.yaw ?? "unknown"} and pitch ${body.pitch ?? "unknown"}.

Write:
- one short factual summary;
- up to five concrete visible observations;
- any visual limitations such as blur, occlusion, distance, or an inability to inspect inside boxes.`,
            },
          ],
        },
      ],
      config: {
        temperature: 0,
        responseMimeType: "application/json",
        responseJsonSchema: {
          type: "object",
          additionalProperties: false,
          required: ["summary", "observations", "limitations"],
          properties: {
            summary: { type: "string" },
            observations: {
              type: "array",
              maxItems: 5,
              items: { type: "string" },
            },
            limitations: {
              type: "array",
              maxItems: 4,
              items: { type: "string" },
            },
          },
        },
      },
    });
    const parsed = JSON.parse(response.text ?? "{}") as Partial<VisionResult>;
    const summary =
      typeof parsed.summary === "string"
        ? parsed.summary.trim().slice(0, 400)
        : "";
    const observations = cleanList(parsed.observations, 5);
    const limitations = cleanList(parsed.limitations, 4);
    if (!summary || !observations.length) {
      return Response.json(
        { error: "The frame did not contain enough verifiable detail." },
        { status: 422 },
      );
    }

    return Response.json({
      verified: true,
      analysisId: crypto.randomUUID(),
      analyzedAt: new Date().toISOString(),
      summary,
      observations,
      limitations,
    });
  } catch (error) {
    return Response.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Could not verify the visual frame.",
      },
      { status: 502 },
    );
  }
}
