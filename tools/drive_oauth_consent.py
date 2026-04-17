#!/usr/bin/env python3
import argparse
import json
import secrets
import threading
import urllib.parse
import urllib.request
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path


CALLBACK_HOST = "ae-micro.cuttlefish-garibaldi.ts.net"
CALLBACK_BIND = "0.0.0.0"
CALLBACK_PORT = 8765
REDIRECT_URI = f"http://{CALLBACK_HOST}:{CALLBACK_PORT}/callback"
SCOPES = ["https://www.googleapis.com/auth/drive.file"]


class CallbackHandler(BaseHTTPRequestHandler):
    server_version = "DriveOAuthConsent/1.0"

    def do_GET(self):
        parsed = urllib.parse.urlparse(self.path)
        if parsed.path != "/callback":
            self.send_response(404)
            self.end_headers()
            self.wfile.write(b"Not found")
            return

        query = urllib.parse.parse_qs(parsed.query)
        self.server.auth_code = query.get("code", [None])[0]
        self.server.auth_error = query.get("error", [None])[0]

        self.send_response(200)
        self.send_header("Content-Type", "text/plain; charset=utf-8")
        self.end_headers()
        if self.server.auth_code:
            self.wfile.write(
                b"Authorization received. You can return to the terminal window."
            )
        else:
            self.wfile.write(
                f"Authorization failed: {self.server.auth_error or 'unknown_error'}".encode(
                    "utf-8"
                )
            )

    def log_message(self, format, *args):
        return


def exchange_code(client_id: str, client_secret: str, code: str):
    payload = urllib.parse.urlencode(
        {
            "client_id": client_id,
            "client_secret": client_secret,
            "code": code,
            "grant_type": "authorization_code",
            "redirect_uri": REDIRECT_URI,
        }
    ).encode()
    req = urllib.request.Request(
        "https://oauth2.googleapis.com/token",
        data=payload,
        headers={"Content-Type": "application/x-www-form-urlencoded"},
    )
    with urllib.request.urlopen(req, timeout=30) as resp:
        return json.load(resp)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--client-id", required=True)
    parser.add_argument("--client-secret", required=True)
    args = parser.parse_args()

    client_id = args.client_id
    client_secret = args.client_secret
    state = secrets.token_urlsafe(24)

    auth_params = {
        "client_id": client_id,
        "redirect_uri": REDIRECT_URI,
        "response_type": "code",
        "scope": " ".join(SCOPES),
        "access_type": "offline",
        "prompt": "consent",
        "state": state,
    }
    auth_url = "https://accounts.google.com/o/oauth2/v2/auth?" + urllib.parse.urlencode(
        auth_params
    )

    server = HTTPServer((CALLBACK_BIND, CALLBACK_PORT), CallbackHandler)
    server.auth_code = None
    server.auth_error = None

    thread = threading.Thread(target=server.handle_request, daemon=True)
    thread.start()

    print("Open this URL in a browser and sign in with the Google account that can access the Drive folder:\n")
    print(auth_url)
    print(f"\nWaiting for callback on {REDIRECT_URI} ...")
    thread.join()

    if server.auth_error:
        raise SystemExit(f"OAuth failed: {server.auth_error}")
    if not server.auth_code:
        raise SystemExit("OAuth failed: no authorization code received")

    token_response = exchange_code(client_id, client_secret, server.auth_code)
    refresh_token = token_response.get("refresh_token")
    if not refresh_token:
        raise SystemExit(
            "OAuth succeeded but no refresh_token was returned. Re-run and ensure consent is granted."
        )

    output = {
        "client_id": client_id,
        "client_secret": client_secret,
        "refresh_token": refresh_token,
    }
    print("\nRefresh token acquired:\n")
    print(json.dumps(output, indent=2))


if __name__ == "__main__":
    main()
