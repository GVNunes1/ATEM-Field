import sys
import os
import json

if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8')

agenda_app_src = r"C:\Users\tecnico.mmAT31\Documents\Agenda Online\Aplicativo_Monitor_Agendas\Aplicativo_Monitor_Agendas\src"
sys.path.insert(0, agenda_app_src)

try:
    import sync_calendar
    from google_auth_oauthlib.flow import InstalledAppFlow

    caminho_credentials = sync_calendar.verificar_credentials()
    if not caminho_credentials or not os.path.exists(caminho_credentials):
        print(json.dumps({'success': False, 'error': 'credentials.json não encontrado.'}))
        sys.exit(1)

    flow = InstalledAppFlow.from_client_secrets_file(
        caminho_credentials,
        scopes=sync_calendar.SCOPES,
        redirect_uri='http://localhost:8080/'
    )

    auth_url, _ = flow.authorization_url(
        access_type='offline',
        prompt='consent'
    )

    print(json.dumps({
        'success': True,
        'auth_url': auth_url,
        'credentials_path': caminho_credentials
    }))

except Exception as e:
    print(json.dumps({'success': False, 'error': str(e)}))
