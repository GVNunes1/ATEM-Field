# ATEM Field para Android

Aplicativo Android instalável que abre o ATEM Field em uma Trusted Web Activity (TWA), usando o navegador compatível do aparelho. O site e o backend permanecem os mesmos: `https://atem-field.vercel.app/`. Não há WebView nem ponte JavaScript para funções nativas, banco ou credenciais incluídos no APK. O PDF do relatório de campo e o gerador de OS não foram alterados.

## Uso e requisitos

- Android 6.0 ou superior (API 23).
- Internet necessária para acesso à agenda, workflow, frota, padrões e sincronizações. Este APK não acrescenta operação offline ou sincronização em segundo plano.
- Chrome ou outro navegador atualizado com suporte a TWA/Custom Tabs. A sessão pertence ao navegador: entre com o usuário habitual do ATEM Field. As permissões continuam sendo verificadas pelo sistema existente.
- Fotos, uploads, downloads de OS/PDF e permissões web são tratados pelo navegador. O APK não pede câmera, localização ou acesso amplo ao armazenamento por conta própria.
- Quando a associação de domínio não for validada ou o navegador não suportar TWA, o acesso usa Custom Tabs com barra do navegador visível. Não existe fallback para WebView.

## Compilação

Ferramentas fixadas: JDK 17, Gradle 8.11.1, Android Gradle Plugin 8.10.1, Android SDK Platform 36 e Build Tools 35.0.0. O aplicativo usa `compileSdk 36`, `targetSdk 35` e `minSdk 23`; compilar com API 36 não exige Android 16 no aparelho.

Dependência principal: `com.google.androidbrowserhelper:androidbrowserhelper:2.7.3`, versão estável do projeto oficial Google Chrome. A API 36 é necessária pelas dependências atuais dessa versão; não foram forçados downgrades de bibliotecas transitivas.

Defina `JAVA_HOME` e `ANDROID_HOME` para as instalações locais. Use o Gradle Wrapper deste diretório:

Neste computador, as ferramentas portáteis estão em `.codex/tmp/android-tools`. Para compilar a versão assinada, use `powershell -File android-app/build-apk.ps1` na raiz. Na primeira compilação, acrescente `-InitializeSigning`; a chave já existente nunca será substituída. O script compila, executa o lint Android, valida a assinatura e entrega o APK em `output/android`.

```powershell
.\gradlew.bat :app:lintDebug :app:assembleDebug
```

Para release, o processo de build deve fornecer **somente ao ambiente do processo**:

- `ATEM_ANDROID_KEYSTORE`: caminho do keystore privado permanente;
- `ATEM_ANDROID_STORE_PASSWORD`: senha do keystore;
- `ATEM_ANDROID_KEY_PASSWORD`: senha da chave com alias `atem-field`.

```powershell
.\gradlew.bat :app:lintRelease :app:assembleRelease
```

A saída padrão fica em `app/build/outputs/apk/release/app-release.apk`. Sem os dados de assinatura, o build release falha; não há fallback silencioso para assinatura debug. O `applicationId` é `br.com.multmed.atemfield`; a versão inicial é 1.0.0 (`versionCode 1`). Para distribuir uma atualização, aumente `versionCode` e use a mesma chave.

## Assinatura permanente e associação do site

Guarde o keystore e suas senhas em local privado com backup seguro. Não envie a chave ao Git, ao frontend, ao Supabase nem dentro do APK. A perda da chave pode impedir atualizar o aplicativo já instalado. Para distribuição pela Play Store, é necessário configurar assinatura de apps do Google Play e usar a impressão digital do certificado efetivo de distribuição; este projeto não constitui uma publicação na loja.

O script guarda a senha local protegida por DPAPI em `.signing/password.xml`, vinculada à **mesma conta Windows nesta máquina**. Copiar somente esse XML e o `.p12` para outro computador não permite recuperar a senha. Antes de trocar de máquina/conta, gere um backup portável com `powershell -File android-app/backup-signing.ps1 -Destination D:\backup-seguro\atem-field-release.p12`. O script pede uma senha escolhida por você e exporta a mesma chave sob essa senha; mantenha arquivo e senha em locais privados separados. Nunca publique esse backup.

Para a TWA esconder a barra de endereço, o site deve publicar, por HTTPS e sem redirecionamento, `/.well-known/assetlinks.json` com `namespace: android_app`, pacote `br.com.multmed.atemfield`, relação `delegate_permission/common.handle_all_urls` e impressão digital SHA-256 pública do certificado que assinou o APK. O certificado público não é segredo; o keystore e as senhas são.

O APK declara também a associação reversa ao domínio. Não intercepta links HTTP/HTTPS gerais e ignora URLs fornecidas por Intents externos ao abrir, usando sempre a URL configurada do ATEM Field. Não desative a verificação Digital Asset Links para contornar a associação.

## Verificação antes de distribuir

Confirme assinatura, instalação e associação do domínio no APK exato entregue. Em Android físico, teste login, agenda, reservar e devolver padrões/carros, upload de fotos, download de OS/PDF, botão Voltar e rotação. Validação de compilação/assinatura em computador não substitui teste no aparelho; não afirme aprovação em dispositivo físico sem executá-la.

Fontes oficiais: [Android Browser Helper](https://github.com/GoogleChrome/android-browser-helper/releases/tag/android-browser-helper-2.7.3), [compatibilidade do AGP 8.10](https://developer.android.com/build/releases/agp-8-10-0-release-notes), [guia TWA](https://developer.chrome.com/docs/android/trusted-web-activity/integration-guide).
