/**
 * The half of the audit that costs nobody anything.
 *
 * Fetching a robots.txt, probing for a file, reading the JSON-LD out of a page
 * — all of that is HTTP and parsing, and it runs on the machine of whoever
 * installed this. So it needs no account and no allowance: the work is theirs.
 *
 * What stays on the server is what actually costs something or is ours: asking
 * four answer engines whether they name a site, and the weights that turn all
 * of it into one number. These tools report facts; `analyze_site` reports a
 * score.
 *
 * The bot names and the file paths below are public — published user-agent
 * strings and proposed conventions. The weights behind them are not, and are
 * deliberately absent.
 */

import dns from "node:dns";
import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import { isIP } from "node:net";

/** Crawlers that fetch a page to answer a live question. Blocking these costs visibility. */
export const RETRIEVAL_BOTS = [
  "Bingbot",
  "OAI-SearchBot",
  "PerplexityBot",
  "ChatGPT-User",
  "Claude-SearchBot",
  "Perplexity-User",
  "Claude-User",
] as const;

/** Crawlers that collect training data. Blocking these costs nothing today. */
export const TRAINING_BOTS = [
  "GPTBot",
  "ClaudeBot",
  "Google-Extended",
  "CCBot",
  "Applebot-Extended",
  "Meta-ExternalAgent",
  "Bytespider",
  "Amazonbot",
] as const;

/** Files an engine may look for when working out who a site belongs to. */
export const IDENTITY_FILES = [
  "/llms.txt",
  "/ai.json",
  "/ai.txt",
  "/identity.json",
  "/llm.txt",
  "/llms.html",
  "/brand.txt",
  "/developer-ai.txt",
  "/faq-ai.txt",
  "/robots-ai.txt",
] as const;

const UA = "inite-visibility (+https://inite.ai)";
const TIMEOUT_MS = 10_000;
/** Redirects followed before giving up. A real site needs one or two. */
export const MAX_REDIRECTS = 5;

// ─── the public-web guard ─────────────────────────────────────────────────────

/** [first address, prefix length] of IPv4 blocks that are not the public web. */
const PRIVATE_V4: readonly (readonly [string, number])[] = [
  ["0.0.0.0", 8], // "this network", incl. 0.0.0.0 which reaches the local host
  ["10.0.0.0", 8],
  ["100.64.0.0", 10], // carrier-grade NAT
  ["127.0.0.0", 8], // loopback
  ["169.254.0.0", 16], // link-local, incl. the cloud metadata address 169.254.169.254
  ["172.16.0.0", 12],
  ["192.0.0.0", 24], // IETF protocol assignments
  ["192.0.2.0", 24], // documentation
  ["192.88.99.0", 24], // 6to4 relay anycast
  ["192.168.0.0", 16],
  ["198.18.0.0", 15], // benchmarking
  ["198.51.100.0", 24], // documentation
  ["203.0.113.0", 24], // documentation
  ["224.0.0.0", 4], // multicast
  ["240.0.0.0", 4], // reserved, incl. broadcast 255.255.255.255
] as const;

function v4Bytes(ip: string): number[] | null {
  const parts = ip.split(".");
  if (parts.length !== 4) return null;
  const bytes = parts.map((p) => (/^\d{1,3}$/.test(p) ? Number(p) : NaN));
  return bytes.every((b) => b >= 0 && b <= 255) ? bytes : null;
}

/** An IPv6 address as 16 bytes, or null. Accepts `::`, a zone id and a trailing dotted quad. */
function v6Bytes(raw: string): number[] | null {
  let ip = raw.replace(/^\[|\]$/g, "").replace(/%.*$/, "").toLowerCase();
  let tail: number[] = [];
  const quad = ip.match(/^(.*:)(\d+\.\d+\.\d+\.\d+)$/);
  if (quad) {
    const v4 = v4Bytes(quad[2]!);
    if (!v4) return null;
    tail = v4;
    ip = `${quad[1]}0:0`;
  }
  const halves = ip.split("::");
  if (halves.length > 2) return null;
  const parse = (s: string) => (s ? s.split(":") : []);
  const head = parse(halves[0]!);
  const rest = halves.length === 2 ? parse(halves[1]!) : [];
  const missing = 8 - head.length - rest.length;
  if (halves.length === 2 ? missing < 1 : missing !== 0) return null;
  const groups = [...head, ...Array(halves.length === 2 ? missing : 0).fill("0"), ...rest];
  const bytes: number[] = [];
  for (const g of groups) {
    if (!/^[0-9a-f]{1,4}$/.test(g)) return null;
    const n = parseInt(g, 16);
    bytes.push(n >> 8, n & 0xff);
  }
  if (tail.length) bytes.splice(12, 4, ...tail);
  return bytes;
}

function inPrefix(bytes: number[], base: number[], bits: number): boolean {
  for (let i = 0; i < bits; i++) {
    const mask = 0x80 >> i % 8;
    if ((bytes[i >> 3]! & mask) !== (base[i >> 3]! & mask)) return false;
  }
  return true;
}

function isPublicV4(bytes: number[]): boolean {
  return !PRIVATE_V4.some(([base, bits]) => inPrefix(bytes, v4Bytes(base)!, bits));
}

/**
 * Whether an IP address is on the public internet.
 *
 * This is what the hostname checks in `publicUrl()` cannot know on their own:
 * `intranet.example.com` may resolve to 10.0.0.5, and a public page may
 * redirect to 169.254.169.254. So every address a fetch is about to connect
 * to passes through here. IPv6 forms that carry an IPv4 address inside them
 * (mapped `::ffff:a.b.c.d`, the old compatible `::a.b.c.d`, NAT64, 6to4) are
 * judged by the IPv4 address they carry, because that is where they lead.
 * Anything that does not parse is not public.
 */
export function isPublicAddress(ip: string): boolean {
  const v4 = v4Bytes(ip);
  if (v4) return isPublicV4(v4);
  const b = v6Bytes(ip);
  if (!b) return false;
  const zeros = (from: number, to: number) => b.slice(from, to).every((x) => x === 0);
  // ::ffff:a.b.c.d (mapped) and ::a.b.c.d (compatible, incl. :: and ::1)
  if (zeros(0, 10) && ((b[10] === 0xff && b[11] === 0xff) || (b[10] === 0 && b[11] === 0))) {
    return isPublicV4(b.slice(12, 16));
  }
  // 64:ff9b::/96 — NAT64 translates to the embedded IPv4 address
  if (b[0] === 0x00 && b[1] === 0x64 && b[2] === 0xff && b[3] === 0x9b && zeros(4, 12)) {
    return isPublicV4(b.slice(12, 16));
  }
  // 2002::/16 — 6to4 tunnels to the IPv4 address in bytes 2–5
  if (b[0] === 0x20 && b[1] === 0x02) return isPublicV4(b.slice(2, 6));
  if ((b[0]! & 0xfe) === 0xfc) return false; // fc00::/7 unique-local
  if (b[0] === 0xfe && (b[1]! & 0xc0) === 0x80) return false; // fe80::/10 link-local
  if (b[0] === 0xfe && (b[1]! & 0xc0) === 0xc0) return false; // fec0::/10 old site-local
  if (b[0] === 0xff) return false; // ff00::/8 multicast
  if (b[0] === 0x01 && zeros(1, 8)) return false; // 100::/64 discard
  if (b[0] === 0x20 && b[1] === 0x01 && b[2] === 0x0d && b[3] === 0xb8) return false; // 2001:db8::/32 documentation
  return true;
}

/**
 * Only the public web, even though this runs locally.
 *
 * A model can be talked into things, and "fetch http://192.168.1.1/" from a
 * tool running on somebody's laptop is a port scan of their own network with
 * extra steps. This judges what the URL says; `isPublicAddress()` judges where
 * its name resolves to, at connect time, inside `get()`.
 */
export function publicUrl(raw: unknown): URL | null {
  if (typeof raw !== "string" || !raw.trim()) return null;
  const withScheme = /^https?:\/\//i.test(raw.trim()) ? raw.trim() : `https://${raw.trim()}`;
  try {
    const u = new URL(withScheme);
    if (!/^https?:$/.test(u.protocol)) return null;
    if (u.username || u.password) return null;
    if (!u.hostname.includes(".")) return null;
    if (/^(localhost|127\.|10\.|192\.168\.|169\.254\.|::1|\[)/i.test(u.hostname)) return null;
    if (/^172\.(1[6-9]|2\d|3[01])\./.test(u.hostname)) return null;
    // An address literal never reaches the resolver, so it is judged here.
    if (isIP(u.hostname) && !isPublicAddress(u.hostname)) return null;
    return u;
  } catch {
    return null;
  }
}

type Resolved = { address: string; family: number };
type LookupCallback = (err: NodeJS.ErrnoException | null, address: string | Resolved[], family?: number) => void;

/**
 * The resolver every local fetch connects through.
 *
 * Checking a name and then letting the HTTP client resolve it again leaves a
 * gap: a name can answer a public address to the check and a private one to
 * the connection (DNS rebinding). So the check happens here, in the `lookup`
 * the socket itself uses, and the socket connects to exactly the addresses
 * that were checked. If any address a name resolves to is not public, the
 * name is refused outright rather than raced against round-robin.
 */
export function publicLookup(
  hostname: string,
  options: { all?: boolean; family?: number | string } | number | undefined,
  callback: LookupCallback,
): void {
  const all = typeof options === "object" && options !== null && options.all === true;
  dns.lookup(hostname, { all: true }, (err, addresses) => {
    if (err) return callback(err, all ? [] : "", 0);
    const list = addresses as Resolved[];
    const refused = !list.length || list.some((a) => !isPublicAddress(a.address));
    if (refused) {
      const e: NodeJS.ErrnoException = new Error(`${hostname} does not resolve to a public address`);
      e.code = "ENOTPUBLIC";
      return callback(e, all ? [] : "", 0);
    }
    if (all) return callback(null, list);
    callback(null, list[0]!.address, list[0]!.family);
  });
}

/** One HTTP exchange, no redirects followed. The seam the tests replace. */
export type Transport = (
  url: URL,
  signal: AbortSignal,
) => Promise<{ status: number; location: string | null; body: string }>;

const nodeTransport: Transport = (url, signal) =>
  new Promise((resolve, reject) => {
    const request = url.protocol === "https:" ? httpsRequest : httpRequest;
    const req = request(
      url,
      {
        method: "GET",
        headers: { "user-agent": UA, accept: "*/*" },
        lookup: publicLookup as never,
        signal,
      },
      (res) => {
        const status = res.statusCode ?? 0;
        const location = typeof res.headers.location === "string" ? res.headers.location : null;
        if (status !== 200) {
          res.resume();
          return resolve({ status, location, body: "" });
        }
        const chunks: Buffer[] = [];
        res.on("data", (c: Buffer) => chunks.push(c));
        res.on("end", () => resolve({ status, location, body: Buffer.concat(chunks).toString("utf8") }));
        res.on("error", reject);
      },
    );
    req.on("error", reject);
    req.end();
  });

const REDIRECTS = new Set([301, 302, 303, 307, 308]);

/**
 * The only fetch the local tools make.
 *
 * Redirects are followed here, by hand, rather than by the HTTP client,
 * because each hop is a new URL the site chose: it gets the same
 * `publicUrl()` check as the one the person typed, and its name goes through
 * `publicLookup()` like the first. A chain longer than `MAX_REDIRECTS`, or a
 * hop that leaves the public web, ends the fetch as unreachable.
 */
export async function get(
  url: string,
  transport: Transport = nodeTransport,
): Promise<{ status: number; body: string } | null> {
  const signal = AbortSignal.timeout(TIMEOUT_MS);
  let current = publicUrl(url);
  try {
    for (let hop = 0; current; hop++) {
      const res = await transport(current, signal);
      if (!REDIRECTS.has(res.status) || !res.location) return { status: res.status, body: res.body };
      if (hop >= MAX_REDIRECTS) return null;
      const next = new URL(res.location, current);
      current = /^https?:$/.test(next.protocol) ? publicUrl(next.toString()) : null;
    }
    return null;
  } catch {
    return null;
  }
}

// ─── robots.txt ───────────────────────────────────────────────────────────────

interface Group {
  agents: string[];
  rules: { allow: boolean; path: string }[];
}

/**
 * Parse robots.txt into agent groups.
 *
 * Deliberately not a full implementation: no crawl-delay, no sitemap, no
 * wildcard expansion beyond a leading match. It answers one question — is this
 * agent allowed to fetch the root — and says so rather than pretending to more.
 */
export function parseRobots(text: string): Group[] {
  const groups: Group[] = [];
  let current: Group | null = null;
  let lastWasAgent = false;

  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/#.*$/, "").trim();
    if (!line) continue;
    const idx = line.indexOf(":");
    if (idx === -1) continue;
    const field = line.slice(0, idx).trim().toLowerCase();
    const value = line.slice(idx + 1).trim();

    if (field === "user-agent") {
      // Consecutive User-agent lines share one group of rules.
      if (!current || !lastWasAgent) {
        current = { agents: [], rules: [] };
        groups.push(current);
      }
      current.agents.push(value.toLowerCase());
      lastWasAgent = true;
      continue;
    }
    lastWasAgent = false;
    if (!current) continue;
    if (field === "allow" || field === "disallow") {
      current.rules.push({ allow: field === "allow", path: value });
    }
  }
  return groups;
}

/** Whether `agent` may fetch `path`, by the most specific group that names it. */
export function isAllowed(groups: Group[], agent: string, path = "/"): boolean {
  const lower = agent.toLowerCase();
  const named = groups.find((g) => g.agents.includes(lower));
  const wildcard = groups.find((g) => g.agents.includes("*"));
  const group = named ?? wildcard;
  if (!group) return true;

  // Longest matching rule wins; Allow beats Disallow at equal length.
  let best: { allow: boolean; len: number } | null = null;
  for (const rule of group.rules) {
    if (rule.path === "") continue;
    if (!path.startsWith(rule.path.replace(/\*$/, ""))) continue;
    const len = rule.path.length;
    if (!best || len > best.len || (len === best.len && rule.allow)) {
      best = { allow: rule.allow, len };
    }
  }
  // An empty Disallow means "allow everything" and is handled by the skip above.
  return best ? best.allow : true;
}

export async function checkAiAccess(site: URL): Promise<string> {
  const robots = await get(new URL("/robots.txt", site).toString());
  if (!robots) return `Could not reach ${site.hostname}.`;
  if (robots.status !== 200) {
    return [
      `${site.hostname} has no robots.txt (HTTP ${robots.status}).`,
      ``,
      `Nothing is blocked, which is the permissive default. It also means no`,
      `crawler is being told anything on purpose.`,
    ].join("\n");
  }

  const groups = parseRobots(robots.body);
  const blockedRetrieval = RETRIEVAL_BOTS.filter((b) => !isAllowed(groups, b));
  const blockedTraining = TRAINING_BOTS.filter((b) => !isAllowed(groups, b));

  const lines = [`Crawler policy for ${site.hostname}`, ``];

  lines.push(
    blockedRetrieval.length === 0
      ? `Retrieval: all ${RETRIEVAL_BOTS.length} answer-engine crawlers may fetch the site.`
      : `Retrieval: ${blockedRetrieval.length} of ${RETRIEVAL_BOTS.length} blocked — ${blockedRetrieval.join(", ")}.`,
  );
  if (blockedRetrieval.length) {
    lines.push(
      `These are the ones that fetch a page to answer a live question. Blocking`,
      `them is what makes a site invisible in AI answers, whatever its search rank.`,
    );
  }

  lines.push(``);
  lines.push(
    blockedTraining.length === 0
      ? `Training: none of the ${TRAINING_BOTS.length} training crawlers are blocked.`
      : `Training: ${blockedTraining.length} of ${TRAINING_BOTS.length} blocked — ${blockedTraining.join(", ")}.`,
  );
  lines.push(
    `Training crawlers collect corpus data. Blocking them costs no visibility`,
    `today, whatever a checklist says — they are a separate decision.`,
  );

  return lines.join("\n");
}

// ─── identity files ───────────────────────────────────────────────────────────

export async function checkIdentityFiles(site: URL): Promise<string> {
  const results = await Promise.all(
    IDENTITY_FILES.map(async (path) => {
      const res = await get(new URL(path, site).toString());
      // A site that answers 200 to everything tells you nothing; a body that is
      // clearly a page rather than the file is the usual way that shows up.
      const looksLikeHtml = /^\s*<(!doctype|html)/i.test(res?.body ?? "");
      return { path, found: res?.status === 200 && !looksLikeHtml, bytes: res?.body.length ?? 0 };
    }),
  );

  const found = results.filter((r) => r.found);
  const lines = [
    `Identity files on ${site.hostname}: ${found.length} of ${IDENTITY_FILES.length}`,
    ``,
  ];
  for (const r of results) {
    lines.push(`  ${r.found ? "yes" : " no"}  ${r.path}${r.found ? `  (${r.bytes} bytes)` : ""}`);
  }
  lines.push(``);
  lines.push(
    found.length === 0
      ? `None of these are a ranking factor, and none are required. They are how a`
      : `None of these are a ranking factor. They are how a`,
    `site states plainly who it is, for an engine that would otherwise guess from`,
    `the page. /llms.txt is the one with the most adoption.`,
  );
  return lines.join("\n");
}

// ─── page signals ─────────────────────────────────────────────────────────────

function jsonLdTypes(html: string): string[] {
  const types = new Set<string>();
  const re = /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  for (const m of html.matchAll(re)) {
    try {
      const parsed = JSON.parse(m[1]!);
      const walk = (node: unknown): void => {
        if (Array.isArray(node)) return node.forEach(walk);
        if (node && typeof node === "object") {
          const t = (node as Record<string, unknown>)["@type"];
          if (typeof t === "string") types.add(t);
          if (Array.isArray(t)) t.forEach((x) => typeof x === "string" && types.add(x));
          if (Array.isArray((node as Record<string, unknown>)["@graph"])) {
            walk((node as Record<string, unknown>)["@graph"]);
          }
        }
      };
      walk(parsed);
    } catch {
      // A block that does not parse is a finding of its own, reported below.
      types.add("(unparseable JSON-LD)");
    }
  }
  return [...types];
}

const meta = (html: string, re: RegExp): string | null => html.match(re)?.[1]?.trim() ?? null;

export async function checkPageSignals(site: URL): Promise<string> {
  const page = await get(site.toString());
  if (!page) return `Could not reach ${site.hostname}.`;
  if (page.status !== 200) return `${site} answered HTTP ${page.status}.`;

  const html = page.body;
  const title = meta(html, /<title[^>]*>([\s\S]*?)<\/title>/i);
  const description = meta(html, /<meta[^>]+name=["']description["'][^>]+content=["']([^"']*)["']/i);
  const canonical = meta(html, /<link[^>]+rel=["']canonical["'][^>]+href=["']([^"']*)["']/i);
  const types = jsonLdTypes(html);
  // Deduplicated, but the repeat count is kept: the same hreflang declared
  // twice is a finding, not noise to hide.
  const hreflangRaw = [...html.matchAll(/<link[^>]+rel=["']alternate["'][^>]+hreflang=["']([^"']*)["']/gi)]
    .map((m) => m[1])
    .filter((x): x is string => Boolean(x));
  const counts = new Map<string, number>();
  for (const h of hreflangRaw) counts.set(h, (counts.get(h) ?? 0) + 1);
  const hreflang = [...counts].map(([tag, n]) => (n > 1 ? `${tag} (×${n})` : tag));

  return [
    `Page signals for ${site.hostname}`,
    ``,
    `  title        ${title ?? "— missing"}`,
    `  description  ${description ?? "— missing"}`,
    `  canonical    ${canonical ?? "— missing"}`,
    `  hreflang     ${hreflang.length ? hreflang.join(", ") : "— none"}`,
    `  schema.org   ${types.length ? types.join(", ") : "— no JSON-LD found"}`,
    ``,
    types.length
      ? `An engine reads the graph before it reads the prose. Organization and`
      : `Without JSON-LD an engine has only the prose to work from, and has to`,
    types.length
      ? `WebSite are the two that answer "who is this".`
      : `infer who the site belongs to.`,
  ].join("\n");
}
