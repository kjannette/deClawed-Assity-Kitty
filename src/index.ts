import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { google, gmail_v1, sheets_v4, calendar_v3 } from "googleapis";
import { OAuth2Client } from "google-auth-library";
import fs from "fs";
import path from "path";

// ---------------------------------------------------------------------------
// Paths — resolved relative to the compiled build/ directory, up one level
// to the project root where credentials.json, token.json, and summary.json live.
// ---------------------------------------------------------------------------
const __dirname = path.dirname(new URL(import.meta.url).pathname);
const PROJECT_ROOT = path.resolve(__dirname, "..");
const CREDENTIALS_PATH = path.join(PROJECT_ROOT, "credentials.json");
const ACCOUNTS_PATH = path.join(PROJECT_ROOT, "accounts.json");
const CLASSIFY_PROMPT_PATH = path.join(PROJECT_ROOT, "classify-emails.txt");
const ACTION_PROMPT_PATH = path.join(
  PROJECT_ROOT, "src", "prompts", "take-action-on-emails.txt"
);

// ---------------------------------------------------------------------------
// Account configuration
// ---------------------------------------------------------------------------
interface AccountConfig {
  label: string;
  tokenFile: string;
  spreadsheetId?: string;
  calendarId?: string;
}

interface AccountsMap {
  [key: string]: AccountConfig;
}

function loadAccounts(): AccountsMap {
  if (!fs.existsSync(ACCOUNTS_PATH)) {
    throw new Error(`Missing accounts.json at ${ACCOUNTS_PATH}.`);
  }
  return JSON.parse(fs.readFileSync(ACCOUNTS_PATH, "utf-8"));
}

function getTokenPath(account: string): string {
  const accounts = loadAccounts();
  const acct = accounts[account];
  if (!acct) {
    const available = Object.keys(accounts).join(", ");
    throw new Error(
      `Unknown account "${account}". Available accounts: ${available}`
    );
  }
  return path.join(PROJECT_ROOT, acct.tokenFile);
}

function getSummaryPath(account: string): string {
  if (account === "work") {
    return path.join(PROJECT_ROOT, "summary.json");
  }
  return path.join(PROJECT_ROOT, `summary-${account}.json`);
}

const VALID_ACCOUNTS = ["work", "secondary"] as const;
const accounts = loadAccounts();
const accountDescription = VALID_ACCOUNTS
  .map((key) => `"${key}" (${accounts[key]?.label ?? key})`)
  .join(" or ");
const accountSchema = z
  .enum(VALID_ACCOUNTS)
  .describe(`Which email account to use: ${accountDescription}`);

// ---------------------------------------------------------------------------
// Prompt loaders
// ---------------------------------------------------------------------------
function loadPromptFile(filePath: string, label: string): string {
  if (!fs.existsSync(filePath)) {
    console.error(`Warning: ${filePath} not found. ${label} will be missing.`);
    return "";
  }
  return fs.readFileSync(filePath, "utf-8");
}

function loadClassificationPrompt(): string {
  return loadPromptFile(CLASSIFY_PROMPT_PATH, "Classification instructions");
}

function loadActionPrompt(): string {
  return loadPromptFile(ACTION_PROMPT_PATH, "Action instructions");
}

// ---------------------------------------------------------------------------
// Auth helpers — generic OAuth2 client, then service-specific factories
// ---------------------------------------------------------------------------
function getOAuth2Client(account: string): OAuth2Client {
  const tokenPath = getTokenPath(account);

  if (!fs.existsSync(CREDENTIALS_PATH)) {
    throw new Error(
      `Missing credentials.json at ${CREDENTIALS_PATH}. Run "npm run auth" first.`
    );
  }
  if (!fs.existsSync(tokenPath)) {
    throw new Error(
      `Missing token file at ${tokenPath} for account "${account}". Run "npm run auth" first.`
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

  const token = JSON.parse(fs.readFileSync(tokenPath, "utf-8"));
  oAuth2Client.setCredentials(token);

  oAuth2Client.on("tokens", (newTokens) => {
    const current = JSON.parse(fs.readFileSync(tokenPath, "utf-8"));
    fs.writeFileSync(
      tokenPath,
      JSON.stringify({ ...current, ...newTokens }, null, 2)
    );
    console.error(`Token refreshed and saved for account "${account}".`);
  });

  return oAuth2Client;
}

function getGmailClient(account: string): gmail_v1.Gmail {
  return google.gmail({ version: "v1", auth: getOAuth2Client(account) });
}

function getSheetsClient(account: string): sheets_v4.Sheets {
  return google.sheets({ version: "v4", auth: getOAuth2Client(account) });
}

function getCalendarClient(account: string): calendar_v3.Calendar {
  return google.calendar({ version: "v3", auth: getOAuth2Client(account) });
}

function getSpreadsheetId(account: string): string {
  const acct = accounts[account];
  if (!acct?.spreadsheetId || acct.spreadsheetId === "PASTE_YOUR_SHEET_ID_HERE") {
    throw new Error(
      `No spreadsheetId configured for account "${account}" in accounts.json.`
    );
  }
  return acct.spreadsheetId;
}

function getCalendarId(account: string): string {
  return accounts[account]?.calendarId ?? "primary";
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
// Prompt: review_emails (work account)
// ---------------------------------------------------------------------------
server.registerPrompt(
  "review_emails",
  {
    description:
      `Review WORK inbox (${accounts.work?.label ?? "work"}): classify emails, delete A+C, summarize B+D, log B to spreadsheet, create calendar events.`,
  },
  () => {
    const phase1 = loadClassificationPrompt();
    const phase2 = loadActionPrompt();
    return {
      messages: [
        {
          role: "user" as const,
          content: {
            type: "text" as const,
            text:
              `ACCOUNT: Use account = "work" for ALL tool calls in this session.\n\n` +
              (phase1 || "Review my new emails and classify them by job application category.") +
              (phase2 ? `\n\n${phase2}` : ""),
          },
        },
      ],
    };
  }
);

// ---------------------------------------------------------------------------
// Prompt: review_secondary_emails (secondary account)
// ---------------------------------------------------------------------------
server.registerPrompt(
  "review_secondary_emails",
  {
    description:
      `Review SECONDARY inbox (${accounts.secondary?.label ?? "secondary"}): classify emails, delete A+C, summarize B+D, log B to spreadsheet, create calendar events.`,
  },
  () => {
    const phase1 = loadClassificationPrompt();
    const phase2 = loadActionPrompt();
    return {
      messages: [
        {
          role: "user" as const,
          content: {
            type: "text" as const,
            text:
              `ACCOUNT: Use account = "secondary" for ALL tool calls in this session.\n\n` +
              (phase1 || "Review my new emails and classify them by job application category.") +
              (phase2 ? `\n\n${phase2}` : ""),
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
      "Fetch unread emails from a Gmail inbox. Returns sender, date, " +
      "subject, message ID, and body text for each message. The message IDs " +
      "can be passed to delete_emails later. Specify which account to fetch from.",
    inputSchema: {
      account: accountSchema,
      maxResults: z
        .number()
        .min(1)
        .max(100)
        .describe("Maximum number of unread emails to fetch (1-100)"),
    },
  },
  async ({ account, maxResults }) => {
    try {
      const gmail = getGmailClient(account);

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
      const actionInstructions = loadActionPrompt();
      const instructionsBlock =
        (classificationInstructions
          ? `\n\n${"=".repeat(60)}\nCLASSIFICATION INSTRUCTIONS (PHASE 1):\n${"=".repeat(60)}\n${classificationInstructions}`
          : "") +
        (actionInstructions
          ? `\n\n${"=".repeat(60)}\nACTION INSTRUCTIONS (PHASE 2):\n${"=".repeat(60)}\n${actionInstructions}`
          : "");

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
      "category A (acknowledgements) and category C (rejections) emails. " +
      "Specify which account the emails belong to.",
    inputSchema: {
      account: accountSchema,
      messageIds: z
        .array(z.string())
        .describe("Array of Gmail message IDs to move to trash"),
    },
  },
  async ({ account, messageIds }) => {
    try {
      const gmail = getGmailClient(account);
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
      "Each entry records the sender, date, subject, and category. " +
      "Specify which account the emails belong to.",
    inputSchema: {
      account: accountSchema,
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
  async ({ account, entries }) => {
    try {
      const summaryPath = getSummaryPath(account);

      // Load existing summary or start fresh
      let summary: SummaryEntry[] = [];
      if (fs.existsSync(summaryPath)) {
        summary = JSON.parse(fs.readFileSync(summaryPath, "utf-8"));
      }

      const now = new Date();
      const nowIso = now.toISOString();
      const newEntries: SummaryEntry[] = entries.map((e) => ({
        ...e,
        addedAt: nowIso,
      }));

      summary.push(...newEntries);

      // Purge entries older than 30 days
      const RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
      const cutoff = now.getTime() - RETENTION_MS;
      const beforePurge = summary.length;
      summary = summary.filter(
        (entry) => new Date(entry.addedAt).getTime() >= cutoff
      );
      const purged = beforePurge - summary.length;

      fs.writeFileSync(summaryPath, JSON.stringify(summary, null, 2));

      const purgeNote = purged > 0
        ? `\nPurged ${purged} entry/entries older than 30 days.`
        : "";

      return {
        content: [
          {
            type: "text" as const,
            text:
              `Appended ${newEntries.length} entry/entries to summary.\n` +
              `Total entries in summary: ${summary.length}\n` +
              `Summary file: ${summaryPath}` +
              purgeNote,
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
// Sheet column layout for "Recruiter Communication Log and Call Schedule"
// ---------------------------------------------------------------------------
const SHEET_COLUMNS = [
  "Recruiter Name",            // A
  "Recruiter Email",           // B
  "Recruiter Tel",             // C
  "Company/Role",              // D
  "First Contact",             // E
  "Subsequent Contact(s)",     // F
  "Recruiter Call Scheduled",  // G
  "Company Contact Info",      // H
  "Company First Interview",   // I
  "Company Second Interview",  // J
];

const SHEET_RANGE = "Sheet1";

// ---------------------------------------------------------------------------
// Tool: log_recruiter_contact
// ---------------------------------------------------------------------------
server.registerTool(
  "log_recruiter_contact",
  {
    description:
      "Log or update recruiter contact info in the tracking spreadsheet. " +
      "If a row already exists for the same recruiterEmail + companyRole, it " +
      "updates the existing row (merging non-empty fields). Otherwise appends " +
      "a new row. Use for Category B emails after classification.",
    inputSchema: {
      account: accountSchema,
      recruiterName: z.string().describe("Recruiter's full name"),
      recruiterEmail: z.string().describe("Recruiter's email address"),
      recruiterTel: z
        .string()
        .optional()
        .describe("Recruiter's phone number, if mentioned in the email"),
      companyRole: z
        .string()
        .describe("Company name and role the recruiter seeks to fill"),
      firstContact: z
        .string()
        .describe("Date/time of first contact (from the email's Date header)"),
      subsequentContacts: z
        .string()
        .optional()
        .describe("Any follow-up contact context mentioned in the email"),
      recruiterCallScheduled: z
        .string()
        .optional()
        .describe(
          "Scheduled call details: date, time, platform (Zoom/Teams), " +
          "meeting link or phone, and whether they have your cell number"
        ),
      companyContactInfo: z
        .string()
        .optional()
        .describe("Company interviewer name/email/tel if advancing to company interview"),
      companyFirstInterview: z
        .string()
        .optional()
        .describe("Company first interview: date, time, platform, link/phone, cell number note"),
      companySecondInterview: z
        .string()
        .optional()
        .describe("Company second interview: date, time, platform, link/phone, cell number note"),
    },
  },
  async ({
    account,
    recruiterName,
    recruiterEmail,
    recruiterTel,
    companyRole,
    firstContact,
    subsequentContacts,
    recruiterCallScheduled,
    companyContactInfo,
    companyFirstInterview,
    companySecondInterview,
  }) => {
    try {
      const sheets = getSheetsClient(account);
      const spreadsheetId = getSpreadsheetId(account);

      const incomingRow = [
        recruiterName,
        recruiterEmail,
        recruiterTel ?? "",
        companyRole,
        firstContact,
        subsequentContacts ?? "",
        recruiterCallScheduled ?? "",
        companyContactInfo ?? "",
        companyFirstInterview ?? "",
        companySecondInterview ?? "",
      ];

      // Read existing data to check for a matching row
      const existing = await sheets.spreadsheets.values.get({
        spreadsheetId,
        range: SHEET_RANGE,
      });
      const rows = existing.data.values ?? [];

      // Find row matching recruiterEmail (col B) + companyRole (col D)
      const emailNorm = recruiterEmail.toLowerCase().trim();
      const roleNorm = companyRole.toLowerCase().trim();
      let matchIdx = -1;
      for (let i = 0; i < rows.length; i++) {
        const rowEmail = (rows[i][1] ?? "").toString().toLowerCase().trim();
        const rowRole = (rows[i][3] ?? "").toString().toLowerCase().trim();
        if (rowEmail === emailNorm && rowRole === roleNorm) {
          matchIdx = i;
          break;
        }
      }

      if (matchIdx >= 0) {
        // Merge: keep existing values where incoming is empty
        const existingRow = rows[matchIdx];
        const merged = incomingRow.map((val, col) => {
          if (col === 5 && val && existingRow[col]) {
            // Subsequent Contacts: append rather than overwrite
            return `${existingRow[col]}; ${val}`;
          }
          return val || existingRow[col] || "";
        });

        const rowNum = matchIdx + 1; // 1-indexed
        await sheets.spreadsheets.values.update({
          spreadsheetId,
          range: `${SHEET_RANGE}!A${rowNum}:J${rowNum}`,
          valueInputOption: "USER_ENTERED",
          requestBody: { values: [merged] },
        });

        return {
          content: [
            {
              type: "text" as const,
              text: `Updated existing row ${rowNum} for ${recruiterName} / ${companyRole}.`,
            },
          ],
        };
      }

      // No match — append new row
      await sheets.spreadsheets.values.append({
        spreadsheetId,
        range: SHEET_RANGE,
        valueInputOption: "USER_ENTERED",
        requestBody: { values: [incomingRow] },
      });

      return {
        content: [
          {
            type: "text" as const,
            text: `Appended new row for ${recruiterName} / ${companyRole}.`,
          },
        ],
      };
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : String(error);
      return {
        content: [
          {
            type: "text" as const,
            text: `Error logging recruiter contact: ${errMsg}`,
          },
        ],
      };
    }
  }
);

// ---------------------------------------------------------------------------
// Tool: create_calendar_event
// ---------------------------------------------------------------------------
server.registerTool(
  "create_calendar_event",
  {
    description:
      "Create a Google Calendar event. Use immediately after logging a " +
      "recruiter call, company first interview, or company second interview " +
      "to the spreadsheet. One calendar event per scheduling column populated.",
    inputSchema: {
      account: accountSchema,
      title: z
        .string()
        .describe(
          "Event title, e.g. '[Recruiter Call] Acme Corp - Sr Engineer' " +
          "or '[Interview] Acme Corp - Sr Engineer'"
        ),
      startDateTime: z
        .string()
        .describe("Event start in ISO 8601 format, e.g. 2026-02-20T14:00:00-06:00"),
      durationMinutes: z
        .number()
        .min(5)
        .max(480)
        .optional()
        .describe("Duration in minutes (default 60)"),
      description: z
        .string()
        .optional()
        .describe(
          "Event description: recruiter/company contact info, notes, " +
          "whether they have your cell number, etc."
        ),
      location: z
        .string()
        .optional()
        .describe("Video meeting link (Zoom/Teams URL) or phone number"),
    },
  },
  async ({ account, title, startDateTime, durationMinutes, description, location }) => {
    try {
      const start = new Date(startDateTime);

      if (start.getTime() < Date.now()) {
        return {
          content: [
            {
              type: "text" as const,
              text:
                `Skipped calendar event "${title}" — the proposed date ` +
                `(${start.toISOString()}) is in the past.`,
            },
          ],
        };
      }

      const calendar = getCalendarClient(account);
      const calendarId = getCalendarId(account);

      const end = new Date(start.getTime() + (durationMinutes ?? 60) * 60_000);

      const event = await calendar.events.insert({
        calendarId,
        requestBody: {
          summary: title,
          start: {
            dateTime: start.toISOString(),
          },
          end: {
            dateTime: end.toISOString(),
          },
          description: description ?? "",
          location: location ?? "",
        },
      });

      return {
        content: [
          {
            type: "text" as const,
            text:
              `Created calendar event: "${title}"\n` +
              `Start: ${start.toISOString()}\n` +
              `End: ${end.toISOString()}\n` +
              `Event ID: ${event.data.id}\n` +
              `Link: ${event.data.htmlLink}`,
          },
        ],
      };
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : String(error);
      return {
        content: [
          {
            type: "text" as const,
            text: `Error creating calendar event: ${errMsg}`,
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
