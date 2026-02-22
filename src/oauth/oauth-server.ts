/**
 * OAuth Callback Server — lightweight HTTP server for receiving OAuth redirects.
 *
 * Uses Node's built-in `http` module (zero dependencies).
 * Starts on demand, auto-shuts down after receiving the callback.
 */

import { createServer, type Server } from "node:http";
import { randomBytes } from "node:crypto";
import { logInfo, logError } from "../logger.js";
import { getGoogleAuth } from "./google-auth.js";

// ─── Types ───────────────────────────────────────────────────────────────────

type OAuthCallbackResult = {
    success: boolean;
    error?: string;
};

type PendingAuth = {
    state: string;
    resolve: (result: OAuthCallbackResult) => void;
    timeout: ReturnType<typeof setTimeout>;
};

// ─── Success HTML page ───────────────────────────────────────────────────────

const SUCCESS_HTML = `<!DOCTYPE html>
<html>
<head><title>Connected!</title>
<style>
  body { font-family: -apple-system, system-ui, sans-serif; display: flex;
         justify-content: center; align-items: center; height: 100vh;
         margin: 0; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); }
  .card { background: white; border-radius: 16px; padding: 48px;
          text-align: center; box-shadow: 0 20px 60px rgba(0,0,0,0.3); }
  .icon { font-size: 64px; }
  h1 { color: #333; margin: 16px 0 8px; }
  p { color: #666; }
</style></head>
<body>
  <div class="card">
    <div class="icon">✅</div>
    <h1>Connected!</h1>
    <p>Google is now connected to your Yakshas-v1.<br>You can close this tab.</p>
  </div>
</body>
</html>`;

const ERROR_HTML = (msg: string) => `<!DOCTYPE html>
<html>
<head><title>Error</title>
<style>
  body { font-family: -apple-system, system-ui, sans-serif; display: flex;
         justify-content: center; align-items: center; height: 100vh;
         margin: 0; background: #f44336; }
  .card { background: white; border-radius: 16px; padding: 48px;
          text-align: center; box-shadow: 0 20px 60px rgba(0,0,0,0.3); }
  .icon { font-size: 64px; }
  h1 { color: #333; }
  p { color: #d32f2f; }
</style></head>
<body>
  <div class="card">
    <div class="icon">❌</div>
    <h1>Connection Failed</h1>
    <p>${msg}</p>
  </div>
</body>
</html>`;

// ─── OAuth Server ────────────────────────────────────────────────────────────

export class OAuthServer {
    private server: Server | null = null;
    private pending: PendingAuth | null = null;
    private port: number;

    constructor() {
        this.port = parseInt(process.env.OAUTH_CALLBACK_PORT ?? "9876", 10);
        // Start listening immediately so callback is always ready
        this.ensureServerRunning().catch(err => {
            logError(`Failed to start OAuth server: ${err instanceof Error ? err.message : err}`);
        });
    }

    /**
     * Start the OAuth flow:
     * 1. Generate a random state parameter
     * 2. Start HTTP server to receive the callback
     * 3. Return the authorization URL for the user to click
     * 4. Wait for the callback (with timeout)
     */
    async startAuthFlow(): Promise<{ authUrl: string; waitForCallback: () => Promise<OAuthCallbackResult> }> {
        const state = randomBytes(16).toString("hex");

        // Ensure server is running
        await this.ensureServerRunning();

        // Build auth URL
        const authUrl = getGoogleAuth().getAuthUrl(state);

        // Create a promise that resolves when the callback is received
        const waitForCallback = (): Promise<OAuthCallbackResult> => {
            return new Promise<OAuthCallbackResult>((resolve) => {
                // 5-minute timeout
                const timeout = setTimeout(() => {
                    this.pending = null;
                    resolve({ success: false, error: "Authorization timed out (5 minutes)" });
                }, 5 * 60 * 1000);

                this.pending = { state, resolve, timeout };
            });
        };

        return { authUrl, waitForCallback };
    }

    private async ensureServerRunning(): Promise<void> {
        if (this.server?.listening) return;

        return new Promise<void>((resolve, reject) => {
            this.server = createServer(async (req, res) => {
                const url = new URL(req.url ?? "/", `http://localhost:${this.port}`);

                if (url.pathname !== "/oauth/callback") {
                    res.writeHead(404, { "Content-Type": "text/plain" });
                    res.end("Not found");
                    return;
                }

                const code = url.searchParams.get("code");
                const state = url.searchParams.get("state");
                const error = url.searchParams.get("error");

                // Handle errors from Google
                if (error) {
                    res.writeHead(200, { "Content-Type": "text/html" });
                    res.end(ERROR_HTML(`Google returned an error: ${error}`));
                    this.pending?.resolve({ success: false, error });
                    this.clearPending();
                    return;
                }

                // Validate state if there's a pending auth, otherwise accept direct callbacks
                if (this.pending && state !== this.pending.state) {
                    res.writeHead(400, { "Content-Type": "text/html" });
                    res.end(ERROR_HTML("Invalid state parameter — possible CSRF attack"));
                    return;
                }

                if (!code) {
                    res.writeHead(400, { "Content-Type": "text/html" });
                    res.end(ERROR_HTML("No authorization code received"));
                    this.pending?.resolve({ success: false, error: "No code received" });
                    this.clearPending();
                    return;
                }

                // Exchange code for tokens
                try {
                    await getGoogleAuth().exchangeCode(code);
                    res.writeHead(200, { "Content-Type": "text/html" });
                    res.end(SUCCESS_HTML);
                    this.pending?.resolve({ success: true });
                } catch (err) {
                    const msg = err instanceof Error ? err.message : String(err);
                    res.writeHead(200, { "Content-Type": "text/html" });
                    res.end(ERROR_HTML(msg));
                    this.pending?.resolve({ success: false, error: msg });
                }

                this.clearPending();
            });

            this.server.on("error", (err) => {
                logError(`OAuth server error: ${err.message}`);
                reject(err);
            });

            this.server.listen(this.port, () => {
                logInfo(`OAuth callback server listening on http://localhost:${this.port}`);
                resolve();
            });
        });
    }

    private clearPending(): void {
        if (this.pending) {
            clearTimeout(this.pending.timeout);
            this.pending = null;
        }
    }

    /** Stop the server gracefully. */
    stop(): void {
        if (this.server) {
            this.server.close();
            this.server = null;
            logInfo("OAuth callback server stopped");
        }
    }
}

// ─── Singleton ───────────────────────────────────────────────────────────────

let _server: OAuthServer | null = null;

export function getOAuthServer(): OAuthServer {
    if (!_server) _server = new OAuthServer();
    return _server;
}
