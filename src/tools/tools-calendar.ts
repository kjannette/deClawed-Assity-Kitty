import { z } from "zod";
import { server } from "../McpServer.js";
import {
  accountSchema,
  getCalendarClient,
  getCalendarId,
} from "../loaders/prompt-config-loaders.js";

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
