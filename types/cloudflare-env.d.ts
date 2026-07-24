declare namespace Cloudflare {
  interface Env {
    DB: D1Database;
    ASSETS: Fetcher;
    GOOGLE_AI_APIKEY?: string;
    OCTEN_API_KEY?: string;
  }
}
