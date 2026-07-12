const CURRENCY_ALIASES: Record<string, string> = {
  "singapore dollar": "SGD",
  "singapore dollars": "SGD",
  sgd: "SGD",
  "s$": "SGD",
  "sg$": "SGD",
  "us dollar": "USD",
  "us dollars": "USD",
  usd: "USD",
  "us$": "USD",
  dollar: "USD",
  dollars: "USD",
  kyat: "MMK",
  kyats: "MMK",
  "ကျပ်": "MMK",
  mmk: "MMK",
  ringgit: "MYR",
  myr: "MYR",
  rm: "MYR",
  baht: "THB",
  thb: "THB",
  euro: "EUR",
  euros: "EUR",
  eur: "EUR",
  pound: "GBP",
  pounds: "GBP",
  gbp: "GBP",
  yen: "JPY",
  jpy: "JPY",
  yuan: "CNY",
  renminbi: "CNY",
  rmb: "CNY",
  cny: "CNY",
  rupee: "INR",
  rupees: "INR",
  inr: "INR",
  peso: "PHP",
  pesos: "PHP",
  php: "PHP",
  rupiah: "IDR",
  idr: "IDR",
  won: "KRW",
  krw: "KRW",
  aud: "AUD",
  cad: "CAD",
  nzd: "NZD",
  hkd: "HKD",
  twd: "TWD",
  vnd: "VND",
  aed: "AED",
  sar: "SAR",
  chf: "CHF"
};

export const COMMON_CURRENCIES = [...new Set(Object.values(CURRENCY_ALIASES))].sort();

export function normalizeCurrency(value: string): string | undefined {
  const normalized = value.trim().toLowerCase().replace(/[.,]$/g, "").replace(/\s+/g, " ");
  const alias = CURRENCY_ALIASES[normalized];
  if (alias) return alias;

  const isoCode = normalized.toUpperCase();
  if (!/^[A-Z]{3}$/.test(isoCode)) return undefined;
  const supportedValuesOf = (Intl as typeof Intl & {
    supportedValuesOf?: (key: "currency") => string[];
  }).supportedValuesOf;
  return supportedValuesOf?.("currency").includes(isoCode) ? isoCode : undefined;
}

export function detectCurrency(text: string, fallbackCurrency = "SGD"): string {
  const fallback = normalizeCurrency(fallbackCurrency) ?? "SGD";
  const explicitPatterns: Array<[RegExp, string]> = [
    [/\bsgd\b|s\$|sg\$|\bsingapore dollars?\b/i, "SGD"],
    [/\busd\b|us\$|\bus dollars?\b/i, "USD"],
    [/\b(?:mmk|kyats?|ks\.?)\b|ကျပ်/i, "MMK"],
    [/\b(?:myr|rm|ringgit)\b/i, "MYR"],
    [/\b(?:thb|baht)\b|฿/i, "THB"],
    [/\b(?:eur|euros?)\b|€/i, "EUR"],
    [/\b(?:gbp|pounds?)\b|£/i, "GBP"],
    [/\b(?:cny|rmb|renminbi|yuan)\b|元|cn¥/i, "CNY"],
    [/\b(?:jpy|yen)\b|(?<!cn)¥/i, "JPY"],
    [/\b(?:inr|rupees?)\b|₹/i, "INR"],
    [/\b(?:php|pesos?)\b|₱/i, "PHP"],
    [/\b(?:idr|rupiah|rp)\b/i, "IDR"],
    [/\b(?:krw|won)\b|₩/i, "KRW"],
    [/\baud\b|a\$/i, "AUD"],
    [/\bcad\b|c\$/i, "CAD"],
    [/\bnzd\b|nz\$/i, "NZD"],
    [/\bhkd\b|hk\$/i, "HKD"],
    [/\btwd\b|nt\$/i, "TWD"],
    [/\b(?:vnd)\b|₫/i, "VND"],
    [/\b(?:aed)\b/i, "AED"],
    [/\b(?:sar)\b/i, "SAR"],
    [/\b(?:chf)\b/i, "CHF"]
  ];
  for (const [pattern, currency] of explicitPatterns) {
    if (pattern.test(text)) return currency;
  }
  if (/\$/.test(text)) {
    return ["SGD", "USD", "AUD", "CAD", "NZD", "HKD"].includes(fallback) ? fallback : "USD";
  }
  return fallback;
}

export function defaultCurrencyForTimezone(timezone: string): string {
  const exact: Record<string, string> = {
    "Asia/Singapore": "SGD",
    "Asia/Yangon": "MMK",
    "Asia/Kuala_Lumpur": "MYR",
    "Asia/Bangkok": "THB",
    "Asia/Manila": "PHP",
    "Asia/Jakarta": "IDR",
    "Asia/Tokyo": "JPY",
    "Asia/Seoul": "KRW",
    "Asia/Kolkata": "INR",
    "Asia/Shanghai": "CNY",
    "Asia/Hong_Kong": "HKD",
    "Asia/Taipei": "TWD",
    "Europe/London": "GBP"
  };
  if (exact[timezone]) return exact[timezone];
  if (timezone.startsWith("America/")) return "USD";
  if (timezone.startsWith("Australia/")) return "AUD";
  if (timezone.startsWith("Europe/")) return "EUR";
  return "SGD";
}
