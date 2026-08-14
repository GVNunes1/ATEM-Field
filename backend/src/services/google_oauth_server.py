import sys
import os
import json
import urllib.parse
from http.server import HTTPServer, BaseHTTPRequestHandler
import threading
import webbrowser

if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8')

agenda_app_src = r"C:\Users\tecnico.mmAT31\Documents\Agenda Online\Aplicativo_Monitor_Agendas\Aplicativo_Monitor_Agendas\src"
sys.path.insert(0, agenda_app_src)

import sync_calendar
from google_auth_oauthlib.flow import InstalledAppFlow

caminho_credentials = sync_calendar.verificar_credentials()
flow = None
if caminho_credentials and os.path.exists(caminho_credentials):
    flow = InstalledAppFlow.from_client_secrets_file(
        caminho_credentials,
        scopes=sync_calendar.SCOPES,
        redirect_uri='http://localhost:8080/'
    )

class OAuthHandler(BaseHTTPRequestHandler):
    def do_GET(self):
        query = urllib.parse.urlparse(self.path).query
        params = urllib.parse.parse_qs(query)

        if 'code' in params:
            code = params['code'][0]
            try:
                flow.fetch_token(code=code)
                creds = flow.credentials
                
                # Save token.pickle
                caminho_token = os.path.join(os.path.dirname(caminho_credentials), 'token.pickle')
                import pickle
                with open(caminho_token, 'wb') as f:
                    pickle.dump(creds, f)

                html = """
                <!DOCTYPE html>
                <html>
                <head>
                    <meta charset="utf-8">
                    <title>Login Google Concluído</title>
                    <style>
                        body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; background: #0f172a; color: #fff; text-align: center; padding: 60px 20px; }
                        .card { background: #1e293b; max-width: 480px; margin: 0 auto; padding: 40px; border-radius: 20px; box-shadow: 0 10px 30px rgba(0,0,0,0.5); }
                        h1 { color: #34d399; margin-bottom: 10px; }
                        p { color: #94a3b8; font-size: 1.1rem; }
                        .btn { display: inline-block; margin-top: 20px; padding: 12px 24px; background: #3b82f6; color: #fff; text-decoration: none; border-radius: 10px; font-weight: bold; }
                    </style>
                </head>
                <body>
                    <div class="card">
                        <h1>✅ Login no Google Concluído!</h1>
                        <p>Sua conta Google foi vinculada com sucesso ao sistema de agendamentos.</p>
                        <p>Você já pode fechar esta aba e voltar para o Dashboard.</p>
                        <a href="http://localhost:5173" class="btn">Voltar para o Dashboard</a>
                    </div>
                </body>
                </html>
                """
                self.send_response(200)
                self.send_header('Content-type', 'text/html; charset=utf-8')
                self.end_headers()
                self.wfile.write(html.encode('utf-8'))

                print(json.dumps({'status': 'SUCCESS', 'message': 'Token Google salvo com sucesso!'}))

            except Exception as e:
                self.send_response(500)
                self.send_header('Content-type', 'text/html; charset=utf-8')
                self.end_headers()
                err_html = f"<h2>Erro ao salvar token: {e}</h2>"
                self.wfile.write(err_html.encode('utf-8'))
        else:
            self.send_response(400)
            self.end_headers()
            self.wfile.write(b"Parametro 'code' nao fornecido.")

def run_server():
    server_address = ('', 8080)
    httpd = HTTPServer(server_address, OAuthHandler)
    print("OAuth Server escutando na porta 8080...")
    httpd.handle_request() # Handle 1 request then close

if __name__ == '__main__':
    run_server()
