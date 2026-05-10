import { chromium, type Browser, type BrowserContext, type Page } from "playwright";

let browser: Browser | null = null;
let context: BrowserContext | null = null;
let page: Page | null = null;

export async function getPage(): Promise<Page> {
  if (page) return page;
  browser = await chromium.launch({ headless: true });
  context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  await applyProviderSessions(context);
  page = await context.newPage();
  return page;
}

export async function closeBrowser() {
  await browser?.close().catch(() => {});
  browser = null;
  context = null;
  page = null;
}

// Inject provider session tokens (set in the Settings tab) as cookies so the
// inside-VM agent operates as the logged-in user. The token format depends on
// the provider — pass either:
//   - a single cookie value (we'll set it on the conventional cookie name), or
//   - a JSON array of cookies in Playwright's storageState shape.
async function applyProviderSessions(ctx: BrowserContext) {
  const sessions: Array<{ env: string; domain: string; cookieName: string }> = [
    { env: "MULERUN_SESSION", domain: ".mulerun.com", cookieName: "session" },
    { env: "TASKLET_SESSION", domain: ".tasklet.ai", cookieName: "session" },
  ];
  for (const s of sessions) {
    const raw = process.env[s.env];
    if (!raw) continue;
    try {
      // If JSON, treat as a Playwright cookies array.
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        await ctx.addCookies(parsed);
        continue;
      }
    } catch {
      // fallthrough — single value
    }
    await ctx.addCookies([
      {
        name: s.cookieName,
        value: raw,
        domain: s.domain,
        path: "/",
        httpOnly: true,
        secure: true,
        sameSite: "Lax",
      },
    ]);
  }
}
