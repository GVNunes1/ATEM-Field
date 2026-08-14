import html
import json
import os
import sys
import urllib.parse
from http.server import BaseHTTPRequestHandler, HTTPServer

from google_auth_oauthlib.flow import InstalledAppFlow

from google_calendar_credentials import (
    SCOPES,
    clear_incremental_sync_state,
    credentials_path,
    save_credentials,
)


if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")
if hasattr(sys.stderr, "reconfigure"):
    sys.stderr.reconfigure(encoding="utf-8")

credentials_file = credentials_path()
if not credentials_file:
    print(json.dumps({
        "success": False,
        "error": "Credenciais OAuth do Google não encontradas. Configure GOOGLE_CALENDAR_CREDENTIALS_PATH.",
    }, ensure_ascii=False), flush=True)
    raise SystemExit(1)

oauth_port = int(os.environ.get("GOOGLE_OAUTH_PORT", "8080"))
redirect_uri = "http://127.0.0.1:{}/".format(oauth_port)
flow = InstalledAppFlow.from_client_secrets_file(str(credentials_file), scopes=SCOPES, redirect_uri=redirect_uri)
auth_url, _ = flow.authorization_url(
    access_type="offline",
    prompt="consent",
    include_granted_scopes="true",
)


class OAuthHandler(BaseHTTPRequestHandler):
    def log_message(self, format_string, *args):
        sys.stderr.write((format_string % args) + "\n")

    def _render(self, status, title, message, success):
        accent = "#087a57" if success else "#b42318"
        document = """<!doctype html><html lang=\"pt-BR\"><head><meta charset=\"utf-8\">
        <meta name=\"viewport\" content=\"width=device-width,initial-scale=1\"><title>{}</title>
        <style>body{{margin:0;padding:48px 18px;background:#f4f7fb;color:#162033;font-family:Segoe UI,Arial,sans-serif}}
        main{{max-width:520px;margin:auto;padding:34px;border:1px solid #dfe7f1;border-radius:18px;background:#fff;box-shadow:0 16px 44px #10284018}}
        h1{{margin:0;color:{};font-size:25px}}p{{color:#667085;line-height:1.6}}a{{display:inline-block;margin-top:10px;padding:11px 16px;border-radius:9px;background:#175cd3;color:#fff;text-decoration:none;font-weight:650}}</style>
        </head><body><main><h1>{}</h1><p>{}</p><a href=\"http://localhost:3001/\">Voltar ao ATEM Field</a></main></body></html>""".format(
            html.escape(title), accent, html.escape(title), html.escape(message)
        )
        self.send_response(status)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.end_headers()
        self.wfile.write(document.encode("utf-8"))

    def do_GET(self):
        params = urllib.parse.parse_qs(urllib.parse.urlparse(self.path).query)
        if "error" in params:
            self._render(400, "Acesso não autorizado", params["error"][0], False)
            return
        if "code" not in params:
            self._render(400, "Código ausente", "O Google não devolveu o código de autorização.", False)
            return
        try:
            flow.fetch_token(code=params["code"][0])
            save_credentials(flow.credentials)
            clear_incremental_sync_state()
            self._render(
                200,
                "Google Agenda conectado",
                "O acesso foi salvo no backend. A partir de agora a renovação e a sincronização são automáticas.",
                True,
            )
        except Exception as error:
            self._render(500, "Falha ao salvar o acesso", str(error), False)


try:
    server = HTTPServer(("127.0.0.1", oauth_port), OAuthHandler)
except OSError as error:
    print(json.dumps({"success": False, "error": "A porta OAuth {} está ocupada: {}".format(oauth_port, error)}, ensure_ascii=False), flush=True)
    raise SystemExit(1)

print(json.dumps({"success": True, "auth_url": auth_url}, ensure_ascii=False), flush=True)
server.timeout = 300
server.handle_request()
