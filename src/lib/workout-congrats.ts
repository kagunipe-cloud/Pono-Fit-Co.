/** Milestone weights in lbs. Steps: 100k+ every 10k; 40k→100k every 5k; 20k→40k every 2k; 1k→19k every 1k; below 1k every 100. ~33% animal, ~33% machinery, ~33% silly. Sorted descending. */
export const WEIGHT_COMPARISONS: { lbs: number; name: string }[] = [
  { lbs: 200_000, name: "blue whale" },
  { lbs: 190_000, name: "whale shark" },
  { lbs: 180_000, name: "empty 747" },
  { lbs: 170_000, name: "Boeing 737" },
  { lbs: 160_000, name: "locomotive" },
  { lbs: 150_000, name: "space shuttle (empty)" },
  { lbs: 140_000, name: "loaded semi" },
  { lbs: 130_000, name: "freight car" },
  { lbs: 120_000, name: "tank" },
  { lbs: 110_000, name: "that many cheeseburgers" },
  { lbs: 100_000, name: "sperm whale" },
  { lbs: 95_000, name: "shipping container (full)" },
  { lbs: 90_000, name: "mountain of luggage" },
  { lbs: 85_000, name: "garbage truck (full)" },
  { lbs: 80_000, name: "main battle tank" },
  { lbs: 75_000, name: "armored personnel carrier" },
  { lbs: 70_000, name: "armored vehicle" },
  { lbs: 65_000, name: "fire engine (with tank)" },
  { lbs: 60_000, name: "Statue of Liberty (copper)" },
  { lbs: 55_000, name: "mobile home" },
  { lbs: 50_000, name: "swimming pool of Jell-O" },
  { lbs: 45_000, name: "cement truck" },
  { lbs: 40_000, name: "school bus" },
  { lbs: 38_000, name: "pizza for a city block" },
  { lbs: 36_000, name: "tractor trailer (empty)" },
  { lbs: 34_000, name: "backhoe loader" },
  { lbs: 32_000, name: "telehandler" },
  { lbs: 30_000, name: "pile of pumpkins" },
  { lbs: 28_000, name: "dump truck (small)" },
  { lbs: 26_000, name: "box truck (loaded)" },
  { lbs: 24_000, name: "ice cream truck (full)" },
  { lbs: 22_000, name: "short bus" },
  { lbs: 20_000, name: "fire truck" },
  { lbs: 19_000, name: "T. rex" },
  { lbs: 18_000, name: "minke whale" },
  { lbs: 17_000, name: "birthday cake (very large)" },
  { lbs: 16_000, name: "wheel loader" },
  { lbs: 15_000, name: "hippo" },
  { lbs: 14_000, name: "white rhino" },
  { lbs: 13_000, name: "young T. rex" },
  { lbs: 12_000, name: "dozen grand pianos" },
  { lbs: 11_000, name: "elephant" },
  { lbs: 10_000, name: "pallet of bricks" },
  { lbs: 9_000, name: "pygmy hippo" },
  { lbs: 8_000, name: "stack of washing machines" },
  { lbs: 7_000, name: "pickup truck" },
  { lbs: 6_000, name: "rhino" },
  { lbs: 5_000, name: "bison" },
  { lbs: 4_000, name: "hot tub (full of water)" },
  { lbs: 3_000, name: "sofa fort" },
  { lbs: 2_000, name: "polar bear" },
  { lbs: 1_000, name: "grand piano" },
  { lbs: 900, name: "your weight in pumpkins" },
  { lbs: 800, name: "grizzly bear" },
  { lbs: 700, name: "food truck (fully loaded)" },
  { lbs: 600, name: "vending machine full of snacks" },
  { lbs: 500, name: "lion" },
  { lbs: 400, name: "stack of watermelons" },
  { lbs: 300, name: "laundry day (full load)" },
  { lbs: 200, name: "stack of cinder blocks" },
  { lbs: 100, name: "golden retriever" },
];

/** Returns the name for the highest milestone you've reached (largest milestone <= volumeLbs). So 10,500 → school bus (10k), 11,000 → elephant (11k). */
export function getWeightComparison(volumeLbs: number): string | null {
  if (volumeLbs < 100) return null;
  for (const item of WEIGHT_COMPARISONS) {
    if (item.lbs <= volumeLbs) return item.name;
  }
  return WEIGHT_COMPARISONS[WEIGHT_COMPARISONS.length - 1]?.name ?? null;
}

/** Use "an" before vowel sounds (a, e, i, o, u), "a" otherwise. */
function articleFor(name: string): "a" | "an" {
  const first = (name.trim().toLowerCase().replace(/^the\s+/i, ""))[0];
  return first === "a" || first === "e" || first === "i" || first === "o" || first === "u" ? "an" : "a";
}

/** Returns "a school bus" or "an elephant" for the highest milestone reached. */
export function getWeightComparisonWithArticle(volumeLbs: number): string | null {
  const name = getWeightComparison(volumeLbs);
  if (!name) return null;
  return `${articleFor(name)} ${name}`;
}
