import { z } from "zod";
import { gmail_v1 } from "googleapis";
import fs from "fs";
import { server } from "../McpServer.js";
import {
  accountSchema,
  getGmailClient,
  getSummaryPath,
  loadClassificationPrompt,
  loadActionPrompt,
} from "../loaders/prompt-config-loaders.js";

// ---------------------------------------------------------------------------
// Email parsing helpers
// ---------------------------------------------------------------------------
const getHeader = (
  headers: gmail_v1.Schema$MessagePartHeader[] | undefined,
  name: string
): string => {
  if (!headers) return "";
  const header = headers.find(
    (h) => h.name?.toLowerCase() === name.toLowerCase()
  );
  return header?.value ?? "";
};

const decodeBody = (message: gmail_v1.Schema$Message): string => {
  const parts = message.payload?.parts;
  let encoded = "";

  if (parts) {
    const textPart = parts.find((p) => p.mimeType === "text/plain");
    encoded = textPart?.body?.data ?? "";

    if (!encoded) {
      const htmlPart = parts.find((p) => p.mimeType === "text/html");
      encoded = htmlPart?.body?.data ?? "";
    }
  } else {
    encoded = message.payload?.body?.data ?? "";
  }

  if (!encoded) {
    return message.snippet ?? "";
  }

  return Buffer.from(encoded, "base64url").toString("utf-8");
};

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
