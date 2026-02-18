import { z } from "zod";
import { server } from "../McpServer.js";
import {
  accountSchema,
  getSheetsClient,
  getSpreadsheetId,
} from "../loaders/prompt-config-loaders.js";

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

      const existing = await sheets.spreadsheets.values.get({
        spreadsheetId,
        range: SHEET_RANGE,
      });
      const rows = existing.data.values ?? [];

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
        const existingRow = rows[matchIdx];
        const merged = incomingRow.map((val, col) => {
          if (col === 5 && val && existingRow[col]) {
            return `${existingRow[col]}; ${val}`;
          }
          return val || existingRow[col] || "";
        });

        const rowNum = matchIdx + 1;
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
