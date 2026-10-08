import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { accessToken } from "./auth.js";
import { checkAiAccess, checkIdentityFiles, checkPageSignals, publicUrl } from "./checks.js";

/**
 * Two halves, and neither needs an account to start.
 *
 * The local tools fetch a robots.txt, probe for a file, read the JSON-LD out
 * of a page. That is HTTP and parsing on the machine of whoever installed
 * this, so it costs nobody anything and works the moment the package is
 * installed.
 *
 * The remote tools are inite.ai's MCP server: the portal, the analyzer and
 * the Atlas. It answers a caller with no token too - as a guest, with the
 * open tools and the audit as a survey, the rule the website keeps for a
 * visitor without an account. Signing in makes the calls the account's: its
 * tier, its member tools, its data. A member tool called signed out answers
 * 401, and that - not the absence of a token - is when this says to sign in.
 *
 * For the remote half this process defines no schemas: it asks
 * https://inite.ai/api/mcp what it offers and forwards calls there, so the
 * tool list stays whatever the service implements today. A local copy would be
 * a second source of truth, and the first thing it would do is drift.
 */

export const REMOTE = process.env.INITE_MCP_URL ?? "https://inite.ai/api/mcp";
export const VERSION = "1.2.0";

export class NotSignedIn extends Error {
  constructor() {
    super(
      "Not signed in to inite.ai. Run `npx @inite/visibility login`, or set INITE_TOKEN in this server's environment.",
    );
  }
}

const urlArg = {
  type: "object",
  properties: {
    url: { type: "string", description: "A public site, e.g. example.com or https://example.com" },
  },
  required: ["url"],
} as const;

/** Everything here runs locally. No account, no allowance, no call home. */
export const LOCAL_TOOLS = [
  {
    name: "check_ai_access",
    description:
      "Read a site's robots.txt and say which AI crawlers may fetch it, separating the ones that retrieve pages to answer live questions from the ones that only collect training data. Blocking the first kind is what makes a site invisible in AI answers; blocking the second costs nothing. Runs locally, no account needed.",
    inputSchema: urlArg,
  },
  {
    name: "check_identity_files",
    description:
      "Probe a site for the identity files an AI engine may look for — llms.txt, ai.json, identity.json and the rest — and report which exist. Runs locally, no account needed.",
    inputSchema: urlArg,
  },
  {
    name: "check_page_signals",
    description:
      "Read a site's homepage and report the signals an engine uses to work out what it is: title, description, canonical, hreflang and the Schema.org types in its JSON-LD. Runs locally, no account needed.",
    inputSchema: urlArg,
  },
] as const;

const LOCAL_NAMES = new Set<string>(LOCAL_TOOLS.map((t) => t.name));

const fail = (message: string) => ({
  content: [{ type: "text", text: message }],
  isError: true,
});

type LocalName = (typeof LOCAL_TOOLS)[number]["name"];

async function runLocal(name: LocalName, args: Record<string, unknown>) {
  const site = publicUrl(args.url);
  if (!site) {
    return fail(
      "That does not look like a public website address. Pass a hostname such as example.com.",
    );
  }
  const body =
    name === "check_ai_access"
      ? await checkAiAccess(site)
      : name === "check_identity_files"
        ? await checkIdentityFiles(site)
        : await checkPageSignals(site);
  return { content: [{ type: "text", text: body }] };
}

let nextId = 1;

/** One JSON-RPC round trip to the remote server. */
export async function remoteCall(
  method: string,
  params: Record<string, unknown> | undefined,
  token: string | null,
  fetchImpl: typeof fetch = fetch,
): Promise<any> {
  const res = await fetchImpl(REMOTE, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      "user-agent": `inite-visibility/${VERSION}`,
    },
    body: JSON.stringify({ jsonrpc: "2.0", id: nextId++, method, params }),
  });

  if (res.status === 401) throw new NotSignedIn();
  if (!res.ok) throw new Error(`inite.ai answered ${res.status} for ${method}.`);

  const body = (await res.json()) as { result?: unknown; error?: { message?: string } };
  if (body.error) throw new Error(body.error.message ?? `${method} failed.`);
  return body.result;
}

/**
 * The tool list: local always, and the remote server's - signed in or not.
 *
 * Signed out, the remote list is the guest's view: every tool, the member
 * ones saying they need an account. If the remote cannot be reached the
 * three local checks still answer, rather than an empty list that reads as
 * a broken server.
 */
export async function listTools(): Promise<{ tools: unknown[] }> {
  const local = [...LOCAL_TOOLS];
  try {
    const token = await accessToken();
    if (!token) {
      process.stderr.write(
        `Signed out: the open tools are available as a guest. \`npx @inite/visibility login\` adds the member tools and your account's tier.\n`,
      );
    }
    const remote = (await remoteCall("tools/list", undefined, token)) as { tools?: unknown[] };
    return { tools: [...local, ...(remote.tools ?? [])] };
  } catch (e) {
    process.stderr.write(`${(e as Error).message}\n`);
    return { tools: local };
  }
}

type ToolResult = { content: { type: string; text: string }[]; isError?: boolean }

export async function callTool(name: string, args: Record<string, unknown>): Promise<ToolResult> {
  try {
    if (LOCAL_NAMES.has(name as LocalName)) return await runLocal(name as LocalName, args);
    // No token is a guest; the server says 401 for a tool that needs one,
    // and remoteCall turns that into "sign in".
    const token = await accessToken();
    return await remoteCall("tools/call", { name, arguments: args }, token);
  } catch (e) {
    // A tool that failed is a result, not a crash: the model can read this and
    // tell the person what to do about it.
    return fail((e as Error).message);
  }
}

export async function main(): Promise<void> {
  const server = new Server(
    { name: "inite-visibility", version: VERSION },
    { capabilities: { tools: {} } },
  );

  server.setRequestHandler(ListToolsRequestSchema, () => listTools());
  server.setRequestHandler(CallToolRequestSchema, (req) =>
    callTool(req.params.name, (req.params.arguments ?? {}) as Record<string, unknown>),
  );

  await server.connect(new StdioServerTransport());
}
