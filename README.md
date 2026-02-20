<p align="center">
<img src="assets/logo.png" alt="Declawed" width="120" />
</p>

# Declawed: your kuddly assisty-kitty

Inbox brimming with stank-ass algorithmically-generated turds?
Wanna cut the crap and get the good stuff into Jira, calendars, sheets, etc. ... in two clicks?

### (Cat) nip that sh*t in the bud!!!

# The "why":

###  Declawed is a configurable, prompt purrr-fectable LLM mail management assisty-kitty.
###  More private than most other options (not purrfect yet - but we aim to get there).
###  More accurate actions/results (read on).
###  Eliminates that frustrating feeling you'll never get the dangling, catnip-stuffed mouse you've been leaping at.

# Privacy: more than the blue-plate crustacean

Your own local Model Context Protocol (MCP) server integrates with your preferred LLM API.
This means greater choice, transparency and ops control.

Avoid flakey (molty?) black box installs, billed as QUICK AND EASY!
...also, loaded with more Trojans than an Olympic Village. Silent processes: data harvesting phone-homes, behavioral analytics reporting, telemetry backdoors - all the nasties crawling the dark detritus. 

💩 You know lobsters eat poop, right? 💩

# Simplicity
### NLP prompts are **actually** easy and  **demonstrably**  more effective

Stop drilling down byzantine menus in mail, scheduling and sheets platforms to 1. configure filters that only ever work 20% of the time 2. change in functionality and scope  every three months.

Write simple, declarative prompts instead. It's like wrapping bulk-mail's paws in tin foil and tossing them in a bathtub.

Prompts

1. Use semantic grouping, organizing by message intent, purpose, and context.
2. The prompt templates in our "built in" library are evaluated using, for example, cosine similarity scoring and ROUGE scoring...
3. Basically, we watch the watchers to max effective choice of delegated actions.
3. An example: keep the gold, toss the junk when reviewing, for example,  forums where actionable insights are gold, but only 10% of the signal.

### Prompting: easily configured to cron: cleaning the litter(in)box before the stank wafts into the kitchen.
### Image morning greeting you with the fresh, spring-meadow aroma of opportunities and insights -- not an avalanche of turds

# -- you just might feel like its f*cxing 1998 again.

# Wiring up your kitty

Assisty-kitty easily interfaces with mail and calendar and other app APIs (about any other service you want to plug in) ... it keeps things moving so you can go chase laser pointers or enjoy a 19-hour nap in a sunbeam.

---

# Scope and Architecture

## Current implementation requires building/using:
-- Claude Desktop (as UI - proprietary UI coming soonish)
-- Building/Connecting a Local Model Context Protocol Server
-- A DNS-config’d domain, with MX records pointing to:
-- A commercial or self-hosted SMTP Server

## Coming soonish:
-- Proprietary custom UI.
-- Support for Hugging Face models galore.
- Support for wiring to local LLMs.

# Setup

### 1. Install Node.js (v16+ required).

```bash
node --version
npm --version
```

If not installed, grab it from [nodejs.org](https://nodejs.org/).

### 2. Clone and Install

```bash
git clone https://github.com/kjannette/deClawed-Assisty-Kitty.git
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
- **Google Sheets API** (if mapping mail to sheets)
- **Google Calendar API** (if using calendar event creation, etc.s)

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

Create file `accounts.json` in the project root. Each key is an account alias with its own token file and optional Sheets/Calendar config:

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

## 8. Configure Claude Desktop

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

## 9. Add/Configure API Keys, Credentials, and Other Secrets

Secret files are **gitignored** -- they never leave your machine. Example templates are provided so you know what shape each file needs to be in.

#### 9a. `credentials.json`

This file holds your Google OAuth client credentials. **You do not write this by hand** -- it is downloaded from the Google Cloud Console (see Step 3f above). Copy the example and then replace it with the real download:

```bash
cp credentials.example.json credentials.json
# Now replace credentials.json with the file downloaded from Google Cloud Console.
```

The structure looks like this (the example file ships with empty values):

```json
{
"installed": {
  "client_id": "",
  "project_id": "",
  "auth_uri": "https://accounts.google.com/o/oauth2/auth",
  "token_uri": "https://oauth2.googleapis.com/token",
  "auth_provider_x509_cert_url": "https://www.googleapis.com/oauth2/v1/certs",
  "client_secret": "",
  "redirect_uris": ["http://localhost"]
}
}
```

#### 9b. `accounts.json`

Defines each Gmail account the server manages. Copy the example and fill in your values:

```bash
cp accounts.example.json accounts.json
```

| Field | What to put here |
|-------|-----------------|
| `label` | The email address for this account (display only) |
| `tokenFile` | Filename for this account's OAuth token (e.g., `token.json`) |
| `spreadsheetId` | The ID from your Google Sheet URL: `docs.google.com/spreadsheets/d/<THIS_PART>/edit` (optional) |
| `calendarId` | `"primary"` for your default calendar, or a specific calendar ID (optional) |

Add as many accounts as you need. Each key (e.g., `"work"`, `"secondary"`) becomes the account name used in tool calls and auth commands.

#### 9c. `token*.json` (auto-generated)

Token files are **created automatically** when you run `npm run auth` (Step 5). You do not need to create or edit them manually. A `token.example.json` is provided for reference only -- it shows the structure but the values are populated by the OAuth flow.

#### Summary of secret files

| Example template | Actual file (gitignored) | How to create |
|-----------------|--------------------------|---------------|
| `credentials.example.json` | `credentials.json` | Download from Google Cloud Console |
| `accounts.example.json` | `accounts.json` | Copy example, fill in your email/sheet/calendar IDs |
| `token.example.json` | `token.json`, `token-secondary.json`, etc. | Auto-generated by `npm run auth` |

### 10. Restart Claude Desktop

Fully quit (**Cmd+Q**, not just close the window) and reopen. The `assistant` server should appear under **Connectors**.

---

## MCP Tools

| Tool | Description |
|------|-------------|
| `fetch_new_emails` | Fetches unread emails for a given account. Classification and action prompts are automatically appended to the response. |
| `delete_emails` | Moves emails to trash by Gmail message ID. Used for categories A (acknowledgements/junk/”THANKS!”/offers) and C (rejections). |
| `append_to_summary` | Logs classified emails to per-account summary files in `mailSummaries/`. Entries older than 30 days are auto-purged. |
| `log_contact` | Logs or updates contact info in a Google Sheet. Merges rows by email + role. |
| `create_calendar_event` | Creates a Google Calendar event for scheduled calls/meetings. Includes meeting links, attendees and their contact info. |

## MCP Prompts (built in as of now-ish - add your own)
### BETTER YET - DO A PR OR FORK

| Prompt | Account | Description |
|--------|---------|-------------|
| `review_emails` | work | Loads the classification + action prompts for the work inbox |
| `review_secondary_emails` | secondary | Same workflow, but for a second email account inbox |

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
├── accountsAndCredentials/
│   ├── accounts.json                    # Multi-account configuration (gitignored)
│   ├── accounts.example.json            # Template for accounts.json
│   ├── credentials.json                 # Google OAuth client credentials (gitignored)
│   ├── credentials.example.json         # Template for credentials.json
│   ├── token.json                       # OAuth token -- work account (gitignored, auto-generated)
│   ├── token-secondary.json             # OAuth token -- secondary account (gitignored, auto-generated)
│   └── token.example.json              # Template showing token structure
├── test/
│   ├── fixtures/
│   │   └── mock-emails.ts              # Mock Gmail API responses
│   ├── integration/
│   │   └── email-workflow.test.ts       # Integration tests
│   └── unit/
│       └── email-parsing.test.ts        # Unit tests for parsing helpers
├── mailSummaries/                       # Per-account summary output (gitignored, auto-generated)
├── build/                               # Compiled JS (auto-generated)
├── assets/
│   └── logo.png                         # Project logo
├── package.json
├── tsconfig.json
├── vitest.config.ts
├── .gitignore
└── README.md
```

