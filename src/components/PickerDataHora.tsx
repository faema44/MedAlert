import React, { useState } from 'react';
import { View, StyleSheet, Platform } from 'react-native';
import DateTimePicker from '@react-native-community/datetimepicker';
import { DATE_DISPLAY, TIME_DISPLAY } from '../utils/datePickerDisplay';

// As duas plataformas entregam o picker por caminhos incompatíveis, e tratá-las igual
// quebra o iPhone em silêncio:
//
// Android — diálogo flutuante. onChange dispara UMA vez, com 'set' (escolheu) ou
// 'dismissed' (cancelou), e o diálogo se fecha sozinho. Não ocupa espaço no formulário.
//
// iOS — não há diálogo: o picker é uma view inline que EMPURRA o formulário. No spinner,
// onChange dispara a CADA giro da roda, sempre com type 'set'.
//
// Por que existe rascunho no iOS: a roda é controlada por `value`. Se o valor do PAI
// mudasse a cada giro, o `value` mudaria embaixo do dedo e a roda saltaria de volta,
// brigando com quem está girando. O rascunho segura a roda; onMudar avisa o pai em
// paralelo. Ou seja, o rascunho existe pela roda, não para ter botão de confirmar.
//
// Sem botões de propósito: quem confirma é o Salvar do formulário, e quem descarta é o
// Cancelar dele. Um par de Cancelar/Confirmar aqui dentro só duplicava o par de fora e
// confundia. O valor aparece ao vivo no campo enquanto se gira.
//
// Renderize condicionalmente ({mostrar && <PickerDataHora .../>}): o rascunho do iOS
// nasce de `valor` na montagem. E nada de Modal aqui — estes pickers já vivem DENTRO de
// modais, e o iOS não empilha dois.

interface Props {
  valor: Date;
  modo?: 'time' | 'date';
  // Valor novo. No iOS dispara a cada giro; no Android, uma vez, ao escolher.
  onMudar: (d: Date) => void;
  // Só o Android chama: o diálogo saiu de cena (escolheu ou cancelou) e o pai precisa
  // baixar a flag. No iOS o picker é inline e quem fecha é o toque no campo de novo.
  onFechar: () => void;
  // Só iOS. Avisa em que altura o picker nasceu, para quem tem o ScrollView rolar até
  // ELE — e não até o fim do formulário: onde o picker fica no meio (data e horário da
  // consulta), rolar ao fim joga o picker para cima, fora da tela. Vem do onLayout, que
  // dispara quando o picker JÁ tem posição — não precisa adivinhar um atraso.
  aoAparecer?: (y: number) => void;
}

export default function PickerDataHora(props: Props) {
  return Platform.OS === 'ios' ? <PickerIOS {...props} /> : <PickerAndroid {...props} />;
}

function PickerAndroid({ valor, modo = 'time', onMudar, onFechar }: Props) {
  return (
    <DateTimePicker
      value={valor}
      mode={modo}
      is24Hour={true}
      display={modo === 'date' ? DATE_DISPLAY : TIME_DISPLAY}
      onChange={(e, d) => {
        if (e.type === 'set' && d) onMudar(d);
        onFechar(); // o diálogo já se fechou; a flag do pai tem de acompanhar
      }}
    />
  );
}

function PickerIOS({ valor, modo = 'time', onMudar, aoAparecer }: Props) {
  const [rascunho, setRascunho] = useState(valor);

  return (
    <View style={styles.caixa} onLayout={e => aoAparecer?.(e.nativeEvent.layout.y)}>
      <DateTimePicker
        value={rascunho}
        mode={modo}
        is24Hour={true}
        display={modo === 'date' ? DATE_DISPLAY : TIME_DISPLAY}
        onChange={(_, d) => { if (d) { setRascunho(d); onMudar(d); } }}
        style={styles.picker}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  caixa: {
    backgroundColor: '#fff',
    borderRadius: 12, borderWidth: 0.5, borderColor: 'rgba(0,0,0,0.06)',
    padding: 8, marginTop: 8,
  },
  picker: { alignSelf: 'stretch' },
});
