import React, { useRef, useEffect } from 'react';
import { View, Text, ScrollView, StyleSheet } from 'react-native';

export const ITEM_H = 44;
const PICKER_VISIBLE = 5;
const PICKER_PAD = ITEM_H * 2;

const HOURS = Array.from({ length: 24 }, (_, i) => String(i).padStart(2, '0'));
const MINUTES = Array.from({ length: 12 }, (_, i) => String(i * 5).padStart(2, '0'));

function PickerCol({ items, value, onChange }: {
  items: string[]; value: number; onChange: (v: number) => void;
}) {
  const ref = useRef<ScrollView>(null);

  useEffect(() => {
    const id = setTimeout(() => {
      ref.current?.scrollTo({ y: value * ITEM_H, animated: false });
    }, 80);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <View style={{ height: ITEM_H * PICKER_VISIBLE, width: 72, overflow: 'hidden' }}>
      <ScrollView
        ref={ref}
        nestedScrollEnabled
        snapToInterval={ITEM_H}
        decelerationRate="fast"
        showsVerticalScrollIndicator={false}
        onMomentumScrollEnd={(e) => {
          const idx = Math.round(e.nativeEvent.contentOffset.y / ITEM_H);
          onChange(Math.max(0, Math.min(items.length - 1, idx)));
        }}
        onScrollEndDrag={(e) => {
          const idx = Math.round(e.nativeEvent.contentOffset.y / ITEM_H);
          onChange(Math.max(0, Math.min(items.length - 1, idx)));
        }}
        contentContainerStyle={{ paddingVertical: PICKER_PAD }}
      >
        {items.map((item, i) => (
          <View key={i} style={{ height: ITEM_H, justifyContent: 'center', alignItems: 'center' }}>
            <Text style={{
              fontSize: i === value ? 26 : 18,
              color: i === value ? '#1C3F7A' : '#C0C5D0',
              fontWeight: i === value ? '700' : '400',
            }}>
              {item}
            </Text>
          </View>
        ))}
      </ScrollView>
    </View>
  );
}

export function TimePicker({ hour, minute, onChange, label }: {
  hour: number;
  minute: number;
  onChange: (h: number, m: number) => void;
  label?: string;
}) {
  const minuteIdx = Math.round(minute / 5) % 12;
  return (
    <View>
      {label ? <Text style={tpStyles.label}>{label}</Text> : null}
      <View style={tpStyles.wrap}>
        <View pointerEvents="none" style={tpStyles.selBar} />
        <PickerCol
          items={HOURS}
          value={hour}
          onChange={(h) => onChange(h, minuteIdx * 5)}
        />
        <Text style={tpStyles.colon}>:</Text>
        <PickerCol
          items={MINUTES}
          value={minuteIdx}
          onChange={(idx) => onChange(hour, idx * 5)}
        />
      </View>
    </View>
  );
}

const tpStyles = StyleSheet.create({
  wrap: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    backgroundColor: '#F2F4F8', borderRadius: 12,
    height: ITEM_H * PICKER_VISIBLE, overflow: 'hidden', marginTop: 4,
  },
  selBar: {
    position: 'absolute',
    top: ITEM_H * 2, left: 0, right: 0,
    height: ITEM_H,
    backgroundColor: 'rgba(28,63,122,0.09)',
    borderTopWidth: 1, borderBottomWidth: 1,
    borderColor: 'rgba(28,63,122,0.14)',
  },
  colon: { fontSize: 26, fontWeight: '700', color: '#1C3F7A', paddingHorizontal: 6, marginBottom: 2 },
  label: { fontSize: 12, color: '#888', fontWeight: '600', textAlign: 'center', marginBottom: 2, marginTop: 8 },
});
