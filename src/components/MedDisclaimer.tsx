import React from 'react';
import { View, Text, StyleSheet } from 'react-native';

export default function MedDisclaimer() {
  return (
    <View style={styles.wrap}>
      <Text style={styles.text}>
        ⚕️ Informações geradas por IA são apenas orientativas e podem conter erros. Confirme com a bula e sempre consulte seu médico ou farmacêutico.
      </Text>
    </View>
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
  text: {
    fontSize: 12,
    color: '#3730A3',
    lineHeight: 17,
  },
});
