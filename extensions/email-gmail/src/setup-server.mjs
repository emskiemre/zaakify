/**
 * OAuth callback server for Gmail setup
 * Handles the OAuth redirect and captures the authorization code
 */

import http from "http";
import { URL } from "url";

let server = null;
let authCode = null;
let authError = null;

/**
 * Start OAuth callback server
 */
export function startServer(port = 3000) {
  return new Promise((resolve, reject) => {
    // Reset state
    authCode = null;
    authError = null;

    // Close existing server if any
    if (server) {
      server.close();
    }

    server = http.createServer(async (req, res) => {
      // Support both /oauth2callback (web app) and / (desktop app)
      if (req.url.startsWith('/oauth2callback') || req.url.startsWith('/?code=') || req.url.startsWith('/?error=')) {
        const url = new URL(req.url, `http://localhost:${port}`);
        const code = url.searchParams.get('code');
        const error = url.searchParams.get('error');

        if (error) {
          authError = error;
          res.writeHead(200, { 'Content-Type': 'text/html' });
          res.end(`
            <html>
              <head><title>Authorization Failed</title></head>
              <body>
                <h1>Authorization Failed</h1>
                <p>Error: ${error}</p>
                <p>You can close this window and try again.</p>
              </body>
            </html>
          `);
        } else if (code) {
          authCode = code;
          res.writeHead(200, { 'Content-Type': 'text/html' });
          res.end(`
            <html>
              <head><title>Authorization Successful</title></head>
              <body>
                <h1>✓ Authorization Successful!</h1>
                <p>You can close this window and return to the agent.</p>
              </body>
            </html>
          `);
        } else {
          res.writeHead(400, { 'Content-Type': 'text/html' });
          res.end(`
            <html>
              <head><title>Invalid Request</title></head>
              <body>
                <h1>Invalid Request</h1>
                <p>Missing authorization code.</p>
              </body>
            </html>
          `);
        }
      } else {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('Not Found');
      }
    });

    server.on('error', (err) => {
      if (err.code === 'EADDRINUSE') {
        reject(new Error(`Port ${port} is already in use. Please close any applications using this port.`));
      } else {
        reject(err);
      }
    });

    server.listen(port, () => {
      resolve({ port, message: `OAuth callback server started on port ${port}` });
    });
  });
}

/**
 * Get authorization code (null if not yet received)
 */
export function getAuthCode() {
  return authCode;
}

/**
 * Get authorization error (null if no error)
 */
export function getAuthError() {
  return authError;
}

/**
 * Check if authorization is complete
 */
export function isAuthComplete() {
  return authCode !== null || authError !== null;
}

/**
 * Stop OAuth callback server
 */
export function stopServer() {
  return new Promise((resolve) => {
    if (server) {
      server.close(() => {
        server = null;
        authCode = null;
        authError = null;
        resolve({ message: 'OAuth callback server stopped' });
      });
    } else {
      resolve({ message: 'No server running' });
    }
  });
}

/**
 * Reset authorization state
 */
export function resetAuth() {
  authCode = null;
  authError = null;
}
