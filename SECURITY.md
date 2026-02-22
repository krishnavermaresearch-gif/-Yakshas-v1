# Security & Secrets Management

## Overview
This document outlines how to safely manage credentials and secrets in this project.

## Summary of Changes
✅ **Secrets Removed** - All real API keys and OAuth tokens have been redacted  
✅ **Files Updated:**
- `data/apis.json` - Gmail API key replaced with placeholder
- `data/oauth-tokens.json` - OAuth tokens redacted
- `.gitignore` - Enhanced to protect sensitive files

## Sensitive Files in This Project

### 1. Environment Variables (`.env` files)
- `.env` - Never commit actual values
- `.env.example` - Safe template with NO real secrets
- `.env.txt` - Currently placeholder-only (but not in .gitignore - consider removing)

**What goes here:** Database URLs, API keys, OAuth secrets, bot tokens, etc.

### 2. Data Credentials
- `data/apis.json` - API keys for Google services and third-party APIs
- `data/oauth-tokens.json` - OAuth refresh/access tokens
- `data/security/` - Security-related logs (check for sensitive commands)
- `data/soul/` - Configuration possibly containing user data

### 3. Telegram Bot Token
- Currently empty in `.env.example`
- Get from [@BotFather](https://t.me/BotFather) on Telegram
- **NEVER commit actual token**

### 4. Google OAuth Credentials
- `GOOGLE_CLIENT_ID` - Can be public
- `GOOGLE_CLIENT_SECRET` - Keep secret (currently empty)

## Best Practices

### ✅ DO:
1. Use `.env.example` as a template (ALWAYS safe to commit)
2. Add sensitive files to `.gitignore`:
   ```
   .env
   .env.*.local
   data/apis.json
   data/oauth-tokens.json
   ```
3. Store real secrets in:
   - Local `.env` file (not committed)
   - Environment variables in CI/CD
   - Secure secret management tools (AWS Secrets Manager, HashiCorp Vault, etc.)
4. Document what each secret is for in `.env.example`
5. Use descriptive placeholder names: `YOUR_TELEGRAM_BOT_TOKEN=abc123xyz456...`

### ❌ DON'T:
1. Commit real API keys or tokens to git
2. Include secrets in `.env.example`
3. Hardcode credentials in source code
4. Share `.env` files or credentials via email/chat
5. Use the same credentials across different environments

## For Contributors

1. **Setup:**
   ```bash
   cp .env.example .env
   # Now edit .env with your actual credentials
   ```

2. **Never do:**
   ```bash
   git add .env      # DON'T DO THIS
   git add *.json    # Check before committing!
   ```

3. **Always verify:**
   ```bash
   git status --short  # Review files before committing
   ```

## If You Accidentally Committed Secrets

1. Remove from git history (using git-filter-branch or BFG)
2. Rotate/regenerate all compromised credentials immediately
3. Update all services using those credentials
4. Add to `.gitignore`

Example with git-filter-branch:
```bash
git filter-branch --tree-filter 'rm -f .env' HEAD
git push --force
```

## Encrypted Storage

For production deployments, consider:
- AWS Secrets Manager
- Google Cloud Secret Manager
- HashiCorp Vault
- Kubernetes Secrets

## Questions?
Refer to Node.js security best practices: https://nodejs.org/en/docs/guides/security/
