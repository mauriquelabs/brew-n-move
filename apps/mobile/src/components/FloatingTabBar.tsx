import type { BottomTabBarProps } from '@react-navigation/bottom-tabs';
import { Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { colors, fonts, radii, spacing } from '../theme/tokens';
import { AppText } from './AppText';
import { TabIcon, type TabIconName } from './TabIcon';

export const FLOATING_TAB_BAR_HEIGHT = 64;

export function floatingTabBarClearance(bottomInset: number) {
  return FLOATING_TAB_BAR_HEIGHT + Math.max(bottomInset, spacing.sm) + spacing.md;
}

function iconForRoute(routeName: string): TabIconName {
  if (routeName === 'rewards') {
    return 'rewards';
  }

  if (routeName === 'discover') {
    return 'discover';
  }

  return 'home';
}

export function FloatingTabBar({ state, descriptors, navigation }: BottomTabBarProps) {
  const insets = useSafeAreaInsets();

  return (
    <View
      pointerEvents="box-none"
      style={[styles.wrap, { paddingBottom: Math.max(insets.bottom, spacing.sm) }]}
    >
      <View accessibilityRole="tablist" style={styles.capsule}>
        {state.routes.map((route, index) => {
          const { options } = descriptors[route.key];
          if ((options as { href?: string | null }).href === null) {
            return null;
          }

          const focused = state.index === index;
          const label =
            typeof options.tabBarLabel === 'string'
              ? options.tabBarLabel
              : typeof options.title === 'string'
                ? options.title
                : route.name;
          const color = focused ? colors.moss : colors.muted;
          const iconName = iconForRoute(route.name);

          const onPress = () => {
            const event = navigation.emit({
              canPreventDefault: true,
              target: route.key,
              type: 'tabPress',
            });

            if (!focused && !event.defaultPrevented) {
              navigation.navigate(route.name, route.params);
            }
          };

          const onLongPress = () => {
            navigation.emit({
              target: route.key,
              type: 'tabLongPress',
            });
          };

          return (
            <Pressable
              accessibilityLabel={options.tabBarAccessibilityLabel ?? label}
              accessibilityRole="tab"
              accessibilityState={{ selected: focused }}
              key={route.key}
              onLongPress={onLongPress}
              onPress={onPress}
              style={[styles.item, focused && styles.itemFocused]}
            >
              <TabIcon color={color} focused={focused} name={iconName} />
              <AppText
                role="caption"
                style={[
                  styles.label,
                  { color, fontFamily: focused ? fonts.bold : fonts.medium },
                ]}
              >
                {label}
              </AppText>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    backgroundColor: 'transparent',
    bottom: 0,
    left: 0,
    paddingHorizontal: spacing.lg,
    position: 'absolute',
    right: 0,
  },
  capsule: {
    alignItems: 'center',
    backgroundColor: colors.card,
    borderColor: colors.line,
    borderRadius: radii.pill,
    borderWidth: 1,
    elevation: 6,
    flexDirection: 'row',
    height: FLOATING_TAB_BAR_HEIGHT,
    justifyContent: 'space-between',
    paddingHorizontal: spacing.xs,
    shadowColor: colors.ink,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.08,
    shadowRadius: 12,
  },
  item: {
    alignItems: 'center',
    borderRadius: radii.pill,
    flex: 1,
    gap: 2,
    height: FLOATING_TAB_BAR_HEIGHT - 8,
    justifyContent: 'center',
    minWidth: 44,
    paddingHorizontal: spacing.xs,
  },
  itemFocused: {
    backgroundColor: colors.mossSoft,
  },
  label: {
    fontSize: 11,
    lineHeight: 13,
  },
});
