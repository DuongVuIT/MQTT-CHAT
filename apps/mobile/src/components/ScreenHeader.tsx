import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { colors, radius, TOUCH_TARGET, typography } from "@app/theme/tokens";

/**
 * ONE reusable native header primitive (§10): back + avatar + centered
 * title/subtitle + optional right action. Every screen renders this instead
 * of hand-rolled header rows. Fixed-width side slots keep the title truly
 * centered and single-line at every width; controls are 44pt targets.
 */
export function ScreenHeader({
  title,
  subtitle,
  avatar,
  avatarColor,
  avatarTextColor,
  onBack,
  backLabel = "Back",
  right,
  onPressTitle,
}: {
  title: string;
  subtitle?: string | null;
  /** Initials for the conversation avatar (omitted → no avatar). */
  avatar?: string;
  avatarColor?: string;
  avatarTextColor?: string;
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
        accessibilityRole={onPressTitle ? "button" : undefined}
        accessibilityLabel={onPressTitle ? `Open details for ${title}` : undefined}
      >
        {!!avatar && (
          <View style={[styles.avatar, { backgroundColor: avatarColor ?? colors.surfaceHigh }]}>
            <Text
              style={[styles.avatarText, avatarTextColor ? { color: avatarTextColor } : undefined]}
            >
              {avatar.slice(0, 2).toUpperCase()}
            </Text>
          </View>
        )}
        <View style={styles.titleBlock}>
          <Text style={styles.title} numberOfLines={1}>
            {title}
          </Text>
          {!!subtitle && (
            <Text style={styles.subtitle} numberOfLines={1}>
              {subtitle}
            </Text>
          )}
        </View>
      </Pressable>
      {right ? <View style={styles.rightSlot}>{right}</View> : <View style={styles.sideSpacer} />}
    </View>
  );
}

const HEADER_SIDE = 76; // fits "‹ Back" and "＋ New" on one line at every width

const styles = StyleSheet.create({
  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 8,
    paddingBottom: 8,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    backgroundColor: colors.background,
  },
  backSlot: {
    minWidth: HEADER_SIDE,
    flexShrink: 0,
    height: TOUCH_TARGET,
    justifyContent: "center",
  },
  rightSlot: {
    minWidth: HEADER_SIDE,
    flexShrink: 0,
    alignItems: "flex-end",
  },
  sideSpacer: { width: HEADER_SIDE, flexShrink: 0 },
  center: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
    paddingHorizontal: 4,
    minHeight: TOUCH_TARGET,
  },
  avatar: {
    width: 36,
    height: 36,
    borderRadius: radius.full,
    alignItems: "center",
    justifyContent: "center",
  },
  avatarText: { color: colors.textPrimary, fontSize: 13, fontWeight: "700" },
  titleBlock: { flexShrink: 1, alignItems: "center" },
  back: { color: colors.primaryStrong, fontSize: 16, fontWeight: "500" },
  title: { color: colors.textPrimary, ...typography.title },
  subtitle: {
    color: colors.textSecondary,
    fontSize: 12,
    fontWeight: "400",
    marginTop: 1,
  },
});
