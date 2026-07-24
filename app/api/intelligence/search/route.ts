import { env } from "cloudflare:workers";

export const dynamic = "force-dynamic";

type OctenResult = {
  title?: string;
  url?: string;
  highlight?: string;
  authors?: string[];
  time_published?: string;
  time_last_crawled?: string;
};

export async function POST(request: Request) {
  const apiKey = process.env.OCTEN_API_KEY ?? env.OCTEN_API_KEY;
  if (!apiKey) {
    return Response.json(
      { error: "Real-data search is not configured on this deployment." },
      { status: 503 },
    );
  }

  let query = "";
  try {
    const body = (await request.json()) as { query?: unknown };
    query = typeof body.query === "string" ? body.query.trim() : "";
  } catch {
    return Response.json({ error: "Invalid request." }, { status: 400 });
  }

  if (query.length < 4 || query.length > 240) {
    return Response.json(
      { error: "Search must be between 4 and 240 characters." },
      { status: 400 },
    );
  }

  const groundedQuery = `${query} commercial beekeeping grower pollination source`;

  try {
    const response = await fetch("https://api.octen.ai/search", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
      },
      body: JSON.stringify({ query: groundedQuery, count: 6 }),
    });
    const payload = (await response.json()) as {
      msg?: string;
      data?: { results?: OctenResult[] };
    };

    if (!response.ok) {
      throw new Error(payload.msg || `Search provider returned ${response.status}.`);
    }

    const results = (payload.data?.results ?? [])
      .filter((item) => item.url && item.title)
      .map((item) => ({
        title: item.title,
        url: item.url,
        excerpt: item.highlight ?? "",
        authors: item.authors ?? [],
        publishedAt: item.time_published ?? null,
        crawledAt: item.time_last_crawled ?? null,
      }));

    return Response.json({ query, results });
  } catch (error) {
    return Response.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "The source search is temporarily unavailable.",
      },
      { status: 502 },
    );
  }
}
