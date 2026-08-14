import sys
import os
import glob
import subprocess

if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8')
if hasattr(sys.stderr, 'reconfigure'):
    sys.stderr.reconfigure(encoding='utf-8')

agenda_app_src = r"C:\Users\tecnico.mmAT31\Documents\Agenda Online\Aplicativo_Monitor_Agendas\Aplicativo_Monitor_Agendas\src"
sys.path.insert(0, agenda_app_src)

# Search and remove all token.pickle instances to force fresh Google OAuth Login
token_locations = [
    os.path.join(agenda_app_src, 'token.pickle'),
    os.path.join(os.getcwd(), 'token.pickle'),
    os.path.expanduser(r'~\token.pickle'),
    os.path.expanduser(r'~\Desktop\token.pickle'),
    os.path.expanduser(r'~\Documents\token.pickle')
]

for loc in token_locations:
    if os.path.exists(loc):
        try:
            os.remove(loc)
            print(f"[INFO] Token removido em: {loc}")
        except Exception as e:
            print(f"[AVISO] Erro ao remover token {loc}: {e}")

try:
    import sync_calendar
    from google_auth_oauthlib.flow import InstalledAppFlow

    caminho_credentials = sync_calendar.verificar_credentials()
    if not caminho_credentials or not os.path.exists(caminho_credentials):
        print("[ERRO] Arquivo credentials.json não encontrado.")
        sys.exit(1)

    print(f"[INFO] Iniciando fluxo de login Google com credentials: {caminho_credentials}")
    flow = InstalledAppFlow.from_client_secrets_file(caminho_credentials, sync_calendar.SCOPES)
    
    # Run local server and force open default browser via Start-Process or webbrowser
    creds = flow.run_local_server(port=0, open_browser=True)
    
    if creds:
        caminho_token = os.path.join(os.path.dirname(caminho_credentials), 'token.pickle')
        import pickle
        with open(caminho_token, 'wb') as token:
            pickle.dump(creds, token)
        print(f"[OK] Login realizado com SUCESSO! Novo token salvo em: {caminho_token}")
    else:
        print("[AVISO] Autenticação não retornou credenciais válidas.")

except Exception as e:
    print(f"[ERRO] Falha durante autenticação Google: {e}")
