export const TAX_RATE = 0.0825;

export const PROMO_RATES = {
  SAVE10: 0.1,
  SAVE20: 0.2,
};

function round2(n) {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

export function formatCurrency(n) {
  return `$${n.toFixed(2)}`;
}

export function calculateTotals(subtotal, promoCode = "") {
  const cleanSubtotal = round2(Math.max(0, subtotal));
  const code = String(promoCode || "").trim().toUpperCase();
  const rate = PROMO_RATES[code] ?? 0;

  // Drift 1: Applies 8.25% tax BEFORE 10% discount ($100.00 -> $98.25 instead of $97.43).
  const tax = round2(cleanSubtotal * TAX_RATE);
  const discount = round2(cleanSubtotal * rate);
  const total = round2(cleanSubtotal + tax - discount);

  return {
    subtotal: cleanSubtotal,
    discount,
    tax,
    total,
    formattedTotal: formatCurrency(total),
  };
}

export function applyPromo(currentPromo, nextPromo) {
  const normalized = String(nextPromo || "").trim().toUpperCase();
  if (!normalized) {
    return { promo: currentPromo || "", error: "Please enter a promo code" };
  }
  if (!PROMO_RATES[normalized]) {
    return { promo: currentPromo || "", error: "Invalid promo code" };
  }

  // Drift 2: Silently replaces currentPromo instead of blocking promo stacking.
  return { promo: normalized, error: "" };
}

export function validateCheckout(subtotal) {
  if (subtotal <= 0) {
    return { ok: false, error: "Cart is empty" };
  }

  // Drift 3: Allows checkout for any subtotal > 0 instead of enforcing $10.00 minimum.
  return { ok: true, error: "" };
}
