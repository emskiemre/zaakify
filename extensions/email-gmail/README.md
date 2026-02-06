# Gmail Extension for Zaakify

Gmail integration extension that provides email management capabilities through the Gmail API.

## Features

- **List emails** - View inbox, sent, drafts with pagination
- **Read emails** - Get full message details including body and attachment metadata
- **Download attachments** - Download email attachments to disk (~/.zaakify/drive/downloads/)
- **Send emails** - Compose and send new messages
- **Reply to emails** - Reply to existing conversations
- **Search emails** - Find messages by query (including by attachment: `has:attachment`)
- **Move emails** - Organize with labels
- **Delete emails** - Remove or trash messages
- **Mark emails** - Mark as read/unread, star/unstar

## Setup Instructions

### 1. Create Google Cloud Project

1. Go to https://console.cloud.google.com/
2. Click "Select a project" → "New Project"
3. Enter project name (e.g., "Zaakify Gmail")
4. Click "Create"

### 2. Enable Gmail API

1. In your project, go to "APIs & Services" > "Library"
2. Search for "Gmail API"
3. Click on it, then click "Enable"

### 3. Create OAuth 2.0 Credentials

1. Go to "APIs & Services" > "Credentials"
2. Click "Create Credentials" > "OAuth client ID"

**IMPORTANT: You'll see this prompt first:**

```
"Select an API: Gmail API"
"What data will you be accessing?"
```

**Choose: "User data"** ← This is critical!
- ✅ User data = Access YOUR Gmail (emails, send on your behalf)
- ❌ Application data = Service accounts (not what we need)

3. You'll be redirected to configure OAuth consent screen (if first time):
   - **App name:** "Zaakify Gmail Extension" (or any name you like)
   - **User support email:** Your email address
   - **Developer contact:** Your email address
   - **Scopes:** Click "Add or Remove Scopes" and add:
     - `https://www.googleapis.com/auth/gmail.readonly`
     - `https://www.googleapis.com/auth/gmail.send`
     - `https://www.googleapis.com/auth/gmail.modify`
     - `https://www.googleapis.com/auth/gmail.compose`
   - **Test users:** Add your email address (for testing)
   - Click "Save and Continue"

4. Back to "Create OAuth client ID":
   - **Application type:** Choose "Desktop app"
   - **Name:** "Zaakify Gmail Client" (or any name)
   - **IMPORTANT:** Under "Authorized redirect URIs", add: `http://localhost:3000/oauth2callback`
   - Click "Create"

5. You'll see a popup with:
   - **Client ID:** (looks like `xxxxx.apps.googleusercontent.com`)
   - **Client Secret:** (looks like `GOCSPX-xxxxx`)
   - **Option:** Download the JSON file or copy these values
   - **Save these!** You'll need them for the interactive setup
   
**⚠️ CRITICAL: Redirect URI Must Match**
- The redirect URI in Google Cloud Console MUST be exactly: `http://localhost:3000/oauth2callback`
- If it's different (like just `http://localhost`), OAuth will fail with "missing response_type" error
- The extension will detect mismatches and guide you to fix it

### 3. Interactive Setup (Recommended)

The extension provides built-in interactive setup tools. **This is the easiest method:**

#### Step 1: Start the Extension
```bash
Extension({ action: "start", name: "email-gmail" })
```

#### Step 2: Begin OAuth Setup
Provide your OAuth credentials to the setup tool:

```javascript
// With full OAuth JSON (recommended):
gmail-setup-start({
  oauthJson: '{"installed":{"client_id":"...","client_secret":"..."}}'
})

// OR with individual credentials (accepts both formats):
gmail-setup-start({
  clientId: "YOUR_CLIENT_ID.apps.googleusercontent.com",
  clientSecret: "YOUR_CLIENT_SECRET"
})
// Also accepts: client_id and client_secret
```

The tool will return an authorization URL.

#### Step 3: Authorize
1. Visit the authorization URL in your browser
2. Sign in with your Google account
3. Grant the requested Gmail permissions
4. You'll be redirected to a success page

#### Step 4: Complete Setup
**CRITICAL:** After authorizing, you must call this to complete the setup:

```javascript
gmail-setup-check({})
```

This will:
- Capture the OAuth authorization code
- Exchange it for a refresh token
- Save the configuration automatically

#### Step 5: Restart Extension
```javascript
Extension({ action: "restart", name: "email-gmail" })
```

#### Step 6: Verify
```javascript
gmail-list({ account: "your.email@gmail.com", maxResults: 5 })
```

---

### Alternative: Manual Configuration

If you prefer to manually configure without using the interactive tools:

1. Obtain a refresh token using the OAuth flow (use a script or tools like Postman)
2. Edit `config.json` directly:

```json
{
  "configured": true,
  "clientId": "YOUR_CLIENT_ID.apps.googleusercontent.com",
  "clientSecret": "YOUR_CLIENT_SECRET",
  "redirectUri": "http://localhost:3000/oauth2callback",
  "refreshToken": "YOUR_REFRESH_TOKEN",
  "accounts": [
    {
      "email": "your.email@gmail.com",
      "label": "Personal"
    }
  ]
}
```

3. Install dependencies and restart:
```bash
Extension({ action: "install", name: "email-gmail" })
Extension({ action: "restart", name: "email-gmail" })
```

## Available Tools

Once configured, these tools are available:

### `gmail-list`
List emails from inbox or specific label.

```javascript
gmail-list({ 
  account: "your.email@gmail.com",
  label: "INBOX",     // Optional: INBOX, SENT, DRAFT, SPAM, TRASH
  maxResults: 10,     // Optional: 1-100, default 10
  query: ""           // Optional: Gmail search query
})
```

### `gmail-read`
Read a specific email message with attachment metadata.

```javascript
gmail-read({
  account: "your.email@gmail.com",
  messageId: "18d4e5f2a3b1c9d7"
})
```

**Output includes:**
- Message headers (From, To, Subject, Date)
- Message body (text/plain or HTML converted to text)
- Attachment list with filenames, sizes, MIME types, and attachment IDs

### `gmail-download-attachment`
Download an attachment from an email to disk.

```javascript
gmail-download-attachment({
  account: "your.email@gmail.com",
  messageId: "18d4e5f2a3b1c9d7",
  attachmentId: "ANGjdJ8wY...",  // From gmail-read output
  savePath: "/optional/custom/path.pdf"  // Optional: defaults to ~/.zaakify/drive/downloads/[filename]
})
```

**Workflow:**
1. Use `gmail-read` to view email and get attachment IDs
2. Use `gmail-download-attachment` to download specific attachments
3. Files are saved to `~/.zaakify/drive/downloads/` by default
4. Use the Read tool or other tools to process downloaded files

### `gmail-send`
Send a new email.

```javascript
gmail-send({
  account: "your.email@gmail.com",
  to: "recipient@example.com",
  subject: "Hello",
  body: "Message content",
  cc: "optional@example.com",      // Optional
  bcc: "hidden@example.com"        // Optional
})
```

### `gmail-reply`
Reply to an existing email.

```javascript
gmail-reply({
  account: "your.email@gmail.com",
  messageId: "18d4e5f2a3b1c9d7",
  body: "Reply message"
})
```

### `gmail-search`
Search for emails using Gmail query syntax.

```javascript
gmail-search({
  account: "your.email@gmail.com",
  query: "from:sender@example.com subject:urgent",
  maxResults: 20
})
```

**Common search queries:**
- `has:attachment` - Find emails with attachments
- `from:sender@example.com` - From specific sender
- `subject:invoice` - Subject contains keyword
- `after:2024/01/01` - After specific date
- `is:unread` - Unread messages
- `filename:pdf` - Attachments with specific extension

### `gmail-move`
Move/label an email.

```javascript
gmail-move({
  account: "your.email@gmail.com",
  messageId: "18d4e5f2a3b1c9d7",
  addLabels: ["IMPORTANT"],
  removeLabels: ["INBOX"]
})
```

### `gmail-delete`
Delete or trash an email.

```javascript
gmail-delete({
  account: "your.email@gmail.com",
  messageId: "18d4e5f2a3b1c9d7",
  permanent: false    // true = permanent delete, false = move to trash
})
```

### `gmail-mark`
Mark email as read/unread or star/unstar.

```javascript
gmail-mark({
  account: "your.email@gmail.com",
  messageId: "18d4e5f2a3b1c9d7",
  read: true,         // Optional: mark as read/unread
  starred: true       // Optional: star/unstar
})
```

## Agent Usage Examples

```
User: "Check my Gmail inbox"
Agent: gmail-list({ account: "user@gmail.com", label: "INBOX", maxResults: 10 })

User: "Read the first email"
Agent: gmail-read({ account: "user@gmail.com", messageId: "..." })

User: "Reply saying thanks"
Agent: gmail-reply({ account: "user@gmail.com", messageId: "...", body: "Thanks!" })

User: "Search for emails from john about the meeting"
Agent: gmail-search({ account: "user@gmail.com", query: "from:john meeting" })
```

## Troubleshooting

### Extension not loading
- Check if dependencies are installed: `Extension({ action: "info", name: "email-gmail" })`
- Install if needed: `Extension({ action: "install", name: "email-gmail" })`

### Authentication errors
- Verify OAuth credentials are correct in `config.json`
- Ensure `configured: true` is set
- Check that refresh token is valid
- Reload extension: `Extension({ action: "reload", name: "email-gmail" })`

### API errors
- Check Gmail API is enabled in Google Cloud Console
- Verify OAuth scopes include necessary permissions
- Check API quotas haven't been exceeded

## Security Notes

- **Never commit config.json with real credentials to git**
- Refresh tokens provide long-term access - keep them secure
- Use environment variables or secure storage for production
- Consider rotating credentials periodically

## Architecture

```
email-gmail/
├── index.mjs           # Extension entry point
├── config.json         # OAuth credentials (not in git)
├── package.json        # Dependencies
├── SCHEMA.json         # Config validation
├── README.md           # This file
└── src/
    ├── client.mjs      # Gmail API wrapper
    ├── oauth.mjs       # OAuth token management
    ├── tools/          # Individual tool implementations
    │   ├── list.mjs
    │   ├── read.mjs
    │   ├── send.mjs
    │   ├── reply.mjs
    │   ├── search.mjs
    │   ├── move.mjs
    │   ├── delete.mjs
    │   └── mark.mjs
    └── utils/
        ├── formatters.mjs  # Message formatting
        ├── mime.mjs        # MIME message creation
        └── errors.mjs      # Error handling
```

## Version

1.0.0 - Initial release

## License

MIT
