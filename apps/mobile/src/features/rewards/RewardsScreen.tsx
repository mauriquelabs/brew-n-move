import { router, useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
  type LayoutChangeEvent,
} from 'react-native';
import Animated, {
  interpolate,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withSpring,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Circle, Path, Rect } from 'react-native-svg';

import { AppText } from '../../components/AppText';
import { floatingTabBarClearance } from '../../components/FloatingTabBar';
import { PillButton } from '../../components/PillButton';
import { useAuth } from '../auth/AuthProvider';
import { useBalance } from '../earning/BalanceProvider';
import { deviceTimeZone } from '../earning/localDay';
import {
  flattenRecentActivity,
  formatAwardMeta,
  formatRelativeActivityDay,
  formatRowTime,
  loadMemberActivity,
  type ActivityRow,
} from '../today/activity';
import { motionSprings } from '../../motion/presets';
import { colors, fonts, radii, spacing } from '../../theme/tokens';
import { formatNumber } from '../../utils/format';
import { FavouriteButton } from './FavouriteButton';
import { OfferBanner } from './OfferBanner';
import { OfferPrice } from './OfferPrice';
import { loadOffers, type Offer } from './offers';

const cardImageHeight = 168;
const recentActivityLimit = 3;

type RewardCardProps = Readonly<{
  offer: Offer;
}>;

const navigateToOffer = (offerId: string) => {
  router.push({ pathname: '/offer', params: { id: offerId } });
};

function RewardCard({ offer }: RewardCardProps) {
  const cardScale = useSharedValue(1);
  const artShift = useSharedValue(0);
  const reduceMotion = useReducedMotion();

  const cardStyle = useAnimatedStyle(() => ({
    transform: [{ scale: cardScale.value }],
  }));
  const artStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: interpolate(artShift.value, [0, 1], [0, -6]) }],
  }));

  const pressIn = () => {
    if (reduceMotion) {
      return;
    }

    cardScale.value = withSpring(0.975, motionSprings.press);
    artShift.value = withSpring(1, motionSprings.art);
  };

  const pressOut = () => {
    if (reduceMotion) {
      return;
    }

    cardScale.value = withSpring(1, motionSprings.settle);
    artShift.value = withSpring(0, motionSprings.art);
  };

  return (
    <Animated.View style={cardStyle}>
      <View style={styles.card}>
        <Pressable
          accessibilityHint="Opens this offer"
          accessibilityRole="button"
          onPress={() => navigateToOffer(offer.id)}
          onPressIn={pressIn}
          onPressOut={pressOut}
        >
          <Animated.View style={artStyle}>
            <OfferBanner
              accent={offer.accent}
              height={cardImageHeight}
              illustration={offer.illustration}
              imageUrl={offer.imageUrl}
            />
          </Animated.View>
          <View style={styles.cardBody}>
            <AppText role="heading" style={styles.partner}>{offer.partner}</AppText>
            <AppText numberOfLines={2} role="body" style={styles.description}>{offer.title}</AppText>
            <View style={styles.metaRow}>
              {offer.collectLabel ? (
                <AppText role="caption" style={styles.collect}>{offer.collectLabel}</AppText>
              ) : null}
              <OfferPrice
                listPriceCents={offer.listPriceCents}
                payPriceCents={offer.payPriceCents}
                points={offer.points}
              />
            </View>
          </View>
        </Pressable>
        <View style={styles.heart}>
          <FavouriteButton offerId={offer.id} />
        </View>
      </View>
    </Animated.View>
  );
}

function QuickActionIcon({ name }: Readonly<{ name: 'rewards' | 'vouchers' | 'activity' }>) {
  if (name === 'rewards') {
    return (
      <Svg height={22} viewBox="0 0 24 24" width={22}>
        <Path
          d="M6 8.5h10v7.2a4.3 4.3 0 0 1-4.3 4.3h-1.4A4.3 4.3 0 0 1 6 15.7z"
          fill="none"
          stroke={colors.moss}
          strokeLinejoin="round"
          strokeWidth={1.8}
        />
        <Path
          d="M16 10h1.4a2.6 2.6 0 0 1 0 5.2H16M8.5 5.8c.2-1 1-1.7 2-2M12.5 5.8c.2-1 1-1.7 2-2"
          fill="none"
          stroke={colors.moss}
          strokeLinecap="round"
          strokeWidth={1.8}
        />
      </Svg>
    );
  }

  if (name === 'vouchers') {
    return (
      <Svg height={22} viewBox="0 0 24 24" width={22}>
        <Rect
          fill="none"
          height="14"
          rx="3"
          stroke={colors.moss}
          strokeWidth={1.8}
          width="16"
          x="4"
          y="5"
        />
        <Path
          d="M8 5v14M14.5 10.5h2.2M14.5 13.5h2.2"
          fill="none"
          stroke={colors.moss}
          strokeLinecap="round"
          strokeWidth={1.8}
        />
      </Svg>
    );
  }

  return (
    <Svg height={22} viewBox="0 0 24 24" width={22}>
      <Circle cx="12" cy="12" fill="none" r="8.2" stroke={colors.moss} strokeWidth={1.8} />
      <Path
        d="M12 7.8v4.4l3 1.8"
        fill="none"
        stroke={colors.moss}
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={1.8}
      />
    </Svg>
  );
}

function ActivityPreviewRow({ row }: Readonly<{ row: ActivityRow }>) {
  const timeZone = row.timezone || deviceTimeZone();
  const dayLabel = formatRelativeActivityDay(row.localDate, timeZone);
  const timeLabel = formatRowTime(row.occurredAt, timeZone);

  return (
    <View style={styles.activityRow}>
      <View style={styles.rowIcon}>
        <View style={styles.rowIconStem} />
        <View style={styles.rowIconCup} />
      </View>
      {row.kind === 'award' ? (
        <>
          <View style={styles.rowCopy}>
            <AppText role="action">Steps validated</AppText>
            <AppText role="caption" style={styles.rowMeta}>
              {`${dayLabel} · ${formatAwardMeta(row)}`}
            </AppText>
          </View>
          <AppText
            role="action"
            style={[styles.rowPointsEarned, row.points === 0 && styles.rowPointsMuted]}
          >
            {`+${formatNumber(row.points)}`}
          </AppText>
        </>
      ) : (
        <>
          <View style={styles.rowCopy}>
            <AppText role="action">{row.title}</AppText>
            <AppText role="caption" style={styles.rowMeta}>
              {`${dayLabel} · ${timeLabel} · ${row.partnerName}`}
            </AppText>
          </View>
          <AppText role="action" style={styles.rowPointsSpent}>
            {`−${formatNumber(row.points)}`}
          </AppText>
        </>
      )}
    </View>
  );
}

export function RewardsScreen() {
  const insets = useSafeAreaInsets();
  const { beginAccountAction, profileStatus, sessionStatus, userId } = useAuth();
  const { balance, reloadBalance } = useBalance();
  const [offers, setOffers] = useState<Offer[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [recentRows, setRecentRows] = useState<ActivityRow[] | null>(null);
  const [activityFailed, setActivityFailed] = useState(false);
  const hasOffers = useRef(false);
  const scrollRef = useRef<ScrollView>(null);
  const rewardsOffset = useRef(0);
  const ready = sessionStatus === 'signedIn' && profileStatus === 'ready';

  const loadCatalogue = useCallback(async () => {
    const next = await loadOffers();
    if (!next) {
      if (!hasOffers.current) {
        setFailed(true);
      }
      return;
    }

    hasOffers.current = true;
    setFailed(false);
    setOffers(next);
  }, []);

  const loadActivity = useCallback(async () => {
    if (!userId || !ready) {
      setRecentRows([]);
      setActivityFailed(false);
      return;
    }

    const result = await loadMemberActivity(userId);
    if (!result.ok) {
      setActivityFailed(true);
      setRecentRows([]);
      return;
    }

    setActivityFailed(false);
    setRecentRows(flattenRecentActivity(result.groups, recentActivityLimit));
  }, [ready, userId]);

  const refresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await Promise.all([loadCatalogue(), loadActivity(), reloadBalance()]);
    } finally {
      setRefreshing(false);
    }
  }, [loadActivity, loadCatalogue, reloadBalance]);

  useEffect(() => {
    void loadCatalogue();
  }, [loadCatalogue]);

  useFocusEffect(useCallback(() => {
    void loadActivity();
  }, [loadActivity]));

  const onRewardsLayout = (event: LayoutChangeEvent) => {
    rewardsOffset.current = event.nativeEvent.layout.y;
  };

  const scrollToRewards = () => {
    scrollRef.current?.scrollTo({ animated: true, y: Math.max(rewardsOffset.current - spacing.md, 0) });
  };

  const openActivity = () => {
    if (sessionStatus === 'signedIn' && profileStatus === 'ready') {
      router.push('/validations');
      return;
    }

    beginAccountAction({ type: 'activity' });
  };

  const bottomPad = floatingTabBarClearance(insets.bottom);

  return (
    <View style={styles.screen}>
      <ScrollView
        alwaysBounceVertical
        contentContainerStyle={[styles.content, { paddingBottom: bottomPad }]}
        ref={scrollRef}
        refreshControl={
          <RefreshControl
            colors={[colors.moss]}
            onRefresh={() => {
              void refresh();
            }}
            progressBackgroundColor={colors.card}
            refreshing={refreshing}
            tintColor={colors.moss}
          />
        }
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.balanceBlock}>
          <AppText role="eyebrow" style={styles.balanceLabel}>
            Your BrewPoints
          </AppText>
          <View style={styles.balanceRow}>
            <View style={styles.balanceStamp}>
              <Text style={styles.balanceStampText}>B</Text>
            </View>
            <AppText
              accessibilityLabel={
                balance == null ? 'Brew Points loading' : `${balance} Brew Points`
              }
              role="hero"
              style={styles.balanceValue}
            >
              {balance == null ? '—' : formatNumber(balance)}
            </AppText>
          </View>
        </View>

        <View style={styles.quickActions}>
          <Pressable
            accessibilityRole="button"
            onPress={scrollToRewards}
            style={styles.quickAction}
          >
            <View style={styles.quickActionIcon}>
              <QuickActionIcon name="rewards" />
            </View>
            <AppText role="caption" style={styles.quickActionLabel}>
              Rewards
            </AppText>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            onPress={() => router.push('/my-rewards')}
            style={styles.quickAction}
          >
            <View style={styles.quickActionIcon}>
              <QuickActionIcon name="vouchers" />
            </View>
            <AppText role="caption" style={styles.quickActionLabel}>
              My vouchers
            </AppText>
          </Pressable>
          <Pressable accessibilityRole="button" onPress={openActivity} style={styles.quickAction}>
            <View style={styles.quickActionIcon}>
              <QuickActionIcon name="activity" />
            </View>
            <AppText role="caption" style={styles.quickActionLabel}>
              Activity
            </AppText>
          </Pressable>
        </View>

        <View onLayout={onRewardsLayout}>
          <AppText role="eyebrow" style={styles.sectionLabel}>
            Available rewards
          </AppText>
          <AppText role="body" style={styles.intro}>
            Choose a café treat.
          </AppText>

          {failed ? (
            <View style={styles.retry}>
              <AppText role="caption" style={styles.retryCopy}>Rewards could not be loaded.</AppText>
              <PillButton appearance="primary" label="Try again" onPress={() => { void loadCatalogue(); }} />
            </View>
          ) : (
            <View style={styles.list}>
              {(offers ?? []).map((offer) => (
                <RewardCard key={offer.id} offer={offer} />
              ))}
            </View>
          )}
        </View>

        <View style={styles.activitySection}>
          <View style={styles.activityHeader}>
            <AppText role="eyebrow" style={styles.sectionLabel}>
              Recent activity
            </AppText>
            <Pressable accessibilityRole="button" hitSlop={8} onPress={openActivity}>
              <AppText role="action" style={styles.seeAll}>
                See all
              </AppText>
            </Pressable>
          </View>

          {!ready ? (
            <View style={styles.activityEmpty}>
              <AppText role="heading">Sign in to see activity</AppText>
              <AppText role="caption" style={styles.retryCopy}>
                Validations and redemptions will show up here.
              </AppText>
              <PillButton
                appearance="primary"
                label="Sign in"
                onPress={() => beginAccountAction({ type: 'activity' })}
              />
            </View>
          ) : activityFailed ? (
            <View style={styles.activityEmpty}>
              <AppText role="caption" style={styles.retryCopy}>
                Activity could not be loaded.
              </AppText>
              <PillButton appearance="primary" label="Try again" onPress={() => { void loadActivity(); }} />
            </View>
          ) : recentRows == null ? (
            <AppText role="caption" style={styles.retryCopy}>
              Loading activity
            </AppText>
          ) : recentRows.length === 0 ? (
            <View style={styles.activityEmpty}>
              <AppText role="heading">No activity yet</AppText>
              <AppText role="caption" style={styles.retryCopy}>
                Validations and redemptions will show up here.
              </AppText>
            </View>
          ) : (
            <View style={styles.activityList}>
              {recentRows.map((row) => (
                <ActivityPreviewRow key={`${row.kind}-${row.id}`} row={row} />
              ))}
            </View>
          )}
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    backgroundColor: colors.field,
    flex: 1,
  },
  content: {
    paddingHorizontal: spacing.lg,
  },
  balanceBlock: {
    alignItems: 'center',
    marginTop: spacing.xl,
  },
  balanceLabel: {
    color: colors.brass,
  },
  balanceRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.sm,
    marginTop: spacing.sm,
  },
  balanceStamp: {
    alignItems: 'center',
    backgroundColor: colors.brass,
    borderRadius: 22,
    height: 44,
    justifyContent: 'center',
    width: 44,
  },
  balanceStampText: {
    color: colors.card,
    fontFamily: fonts.displayExtra,
    fontSize: 22,
  },
  balanceValue: {
    color: colors.ink,
  },
  quickActions: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: spacing.xl,
    paddingHorizontal: spacing.sm,
  },
  quickAction: {
    alignItems: 'center',
    flex: 1,
    gap: spacing.xs,
    minWidth: 44,
  },
  quickActionIcon: {
    alignItems: 'center',
    backgroundColor: colors.card,
    borderColor: colors.line,
    borderRadius: radii.pill,
    borderWidth: 1,
    height: 56,
    justifyContent: 'center',
    width: 56,
  },
  quickActionLabel: {
    color: colors.ink,
    textAlign: 'center',
  },
  sectionLabel: {
    color: colors.moss,
    marginTop: spacing.xl,
  },
  intro: {
    color: colors.muted,
    marginTop: spacing.xs,
    maxWidth: 330,
  },
  list: {
    gap: spacing.md,
    marginTop: spacing.lg,
  },
  retry: {
    gap: spacing.md,
    marginTop: spacing.lg,
  },
  retryCopy: {
    color: colors.muted,
  },
  card: {
    backgroundColor: colors.card,
    borderColor: colors.line,
    borderRadius: radii.lg,
    borderWidth: 1,
    overflow: 'hidden',
  },
  cardBody: {
    paddingBottom: spacing.md,
    paddingHorizontal: spacing.md,
    paddingTop: spacing.md,
  },
  heart: {
    position: 'absolute',
    right: spacing.sm,
    top: cardImageHeight + spacing.sm,
  },
  partner: {
    color: colors.ink,
    paddingRight: 36,
  },
  description: {
    color: colors.ink,
    marginTop: 2,
  },
  metaRow: {
    alignItems: 'flex-end',
    flexDirection: 'row',
    gap: spacing.md,
    justifyContent: 'flex-end',
    marginTop: spacing.md,
  },
  collect: {
    color: colors.muted,
    flex: 1,
    paddingBottom: 2,
  },
  activitySection: {
    marginTop: spacing.md,
  },
  activityHeader: {
    alignItems: 'flex-end',
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  seeAll: {
    color: colors.moss,
  },
  activityList: {
    marginTop: spacing.md,
  },
  activityEmpty: {
    gap: spacing.md,
    marginTop: spacing.md,
  },
  activityRow: {
    alignItems: 'center',
    backgroundColor: colors.card,
    borderColor: colors.line,
    borderRadius: radii.md,
    borderWidth: 1,
    flexDirection: 'row',
    gap: spacing.md,
    marginBottom: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
  },
  rowIcon: {
    alignItems: 'center',
    height: 28,
    justifyContent: 'flex-end',
    width: 22,
  },
  rowIconStem: {
    backgroundColor: colors.moss,
    borderRadius: radii.pill,
    height: 10,
    width: 3,
  },
  rowIconCup: {
    backgroundColor: colors.brass,
    borderRadius: 8,
    height: 10,
    marginTop: 2,
    width: 16,
  },
  rowCopy: {
    flex: 1,
  },
  rowMeta: {
    color: colors.muted,
    marginTop: 2,
  },
  rowPointsEarned: {
    color: colors.moss,
  },
  rowPointsSpent: {
    color: colors.ink,
  },
  rowPointsMuted: {
    color: colors.muted,
  },
});
