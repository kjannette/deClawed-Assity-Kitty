import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from "vitest";
import { z } from "zod";
import fs from "fs";
import os from "os";
import path from "path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { MOCK_MESSAGE_LIST, MOCK_MESSAGES, MOCK_EMPTY_LIST } from "../fixtures/mock-emails.js";

// -----------------------------------------------------------------------
// Mock the loaders module so no real credentials/tokens/APIs are needed.
// vi.mock is hoisted — runs before any module imports.
// -----------------------------------------------------------------------
const mockGmailList = vi.fn();
const mockGmailGet = vi.fn();
const mockGmailTrash = vi.fn();
let tmpDir: string;

vi.mock("../../src/loaders/prompt-config-loaders.js", () => {
  const testAccounts = {
    work: { label: "test@test.com", tokenFile: "token.json" },
    secondary: { label: "test2@test.com", tokenFile: "token-secondary.json" },
  };

  return {
    PROJECT_ROOT: "/tmp/test-project",
    VALID_ACCOUNTS: ["work", "secondary"] as const,
    accounts: testAccounts,
    accountSchema: z
      .enum(["work", "secondary"])
      .describe("test account"),
    loadAccounts: () => testAccounts,
    getTokenPath: () => "/tmp/fake-token.json",
    getSummaryPath: (account: string) => {
      // tmpDir is set in beforeAll, but this is called lazily so it's fine
      const base = tmpDir || os.tmpdir();
      return account === "work"
        ? path.join(base, "summary.json")
        : path.join(base, `summary-${account}.json`);
    },
    loadClassificationPrompt: () => "CLASSIFY EACH EMAIL AS A, B, C, OR D.",
    loadActionPrompt: () => "PHASE 2 INSTRUCTIONS HERE.",
    getGmailClient: () => ({
      users: {
        messages: {
          list: mockGmailList,
          get: mockGmailGet,
          trash: mockGmailTrash,
        },
      },
    }),
    getSheetsClient: vi.fn(),
    getCalendarClient: vi.fn(),
    getSpreadsheetId: vi.fn(),
    getCalendarId: () => "primary",
    getOAuth2Client: vi.fn(),
  };
});

// Now import the server and tool modules (they'll use the mocked loaders)
const { server } = await import("../../src/McpServer.js");
await import("../../src/tools/tools-email.js");

// -----------------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------------
let client: Client;

async function connectClient(): Promise<void> {
  client = new Client({ name: "test-client", version: "1.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([
    client.connect(clientTransport),
    server.connect(serverTransport),
  ]);
}

async function callTool(name: string, args: Record<string, unknown>) {
  const result = await client.callTool({ name, arguments: args });
  const text = (result.content as Array<{ type: string; text: string }>)[0]?.text ?? "";
  return text;
}

// -----------------------------------------------------------------------
// Test suite
// -----------------------------------------------------------------------
describe("Phase 1: Email Review Workflow", () => {
  beforeAll(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "mcp-test-"));
    await connectClient();
  });

  afterAll(async () => {
    await client?.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ----- Step 1: Fetch new emails -----
  describe("fetch_new_emails", () => {
    it("returns formatted emails with classification instructions", async () => {
      mockGmailList.mockResolvedValue(MOCK_MESSAGE_LIST);
      mockGmailGet.mockImplementation(({ id }: { id: string }) =>
        Promise.resolve(MOCK_MESSAGES[id])
      );

      const text = await callTool("fetch_new_emails", {
        account: "work",
        maxResults: 10,
      });

      expect(text).toContain("Found 4 unread email(s)");

      // All 4 messages present
      expect(text).toContain("msg-cat-a-001");
      expect(text).toContain("msg-cat-b-001");
      expect(text).toContain("msg-cat-c-001");
      expect(text).toContain("msg-cat-d-001");

      // Headers extracted correctly
      expect(text).toContain("FROM: Acme Talent <talent@acmecorp.com>");
      expect(text).toContain("SUBJECT: Phone Screen — Full Stack Engineer at Globex Corp");
      expect(text).toContain("FROM: Initech Recruiting <recruiting@initech.com>");

      // Body content decoded
      expect(text).toContain("We have received your application");
      expect(text).toContain("schedule a phone screen");
      expect(text).toContain("decided to pursue other candidates");
      expect(text).toContain("payment of $6.00 was unsuccessful");

      // Classification instructions appended
      expect(text).toContain("CLASSIFICATION INSTRUCTIONS (PHASE 1)");
      expect(text).toContain("CLASSIFY EACH EMAIL AS A, B, C, OR D.");

      // Phase 2 instructions also appended
      expect(text).toContain("ACTION INSTRUCTIONS (PHASE 2)");
    });

    it("handles an empty inbox", async () => {
      mockGmailList.mockResolvedValue(MOCK_EMPTY_LIST);

      const text = await callTool("fetch_new_emails", {
        account: "work",
        maxResults: 10,
      });

      expect(text).toBe("No unread emails found.");
    });

    it("handles Gmail API errors gracefully", async () => {
      mockGmailList.mockRejectedValue(new Error("Token expired"));

      const text = await callTool("fetch_new_emails", {
        account: "work",
        maxResults: 10,
      });

      expect(text).toContain("Error fetching emails");
      expect(text).toContain("Token expired");
    });
  });

  // ----- Step 2: Delete A and C emails -----
  describe("delete_emails", () => {
    it("trashes the specified message IDs", async () => {
      mockGmailTrash.mockResolvedValue({});

      const text = await callTool("delete_emails", {
        account: "work",
        messageIds: ["msg-cat-a-001", "msg-cat-c-001"],
      });

      expect(mockGmailTrash).toHaveBeenCalledTimes(2);
      expect(mockGmailTrash).toHaveBeenCalledWith({ userId: "me", id: "msg-cat-a-001" });
      expect(mockGmailTrash).toHaveBeenCalledWith({ userId: "me", id: "msg-cat-c-001" });
      expect(text).toContain("Trashed: msg-cat-a-001");
      expect(text).toContain("Trashed: msg-cat-c-001");
    });

    it("reports partial failures without aborting", async () => {
      mockGmailTrash
        .mockResolvedValueOnce({})
        .mockRejectedValueOnce(new Error("Not Found"));

      const text = await callTool("delete_emails", {
        account: "work",
        messageIds: ["msg-cat-a-001", "msg-bad-id"],
      });

      expect(text).toContain("Trashed: msg-cat-a-001");
      expect(text).toContain("Failed to trash msg-bad-id: Not Found");
    });

    it("handles auth/client errors", async () => {
      // Make getGmailClient itself throw by having list throw before any trash
      mockGmailTrash.mockRejectedValue(new Error("Auth failed"));

      const text = await callTool("delete_emails", {
        account: "work",
        messageIds: ["msg-cat-a-001"],
      });

      expect(text).toContain("Failed to trash msg-cat-a-001: Auth failed");
    });
  });

  // ----- Step 3: Summarize B and D -----
  describe("append_to_summary", () => {
    it("creates a summary file and appends entries", async () => {
      const entries = [
        {
          senderName: "Jane Smith",
          senderEmail: "jane.smith@globexcorp.com",
          dateReceived: "Tue, 18 Feb 2026 14:30:00 +0000",
          subject: "Phone Screen — Full Stack Engineer at Globex Corp",
          category: "B",
        },
        {
          senderName: "Tailscale Billing",
          senderEmail: "billing@tailscale.com",
          dateReceived: "Thu, 20 Feb 2026 17:00:00 +0000",
          subject: "$6.00 payment to Tailscale US Inc. was unsuccessful",
          category: "D",
        },
      ];

      const text = await callTool("append_to_summary", {
        account: "work",
        entries,
      });

      expect(text).toContain("Appended 2 entry/entries to summary.");
      expect(text).toContain("Total entries in summary: 2");

      // Verify the file was actually written
      const summaryPath = path.join(tmpDir, "summary.json");
      const written = JSON.parse(fs.readFileSync(summaryPath, "utf-8"));
      expect(written).toHaveLength(2);
      expect(written[0].senderName).toBe("Jane Smith");
      expect(written[0].category).toBe("B");
      expect(written[1].category).toBe("D");
      expect(written[0].addedAt).toBeDefined();
    });

    it("purges entries older than 30 days", async () => {
      const summaryPath = path.join(tmpDir, "summary.json");
      const oldDate = new Date(Date.now() - 31 * 24 * 60 * 60 * 1000).toISOString();

      // Seed with an old entry
      fs.writeFileSync(
        summaryPath,
        JSON.stringify([
          {
            senderName: "Old Entry",
            senderEmail: "old@example.com",
            dateReceived: "2025-01-01",
            subject: "Ancient email",
            category: "D",
            addedAt: oldDate,
          },
        ])
      );

      const text = await callTool("append_to_summary", {
        account: "work",
        entries: [
          {
            senderName: "New Entry",
            senderEmail: "new@example.com",
            dateReceived: "2026-02-18",
            subject: "Fresh email",
            category: "B",
          },
        ],
      });

      expect(text).toContain("Purged 1 entry/entries older than 30 days.");
      expect(text).toContain("Total entries in summary: 1");

      const written = JSON.parse(fs.readFileSync(summaryPath, "utf-8"));
      expect(written).toHaveLength(1);
      expect(written[0].senderName).toBe("New Entry");
    });
  });
});
