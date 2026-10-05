/**
 * @bannerbye/refuse — MCP-server (stdio).
 *
 * Eén tool: `refuse_cookie_banner({ url })`. Opent de pagina in een
 * headless Chromium met de TCF/GPC-voorbereiding, weigert de banner en
 * geeft terug wat er gebeurde — plus de leesbare paginatekst, zodat een
 * agent de inhoud krijgt in plaats van een banner.
 *
 *   npx @bannerbye/refuse            # start de server op stdio
 *
 * Claude Desktop / Claude Code (claude_desktop_config.json of .mcp.json):
 *   { "mcpServers": { "bannerbye": { "command": "npx", "args": ["-y", "@bannerbye/refuse"] } } }
 *
 * Vereist `playwright` met een Chromium-build (`npx playwright install chromium`).
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { prepare, refuse } from './index.ts';

const server = new McpServer({ name: 'bannerbye-refuse', version: '0.1.0' });

// Minimale SSRF-vangrail: alleen http(s) naar publieke hosts.
function assertPublicHttpUrl(raw: string): URL {
  const u = new URL(raw);
  if (u.protocol !== 'http:' && u.protocol !== 'https:') throw new Error('Only http(s) URLs are allowed.');
  const h = u.hostname.toLowerCase();
  if (
    h === 'localhost' ||
    h.endsWith('.localhost') ||
    h.endsWith('.local') ||
    h.endsWith('.internal') ||
    /^(127\.|10\.|0\.|169\.254\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(h) ||
    h === '::1' ||
    h.startsWith('[fc') ||
    h.startsWith('[fd') ||
    h.startsWith('[fe80')
  ) {
    throw new Error('Private or loopback hosts are not allowed.');
  }
  return u;
}

server.tool(
  'refuse_cookie_banner',
  'Open a web page in a headless browser, refuse its cookie banner the way the BannerBye extension does (TCF reject string + GPC before load, then "Reject all" — also behind "Manage settings"), and return the outcome plus the page text without the banner.',
  {
    url: z.string().url().describe('The page to open.'),
    timeoutMs: z.number().int().min(1000).max(30000).optional().describe('How long to keep looking for the banner (default 8000).'),
    includeText: z.boolean().optional().describe('Also return the visible page text after refusal (default true).'),
    maxTextChars: z.number().int().min(200).max(200000).optional().describe('Cap on the returned text (default 20000).'),
    screenshotPath: z.string().optional().describe('If set, write a full-page PNG to this local path after refusal.'),
  },
  async ({ url, timeoutMs, includeText, maxTextChars, screenshotPath }) => {
    const target = assertPublicHttpUrl(url);
    const { chromium } = await import('playwright');
    const browser = await chromium.launch({ headless: true });
    try {
      const context = await browser.newContext({ locale: 'en-GB' });
      await prepare(context);
      const page = await context.newPage();
      await page.goto(target.toString(), { waitUntil: 'domcontentloaded', timeout: 30000 });
      const result = await refuse(page, { timeoutMs: timeoutMs ?? 8000 });
      let text: string | undefined;
      if (includeText ?? true) {
        text = await page.evaluate(() => (document.body?.innerText || '').replace(/\n{3,}/g, '\n\n'));
        const cap = maxTextChars ?? 20000;
        if (text.length > cap) text = text.slice(0, cap) + `\n…[truncated at ${cap} chars]`;
      }
      if (screenshotPath) await page.screenshot({ path: screenshotPath, fullPage: true });
      return {
        content: [
          { type: 'text', text: JSON.stringify({ ...result, screenshotPath: screenshotPath ?? null }, null, 2) },
          ...(text !== undefined ? [{ type: 'text' as const, text }] : []),
        ],
      };
    } finally {
      await browser.close();
    }
  },
);

const transport = new StdioServerTransport();
await server.connect(transport);
