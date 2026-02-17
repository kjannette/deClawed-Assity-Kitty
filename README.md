# Declawed (A Mail Bot)

A local Model Context Protocol (MCP) server connecing LLM platform APIs (ie  Claude Desktop), or locally hosted models to your mail account. 
Ssimple. 
No Surprises, unlike the blue-plate-special-crustacean of the day.
Automates review, classification, and action -- response, deletion, archiving -- for inbox items.

---

# Scope 

## Current implementaiton contemplates: Claude Desktop + Local Custom Model Context Protocol Server + Goog-MX'ed SMTP for your Registered, DNS'd XXX.YYY domain
(highly config'able- more to follow)

---

### 1. Install: Node.js

 Node.js v16 or higher must be installed.

```bash
node --version
npm --version
```

If not installed, download from [nodejs.org](https://nodejs.org/).

### 2. Initialize the Project

```bash
mkdir assistant
cd assistant
npm init -y
```

### 3. Install Dependencies

```bash
npm install @modelcontextprotocol/sdk zod@3 googleapis
npm install -D @types/node typescript
```

Create the source directory and entry file:

```bash
mkdir src
touch src/index.ts
```

### 4. Configure the Project

#### 4a. Update `package.json`

Set the module type, binary entry, and build scripts:

```json
{
  "type": "module",
  "bin": {
    "assistant": "./build/index.js"
  },
  "scripts": {
    "build": "tsc && chmod 755 build/index.js",
    "auth": "npm run build && node build/auth.js"
  },
  "files": ["build"]
}
```

#### 4b. Create `tsconfig.json` in the project root

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "Node16",
    "moduleResolution": "Node16",
    "outDir": "./build",
    "rootDir": "./src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules"]
}
```

### 5. Write the Server Code

The server source lives in `src/index.ts`. It registers three tools and one prompt with the MCP server:

- **`fetch_new_emails`** -- fetches unread Gmail messages
- **`delete_emails`** -- trashes messages by ID
- **`append_to_summary`** -- logs classified emails to `summary.json`
- **`review_emails`** (prompt) -- feeds Claude the classification instructions

The auth helper lives in `src/auth.ts`, used only for the one-time OAuth setup.

### 6. Set Up Google Cloud Credentials

#### 6a. Create a Google Cloud Project

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Sign in with the Google account that owns the target Gmail
3. Click the project dropdown (top-left) and select **New Project**
4. Name it (e.g., `assistant-mcp`) and click **Create**
5. Select the new project from the dropdown

#### 6b. Enable the Gmail API

1. Go to **APIs & Services > Library** ([direct link](https://console.cloud.google.com/apis/library))
2. Search for **Gmail API**
3. Click it, then click **Enable**

#### 6c. Configure the OAuth Consent Screen

1. Go to **Google Auth Platform > Branding** (or **APIs & Services > OAuth consent screen**)
2. Set user type to **External**, click **Create**
3. Fill in app name, support email, and developer contact email
4. Save and continue

#### 6d. Add the Gmail Scope

1. Go to **Google Auth Platform > Data Access** (or the Scopes page)
2. Click **Add or remove scopes**
3. Add: `https://www.googleapis.com/auth/gmail.modify`
4. Save

#### 6e. Add Yourself as a Test User

1. Go to **Google Auth Platform > Audience**
2. Add your Gmail address as a test user

#### 6f. Create OAuth Client Credentials

1. Go to **Google Auth Platform > Clients** (or **APIs & Services > Credentials**)
2. Click **Create Client** (or **+ Create Credentials > OAuth client ID**)
3. Application type: **Desktop app**
4. Name it anything (e.g., `Assistant MCP Desktop`)
5. Click **Create**
6. **Download the JSON** file
7. Rename it to `credentials.json`
8. Move it to the project root: `/Users/kjannette/assistant/credentials.json`

### 7. Authorize Your Gmail Account

Build the project and run the auth script:

```bash
npm run auth
```

This will:
1. Print a URL -- open it in your browser
2. Sign in with your Google account and click **Allow**
3. You'll land on a "localhost refused to connect" page (this is normal)
4. Copy the **entire URL** from the browser address bar
5. Paste it into the terminal prompt
6. The script extracts the auth code and saves `token.json`

You only need to do this once. The token auto-refreshes.

### 8. Build the Server

```bash
npm run build
```

This compiles `src/*.ts` into `build/*.js`.

### 9. Write the Classification Prompt

Create a file called `classify-emails.txt` in the project root. This file contains the plain-text instructions that tell Claude how to classify your emails.

**Tips for writing the prompt:**
- Use clear, explicit category definitions with example language for each
- Handle ambiguous cases (e.g., "If an email both acknowledges receipt AND requests action, classify it as B")
- Define the exact actions to take for each category (delete, summarize, etc.)
- Specify what fields to include in summaries
- Keep it in plain text -- no JSON or special formatting needed
- The file is loaded at runtime, so you can edit it without rebuilding the server

**File location:** Must be at the project root as `classify-emails.txt`.

### 10. Configure Claude Desktop

Edit the Claude Desktop config file:

```bash
code ~/Library/Application\ Support/Claude/claude_desktop_config.json
```

Add the `assistant` server to the `mcpServers` object:

```json
{
  "mcpServers": {
    "assistant": {
      "command": "/ABSOLUTE/PATH/TO/node",
      "args": [
        "/Users/kjannette/assistant/build/index.js"
      ]
    }
  }
}
```

Replace `/ABSOLUTE/PATH/TO/node` with the output of `which node`.

### 11. Restart Claude Desktop

Fully quit Claude Desktop (**Cmd+Q**, not just close the window) and reopen it. The `assistant` server should now appear under **Connectors** in the chat input.

---

## Usage Guide

### Prompt Loader

The server reads `classify-emails.txt` from the project root at runtime. To change classification behavior, edit that file directly -- no rebuild required. The updated instructions take effect on the next tool call.

### MCP Prompt: `review_emails`

A registered MCP prompt available in Claude Desktop's Connectors menu. When invoked, it feeds Claude the full contents of `classify-emails.txt` as a user message, giving Claude all the classification criteria before it calls any tools. This is the recommended way to trigger the workflow -- it ensures Claude has the complete instructions every time.

### `fetch_new_emails` Enrichment

Every time `fetch_new_emails` is called, the classification instructions from `classify-emails.txt` are appended to the response alongside the email data. This means Claude always sees the rules with the data, even if the `review_emails` prompt was not explicitly invoked. Belt and suspenders.

### Running the Workflow

1. Open Claude Desktop
2. Type: **"Review my inbox"** (or invoke the `review_emails` prompt from Connectors)
3. Claude will:
   - Call `fetch_new_emails` to retrieve unread messages
   - Classify each email as A, B, C, or D using the prompt instructions
   - Call `delete_emails` for categories A and C
   - Call `append_to_summary` for categories B and D
4. Results are displayed in the chat and saved to `summary.json`

### Key Commands

| Command | Purpose |
|---------|---------|
| `npm run build` | Recompile after editing `src/index.ts` |
| `npm run auth` | Re-authorize Gmail (only if `token.json` deleted/expired) |
| Cmd+Q Claude Desktop, reopen | Pick up server changes after a rebuild |

---

## Project Structure

```
assistant/
├── src/
│   ├── index.ts          # MCP server source (tools + prompt)
│   └── auth.ts           # One-time OAuth setup script
├── build/
│   ├── index.js          # Compiled server (Claude Desktop runs this)
│   └── auth.js           # Compiled auth script
├── classify-emails.txt   # Classification prompt (plain text, edit anytime)
├── credentials.json      # Google OAuth client credentials (from Cloud Console)
├── token.json            # Gmail access/refresh token (auto-generated)
├── summary.json          # Output file where B/D emails are logged
├── package.json          # Project config and scripts
├── tsconfig.json         # TypeScript compiler config
└── README.md             # This file
```
