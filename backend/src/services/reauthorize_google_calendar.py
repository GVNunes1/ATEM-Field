import argparse
import json
import sys
from pathlib import Path

from google_auth_oauthlib.flow import InstalledAppFlow
from googleapiclient.discovery import build

from google_calendar_credentials import (
    SCOPES,
    clear_incremental_sync_state,
    credentials_path,
    save_credentials,
)


def main():
    parser = argparse.ArgumentParser(description="Renova o acesso do ATEM Field ao Google Agenda.")
    parser.add_argument("--output", required=True, help="Arquivo protegido que receberá a variável da Northflank.")
    args = parser.parse_args()

    credentials_file = credentials_path()
    if not credentials_file:
        raise RuntimeError("As credenciais OAuth não foram encontradas.")

    flow = InstalledAppFlow.from_client_secrets_file(str(credentials_file), SCOPES)
    credentials = flow.run_local_server(
        host="127.0.0.1",
        port=0,
        open_browser=True,
        access_type="offline",
        prompt="consent",
        include_granted_scopes="true",
        authorization_prompt_message="Abrindo a autorização do Google no navegador...",
        success_message="Google Agenda autorizado. Você pode fechar esta aba e voltar ao instalador.",
    )

    if not credentials or not credentials.refresh_token:
        raise RuntimeError("O Google não devolveu um refresh token. Revogue o acesso antigo e tente novamente.")

    # Valide o acesso antes de gerar o segredo que será enviado à produção.
    service = build("calendar", "v3", credentials=credentials, cache_discovery=False)
    service.calendarList().list(maxResults=1, showHidden=False).execute()
    save_credentials(credentials)
    clear_incremental_sync_state()

    output_path = Path(args.output).resolve()
    output_path.write_text(
        "GOOGLE_CALENDAR_TOKEN_JSON=" + credentials.to_json() + "\n",
        encoding="utf-8",
    )
    print(json.dumps({"success": True, "output": str(output_path)}, ensure_ascii=False))


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        print(json.dumps({"success": False, "error": str(error)}, ensure_ascii=False))
        raise SystemExit(1)
