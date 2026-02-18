/**
 * Canned Gmail API responses representing one email from each category.
 * Body text is base64url-encoded to match the real Gmail API format.
 */

const toBase64Url = (text: string): string =>
  Buffer.from(text, "utf-8").toString("base64url");

// Category A — Acknowledgement only
const catABody = [
  "Dear Steven,",
  "",
  "Thank you for your interest in the Senior Software Engineer position at Acme Corp.",
  "We have received your application and it is currently under review.",
  "We will contact you if your qualifications match our needs.",
  "",
  "Best regards,",
  "Acme Talent Acquisition",
].join("\n");

// Category B — Advancement to next step
const catBBody = [
  "Hi Steven,",
  "",
  "Thanks for applying to the Full Stack Engineer role at Globex Corp.",
  "We'd love to schedule a phone screen to discuss your background.",
  "Are you available this Thursday at 2:00 PM CST?",
  "Please join via Zoom: https://zoom.us/j/123456789",
  "",
  "Looking forward to connecting,",
  "Jane Smith",
  "Senior Recruiter, Globex Corp",
  "jane.smith@globexcorp.com",
  "(555) 867-5309",
].join("\n");

// Category C — Rejection
const catCBody = [
  "Dear Steven,",
  "",
  "Thank you for taking the time to interview for the Platform Engineer position at Initech.",
  "After careful consideration, we have decided to pursue other candidates",
  "whose experience more closely aligns with our current needs.",
  "",
  "We wish you the best in your job search.",
  "",
  "Regards,",
  "Initech Recruiting Team",
].join("\n");

// Category D — Other / non-job
const catDBody = [
  "Your Tailscale subscription payment of $6.00 was unsuccessful.",
  "Please update your payment method at https://login.tailscale.com/billing.",
  "",
  "— Tailscale Billing",
].join("\n");

const makeHeaders = (from: string, subject: string, date: string) => [
  { name: "From", value: from },
  { name: "Subject", value: subject },
  { name: "Date", value: date },
  { name: "To", value: "steven@sjdev.co" },
];

export const MOCK_MESSAGE_LIST = {
  data: {
    messages: [
      { id: "msg-cat-a-001" },
      { id: "msg-cat-b-001" },
      { id: "msg-cat-c-001" },
      { id: "msg-cat-d-001" },
    ],
  },
};

export const MOCK_MESSAGES: Record<string, { data: any }> = {
  "msg-cat-a-001": {
    data: {
      id: "msg-cat-a-001",
      snippet: "Thank you for your interest in the Senior Software Engineer position...",
      payload: {
        headers: makeHeaders(
          "Acme Talent <talent@acmecorp.com>",
          "Application Received — Senior Software Engineer",
          "Mon, 17 Feb 2026 10:00:00 +0000"
        ),
        mimeType: "multipart/alternative",
        parts: [
          {
            mimeType: "text/plain",
            body: { data: toBase64Url(catABody) },
          },
          {
            mimeType: "text/html",
            body: { data: toBase64Url(`<p>${catABody}</p>`) },
          },
        ],
      },
    },
  },

  "msg-cat-b-001": {
    data: {
      id: "msg-cat-b-001",
      snippet: "We'd love to schedule a phone screen...",
      payload: {
        headers: makeHeaders(
          "Jane Smith <jane.smith@globexcorp.com>",
          "Phone Screen — Full Stack Engineer at Globex Corp",
          "Tue, 18 Feb 2026 14:30:00 +0000"
        ),
        mimeType: "multipart/alternative",
        parts: [
          {
            mimeType: "text/plain",
            body: { data: toBase64Url(catBBody) },
          },
        ],
      },
    },
  },

  "msg-cat-c-001": {
    data: {
      id: "msg-cat-c-001",
      snippet: "We have decided to pursue other candidates...",
      payload: {
        headers: makeHeaders(
          "Initech Recruiting <recruiting@initech.com>",
          "Update on Your Application — Platform Engineer",
          "Wed, 19 Feb 2026 09:15:00 +0000"
        ),
        mimeType: "text/plain",
        body: { data: toBase64Url(catCBody) },
      },
    },
  },

  "msg-cat-d-001": {
    data: {
      id: "msg-cat-d-001",
      snippet: "Your Tailscale subscription payment of $6.00 was unsuccessful.",
      payload: {
        headers: makeHeaders(
          "Tailscale Billing <billing@tailscale.com>",
          "$6.00 payment to Tailscale US Inc. was unsuccessful",
          "Thu, 20 Feb 2026 17:00:00 +0000"
        ),
        mimeType: "text/plain",
        body: { data: toBase64Url(catDBody) },
      },
    },
  },
};

export const MOCK_EMPTY_LIST = {
  data: { messages: undefined },
};

// Raw body text for assertion comparisons
export const RAW_BODIES = {
  "msg-cat-a-001": catABody,
  "msg-cat-b-001": catBBody,
  "msg-cat-c-001": catCBody,
  "msg-cat-d-001": catDBody,
};
