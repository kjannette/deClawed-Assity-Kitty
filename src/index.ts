import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { google, gmail_v1 } from "googleapis";
import fs from "fs";
import path from "path";

// ---------------------------------------------------------------------------
// Paths — resolved relative to the compiled build/ directory, up one level
// to the project root where credentials.json, token.json, and summary.json live.
// ---------------------------------------------------------------------------
const __dirname = path.dirname(new URL(import.meta.url).pathname);
const PROJECT_ROOT = path.resolve(__dirname, "..");
const CREDENTIALS_PATH = path.join(PROJECT_ROOT, "credentials.json");
const TOKEN_PATH = path.join(PROJECT_ROOT, "token.json");
const SUMMARY_PATH = path.join(PROJECT_ROOT, "summary.json");
const PROMPT_PATH = path.join(PROJECT_ROOT, "classify-emails.txt");

// ---------------------------------------------------------------------------
// Load classification prompt
// ---------------------------------------------------------------------------
function loadClassificationPrompt(): string {
  if (!fs.existsSync(PROMPT_PATH)) {
    console.error(`Warning: ${PROMPT_PATH} not found. Classification instructions will be missing.`);
    return "";
  }
  return fs.readFileSync(PROMPT_PATH, "utf-8");
}

// ---------------------------------------------------------------------------
// Gmail auth helper
// ---------------------------------------------------------------------------
function getGmailClient(): gmail_v1.Gmail {
  if (!fs.existsSync(CREDENTIALS_PATH)) {
    throw new Error(
      `Missing credentials.json at ${CREDENTIALS_PATH}. Run "npm run auth" first.`
    );
  }
  if (!fs.existsSync(TOKEN_PATH)) {
    throw new Error(
      `Missing token.json at ${TOKEN_PATH}. Run "npm run auth" first.`
    );
  }

  const credentials = JSON.parse(fs.readFileSync(CREDENTIALS_PATH, "utf-8"));
  const { client_id, client_secret, redirect_uris } =
    credentials.installed || credentials.web;

  const oAuth2Client = new google.auth.OAuth2(
    client_id,
    client_secret,
    redirect_uris[0]
  );

  const token = JSON.parse(fs.readFileSync(TOKEN_PATH, "utf-8"));
  oAuth2Client.setCredentials(token);

  // Persist refreshed tokens automatically
  oAuth2Client.on("tokens", (newTokens) => {
    const current = JSON.parse(fs.readFileSync(TOKEN_PATH, "utf-8"));
    fs.writeFileSync(
      TOKEN_PATH,
      JSON.stringify({ ...current, ...newTokens }, null, 2)
    );
    console.error("Token refreshed and saved.");
  });

  return google.gmail({ version: "v1", auth: oAuth2Client });
}

// ---------------------------------------------------------------------------
// Email parsing helpers
// ---------------------------------------------------------------------------
function getHeader(
  headers: gmail_v1.Schema$MessagePartHeader[] | undefined,
  name: string
): string {
  if (!headers) return "";
  const header = headers.find(
    (h) => h.name?.toLowerCase() === name.toLowerCase()
  );
  return header?.value ?? "";
}

function decodeBody(message: gmail_v1.Schema$Message): string {
  const parts = message.payload?.parts;
  let encoded = "";

  if (parts) {
    // Multipart message — prefer text/plain
    const textPart = parts.find((p) => p.mimeType === "text/plain");
    encoded = textPart?.body?.data ?? "";

    // Fallback to text/html if no plain text
    if (!encoded) {
      const htmlPart = parts.find((p) => p.mimeType === "text/html");
      encoded = htmlPart?.body?.data ?? "";
    }
  } else {
    // Single-part message
    encoded = message.payload?.body?.data ?? "";
  }

  if (!encoded) {
    return message.snippet ?? "";
  }

  return Buffer.from(encoded, "base64url").toString("utf-8");
}

// ---------------------------------------------------------------------------
// MCP Server
// ---------------------------------------------------------------------------
const server = new McpServer({
  name: "assistant",
  version: "1.0.0",
});

// ---------------------------------------------------------------------------
// Prompt: review_emails
// ---------------------------------------------------------------------------
server.registerPrompt(
  "review_emails",
  {
    description:
      "Review inbox, classify job application emails (A/B/C/D), delete A+C, summarize B+D.",
  },
  () => {
    const instructions = loadClassificationPrompt();
    return {
      messages: [
        {
          role: "user" as const,
          content: {
            type: "text" as const,
            text: instructions ||
              "Review my new emails and classify them by job application category.",
          },
        },
      ],
    };
  }
);

// ---------------------------------------------------------------------------
// Tool: fetch_new_emails
// ---------------------------------------------------------------------------
server.registerTool(
  "fetch_new_emails",
  {
    description:
      "Fetch unread emails from the Gmail inbox. Returns sender, date, " +
      "subject, message ID, and body text for each message. The message IDs " +
      "can be passed to delete_emails later.",
    inputSchema: {
      maxResults: z
        .number()
        .min(1)
        .max(100)
        .describe("Maximum number of unread emails to fetch (1-100)"),
    },
  },
  async ({ maxResults }) => {
    try {
      const gmail = getGmailClient();

      const listResponse = await gmail.users.messages.list({
        userId: "me",
        q: "is:unread",
        maxResults,
      });

      const messageIds = listResponse.data.messages ?? [];

      if (messageIds.length === 0) {
        return {
          content: [{ type: "text" as const, text: "No unread emails found." }],
        };
      }

      const emails: string[] = [];

      for (const msg of messageIds) {
        const detail = await gmail.users.messages.get({
          userId: "me",
          id: msg.id!,
          format: "full",
        });

        const headers = detail.data.payload?.headers;
        const from = getHeader(headers, "From");
        const subject = getHeader(headers, "Subject");
        const date = getHeader(headers, "Date");
        const body = decodeBody(detail.data);

        // Truncate body to avoid overwhelming the context window
        const truncatedBody =
          body.length > 2000 ? body.substring(0, 2000) + "\n[...truncated]" : body;

        emails.push(
          [
            `MESSAGE_ID: ${msg.id}`,
            `FROM: ${from}`,
            `DATE: ${date}`,
            `SUBJECT: ${subject}`,
            `BODY:\n${truncatedBody}`,
          ].join("\n")
        );
      }

      const classificationInstructions = loadClassificationPrompt();
      const instructionsBlock = classificationInstructions
        ? `\n\n${"=".repeat(60)}\nCLASSIFICATION INSTRUCTIONS:\n${"=".repeat(60)}\n${classificationInstructions}`
        : "";

      return {
        content: [
          {
            type: "text" as const,
            text:
              `Found ${emails.length} unread email(s):\n\n` +
              `${"=".repeat(60)}\n${emails.join(`\n${"=".repeat(60)}\n`)}` +
              instructionsBlock,
          },
        ],
      };
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : String(error);
      return {
        content: [
          {
            type: "text" as const,
            text: `Error fetching emails: ${errMsg}`,
          },
        ],
      };
    }
  }
);

// ---------------------------------------------------------------------------
// Tool: delete_emails
// ---------------------------------------------------------------------------
server.registerTool(
  "delete_emails",
  {
    description:
      "Move emails to trash by their Gmail message IDs. Use this for " +
      "category A (acknowledgements) and category C (rejections) emails.",
    inputSchema: {
      messageIds: z
        .array(z.string())
        .describe("Array of Gmail message IDs to move to trash"),
    },
  },
  async ({ messageIds }) => {
    try {
      const gmail = getGmailClient();
      const results: string[] = [];

      for (const id of messageIds) {
        try {
          await gmail.users.messages.trash({
            userId: "me",
            id,
          });
          results.push(`Trashed: ${id}`);
        } catch (err) {
          const errMsg = err instanceof Error ? err.message : String(err);
          results.push(`Failed to trash ${id}: ${errMsg}`);
        }
      }

      return {
        content: [
          {
            type: "text" as const,
            text: `Delete results:\n${results.join("\n")}`,
          },
        ],
      };
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : String(error);
      return {
        content: [
          {
            type: "text" as const,
            text: `Error deleting emails: ${errMsg}`,
          },
        ],
      };
    }
  }
);

// ---------------------------------------------------------------------------
// Tool: append_to_summary
// ---------------------------------------------------------------------------
interface SummaryEntry {
  senderName: string;
  senderEmail: string;
  dateReceived: string;
  subject: string;
  category: "B" | "D";
  addedAt: string;
}

server.registerTool(
  "append_to_summary",
  {
    description:
      "Append classified email entries to the local summary file. Use this " +
      "for category B (advancement to next step) and category D (other) emails. " +
      "Each entry records the sender, date, subject, and category.",
    inputSchema: {
      entries: z
        .array(
          z.object({
            senderName: z.string().describe("Name of the sender"),
            senderEmail: z.string().describe("Email address of the sender"),
            dateReceived: z
              .string()
              .describe("Date and time the email was received"),
            subject: z.string().describe("Email subject line"),
            category: z
              .enum(["B", "D"])
              .describe(
                "Category: B = advancement to next step, D = other/uncategorized"
              ),
          })
        )
        .describe("Array of email summary entries to append"),
    },
  },
  async ({ entries }) => {
    try {
      // Load existing summary or start fresh
      let summary: SummaryEntry[] = [];
      if (fs.existsSync(SUMMARY_PATH)) {
        summary = JSON.parse(fs.readFileSync(SUMMARY_PATH, "utf-8"));
      }

      const now = new Date().toISOString();
      const newEntries: SummaryEntry[] = entries.map((e) => ({
        ...e,
        addedAt: now,
      }));

      summary.push(...newEntries);
      fs.writeFileSync(SUMMARY_PATH, JSON.stringify(summary, null, 2));

      return {
        content: [
          {
            type: "text" as const,
            text:
              `Appended ${newEntries.length} entry/entries to summary.\n` +
              `Total entries in summary: ${summary.length}\n` +
              `Summary file: ${SUMMARY_PATH}`,
          },
        ],
      };
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : String(error);
      return {
        content: [
          {
            type: "text" as const,
            text: `Error appending to summary: ${errMsg}`,
          },
        ],
      };
    }
  }
);

// ---------------------------------------------------------------------------
// Start server
// ---------------------------------------------------------------------------
async function main(): Promise<void> {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("Assistant MCP Server running on stdio");
}

main().catch((error) => {
  console.error("Fatal error in main():", error);
  process.exit(1);
});
