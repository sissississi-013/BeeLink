import { GoogleGenAI, Modality } from "@google/genai";
import { env } from "cloudflare:workers";

export const dynamic = "force-dynamic";

const MODEL = "gemini-3.1-flash-live-preview";

export async function POST() {
  const apiKey = process.env.GOOGLE_AI_APIKEY ?? env.GOOGLE_AI_APIKEY;
  if (!apiKey) {
    return Response.json(
      {
        error:
          "GOOGLE_AI_APIKEY is not configured on the server. Add it to the local or hosted runtime environment.",
      },
      { status: 503 },
    );
  }

  try {
    const client = new GoogleGenAI({ apiKey, apiVersion: "v1beta" });
    const token = await client.authTokens.create({
      config: {
        uses: 1,
        expireTime: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
        newSessionExpireTime: new Date(Date.now() + 60 * 1000).toISOString(),
        liveConnectConstraints: {
          model: MODEL,
          config: {
            responseModalities: [Modality.AUDIO],
            sessionResumption: {},
          },
        },
      },
    });

    return Response.json({
      token: token.name,
      model: MODEL,
      expiresInSeconds: 60,
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Could not mint a live token.";
    return Response.json({ error: message }, { status: 502 });
  }
}
