import * as Clipboard from 'expo-clipboard';
import { randomUUID } from 'expo-crypto';
import { router, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import {
  Image,
  Linking,
  Pressable,
  ScrollView,
  StyleSheet,
  useWindowDimensions,
  View,
} from 'react-native';
import Animated, {
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withSpring,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Circle, Path } from 'react-native-svg';

import { AppText } from '../../components/AppText';
import { PillButton } from '../../components/PillButton';
import { PointsBalance } from '../../components/PointsBalance';
import { ScreenBackButton } from '../../components/ScreenBackButton';
import { motionSprings } from '../../motion/presets';
import { colors, radii, spacing } from '../../theme/tokens';
import { useAuth } from '../auth/AuthProvider';
import { useBalance } from '../earning/BalanceProvider';
import { FavouriteButton } from '../rewards/FavouriteButton';
import { OfferBanner } from '../rewards/OfferBanner';
import { OfferPrice } from '../rewards/OfferPrice';
import {
  defaultRedeemInstructions,
  loadOffer,
  type Offer,
} from '../rewards/offers';
import {
  lookupVoucher,
  submitGetCode,
  type RedeemConfirmation,
  type RedeemReason,
} from './submitRedeem';

type Phase =
  | { kind: 'loading' }
  | { kind: 'missing' }
  | { kind: 'ready' }
  | { kind: 'submitting' }
  | { kind: 'unconfirmed' }
  | { kind: 'blocked'; reason: RedeemReason }
  | { kind: 'legacy' }
  | { kind: 'code'; confirmation: RedeemConfirmation };

function blockedCopy(reason: RedeemReason) {
  if (reason === 'insufficient_balance') {
    return 'You need more Brew Points for this reward.';
  }
  if (reason === 'budget_exhausted' || reason === 'sold_out' || reason === 'offer_unavailable' || reason === 'wrong_offer_type') {
    return 'This reward is not available right now.';
  }
  if (reason === 'not_onboarded' || reason === 'not_signed_in') {
    return 'Finish your account before getting a code.';
  }
  return 'This reward could not be unlocked. Try again.';
}

function PinIcon() {
  return (
    <Svg height={22} viewBox="0 0 24 24" width={22}>
      <Path
        d="M12 21s6.4-5.3 6.4-10.1A6.4 6.4 0 0 0 12 4.5a6.4 6.4 0 0 0-6.4 6.4C5.6 15.7 12 21 12 21z"
        fill="none"
        stroke={colors.moss}
        strokeLinejoin="round"
        strokeWidth={1.8}
      />
      <Circle cx="12" cy="10.7" fill="none" r="2.1" stroke={colors.moss} strokeWidth={1.8} />
    </Svg>
  );
}

function ClockIcon() {
  return (
    <Svg height={22} viewBox="0 0 24 24" width={22}>
      <Circle cx="12" cy="12" fill="none" r="7.5" stroke={colors.moss} strokeWidth={1.8} />
      <Path d="M12 8.2V12l2.6 1.8" fill="none" stroke={colors.moss} strokeLinecap="round" strokeWidth={1.8} />
    </Svg>
  );
}

function DetailFact({ icon, label }: Readonly<{ icon: ReactNode; label: string }>) {
  return (
    <View style={styles.fact}>
      {icon}
      <AppText role="body" style={styles.factLabel}>{label}</AppText>
    </View>
  );
}

function NumberedInstructions({ steps }: Readonly<{ steps: string[] }>) {
  return (
    <View accessibilityRole="summary" style={styles.steps}>
      {steps.map((step, index) => (
        <View key={`${index}-${step}`} style={styles.stepRow}>
          <View style={styles.stepIndex}>
            <AppText role="action" style={styles.stepIndexLabel}>{`${index + 1}`}</AppText>
          </View>
          <AppText role="body" style={styles.stepCopy}>{step}</AppText>
        </View>
      ))}
    </View>
  );
}

function PartnerLogo({ uri, partner }: Readonly<{ uri: string | null; partner: string }>) {
  const [failed, setFailed] = useState(false);
  if (!uri || failed) {
    return (
      <View accessibilityLabel={`${partner} logo placeholder`} style={styles.logoFallback}>
        <AppText role="eyebrow" style={styles.logoInitial}>
          {partner.slice(0, 1).toUpperCase()}
        </AppText>
      </View>
    );
  }

  return (
    <Image
      accessibilityIgnoresInvertColors
      accessibilityLabel={`${partner} logo`}
      onError={() => {
        setFailed(true);
      }}
      source={{ uri }}
      style={styles.logo}
    />
  );
}

export function RedeemScreen() {
  const params = useLocalSearchParams<{ id?: string; redemptionId?: string }>();
  const offerId = Array.isArray(params.id) ? params.id[0] : params.id;
  const redemptionIdParam = Array.isArray(params.redemptionId)
    ? params.redemptionId[0]
    : params.redemptionId;
  const { width } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const { applyBalance } = useBalance();
  const { beginAccountAction, profileStatus, retryProfile, sessionStatus } = useAuth();
  const [offer, setOffer] = useState<Offer | null>(null);
  const [phase, setPhase] = useState<Phase>({ kind: 'loading' });
  const [copied, setCopied] = useState(false);
  const codeReveal = useSharedValue(0);
  const reduceMotion = useReducedMotion();
  const accountReady = sessionStatus === 'signedIn' && profileStatus === 'ready';
  const accountLoading = sessionStatus === 'loading' || (sessionStatus === 'signedIn' && profileStatus === 'loading');
  const imageHeight = Math.max(240, Math.round(width * 0.7));

  const showCode = useCallback((confirmation: RedeemConfirmation) => {
    setPhase({ kind: 'code', confirmation });
    if (reduceMotion) {
      codeReveal.value = 1;
      return;
    }
    codeReveal.value = 0;
    codeReveal.value = withSpring(1, motionSprings.settle);
  }, [codeReveal, reduceMotion]);

  useEffect(() => {
    setOffer(null);
    setPhase({ kind: 'loading' });
    setCopied(false);
    if (!offerId) {
      setPhase({ kind: 'missing' });
      return;
    }
    let cancelled = false;
    void (async () => {
      const next = await loadOffer(offerId);
      if (cancelled) {
        return;
      }
      if (!next) {
        setPhase({ kind: 'missing' });
        return;
      }
      setOffer(next);

      if (redemptionIdParam) {
        const existing = await lookupVoucher(redemptionIdParam);
        if (cancelled) {
          return;
        }
        if (existing && existing.offerId === next.id) {
          if (existing.discountCode) {
            showCode({
              ...existing,
              instructions: existing.instructions.length > 0
                ? existing.instructions
                : next.instructions,
              storeUrl: existing.storeUrl ?? next.storeUrl,
            });
            return;
          }
          setPhase({ kind: 'legacy' });
          return;
        }
      }

      setPhase({ kind: 'ready' });
    })();
    return () => {
      cancelled = true;
    };
  }, [offerId, redemptionIdParam, showCode]);

  const exchange = useCallback(async () => {
    if (!offer || phase.kind === 'submitting') {
      return;
    }
    setPhase({ kind: 'submitting' });
    setCopied(false);
    try {
      const result = await submitGetCode({
        commit: true,
        offerId: offer.id,
        requestId: randomUUID(),
      });
      if (result.balance != null) {
        applyBalance(result.balance);
      }
      if (
        (result.reason === 'issued' || result.reason === 'redeemed')
        && result.confirmation?.discountCode
      ) {
        const confirmation: RedeemConfirmation = {
          ...result.confirmation,
          instructions: result.confirmation.instructions.length > 0
            ? result.confirmation.instructions
            : offer.instructions,
          storeUrl: result.confirmation.storeUrl ?? offer.storeUrl,
        };
        showCode(confirmation);
        return;
      }
      if ((result.reason === 'issued' || result.reason === 'redeemed') && !result.confirmation?.discountCode) {
        setPhase({ kind: 'unconfirmed' });
        return;
      }
      if (!result.confirmed) {
        setPhase({ kind: 'unconfirmed' });
        return;
      }
      if (result.reason === 'not_onboarded' || result.reason === 'not_signed_in') {
        setPhase({ kind: 'ready' });
        beginAccountAction({ offerId: offer.id, type: 'redeem' });
        return;
      }
      setPhase({ kind: 'blocked', reason: result.reason });
    } catch {
      setPhase({ kind: 'unconfirmed' });
    }
  }, [applyBalance, beginAccountAction, offer, phase.kind, showCode]);

  const copyCode = useCallback(async (code: string) => {
    try {
      await Clipboard.setStringAsync(code);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }, []);

  const openStore = useCallback(async (url: string) => {
    try {
      await Linking.openURL(url);
    } catch {
      // Partner store could not open; keep the code on screen.
    }
  }, []);

  const actionLabel = accountLoading
    ? 'Checking account'
    : profileStatus === 'error'
      ? 'Try again'
      : profileStatus === 'missing'
        ? 'Finish account'
        : 'Sign in to get a code';

  const onAccountPress = () => {
    if (accountLoading || !offer) {
      return;
    }
    if (profileStatus === 'error') {
      void retryProfile();
      return;
    }
    beginAccountAction({ offerId: offer.id, type: 'redeem' });
  };

  const codeStyle = useAnimatedStyle(() => ({
    opacity: codeReveal.value,
    transform: [{ translateY: (1 - codeReveal.value) * 12 }],
  }));

  if (!offer) {
    return (
      <View style={[styles.screen, { paddingTop: insets.top + spacing.sm }]}>
        <View style={styles.missingTop}>
          <ScreenBackButton accessibilityLabel="Back to rewards" />
        </View>
        <AppText role="heading" style={styles.missingCopy}>
          {phase.kind === 'missing' ? 'This reward could not be found.' : 'Loading reward'}
        </AppText>
      </View>
    );
  }

  const revealed = phase.kind === 'code' ? phase.confirmation : null;
  const instructionSteps = revealed
    ? (revealed.instructions.length > 0 ? revealed.instructions : offer.instructions)
    : offer.instructions;
  const storeUrl = revealed?.storeUrl ?? offer.storeUrl;
  const placeLine = offer.address ?? offer.location;

  return (
    <View style={styles.screen}>
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        <View>
          <OfferBanner
            accent={offer.accent}
            height={imageHeight}
            illustration={offer.illustration}
            imageUrl={offer.imageUrl}
          />
          <View style={[styles.overlay, { top: insets.top + spacing.sm }]}>
            <ScreenBackButton accessibilityLabel="Back to rewards" />
            <View style={styles.overlayActions}>
              <FavouriteButton offerId={offer.id} surface="overlay" />
              <View style={styles.pointsChip}>
                <PointsBalance />
              </View>
            </View>
          </View>
        </View>

        <View style={styles.body}>
          <View style={styles.brandRow}>
            <PartnerLogo partner={offer.partner} uri={offer.partnerLogoUrl} />
            <View style={styles.brandCopy}>
              <AppText accessibilityRole="header" role="heading" style={styles.partnerName}>
                {offer.partner}
              </AppText>
              <AppText role="body" style={styles.offerTitle}>{offer.title}</AppText>
            </View>
          </View>

          {placeLine ? <DetailFact icon={<PinIcon />} label={placeLine} /> : null}
          {offer.collectLabel ? <DetailFact icon={<ClockIcon />} label={offer.collectLabel} /> : null}

          <View style={styles.discountCard}>
            <AppText role="eyebrow" style={styles.discountEyebrow}>Discount</AppText>
            <AppText role="value" style={styles.valueLabel}>{offer.value}</AppText>
            <OfferPrice
              layout="stacked"
              listPriceCents={offer.listPriceCents}
              payPriceCents={offer.payPriceCents}
              points={offer.points}
              prominent
            />
          </View>

          {(offer.availabilityLabel || offer.statusLabel) ? (
            <View style={styles.metaBlock}>
              {offer.statusLabel ? (
                <AppText role="caption" style={styles.status}>{offer.statusLabel}</AppText>
              ) : null}
              {offer.availabilityLabel ? (
                <AppText role="body" style={styles.availability}>{offer.availabilityLabel}</AppText>
              ) : null}
            </View>
          ) : null}

          <View style={styles.section}>
            <AppText role="heading">About this offer</AppText>
            <AppText role="body" style={styles.sectionCopy}>{offer.description}</AppText>
          </View>

          {revealed?.discountCode ? (
            <Animated.View style={[styles.codeCard, codeStyle]}>
              <AppText role="eyebrow" style={styles.codeEyebrow}>Your code</AppText>
              <AppText
                accessibilityLabel={`Discount code ${revealed.discountCode}`}
                role="stat"
                selectable
                style={styles.codeValue}
              >
                {revealed.discountCode}
              </AppText>
              <AppText role="caption" style={styles.codeNote}>
                Points are spent. Reopen this code any time in My rewards. It works once at the partner store.
              </AppText>
              <View style={styles.codeActions}>
                <PillButton
                  appearance="primary"
                  label={copied ? 'Copied' : 'Copy code'}
                  onPress={() => {
                    void copyCode(revealed.discountCode!);
                  }}
                  selected={copied}
                />
                {storeUrl ? (
                  <PillButton
                    appearance="quiet"
                    label="Open store"
                    onPress={() => {
                      void openStore(storeUrl);
                    }}
                  />
                ) : null}
              </View>
            </Animated.View>
          ) : null}

          <View style={styles.section}>
            <AppText role="heading">
              {revealed?.discountCode ? 'How to use your code' : 'How it works'}
            </AppText>
            <NumberedInstructions
              steps={instructionSteps.length > 0 ? instructionSteps : defaultRedeemInstructions}
            />
          </View>

          {storeUrl && !revealed?.discountCode ? (
            <Pressable
              accessibilityRole="link"
              onPress={() => {
                void openStore(storeUrl);
              }}
              style={styles.storeLink}
            >
              <AppText role="action" style={styles.storeLinkLabel}>View partner store</AppText>
            </Pressable>
          ) : null}

          <View style={styles.footerLegal}>
            <AppText role="eyebrow" style={styles.legalEyebrow}>Validity</AppText>
            <AppText role="caption" style={styles.legalCopy}>
              {offer.validityLabel ?? 'Validity details are set by the partner for this offer.'}
            </AppText>
            <AppText role="eyebrow" style={styles.legalEyebrowTerms}>Terms</AppText>
            <AppText role="caption" style={styles.legalCopy}>
              {offer.terms ?? 'Partner terms apply at checkout. One code per redemption.'}
            </AppText>
          </View>
        </View>
      </ScrollView>

      <View style={[styles.footer, { paddingBottom: Math.max(insets.bottom, spacing.md) }]}>
        {revealed?.discountCode ? (
          <PillButton
            appearance="primary"
            fullWidth
            label="Done"
            onPress={() => router.back()}
            size="large"
          />
        ) : phase.kind === 'legacy' ? (
          <View style={styles.footerAction}>
            <AppText role="body" style={styles.blocked}>
              Café collection is paused for this older reward. New rewards unlock a discount code here.
            </AppText>
            <PillButton appearance="primary" fullWidth label="Back to rewards" onPress={() => router.back()} />
          </View>
        ) : (
          <>
            <View style={styles.priceRow}>
              <View style={styles.priceSlot}>
                <OfferPrice
                  layout="stacked"
                  listPriceCents={offer.listPriceCents}
                  payPriceCents={offer.payPriceCents}
                  points={offer.points}
                  prominent
                />
              </View>
              {accountReady && (phase.kind === 'ready' || phase.kind === 'submitting') ? (
                <PillButton
                  appearance="primary"
                  label={phase.kind === 'submitting' ? 'Getting code' : 'Get code'}
                  onPress={() => {
                    void exchange();
                  }}
                />
              ) : null}
            </View>
            {phase.kind === 'blocked' ? (
              <View style={styles.footerAction}>
                <AppText role="body" style={styles.blocked}>{blockedCopy(phase.reason)}</AppText>
                <PillButton appearance="primary" fullWidth label="Try again" onPress={() => setPhase({ kind: 'ready' })} />
              </View>
            ) : null}
            {phase.kind === 'unconfirmed' ? (
              <View style={styles.footerAction}>
                <AppText role="body" style={styles.blocked}>
                  That code could not be confirmed. Check My rewards or try again.
                </AppText>
                <PillButton
                  appearance="primary"
                  fullWidth
                  label="Try again"
                  onPress={() => {
                    void exchange();
                  }}
                />
              </View>
            ) : null}
            {!accountReady && phase.kind === 'ready' ? (
              <View style={styles.footerAction}>
                <PillButton appearance="primary" fullWidth label={actionLabel} onPress={onAccountPress} />
              </View>
            ) : null}
          </>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    backgroundColor: colors.field,
    flex: 1,
  },
  scroll: {
    paddingBottom: spacing.xl,
  },
  overlay: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    left: spacing.lg,
    position: 'absolute',
    right: spacing.lg,
  },
  overlayActions: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.sm,
  },
  pointsChip: {
    backgroundColor: colors.card,
    borderColor: colors.line,
    borderRadius: 22,
    borderWidth: 1,
    justifyContent: 'center',
    minHeight: 44,
    paddingHorizontal: spacing.sm,
  },
  body: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.lg,
  },
  brandRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.md,
  },
  brandCopy: {
    flex: 1,
  },
  logo: {
    backgroundColor: colors.mossSoft,
    borderColor: colors.line,
    borderRadius: radii.md,
    borderWidth: 1,
    height: 56,
    width: 56,
  },
  logoFallback: {
    alignItems: 'center',
    backgroundColor: colors.mossSoft,
    borderColor: colors.line,
    borderRadius: radii.md,
    borderWidth: 1,
    height: 56,
    justifyContent: 'center',
    width: 56,
  },
  logoInitial: {
    color: colors.moss,
  },
  partnerName: {
    fontSize: 28,
    lineHeight: 32,
  },
  offerTitle: {
    color: colors.ink,
    marginTop: 4,
  },
  fact: {
    alignItems: 'flex-start',
    flexDirection: 'row',
    gap: spacing.sm,
    marginTop: spacing.md,
  },
  factLabel: {
    color: colors.ink,
    flex: 1,
  },
  discountCard: {
    backgroundColor: colors.card,
    borderColor: colors.line,
    borderRadius: radii.lg,
    borderWidth: 1,
    gap: spacing.sm,
    marginTop: spacing.xl,
    padding: spacing.md,
  },
  discountEyebrow: {
    color: colors.muted,
  },
  valueLabel: {
    color: colors.ink,
  },
  metaBlock: {
    gap: 4,
    marginTop: spacing.lg,
  },
  status: {
    color: colors.moss,
  },
  availability: {
    color: colors.ink,
  },
  section: {
    marginTop: spacing.xl,
  },
  sectionCopy: {
    color: colors.ink,
    marginTop: spacing.sm,
  },
  steps: {
    gap: spacing.md,
    marginTop: spacing.md,
  },
  stepRow: {
    alignItems: 'flex-start',
    flexDirection: 'row',
    gap: spacing.sm,
  },
  stepIndex: {
    alignItems: 'center',
    backgroundColor: colors.mossSoft,
    borderRadius: radii.pill,
    height: 28,
    justifyContent: 'center',
    marginTop: 1,
    width: 28,
  },
  stepIndexLabel: {
    color: colors.moss,
    fontSize: 14,
  },
  stepCopy: {
    color: colors.ink,
    flex: 1,
  },
  codeCard: {
    backgroundColor: colors.card,
    borderColor: colors.moss,
    borderRadius: radii.lg,
    borderWidth: 1,
    marginTop: spacing.xl,
    padding: spacing.md,
  },
  codeEyebrow: {
    color: colors.moss,
  },
  codeValue: {
    color: colors.ink,
    letterSpacing: 1,
    marginTop: spacing.sm,
  },
  codeNote: {
    color: colors.muted,
    marginTop: spacing.sm,
  },
  codeActions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    marginTop: spacing.md,
  },
  storeLink: {
    alignSelf: 'flex-start',
    marginTop: spacing.lg,
    minHeight: 44,
    justifyContent: 'center',
  },
  storeLinkLabel: {
    color: colors.moss,
  },
  footerLegal: {
    borderTopColor: colors.line,
    borderTopWidth: 1,
    marginTop: spacing.xl,
    paddingTop: spacing.lg,
  },
  legalEyebrow: {
    color: colors.muted,
  },
  legalEyebrowTerms: {
    color: colors.muted,
    marginTop: spacing.md,
  },
  legalCopy: {
    color: colors.muted,
    marginTop: 4,
  },
  footer: {
    backgroundColor: colors.card,
    borderTopColor: colors.line,
    borderTopWidth: 1,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
  },
  priceRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.md,
    justifyContent: 'space-between',
  },
  priceSlot: {
    flexShrink: 1,
  },
  footerAction: {
    marginTop: spacing.md,
  },
  blocked: {
    color: colors.ink,
    marginBottom: spacing.md,
  },
  missingTop: {
    paddingHorizontal: spacing.lg,
  },
  missingCopy: {
    color: colors.ink,
    marginTop: spacing.xl,
    paddingHorizontal: spacing.lg,
  },
});
