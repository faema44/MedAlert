import React from 'react';
import { View, Text, StyleSheet } from 'react-native';

export default function MedDisclaimer() {
  return (
    <View style={styles.wrap}>
      <Text style={styles.text}>
        ⚕️ As informações exibidas são apenas orientativas e não substituem avaliação médica ou farmacêutica.
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
