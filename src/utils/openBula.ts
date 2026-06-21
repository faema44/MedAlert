import { Alert, Linking } from 'react-native';

const ANVISA_BULARIO = 'https://consultas.anvisa.gov.br/#/bulario/';

export function openBula(url: string) {
  Alert.alert(
    'Aviso sobre a bula',
    'Bula apenas para referência rápida, sempre consulte a bula conforme o fabricante e a dosagem desejada.\n\nPara a bula exata às suas necessidades consulte o bulário da Anvisa.',
    [
      { text: 'Cancelar', style: 'cancel' },
      { text: 'Bulário Anvisa', onPress: () => Linking.openURL(ANVISA_BULARIO) },
      { text: 'Ver bula', onPress: () => Linking.openURL(url) },
    ],
  );
}
