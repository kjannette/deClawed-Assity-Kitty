import { google } from "googleapis";
import fs from "fs";
import path from "path";
import readline from "readline";

const __dirname = path.dirname(new URL(import.meta.url).pathname);
const PROJECT_ROOT = path.resolve(__dirname, "..");
const CREDENTIALS_PATH = path.join(PROJECT_ROOT, "credentials.json");
const ACCOUNTS_PATH = path.join(PROJECT_ROOT, "accounts.json");

const SCOPES = [
  "https://www.googleapis.com/auth/gmail.modify",
  "https://www.googleapis.com/auth/spreadsheets",
  "https://www.googleapis.com/auth/calendar.events",
];

function resolveTokenPath(accountKey: string): string {
  if (!fs.existsSync(ACCOUNTS_PATH)) {
    throw new Error(`Missing ${ACCOUNTS_PATH}. Create accounts.json first.`);
  }
  const accounts = JSON.parse(fs.readFileSync(ACCOUNTS_PATH, "utf-8"));
  const acct = accounts[accountKey];
  if (!acct) {
    const available = Object.keys(accounts).join(", ");
    throw new Error(
      `Unknown account "${accountKey}". Available: ${available}`
    );
  }
  return path.join(PROJECT_ROOT, acct.tokenFile);
}

async function authorize(): Promise<void> {
  const accountKey = process.argv[2] || "work";
  const tokenPath = resolveTokenPath(accountKey);

  console.log(`Authorizing account: "${accountKey}"`);
  console.log(`Token file: ${tokenPath}`);
  console.log(`Scopes: ${SCOPES.join(", ")}\n`);

  if (!fs.existsSync(CREDENTIALS_PATH)) {
    console.error(
      `Missing ${CREDENTIALS_PATH}\n\n` +
        "To create this file:\n" +
        "1. Go to https://console.cloud.google.com/\n" +
        "2. Create a project and enable the Gmail, Sheets, and Calendar APIs\n" +
        "3. Create OAuth 2.0 credentials (Desktop app type)\n" +
        "4. Download the JSON and save it as credentials.json in the project root\n"
    );
    process.exit(1);
  }

  const credentials = JSON.parse(fs.readFileSync(CREDENTIALS_PATH, "utf-8"));
  const { client_id, client_secret, redirect_uris } =
    credentials.installed || credentials.web;

  const oAuth2Client = new google.auth.OAuth2(
    client_id,
    client_secret,
    redirect_uris[0]
  );

  if (fs.existsSync(tokenPath)) {
    const token = JSON.parse(fs.readFileSync(tokenPath, "utf-8"));
    oAuth2Client.setCredentials(token);
    console.log("Token already exists at:", tokenPath);
    console.log(
      "To re-authorize with new scopes, delete the token file and run again:\n" +
        `  rm ${tokenPath}\n` +
        `  npm run auth -- ${accountKey}`
    );
    return;
  }

  const authUrl = oAuth2Client.generateAuthUrl({
    access_type: "offline",
    scope: SCOPES,
    prompt: "consent",
  });

  console.log("Authorize this app by visiting this URL:\n");
  console.log(authUrl);
  console.log();

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  const rawInput = await new Promise<string>((resolve) => {
    rl.question(
      "Paste the FULL URL from your browser address bar (or just the code): ",
      (answer) => {
        rl.close();
        resolve(answer.trim());
      }
    );
  });

  let code = rawInput;
  if (rawInput.includes("code=")) {
    const url = new URL(rawInput);
    code = url.searchParams.get("code") ?? rawInput;
  }

  console.log(`\nExtracted code: ${code.substring(0, 10)}...`);

  const { tokens } = await oAuth2Client.getToken(code);
  oAuth2Client.setCredentials(tokens);

  fs.writeFileSync(tokenPath, JSON.stringify(tokens, null, 2));
  console.log("\nToken saved to:", tokenPath);
  console.log("You can now start the MCP server.");
}

authorize().catch((err) => {
  console.error("Authorization failed:", err);
  process.exit(1);
});
