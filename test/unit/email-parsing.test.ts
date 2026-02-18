import { describe, it, expect } from "vitest";
import { getHeader, decodeBody } from "../../src/tools/tools-email.js";
import { MOCK_MESSAGES, RAW_BODIES } from "../fixtures/mock-emails.js";

describe("getHeader", () => {
  const headers = [
    { name: "From", value: "Jane <jane@example.com>" },
    { name: "Subject", value: "Hello World" },
    { name: "Date", value: "Mon, 17 Feb 2026 10:00:00 +0000" },
  ];

  it("extracts a header by name (case-insensitive)", () => {
    expect(getHeader(headers, "from")).toBe("Jane <jane@example.com>");
    expect(getHeader(headers, "FROM")).toBe("Jane <jane@example.com>");
    expect(getHeader(headers, "From")).toBe("Jane <jane@example.com>");
  });

  it("returns empty string for missing header", () => {
    expect(getHeader(headers, "Cc")).toBe("");
  });

  it("returns empty string for undefined headers array", () => {
    expect(getHeader(undefined, "From")).toBe("");
  });

  it("returns empty string for empty headers array", () => {
    expect(getHeader([], "From")).toBe("");
  });
});

describe("decodeBody", () => {
  it("decodes a multipart message (text/plain preferred)", () => {
    const msg = MOCK_MESSAGES["msg-cat-a-001"].data;
    const body = decodeBody(msg);
    expect(body).toBe(RAW_BODIES["msg-cat-a-001"]);
    expect(body).toContain("We have received your application");
  });

  it("decodes a multipart message with only text/plain part", () => {
    const msg = MOCK_MESSAGES["msg-cat-b-001"].data;
    const body = decodeBody(msg);
    expect(body).toBe(RAW_BODIES["msg-cat-b-001"]);
    expect(body).toContain("schedule a phone screen");
  });

  it("decodes a single-part message (no parts array)", () => {
    const msg = MOCK_MESSAGES["msg-cat-c-001"].data;
    const body = decodeBody(msg);
    expect(body).toBe(RAW_BODIES["msg-cat-c-001"]);
    expect(body).toContain("decided to pursue other candidates");
  });

  it("falls back to snippet when body data is empty", () => {
    const msg = {
      snippet: "This is a snippet fallback",
      payload: { body: { data: "" } },
    };
    expect(decodeBody(msg)).toBe("This is a snippet fallback");
  });

  it("falls back to snippet when payload has no body data at all", () => {
    const msg = {
      snippet: "Snippet only",
      payload: {},
    };
    expect(decodeBody(msg)).toBe("Snippet only");
  });

  it("returns empty string when no body and no snippet", () => {
    const msg = { payload: {} };
    expect(decodeBody(msg)).toBe("");
  });

  it("falls back to text/html when text/plain is missing in multipart", () => {
    const htmlContent = "<p>Hello from HTML</p>";
    const encoded = Buffer.from(htmlContent).toString("base64url");
    const msg = {
      payload: {
        parts: [
          { mimeType: "text/html", body: { data: encoded } },
        ],
      },
    };
    expect(decodeBody(msg)).toBe(htmlContent);
  });
});
