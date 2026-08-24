import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors, typography } from '../theme/tokens';

/**
 * ONE reusable native header primitive (#10): back + centered title/subtitle
 * + optional right action. Every screen renders this instead of hand-rolled
 * header rows — kills the wrapped "‹ Bac k" label class (#9) by giving the
 * back button a fixed minimum width with single-line text and letting the
 * title block flex between two fixed-width side slots.
 */
export function ScreenHeader({
  title,
  subtitle,
  onBack,
  backLabel = 'Back',
  right,
  onPressTitle,
}: {
  title: string;
  subtitle?: string | null;
  /** Omit → no back control (root screens). */
  onBack?: () => void;
  backLabel?: string;
  right?: React.ReactNode;
  /** Pressable title block (e.g. open group details from chat). */
  onPressTitle?: () => void;
}) {
  const insets = useSafeAreaInsets();
  return (
    <View style={[styles.header, { paddingTop: insets.top + 6 }]}>
      {onBack ? (
        <Pressable
          onPress={onBack}
          hitSlop={8}
          style={styles.backSlot}
          accessibilityRole="button"
          accessibilityLabel={`Go back from ${title}`}
        >
          <Text style={styles.back} numberOfLines={1}>
            ‹ {backLabel}
          </Text>
        </Pressable>
      ) : (
        <View style={styles.sideSpacer} />
      )}
      <Pressable
        style={styles.center}
        disabled={!onPressTitle}
        onPress={onPressTitle}
      >
        <Text style={styles.title} numberOfLines={1}>
          {title}
        </Text>
        {!!subtitle && (
          <Text style={styles.subtitle} numberOfLines={1}>
            {subtitle}
          </Text>
        )}
      </Pressable>
      {right ? (
        <View style={styles.rightSlot}>{right}</View>
      ) : (
        <View style={styles.sideSpacer} />
      )}
    </View>
  );
}

const HEADER_SIDE = 72; // fits "‹ Back" and "＋ New" on one line at every width

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingBottom: 10,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    backgroundColor: colors.background,
  },
  backSlot: { minWidth: HEADER_SIDE, flexShrink: 0 },
  rightSlot: {
    minWidth: HEADER_SIDE,
    flexShrink: 0,
    alignItems: 'flex-end',
  },
  sideSpacer: { width: 44, flexShrink: 0 },
  center: { flex: 1, alignItems: 'center', paddingHorizontal: 4 },
  back: { color: colors.primary, fontSize: 16 },
  title: { color: colors.textPrimary, ...typography.title },
  subtitle: {
    color: colors.textSecondary,
    ...typography.subtitle,
    marginTop: 1,
  },
});
