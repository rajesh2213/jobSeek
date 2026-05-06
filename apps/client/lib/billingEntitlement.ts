type BillingSubscriptionLike = {
  status: string;
  currentPeriodEnd: string;
  graceEndsAt: string | null;
};

export function isBillingSubscriptionEntitled(subscription: BillingSubscriptionLike | null): boolean {
  if (!subscription) return false;
  const now = Date.now();
  if (subscription.status === "active") return true;
  if (subscription.status === "canceled") {
    const end = Date.parse(subscription.currentPeriodEnd);
    return Number.isFinite(end) && end > now;
  }
  if (subscription.status === "past_due" && subscription.graceEndsAt) {
    const graceEnd = Date.parse(subscription.graceEndsAt);
    return Number.isFinite(graceEnd) && graceEnd > now;
  }
  return false;
}
