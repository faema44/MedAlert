'use strict';
const {
  withDangerousMod, withAndroidManifest, withAppBuildGradle, withProjectBuildGradle,
} = require('@expo/config-plugins');
const fs = require('fs');
const path = require('path');

// O Kotlin do app mora em native/android/*.kt, versionado, e é COPIADO para android/ a cada
// prebuild.
//
// Antes ele vivia aqui dentro, como strings JS gigantes. Isso criava duas cópias da mesma
// verdade: a de android/ (que compila e é a que a gente edita e testa) e a daqui (que o prebuild
// impõe). Elas divergiam em silêncio — e como android/ é gitignored, era a cópia NÃO testada que
// sobrevivia no repositório. Um prebuild depois, o trabalho testado sumia sem aviso.
//
// Com os arquivos numa pasta só, editar e testar é o mesmo ato que versionar. Não há segunda
// cópia para envelhecer.
function withKotlinFiles(config) {
  return withDangerousMod(config, [
    'android',
    (cfg) => {
      const javaDir = path.join(
        cfg.modRequest.platformProjectRoot,
        'app/src/main/java/com/alertamedico/app'
      );
      const nativeDir = path.join(cfg.modRequest.projectRoot, 'native/android');

      for (const arquivo of fs.readdirSync(nativeDir)) {
        if (!arquivo.endsWith('.kt')) continue;
        fs.copyFileSync(path.join(nativeDir, arquivo), path.join(javaDir, arquivo));
      }

      // Os recursos do WIDGET (layouts, metadata, drawables) seguem a MESMA regra dos .kt:
      // vivem versionados em native/android/res e são copiados a cada prebuild. Deixá-los só
      // em android/res seria perdê-los no primeiro prebuild — android/ é gitignored.
      const resOrigem = path.join(nativeDir, 'res');
      if (fs.existsSync(resOrigem)) {
        const resDestino = path.join(cfg.modRequest.platformProjectRoot, 'app/src/main/res');
        for (const pasta of fs.readdirSync(resOrigem)) {
          const de = path.join(resOrigem, pasta);
          if (!fs.statSync(de).isDirectory()) continue;
          const para = path.join(resDestino, pasta);
          fs.mkdirSync(para, { recursive: true });
          for (const arquivo of fs.readdirSync(de)) {
            fs.copyFileSync(path.join(de, arquivo), path.join(para, arquivo));
          }
        }
      }

      const mainAppPath = path.join(javaDir, 'MainApplication.kt');
      let src = fs.readFileSync(mainAppPath, 'utf8');
      if (!src.includes('MedNotificationPackage')) {
        src = src.replace(
          'PackageList(this).packages.apply {',
          'PackageList(this).packages.apply {\n          add(MedNotificationPackage())'
        );
        fs.writeFileSync(mainAppPath, src);
      }

      return cfg;
    },
  ]);
}

function withBootReceiver(config) {
  return withAndroidManifest(config, (cfg) => {
    const manifest = cfg.modResults;

    if (!manifest.manifest['uses-permission']) manifest.manifest['uses-permission'] = [];
    const perms = manifest.manifest['uses-permission'];
    if (!perms.some(p => p.$?.['android:name'] === 'android.permission.RECEIVE_BOOT_COMPLETED')) {
      perms.push({ $: { 'android:name': 'android.permission.RECEIVE_BOOT_COMPLETED' } });
    }

    const application = manifest.manifest.application[0];
    if (!application.receiver) application.receiver = [];

    if (!application.receiver.some(r => r.$?.['android:name'] === '.BootReceiver')) {
      application.receiver.push({
        $: { 'android:name': '.BootReceiver', 'android:exported': 'true' },
        'intent-filter': [{
          action: [
            { $: { 'android:name': 'android.intent.action.BOOT_COMPLETED' } },
            { $: { 'android:name': 'android.intent.action.QUICKBOOT_POWERON' } },
          ],
        }],
      });
    }

    if (!application.receiver.some(r => r.$?.['android:name'] === '.NotifRefreshReceiver')) {
      application.receiver.push({
        $: { 'android:name': '.NotifRefreshReceiver', 'android:exported': 'false' },
      });
    }

    if (!application.receiver.some(r => r.$?.['android:name'] === '.NextMedReceiver')) {
      application.receiver.push({
        $: { 'android:name': '.NextMedReceiver', 'android:exported': 'false' },
      });
    }

    return cfg;
  });
}

function withCompatResizability(config) {
  return withAndroidManifest(config, (cfg) => {
    const manifest = cfg.modResults;
    const activities = manifest.manifest.application[0].activity || [];
    const mainActivity = activities.find(a => a.$?.['android:name'] === '.MainActivity');
    if (!mainActivity) return cfg;

    if (!mainActivity.property) mainActivity.property = [];
    if (!mainActivity.property.some(p => p.$?.['android:name'] === 'android.window.PROPERTY_COMPAT_ALLOW_RESTRICTED_RESIZABILITY')) {
      mainActivity.property.push({
        $: { 'android:name': 'android.window.PROPERTY_COMPAT_ALLOW_RESTRICTED_RESIZABILITY', 'android:value': 'true' },
      });
    }

    return cfg;
  });
}

// Injeta o signingConfig de release no build.gradle gerado.
//
// As credenciais NÃO ficam aqui. Este arquivo é versionado num repositório PÚBLICO — a
// senha da keystore chegou a ser commitada em texto puro neste bloco (rotacionada em
// 12/07/2026). Agora os valores vêm de propriedades do Gradle, que moram em
// ~/.gradle/gradle.properties, fora do repositório E fora da pasta do projeto:
//
//   MEDALERT_STORE_FILE, MEDALERT_STORE_PASSWORD, MEDALERT_KEY_ALIAS, MEDALERT_KEY_PASSWORD
//
// Sem essas propriedades, o build de release cai no debug signing em vez de quebrar — quem
// clonar o repo sem a chave ainda consegue compilar.
function withReleaseSigning(config) {
  return withAppBuildGradle(config, (cfg) => {
    let gradle = cfg.modResults.contents;
    if (gradle.includes('MEDALERT_STORE_FILE')) return cfg;

    gradle = gradle.replace(
      /signingConfigs \{\s*debug \{/,
      `signingConfigs {\n        release {\n            if (project.hasProperty('MEDALERT_STORE_FILE')) {\n                storeFile rootProject.file(MEDALERT_STORE_FILE)\n                storePassword MEDALERT_STORE_PASSWORD\n                keyAlias MEDALERT_KEY_ALIAS\n                keyPassword MEDALERT_KEY_PASSWORD\n            }\n        }\n        debug {`
    );
    gradle = gradle.replace(
      /\/\/ Caution.*\n.*signingConfig signingConfigs\.debug/,
      `// Assina com a chave de upload quando ela estiver configurada (ver acima).\n            signingConfig project.hasProperty('MEDALERT_STORE_FILE') ? signingConfigs.release : signingConfigs.debug`
    );

    cfg.modResults.contents = gradle;
    return cfg;
  });
}

// FCM: o plugin do google-services precisa do classpath no build.gradle RAIZ. Sem ele, o
// google-services.json é ignorado EM SILÊNCIO — o app compila, instala, e o push simplesmente
// nunca chega. Foi assim que o projeto ficou meses com push impossível sem ninguém notar.
function withGoogleServices(config) {
  return withProjectBuildGradle(config, (cfg) => {
    if (cfg.modResults.contents.includes('com.google.gms:google-services')) return cfg;
    cfg.modResults.contents = cfg.modResults.contents.replace(
      /classpath\('org\.jetbrains\.kotlin:kotlin-gradle-plugin'\)/,
      `classpath('org.jetbrains.kotlin:kotlin-gradle-plugin')\n    classpath('com.google.gms:google-services:4.4.2')`
    );
    return cfg;
  });
}

// E o plugin em si, no módulo do app. O google-services.json é copiado da RAIZ do repositório a
// cada build: android/ é regenerável, e manter uma segunda cópia lá dentro repetiria o drift que
// já custou caro com o versionCode — dois lugares com a mesma verdade, um deles envelhecendo
// calado. Se o arquivo não existir, o plugin QUEBRA o build, de propósito.
function withGoogleServicesApp(config) {
  return withAppBuildGradle(config, (cfg) => {
    if (cfg.modResults.contents.includes('com.google.gms.google-services')) return cfg;
    cfg.modResults.contents += `
copy {
    from "\${rootDir}/../google-services.json"
    into projectDir
}
apply plugin: 'com.google.gms.google-services'
`;
    return cfg;
  });
}

// Deep link do pareamento do cuidador: alertamedico://cuidador?n=&t=&k=
// O convite chega por WhatsApp e o idoso toca no link uma vez. Ver src/services/caregiver.ts.
function withPairingDeepLink(config) {
  return withAndroidManifest(config, (cfg) => {
    const activities = cfg.modResults.manifest.application[0].activity || [];
    const main = activities.find(a => a.$?.['android:name'] === '.MainActivity');
    if (!main) return cfg;

    if (!main['intent-filter']) main['intent-filter'] = [];
    const jaTem = main['intent-filter'].some(f =>
      f.data?.some(d => d.$?.['android:scheme'] === 'alertamedico')
    );
    if (!jaTem) {
      main['intent-filter'].push({
        action: [{ $: { 'android:name': 'android.intent.action.VIEW' } }],
        category: [
          { $: { 'android:name': 'android.intent.category.DEFAULT' } },
          { $: { 'android:name': 'android.intent.category.BROWSABLE' } },
        ],
        data: [{ $: { 'android:scheme': 'alertamedico' } }],
      });
    }
    return cfg;
  });
}


// O widget precisa estar declarado no manifesto, senão o Android nem o oferece na lista de
// widgets do launcher — e não há erro nenhum, ele simplesmente não existe para o sistema.
function withWidgetReceiver(config) {
  return withAndroidManifest(config, (cfg) => {
    const application = cfg.modResults.manifest.application[0];
    if (!application.receiver) application.receiver = [];
    const jaTem = application.receiver.some(
      r => r.$?.['android:name'] === '.MedWidgetProvider'
    );
    if (!jaTem) {
      application.receiver.push({
        $: {
          'android:name': '.MedWidgetProvider',
          // exported=true é OBRIGATÓRIO para widget: quem envia o APPWIDGET_UPDATE é o
          // launcher, que é outro app. Com false, o widget nunca atualiza.
          'android:exported': 'true',
        },
        'intent-filter': [{
          action: [{ $: { 'android:name': 'android.appwidget.action.APPWIDGET_UPDATE' } }],
        }],
        'meta-data': [{
          $: {
            'android:name': 'android.appwidget.provider',
            'android:resource': '@xml/med_widget_info',
          },
        }],
      });
    }
    return cfg;
  });
}

module.exports = function withMedNotification(config) {
  config = withKotlinFiles(config);
  config = withBootReceiver(config);
  config = withWidgetReceiver(config);
  config = withCompatResizability(config);
  config = withReleaseSigning(config);
  config = withGoogleServices(config);
  config = withGoogleServicesApp(config);
  config = withPairingDeepLink(config);
  return config;
};
