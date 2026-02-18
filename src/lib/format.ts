/**
 * Safe price formatting: avoids $NaN when price is missing or invalid.
 */
export function formatPrice(price: string | number | null | undefined): string {
  if (price == null || price === "") return "—";
  const n = typeof price === "number" ? price : parseFloat(String(price).replace(/[^0-9.-]/g, ""));
  if (Number.isNaN(n)) return "—";
  if (n === 0) return "Free";
  return `$${n.toFixed(2)}`;
}

const SMALL_WORDS = new Set(["a", "an", "the", "and", "but", "or", "for", "nor", "on", "at", "to", "by", "of", "in", "with", "is", "it", "as"]);

/**
 * Title case: capitalize first letter of each word except small words (and, the, with, etc.).
 * First and last word of the string are always capitalized.
 */
export function toTitleCase(str: string | null | undefined): string {
  if (str == null || str === "") return "";
  const words = str.trim().split(/\s+/);
  return words
    .map((word, i) => {
      const lower = word.toLowerCase();
      const isFirstOrLast = i === 0 || i === words.length - 1;
      if (isFirstOrLast || !SMALL_WORDS.has(lower)) {
        return lower.charAt(0).toUpperCase() + lower.slice(1);
      }
      return lower;
    })
    .join(" ");
}
