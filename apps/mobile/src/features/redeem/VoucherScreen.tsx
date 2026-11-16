import { Redirect, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AppText } from '../../components/AppText';
import { ScreenBackButton } from '../../components/ScreenBackButton';
import { colors, spacing } from '../../theme/tokens';
import { lookupVoucher } from './submitRedeem';

/**
 * Café till / geofence collection is paused. Legacy deep links redirect to the
 * offer detail screen, which reveals the discount code in place.
 */
export function VoucherScreen() {
  const params = useLocalSearchParams<{ id?: string }>();
  const redemptionId = Array.isArray(params.id) ? params.id[0] : params.id;
  const insets = useSafeAreaInsets();
  const [target, setTarget] = useState<{ offerId: string; redemptionId: string } | null | undefined>(
    undefined,
  );

  useEffect(() => {
    if (!redemptionId) {
      setTarget(null);
      return;
    }
    let cancelled = false;
    void lookupVoucher(redemptionId).then((voucher) => {
      if (cancelled) {
        return;
      }
      if (!voucher) {
        setTarget(null);
        return;
      }
      setTarget({ offerId: voucher.offerId, redemptionId: voucher.redemptionId });
    });
    return () => {
      cancelled = true;
    };
  }, [redemptionId]);

  if (target) {
    return (
      <Redirect
        href={{
          pathname: '/offer',
          params: {
            id: target.offerId,
            redemptionId: target.redemptionId,
          },
        }}
      />
    );
  }

  return (
    <View style={[styles.screen, { paddingTop: insets.top + spacing.sm }]}>
      <View style={styles.top}>
        <ScreenBackButton accessibilityLabel="Back" />
      </View>
      <AppText role="heading" style={styles.copy}>
        {target === null ? 'This reward could not be found.' : 'Loading reward'}
      </AppText>
      <AppText role="caption" style={styles.note}>
        Café collection is paused. Discount codes open on the offer screen.
      </AppText>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    backgroundColor: colors.field,
    flex: 1,
  },
  top: {
    paddingHorizontal: spacing.lg,
  },
  copy: {
    marginTop: spacing.xl,
    paddingHorizontal: spacing.lg,
  },
  note: {
    color: colors.muted,
    marginTop: spacing.sm,
    paddingHorizontal: spacing.lg,
  },
});
