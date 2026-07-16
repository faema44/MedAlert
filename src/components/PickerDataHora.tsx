import React, { useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Platform } from 'react-native';
import DateTimePicker from '@react-native-community/datetimepicker';
import { DATE_DISPLAY, TIME_DISPLAY } from '../utils/datePickerDisplay';

// As duas plataformas entregam o picker por caminhos incompatíveis, e tratá-las igual
// quebra o iPhone em silêncio:
//
// Android — diálogo nativo. onChange dispara UMA vez, com 'set' (escolheu) ou 'dismissed'
// (cancelou), e o diálogo se fecha sozinho. Fechar no onChange é o certo.
//
// iOS — não há diálogo: o picker é uma view inline na árvore. No spinner, onChange dispara
// a CADA giro da roda, sempre com type 'set'. Fechar no primeiro onChange fazia o picker
// sumir no primeiro movimento gravando o valor de passagem. Por isso o iOS mantém um
// rascunho local e só devolve o valor no Confirmar.
//
// Renderize condicionalmente ({mostrar && <PickerDataHora .../>}): o rascunho do iOS nasce
// de `valor` na montagem. E nada de Modal aqui — estes pickers já vivem DENTRO de modais,
// e o iOS não empilha dois.

interface Props {
  valor: Date;
  modo?: 'time' | 'date';
  onConfirmar: (d: Date) => void;
  onCancelar: () => void;
}

export default function PickerDataHora(props: Props) {
  return Platform.OS === 'ios' ? <PickerIOS {...props} /> : <PickerAndroid {...props} />;
}

function PickerAndroid({ valor, modo = 'time', onConfirmar, onCancelar }: Props) {
  return (
    <DateTimePicker
      value={valor}
      mode={modo}
      is24Hour={true}
      display={modo === 'date' ? DATE_DISPLAY : TIME_DISPLAY}
      onChange={(e, d) => {
        if (e.type === 'set' && d) onConfirmar(d);
        else onCancelar();
      }}
    />
  );
}

function PickerIOS({ valor, modo = 'time', onConfirmar, onCancelar }: Props) {
  const [rascunho, setRascunho] = useState(valor);

  return (
    <View style={styles.caixa}>
      <DateTimePicker
        value={rascunho}
        mode={modo}
        is24Hour={true}
        display={modo === 'date' ? DATE_DISPLAY : TIME_DISPLAY}
        onChange={(_, d) => { if (d) setRascunho(d); }}
        style={styles.picker}
      />
      <View style={styles.acoes}>
        <TouchableOpacity style={styles.btnSec} onPress={onCancelar} activeOpacity={0.7}>
          <Text style={styles.btnSecText}>Cancelar</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.btnPri} onPress={() => onConfirmar(rascunho)} activeOpacity={0.8}>
          <Text style={styles.btnPriText}>Confirmar</Text>
        </TouchableOpacity>
      </View>
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
  acoes: { flexDirection: 'row', gap: 8, marginTop: 4 },
  btnSec: {
    flex: 1, backgroundColor: '#fff',
    borderRadius: 12, paddingVertical: 13, alignItems: 'center',
    borderWidth: 0.5, borderColor: '#D0D5E8',
  },
  btnSecText: { color: '#6B7280', fontSize: 14, fontWeight: '600' },
  btnPri: {
    flex: 1, backgroundColor: '#1C3F7A',
    borderRadius: 12, paddingVertical: 13, alignItems: 'center',
  },
  btnPriText: { color: '#fff', fontSize: 14, fontWeight: '700' },
});
