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
        <Text style={styles.text} numberOfLines={collapsed ? 1 : undefined}>
          ⚕️ <Text style={styles.bold}>Atenção:</Text> Informações geradas por IA são apenas orientativas e podem conter erros. Confirme com a bula e sempre consulte seu médico ou farmacêutico.
        </Text>
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
  text: {
    flex: 1,
    fontSize: 12,
    color: '#3730A3',
    lineHeight: 17,
  },
  bold: { fontWeight: '700' },
  chevron: {
    fontSize: 10,
    color: '#818CF8',
    lineHeight: 17,
  },
});
