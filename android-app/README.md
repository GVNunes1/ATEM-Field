# ATEM Field para Android

Aplicativo Android instalável que abre o ATEM Field em uma Trusted Web Activity (TWA), usando o navegador compatível do aparelho. O site e o backend permanecem os mesmos: `https://atem-field.vercel.app/`. Não há WebView nem ponte JavaScript para funções nativas, banco ou credenciais incluídos no APK. O PDF do relatório de campo e o gerador de OS não foram alterados.

## Atualização 1.0.1 — correção da abertura

A versão 1.0.0 podia fechar imediatamente na abertura em Android API 25 ou superior. O Android Browser Helper 2.7.3 ativa/desativa `ManageDataLauncherActivity` durante a inicialização, mas essa Activity não estava declarada no manifesto do aplicativo. O Android rejeita a referência ao componente ausente.

A versão 1.0.1 (`versionCode 2`) declara essa Activity interna, a URL fixa de gerenciamento e `application.manageSpaceActivity`. Mantém a mesma chave, pacote, domínio, tema e arquitetura TWA. Instale sobre a versão anterior, sem desinstalá-la. O site, o backend, a Agenda e os PDFs não foram modificados.

Quatro testes de regressão verificam o manifesto mesclado: registro da Activity, acesso externo bloqueado, URL de gerenciamento, associação do aplicativo e caminho de desativação do atalho. Todos falharam antes da correção e passaram depois, no SDK 28. Esses testes não substituem a validação no aparelho: o PackageManager simulado pelo Robolectric não reproduz a exceção nativa de um componente ausente, por isso o registro também é verificado explicitamente.

- Arquivo: `output/android/ATEM-Field-1.0.1.apk`, relativo à raiz do projeto; 4.693.790 bytes (4.48 MiB).
- SHA-256: `1E63E486A42B6A4EFF6DDDCB08ED503D379A92F3C4148518631CEF6955FBF227`.
- Testes: 4 aprovados, zero falhas e zero testes ignorados. Build release e lint concluídos, zero erros e os mesmos quatro avisos não bloqueantes da versão inicial.
- Assinatura v1/v2 válida; certificado SHA-256 idêntico ao APK anterior e ao `assetlinks.json` publicado. Manifesto binário do APK confirma versão 1.0.1/code 2, componente registrado e `exported=false`.
- Abertura no aparelho ainda precisa ser confirmada pelo usuário. Nenhum dispositivo foi encontrado por `adb devices` nesta máquina.

Referências da correção: [inicialização da TWA](https://github.com/GoogleChrome/android-browser-helper/blob/android-browser-helper-2.7.3/androidbrowserhelper/src/main/java/com/google/androidbrowserhelper/trusted/LauncherActivity.java), [gerenciamento de dados](https://github.com/GoogleChrome/android-browser-helper/blob/android-browser-helper-2.7.3/androidbrowserhelper/src/main/java/com/google/androidbrowserhelper/trusted/ManageDataLauncherActivity.java) e [manifesto do exemplo oficial](https://github.com/GoogleChrome/android-browser-helper/blob/android-browser-helper-2.7.3/demos/twa-basic/src/main/AndroidManifest.xml).

## APK inicial 1.0.0 (substituído)

- Arquivo local: `output/android/ATEM-Field-1.0.0.apk` (4.48 MiB), relativo à raiz do projeto.
- SHA-256 do APK: `5AB6223164D116B5284CBB79533FAAD21C44DD29EB393036A3A9B6DE7CB75EE6`.
- Build release e lint concluídos: zero erros e quatro avisos não bloqueantes (label redundante, nova versão de Gradle disponível, ícone temático monocromático ausente e pasta de densidade do bitmap).
- Assinatura RSA 3072 verificada por `apksigner`, incluindo esquemas v1 e v2. O manifesto compilado confirma pacote, versão 1.0.0, Android mínimo 6.0 e destino API 35.
- `https://atem-field.vercel.app/.well-known/assetlinks.json` publicado como JSON, por HTTPS e sem redirecionamento. API oficial Google Digital Asset Links retornou `linked: true` para o certificado deste APK.
- O usuário instalou esta versão e relatou fechamento imediato na abertura. Use a atualização 1.0.1 acima; não redistribua a versão 1.0.0.

Para instalar, transfira o APK para o Android, abra-o e autorize a instalação desse arquivo pela aplicação usada para abri-lo, caso o Android solicite. Depois, abra ATEM Field e entre com seu usuário habitual. Não é uma publicação na Play Store. Use Chrome atualizado e conexão à internet.

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

Em Linux/macOS, execute o wrapper com `sh ./gradlew` (ou torne-o executável com `chmod +x gradlew`). O script automático e a proteção DPAPI abaixo são específicos do Windows.

Neste computador, as ferramentas portáteis estão em `.codex/tmp/android-tools`. Para compilar a versão assinada, use `powershell -File android-app/build-apk.ps1` na raiz. Na primeira compilação, acrescente `-InitializeSigning`; a chave já existente nunca será substituída. O script executa os testes de regressão, compila, executa o lint Android, valida a assinatura e entrega o APK em `output/android`. O processo é sequencial e limita os workers e a memória para este computador.

```powershell
.\gradlew.bat :app:testDebugUnitTest :app:lintDebug :app:assembleDebug
```

Para release, o processo de build deve fornecer **somente ao ambiente do processo**:

- `ATEM_ANDROID_KEYSTORE`: caminho do keystore privado permanente;
- `ATEM_ANDROID_STORE_PASSWORD`: senha do keystore;
- `ATEM_ANDROID_KEY_PASSWORD`: senha da chave com alias `atem-field`.

```powershell
.\gradlew.bat :app:testDebugUnitTest :app:lintRelease :app:assembleRelease
```

A saída padrão fica em `app/build/outputs/apk/release/app-release.apk`. Sem os dados de assinatura, o build release falha; não há fallback silencioso para assinatura debug. O `applicationId` é `br.com.multmed.atemfield`; a versão atual é 1.0.1 (`versionCode 2`). Para distribuir uma atualização, aumente `versionCode` e use a mesma chave.

## Skill de desenvolvimento Android

A skill [compose-expert](https://github.com/aldefy/compose-skill), versão 2.4.0, foi instalada no Codex. As instruções e o playbook de falhas foram consultados, e a verificação de aplicabilidade confirmou que este módulo usa Java + TWA, não Jetpack Compose. Foi seguida a orientação de manter a correção mínima e verificável; não foram adicionadas dependências Compose nem reescritas as telas web. Os padrões específicos de Compose deverão ser usados quando houver uma implementação de UI nativa Compose.

## Assinatura permanente e associação do site

Guarde o keystore e suas senhas em local privado com backup seguro. Não envie a chave ao Git, ao frontend, ao Supabase nem dentro do APK. A perda da chave pode impedir atualizar o aplicativo já instalado. Para distribuição pela Play Store, é necessário configurar assinatura de apps do Google Play e usar a impressão digital do certificado efetivo de distribuição; este projeto não constitui uma publicação na loja.

O script guarda a senha local protegida por DPAPI em `.signing/password.xml`, vinculada à **mesma conta Windows nesta máquina**. Copiar somente esse XML e o `.p12` para outro computador não permite recuperar a senha. Antes de trocar de máquina/conta, gere um backup portável com `powershell -File android-app/backup-signing.ps1 -Destination D:\backup-seguro\atem-field-release.p12`. O script pede uma senha escolhida por você e exporta a mesma chave sob essa senha; mantenha arquivo e senha em locais privados separados. Nunca publique esse backup.

Para a TWA esconder a barra de endereço, o site deve publicar, por HTTPS e sem redirecionamento, `/.well-known/assetlinks.json` com `namespace: android_app`, pacote `br.com.multmed.atemfield`, relação `delegate_permission/common.handle_all_urls` e impressão digital SHA-256 pública do certificado que assinou o APK. O certificado público não é segredo; o keystore e as senhas são.

O APK declara também a associação reversa ao domínio. Não intercepta links HTTP/HTTPS gerais e ignora URLs fornecidas por Intents externos ao abrir, usando sempre a URL configurada do ATEM Field. Não desative a verificação Digital Asset Links para contornar a associação.

## Verificação antes de distribuir

Confirme assinatura, instalação e associação do domínio no APK exato entregue. Em Android físico, teste login, agenda, reservar e devolver padrões/carros, upload de fotos, download de OS/PDF, botão Voltar e rotação. Validação de compilação/assinatura em computador não substitui teste no aparelho; não afirme aprovação em dispositivo físico sem executá-la.

Fontes oficiais: [Android Browser Helper](https://github.com/GoogleChrome/android-browser-helper/releases/tag/android-browser-helper-2.7.3), [compatibilidade do AGP 8.10](https://developer.android.com/build/releases/agp-8-10-0-release-notes), [guia TWA](https://developer.chrome.com/docs/android/trusted-web-activity/integration-guide).
