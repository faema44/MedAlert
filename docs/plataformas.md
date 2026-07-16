# iOS e Android na mesma base

## Por que não separar

A tentação de forkar o app por plataforma aparece toda vez que uma correção de iOS
quase estraga o Android (foi o que quase aconteceu no commit `61fb760`, na retirada
da ficha de emergência).

Separar é o pior negócio possível aqui. `Platform.OS` aparece em 8 arquivos — essa é
a superfície **inteira** de divergência. Todo o resto (SQLite, dbSync, assinatura
Ed25519, base de bulas, motor de interações, cuidador, ciclo) não tem uma linha de
plataforma: é ~90% do app.

Forkar duplicaria esses 90% para proteger 10%. O efeito prático seria o inverso do
pretendido: um bug de dados corrigido no iPhone continuaria vivo no Android até
alguém lembrar de reaplicar à mão. O risco de "arrumar um e estragar o outro" deixa
de ser possível e passa a ser garantido — só que invisível, em vez de aparecer no diff.

No `61fb760` o código compartilhado não falhou; foi ele que salvou. O diff mostrava
as duas plataformas lado a lado e por isso deu pra ver o Android sendo levado junto.
Em bases separadas esse diff não existiria.

## A regra

**Correção de plataforma nunca altera o ramo comum.** Ela entra por um dos dois
padrões abaixo. Se a correção *exigir* mexer no ramo comum, isso é uma decisão
consciente que passa pelo smoke test do Android antes de virar release.

### Padrão 1 — guarda na fronteira do serviço

A plataforma para na primeira linha da função exportada e nunca vaza pra dentro.
`src/services/medNotification.ts` é a referência: toda função começa com

```ts
if (Platform.OS !== 'android') return;
```

Quem chama não sabe (nem precisa saber) em que plataforma está. Use isso quando o
recurso simplesmente **não existe** na outra plataforma.

### Padrão 2 — tela separada por sufixo

Quando a tela diverge de verdade, quebre em vez de encher de `if`.
`src/screens/LockScreenScreen.tsx` é a referência: delega pra `IOSMedicalIdScreen`.

O Metro também resolve sufixo de arquivo sozinho (`HomeScreen.ios.tsx` /
`HomeScreen.android.tsx`), com a lógica comum extraída num hook. Isso é fork **só da
camada visual** — onde a divergência é real.

**Gatilho:** quando uma tela passar de ~3 ramos de `IS_IOS`, quebre. Hoje
`HomeScreen.tsx` e `HelpScreen.tsx` estão perto disso.

### O que evitar

- `Platform.OS` espalhado no meio da lógica de negócio, longe da fronteira.
- `if (Platform.OS === 'ios')` que **muda** o comportamento comum em vez de desligar
  um trecho só do iOS. Se o Android depende do `else`, o próximo a editar não vai ver.

## Smoke test do Android (antes de qualquer release)

Rodar **depois** de fechar um lote de correções de iOS e **antes** de mexer em
versão/build. Não buildar a cada bug — junte o lote.

### 1. Gates automáticos

```bash
npm run test:interactions
npm run test:bulas
npm run test:bula-slug
npm run test:dbsync
npm run test:signature
```

### 2. APK novo no aparelho real

`dev.bat` **não** reconstrói nada. Só `build-apk.bat` gera APK com o JS e os dados
atualizados:

```bash
.\build-apk.bat
.\install-apk.bat
```

### 3. Os 4 caminhos que importam (Samsung físico, não emulador)

- [ ] **Ficha de emergência na tela de bloqueio** — aparece, e continua lá depois de
      trancar/destrancar. É o caminho com mais histórico de regressão (Doze, NPE do
      BootReceiver, handle morto do SQLite).
- [ ] **"Tomei"** — marca, e o registro **persiste** depois de fechar e reabrir o app.
      Falha silenciosa conhecida: gravação que morre sem erro visível.
- [ ] **dbSync** — abre e baixa a base sem erro de assinatura.
- [ ] **Abrir uma bula** — inclusive um sal multi-forma (seletor de apresentação).

Qualquer um falhando: **não publica o iOS**. A regressão veio do lote.
