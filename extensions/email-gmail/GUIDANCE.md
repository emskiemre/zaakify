# Gmail Extension — Usage Guide

_Auto-shown to agent when extension starts_

## ⚠️ CRITICAL: Two-Step Setup Process

**If extension is not yet configured, you MUST complete BOTH steps below:**

### 🔧 Setup Tools Available

| Tool | Purpose |
|------|---------|
| `gmail-setup-start` | Step 1: Collect credentials and generate auth URL |
| `gmail-setup-check` | Step 2: Complete setup after user authorizes (REQUIRED!) |

---

## 📋 Interactive Setup Checklist

When user asks to access Gmail and extension is not configured, follow this EXACT sequence:

### ✅ STEP 1: Get OAuth Credentials

Ask the user for their Google OAuth credentials. They can provide:

**Option A: Full OAuth JSON (Recommended)**
- Ask: "Please paste the entire OAuth JSON from Google Cloud Console"
- User pastes JSON starting with `{"installed":` or `{"web":`

**Option B: Individual credentials**
- Ask: "Please provide your OAuth Client ID and Client Secret"
- Format: Client ID ends with `.apps.googleusercontent.com`
- Format: Client Secret starts with `GOCSPX-`

### ✅ STEP 2: Call gmail-setup-start

**With full OAuth JSON:**
```javascript
gmail-setup-start({
  oauthJson: "<paste entire JSON here>"
})
```

**With individual credentials (accepts both formats):**
```javascript
gmail-setup-start({
  clientId: "...",        // or client_id
  clientSecret: "..."     // or client_secret
})
```

**Expected Result:** Tool returns an authorization URL

⚠️ **If you get a redirect URI mismatch error:** Guide user to fix it in Google Cloud Console, then retry.

### ✅ STEP 3: User Authorization

Show the authorization URL to the user:
```
"Please visit this URL in your browser:
[authorization URL]

Sign in with your Google account and grant the requested Gmail permissions.

Let me know when you've completed the authorization."
```

**Wait for user to confirm they've authorized.**

### ✅ STEP 4: Call gmail-setup-check (CRITICAL - DO NOT SKIP!)

🚨 **IMPORTANT:** After the user authorizes, you MUST call this tool to complete setup:

```javascript
gmail-setup-check({})
```

**This tool:**
- Captures the OAuth authorization code
- Exchanges it for a refresh token
- Saves the configuration
- Marks extension as configured

⛔ **Common mistake:** Agents forget to call this tool. Without it, setup is incomplete!

### ✅ STEP 5: Restart Extension

After successful setup:
```javascript
Extension({ action: "restart", name: "email-gmail" })
```

### ✅ STEP 6: Verify Setup

Test that Gmail access works:
```javascript
gmail-list({ account: "user@gmail.com", maxResults: 5 })
```

---

## 📧 Gmail Tools (Available After Setup)

Once configured, these tools are available:

| Tool | Purpose | Example |
|------|---------|---------|
| `gmail-list` | List emails from inbox or label | `gmail-list({ account: "user@gmail.com", label: "INBOX" })` |
| `gmail-read` | Read a specific email | `gmail-read({ account: "user@gmail.com", messageId: "abc123" })` |
| `gmail-send` | Send a new email | `gmail-send({ account: "user@gmail.com", to: "...", subject: "...", body: "..." })` |
| `gmail-reply` | Reply to an email | `gmail-reply({ account: "user@gmail.com", messageId: "...", body: "..." })` |
| `gmail-search` | Search emails by query | `gmail-search({ account: "user@gmail.com", query: "from:john" })` |
| `gmail-move` | Move/label an email | `gmail-move({ account: "user@gmail.com", messageId: "...", addLabels: ["IMPORTANT"] })` |
| `gmail-delete` | Delete or trash an email | `gmail-delete({ account: "user@gmail.com", messageId: "...", permanent: false })` |
| `gmail-mark` | Mark as read/unread/starred | `gmail-mark({ account: "user@gmail.com", messageId: "...", read: true })` |

---

## 📝 Important Notes

- **Account parameter:** All Gmail tools require the `account` parameter (user's email address)
- **Search syntax:** Use Gmail operators: `from:`, `to:`, `subject:`, `has:attachment`, `is:unread`, `after:2024/01/01`
- **Delete safety:** `gmail-delete` moves to trash by default. Only use `permanent: true` if user explicitly requests it
- **Auth errors:** If tools fail with auth errors, user may need to revoke access at https://myaccount.google.com/permissions and re-authorize

---

## 🛑 When You're Done

Stop this extension to free resources:
```javascript
Extension({ action: "stop", name: "email-gmail" })
```

**Remember:** Only one extension should run at a time.

---

## 🔍 Troubleshooting

**"Extension not configured" error:**
- Follow the setup checklist above
- Make sure you called BOTH `gmail-setup-start` AND `gmail-setup-check`

**OAuth authorization fails:**
- Check that user created OAuth credentials for "User data" (not "Application data")
- Verify redirect URI is: `http://localhost:3000/oauth2callback`
- User may need to add their email as a test user in Google Cloud Console

**Tools return auth errors:**
- Refresh token may be invalid
- Run the setup process again
- User may need to revoke and re-authorize
