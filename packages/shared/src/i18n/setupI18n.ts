import i18n, { type i18n as I18nInstance, type InitOptions } from "i18next";
import { LOCALE_REGISTRY } from "./registry";
import { SUPPORTED_LANGUAGE_CODES } from "./languages";

const UPSTREAM_PRODUCT_NAME = "Craft Agents";

function brandMessages(value: unknown, productName: string): unknown {
  if (typeof value === "string") return value.split(UPSTREAM_PRODUCT_NAME).join(productName);
  if (Array.isArray(value)) return value.map((item) => brandMessages(item, productName));
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, brandMessages(item, productName)]));
  }
  return value;
}

/** Build i18next resources from the locale registry, renaming the product for forks (e.g. "Veto Agents"). */
export function buildI18nResources(productName = UPSTREAM_PRODUCT_NAME) {
  const rename = productName.trim() && productName !== UPSTREAM_PRODUCT_NAME;
  return Object.fromEntries(
    Object.entries(LOCALE_REGISTRY).map(([code, entry]) => [
      code,
      { translation: rename ? brandMessages(entry.messages, productName.trim()) : entry.messages },
    ]),
  );
}

// Safe as a boolean guard because init is synchronous (initImmediate: false).
// If async init is ever needed, replace with a promise-based singleton.
let initialized = false;

/**
 * Initialize i18next with bundled translations.
 * Call once at app startup. Pass `plugins` to add framework integrations
 * (e.g. initReactI18next for React apps, LanguageDetector for browser apps).
 */
export function setupI18n(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  plugins: any[] = [],
  options: { productName?: string } = {},
): I18nInstance {
  if (initialized) return i18n;

  let instance = i18n;
  for (const plugin of plugins) {
    instance = instance.use(plugin);
  }

  instance.init({
    resources: buildI18nResources(options.productName),
    fallbackLng: "en",
    supportedLngs: [...SUPPORTED_LANGUAGE_CODES],
    interpolation: { escapeValue: false },
    initImmediate: false, // synchronous init — resources are bundled inline
    detection: {
      order: ["localStorage", "navigator"],
      caches: ["localStorage"],
      lookupLocalStorage: "i18nextLng",
    },
  } as InitOptions);

  initialized = true;
  return i18n;
}

export { i18n };
