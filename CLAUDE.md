@AGENTS.md
## Plataformas
- iOS e Android vivem na MESMA base. Não separar — ver `docs/plataformas.md` antes de propor fork.
- Correção de plataforma nunca altera o ramo comum: guarda na fronteira do serviço
  (`medNotification.ts`) ou tela por sufixo (`LockScreenScreen.tsx`).
- Antes de release: rodar o smoke test do Android em `docs/plataformas.md`.

## Design
- Paleta principal: #1C3F7A (azul), #F2F4F8 (fundo), #E07B4F (ação/alerta)
- Fundo das telas: #F2F4F8 (não #f5f5f5)
- Cards: borderRadius 12, borderWidth 0.5, borderColor rgba(0,0,0,0.06)
- Badges de risco: caixa baixa (Crítico, Alto, Moderado — não CRÍTICO)
