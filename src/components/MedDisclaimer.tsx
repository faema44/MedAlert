import React, { useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';

export default function MedDisclaimer() {
  const [collapsed, setCollapsed] = useState(false);

  function toggle() {
    setCollapsed(prev => !prev);
  }

  return (
    <TouchableOpacity style={styles.wrap} onPress={toggle} activeOpacity={0.7}>
      <View style={styles.row}>
        <View style={styles.textCol}>
          {/* Fica sempre visível, mesmo recolhido: é o aviso que impede o paciente de
              interromper um tratamento necessário por causa de um alerta incorreto. */}
          <Text style={styles.headline}>
            ⚕️ <Text style={styles.bold}>Não altere seu tratamento por conta própria.</Text>
          </Text>
          {!collapsed && (
            <Text style={styles.text}>
              O app é <Text style={styles.bold}>só um alerta</Text>, feito por IA e sujeito a erros.
              Sempre confirme com a <Text style={styles.bold}>bula</Text> e com seu{' '}
              <Text style={styles.bold}>médico ou farmacêutico</Text>.
            </Text>
          )}
        </View>
        <Text style={styles.chevron}>{collapsed ? '▼' : '▲'}</Text>
      </View>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  wrap: {
    marginHorizontal: 14,
    marginVertical: 8,
    backgroundColor: '#EEF2FF',
    borderRadius: 8,
    borderWidth: 0.5,
    borderColor: '#C7D2FE',
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
  },
  textCol: { flex: 1 },
  headline: {
    fontSize: 12.5,
    color: '#3730A3',
    lineHeight: 18,
  },
  text: {
    fontSize: 12,
    color: '#3730A3',
    lineHeight: 17,
    marginTop: 6,
  },
  bold: { fontWeight: '700' },
  chevron: {
    fontSize: 10,
    color: '#818CF8',
    lineHeight: 17,
  },
});
