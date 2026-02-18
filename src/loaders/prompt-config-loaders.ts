import { z } from "zod";
import { google, gmail_v1, sheets_v4, calendar_v3 } from "googleapis";
import { OAuth2Client } from "google-auth-library";
import fs from "fs";
import path from "path";

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------
const __dirname = path.dirname(new URL(import.meta.url).pathname);
export const PROJECT_ROOT = path.resolve(__dirname, "..", "..");
const CREDENTIALS_PATH = path.join(PROJECT_ROOT, "credentials.json");
const ACCOUNTS_PATH = path.join(PROJECT_ROOT, "accounts.json");
const CLASSIFY_PROMPT_PATH = path.join(PROJECT_ROOT, "classify-emails.txt");
const ACTION_PROMPT_PATH = path.join(
  PROJECT_ROOT, "src", "prompts", "take-action-on-emails.txt"
);

// ---------------------------------------------------------------------------
// Account configuration
// ---------------------------------------------------------------------------
export interface AccountConfig {
  label: string;
  tokenFile: string;
  spreadsheetId?: string;
  calendarId?: string;
}

export interface AccountsMap {
  [key: string]: AccountConfig;
}

export const loadAccounts = (): AccountsMap => {
  if (!fs.existsSync(ACCOUNTS_PATH)) {
    throw new Error(`Missing accounts.json at ${ACCOUNTS_PATH}.`);
  }
  return JSON.parse(fs.readFileSync(ACCOUNTS_PATH, "utf-8"));
};

export const getTokenPath = (account: string): string => {
  const accts = loadAccounts();
  const acct = accts[account];
  if (!acct) {
    const available = Object.keys(accts).join(", ");
    throw new Error(
      `Unknown account "${account}". Available accounts: ${available}`
    );
  }
  return path.join(PROJECT_ROOT, acct.tokenFile);
};

export const getSummaryPath = (account: string): string => {
  if (account === "work") {
    return path.join(PROJECT_ROOT, "summary.json");
  }
  return path.join(PROJECT_ROOT, `summary-${account}.json`);
};

export const VALID_ACCOUNTS = ["work", "secondary"] as const;
export const accounts = loadAccounts();

const accountDescription = VALID_ACCOUNTS
  .map((key) => `"${key}" (${accounts[key]?.label ?? key})`)
  .join(" or ");

export const accountSchema = z
  .enum(VALID_ACCOUNTS)
  .describe(`Which email account to use: ${accountDescription}`);

// ---------------------------------------------------------------------------
// Prompt loaders
// ---------------------------------------------------------------------------
const loadPromptFile = (filePath: string, label: string): string => {
  if (!fs.existsSync(filePath)) {
    console.error(`Warning: ${filePath} not found. ${label} will be missing.`);
    return "";
  }
  return fs.readFileSync(filePath, "utf-8");
};

export const loadClassificationPrompt = (): string =>
  loadPromptFile(CLASSIFY_PROMPT_PATH, "Classification instructions");

export const loadActionPrompt = (): string =>
  loadPromptFile(ACTION_PROMPT_PATH, "Action instructions");

// ---------------------------------------------------------------------------
// Auth helpers — generic OAuth2 client, then service-specific factories
// ---------------------------------------------------------------------------
export const getOAuth2Client = (account: string): OAuth2Client => {
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
};

export const getGmailClient = (account: string): gmail_v1.Gmail =>
  google.gmail({ version: "v1", auth: getOAuth2Client(account) });

export const getSheetsClient = (account: string): sheets_v4.Sheets =>
  google.sheets({ version: "v4", auth: getOAuth2Client(account) });

export const getCalendarClient = (account: string): calendar_v3.Calendar =>
  google.calendar({ version: "v3", auth: getOAuth2Client(account) });

export const getSpreadsheetId = (account: string): string => {
  const acct = accounts[account];
  if (!acct?.spreadsheetId || acct.spreadsheetId === "PASTE_YOUR_SHEET_ID_HERE") {
    throw new Error(
      `No spreadsheetId configured for account "${account}" in accounts.json.`
    );
  }
  return acct.spreadsheetId;
};

export const getCalendarId = (account: string): string =>
  accounts[account]?.calendarId ?? "primary";
