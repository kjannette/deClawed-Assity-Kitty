import { server } from "../McpServer.js";
import {
  accounts,
  loadClassificationPrompt,
  loadActionPrompt,
} from "../loaders/prompt-config-loaders.js";

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
