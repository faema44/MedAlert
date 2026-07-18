import React, { useRef, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, Animated,
  useWindowDimensions, NativeSyntheticEvent, NativeScrollEvent, Linking,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

type Slide = {
  emoji: string;
  title: string;
  highlight: string;
  subtitle: string;
  bg: string;
};

const SLIDES: Slide[] = [
  {
    emoji: '💊⏰',
    title: 'Seu remédio,',
    highlight: 'na hora certa',
    subtitle: 'O Alerta Médico avisa e toca até você confirmar que tomou.',
    bg: '#EAF0FB',
  },
  {
    emoji: '🔒📱',
    title: 'O aviso aparece',
    highlight: 'até na tela travada',
    subtitle: 'Sem precisar destravar o celular. Um toque em "Tomei" e pronto.',
    bg: '#FBEFE9',
  },
  {
    emoji: '🚨❤️',
    title: 'Numa emergência,',
    highlight: 'tudo à mão',
    subtitle: 'Remédios, alergias e contatos prontos pra família ou socorrista ver.',
    bg: '#EAF0FB',
  },
  {
    emoji: '📋✅',
    title: 'Cada dose',
    highlight: 'vira histórico',
    subtitle: 'Leve pro médico e mostre certinho o que foi tomado (e o que não foi).',
    bg: '#FBEFE9',
  },
];

const PRIMARY = '#1C3F7A';
const ACCENT = '#E07B4F';

export default function OnboardingScreen({ onFinish }: { onFinish: () => void }) {
  const { width } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const scrollRef = useRef<ScrollView>(null);
  const [index, setIndex] = useState(0);
  const bounce = useRef(new Animated.Value(0)).current;

  const isLast = index === SLIDES.length - 1;

  function playBounce() {
    bounce.setValue(0);
    Animated.spring(bounce, { toValue: 1, useNativeDriver: true, friction: 4, tension: 60 }).start();
  }

  React.useEffect(() => { playBounce(); }, []);

  function onMomentumEnd(e: NativeSyntheticEvent<NativeScrollEvent>) {
    const i = Math.round(e.nativeEvent.contentOffset.x / width);
    if (i !== index) {
      setIndex(i);
      playBounce();
    }
  }

  function goTo(i: number) {
    scrollRef.current?.scrollTo({ x: i * width, animated: true });
    setIndex(i);
    playBounce();
  }

  const scale = bounce.interpolate({ inputRange: [0, 1], outputRange: [0.5, 1] });

  return (
    <View style={[styles.root, { paddingTop: insets.top, paddingBottom: insets.bottom + 16 }]}>
      {/* "Pular" leva ao ÚLTIMO slide, não ao fim: é lá que mora o aceite dos termos, e
          onFinish é o registro do aceite — não pode existir caminho que o contorne. */}
      {!isLast && (
        <TouchableOpacity style={styles.skip} onPress={() => goTo(SLIDES.length - 1)} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
          <Text style={styles.skipText}>Pular</Text>
        </TouchableOpacity>
      )}

      <ScrollView
        ref={scrollRef}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        onMomentumScrollEnd={onMomentumEnd}
        style={{ flex: 1 }}
      >
        {SLIDES.map((slide, i) => (
          <View key={i} style={[styles.slide, { width }]}>
            <View style={[styles.emojiCircle, { backgroundColor: slide.bg }]}>
              <Animated.Text style={[styles.emoji, { transform: [{ scale: i === index ? scale : 1 }] }]}>
                {slide.emoji}
              </Animated.Text>
            </View>
            <Text style={styles.title}>
              {slide.title}{'\n'}<Text style={styles.highlight}>{slide.highlight}</Text>
            </Text>
            <Text style={styles.subtitle}>{slide.subtitle}</Text>
          </View>
        ))}
      </ScrollView>

      <View style={styles.dots}>
        {SLIDES.map((_, i) => (
          <View key={i} style={[styles.dot, i === index && styles.dotActive]} />
        ))}
      </View>

      <View style={styles.footer}>
        {isLast ? (
          <>
            <Text style={styles.termos}>
              Ao continuar, você declara que leu e aceita os{' '}
              <Text
                style={styles.termosLink}
                onPress={() => Linking.openURL('https://www.alertamedico.ia.br/termos.html').catch(() => {})}
              >
                Termos de Uso
              </Text>
              {' '}e a{' '}
              <Text
                style={styles.termosLink}
                onPress={() => Linking.openURL('https://www.alertamedico.ia.br/privacy.html').catch(() => {})}
              >
                Política de Privacidade
              </Text>.
            </Text>
            <TouchableOpacity style={styles.ctaButton} onPress={onFinish} activeOpacity={0.85}>
              <Text style={styles.ctaText}>Li e aceito — vamos começar! 🎉</Text>
            </TouchableOpacity>
          </>
        ) : (
          <TouchableOpacity style={styles.nextButton} onPress={() => goTo(index + 1)} activeOpacity={0.85}>
            <Text style={styles.nextText}>Próximo</Text>
          </TouchableOpacity>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#F2F4F8' },
  skip: { position: 'absolute', top: 12, right: 20, zIndex: 10, padding: 8 },
  skipText: { color: '#9CA3AF', fontSize: 15, fontWeight: '600' },
  slide: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 32 },
  emojiCircle: {
    width: 180, height: 180, borderRadius: 90,
    alignItems: 'center', justifyContent: 'center', marginBottom: 36,
  },
  emoji: { fontSize: 64 },
  title: {
    fontSize: 26, fontWeight: '700', color: '#1F2937',
    textAlign: 'center', lineHeight: 34,
  },
  highlight: { color: PRIMARY, fontWeight: '800' },
  subtitle: {
    fontSize: 16, color: '#5B6472', textAlign: 'center',
    marginTop: 16, lineHeight: 23, paddingHorizontal: 8,
  },
  dots: { flexDirection: 'row', justifyContent: 'center', gap: 8, marginVertical: 20 },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: '#D7DCE5' },
  dotActive: { backgroundColor: PRIMARY, width: 22 },
  footer: { paddingHorizontal: 32 },
  nextButton: {
    backgroundColor: '#fff', borderRadius: 14, paddingVertical: 16, alignItems: 'center',
    borderWidth: 0.5, borderColor: 'rgba(0,0,0,0.06)',
  },
  nextText: { color: PRIMARY, fontSize: 16, fontWeight: '700' },
  termos: {
    fontSize: 12.5, color: '#5B6472', textAlign: 'center', lineHeight: 18, marginBottom: 12,
  },
  termosLink: { color: PRIMARY, fontWeight: '700', textDecorationLine: 'underline' },
  ctaButton: {
    backgroundColor: ACCENT, borderRadius: 14, paddingVertical: 16, alignItems: 'center',
  },
  ctaText: { color: '#fff', fontSize: 16, fontWeight: '700' },
});
