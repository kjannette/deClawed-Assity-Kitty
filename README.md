<p align="center">
 <img src="assets/logo.png" alt="Declawed" width="120" />
</p>

# Declawed

###  A configurable, prompt purrr-fectable LLM mail management assisty-kitty.
###  Perfect for tedious job hunts – you know the ones – it feels like the process is driving *you*.
###  Whirks whiskerous wonders for  forums where good posts are solid-gold but only 10% total volume, vs 90% gregarious noise.
### With some prompt purrfection and playful experimentation, helps any inbox where you need to cut adjust signal/noise to hone in, and take action on real opportunities,
###  (Cat) nip that sh*t in the bud.

# Secure
A local Model Context Protocol (MCP) server integrates an  LLM API, a local model, or whatever your nine lives desire. Questionable security, privacy holes or nasties are not lurking in an opaque supply-chain.

# Cat-o-matic
The library easily interfaces with your mail and calendar app APIs, or about any other service you want to plug in... keeping your adulting  moving forward while you chase your tail or take a 19-hour nap in a sunbeam.

---

# Scope and Architecture

## Current implementation contemplates:
-- Claude Desktop (plugging in your choice of  LLM to our framework should be easy. Plus we'll be building our own UI soon-ishh).
-- A Custom Local Model Context Protocol Server
-- A DNS-config’d domain, with MX records pointing to:
-- A commercial or self-hosted SMTP Server (with a sensible API)

---

### 1. Install Node.js

Node.js v16+ required.

```bash
node --version
npm --version
```

If not installed, grab it from [nodejs.org](https://nodejs.org/).

### 2. Clone and Install

```bash
git clone <repo-url>
cd deClawed-Assity-Kitty
npm install
```

### 3. Set Up Google Cloud Credentials

#### 3a. Create a Google Cloud Project

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Sign in with the Google account that owns the target Gmail
3. Click the project dropdown (top-left) > **New Project**
4. Name it (e.g., `assistant-mcp`) and click **Create**
5. Select the new project from the dropdown

#### 3b. Enable APIs

In **APIs & Services > Library**, enable:
- **Gmail API**
- **Google Sheets API** (if using recruiter contact logging)
- **Google Calendar API** (if using calendar event creation)

#### 3c. Configure the OAuth Consent Screen

1. Go to **Google Auth Platform > Branding** (or **APIs & Services > OAuth consent screen**)
2. Set user type to **External**, click **Create**
3. Fill in app name, support email, and developer contact email
4. Save and continue

#### 3d. Add OAuth Scopes

In **Google Auth Platform > Data Access**, add:
- `https://www.googleapis.com/auth/gmail.modify`
- `https://www.googleapis.com/auth/spreadsheets` (for Sheets integration)
- `https://www.googleapis.com/auth/calendar.events` (for Calendar integration)

#### 3e. Add Yourself as a Test User

Go to **Google Auth Platform > Audience** and add each Gmail address you'll use.

#### 3f. Create OAuth Client Credentials

1. Go to **Google Auth Platform > Clients** (or **APIs & Services > Credentials**)
2. Click **Create Client** > Application type: **Desktop app**
3. **Download the JSON**, rename it to `credentials.json`
4. Place it in the project root

### 4. Configure Accounts

Create `accounts.json` in the project root. Each key is an account alias with its own token file and optional Sheets/Calendar config:

```json
{
"work": {
  "label": "you@yourdomain.com",
  "tokenFile": "token.json",
  "spreadsheetId": "YOUR_GOOGLE_SHEET_ID",
  "calendarId": "primary"
},
"secondary": {
  "label": "you@gmail.com",
  "tokenFile": "token-secondary.json"
}
}
```

- **`label`** -- display name (typically the email address)
- **`tokenFile`** -- per-account OAuth token (auto-generated during auth)
- **`spreadsheetId`** -- Google Sheets ID for recruiter contact logging (optional)
- **`calendarId`** -- Google Calendar ID for event creation (optional, `"primary"` uses the default calendar)

### 5. Authorize Gmail Accounts

Build and run the auth script for each account:

```bash
npm run auth              # authorizes the "work" account
npm run auth -- secondary # authorizes the "secondary" account
```

Each run will:
1. Print a URL -- open it in your browser
2. Sign in and click **Allow**
3. You'll land on a "localhost refused to connect" page (normal)
4. Copy the **entire URL** from the address bar and paste it back into the terminal
5. The script saves the token file (e.g., `token.json` or `token-secondary.json`)

You only need to do this once per account. Tokens auto-refresh.

### 6. Write the Prompts

Two plain-text prompt files in `src/prompts/` control the workflow:

| File | Phase | Purpose |
|------|-------|---------|
| `src/prompts/classify-emails.txt` | 1 -- Classification | Defines categories A/B/C/D and how to sort emails |
| `src/prompts/take-action-on-emails.txt` | 2 -- Action | Tells the LLM what to do with each category (delete, log, schedule, etc.) |

**Tips:**
- Use clear, explicit category definitions with example language
- Handle ambiguous cases (e.g., "If an email both acknowledges receipt AND requests action, classify as B")
- Prompt files are loaded at runtime -- edit them anytime, no rebuild required

### 7. Build

```bash
npm run build
```

Compiles `src/**/*.ts` into `build/`.

### 8. Configure Claude Desktop

Edit your Claude Desktop config:

```bash
code ~/Library/Application\ Support/Claude/claude_desktop_config.json
```

Add the server:

```json
{
"mcpServers": {
  "assistant": {
    "command": "/ABSOLUTE/PATH/TO/node",
    "args": [
      "/ABSOLUTE/PATH/TO/deClawed-Assity-Kitty/build/index.js"
    ]
  }
}
}
```

Replace paths with the output of `which node` and your actual project location.

### 9. Restart Claude Desktop

Fully quit (**Cmd+Q**, not just close the window) and reopen. The `assistant` server should appear under **Connectors**.

---

## MCP Tools

| Tool | Description |
|------|-------------|
| `fetch_new_emails` | Fetches unread emails for a given account. Classification and action prompts are automatically appended to the response. |
| `delete_emails` | Moves emails to trash by Gmail message ID. Used for categories A (acknowledgements) and C (rejections). |
| `append_to_summary` | Logs classified emails to per-account summary files in `mailSummaries/`. Entries older than 30 days are auto-purged. |
| `log_recruiter_contact` | Logs or updates recruiter contact info in a Google Sheet. Merges rows by recruiter email + role. |
| `create_calendar_event` | Creates a Google Calendar event for scheduled calls/interviews. Skips past dates. Includes meeting links and contact info. |

## MCP Prompts

| Prompt | Account | Description |
|--------|---------|-------------|
| `review_emails` | work | Loads the classification + action prompts for the work inbox |
| `review_secondary_emails` | secondary | Same workflow for the secondary inbox |

Invoke these from Claude Desktop's Connectors menu, or just type "Review my inbox" / "Review my secondary inbox."

---

## Two-Phase Workflow

**Phase 1 -- Classify**

The LLM calls `fetch_new_emails`, which returns email data with the classification instructions from `classify-emails.txt` appended. Each email is sorted into:

| Category | Meaning | Action |
|----------|---------|--------|
| **A** | Acknowledgement / auto-reply | Delete |
| **B** | Advancement to next step | Summarize + log |
| **C** | Rejection | Delete |
| **D** | Other / uncategorized | Summarize + log |

**Phase 2 -- Act**

Using `take-action-on-emails.txt`, the LLM:
- Calls `delete_emails` for A + C
- Calls `append_to_summary` for B + D
- Calls `log_recruiter_contact` to track contacts in Sheets (if configured)
- Calls `create_calendar_event` for any scheduled interviews/calls (if configured)

---

## Key Commands

| Command | Purpose |
|---------|---------|
| `npm run build` | Recompile after editing source files |
| `npm run auth` | Authorize the default (work) account |
| `npm run auth -- secondary` | Authorize the secondary account |
| `npm test` | Run the test suite |
| `npm run test:watch` | Run tests in watch mode |

---

## Project Structure

```
deClawed-Assity-Kitty/
├── src/
│   ├── index.ts                         # Entry point -- imports modules, starts server
│   ├── McpServer.ts                     # MCP server instance
│   ├── auth.ts                          # Multi-account OAuth setup script
│   ├── loaders/
│   │   └── prompt-config-loaders.ts     # Account, prompt, and OAuth client loaders
│   ├── prompt-controller-service/
│   │   └── prompt-controller-service.ts # MCP prompt registration
│   ├── prompts/
│   │   ├── classify-emails.txt          # Phase 1: classification instructions
│   │   └── take-action-on-emails.txt    # Phase 2: action instructions
│   └── tools/
│       ├── tools-email.ts               # fetch, delete, append_to_summary
│       ├── tools-calendar.ts            # create_calendar_event
│       └── tools-spreadsheet.ts         # log_recruiter_contact
├── test/
│   ├── fixtures/
│   │   └── mock-emails.ts              # Mock Gmail API responses
│   ├── integration/
│   │   └── email-workflow.test.ts       # Integration tests
│   └── unit/
│       └── email-parsing.test.ts        # Unit tests for parsing helpers
├── mailSummaries/                       # Per-account summary output (auto-generated)
├── build/                               # Compiled JS (auto-generated)
├── accounts.json                        # Multi-account configuration
├── credentials.json                     # Google OAuth client credentials
├── token*.json                          # Per-account OAuth tokens (auto-generated)
├── package.json
├── tsconfig.json
├── vitest.config.ts
└── README.md
```
