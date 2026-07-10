export type InStoreMarketingSlide = {
  id: string;
  title: string;
  description: string;
  src: string;
};

export const IN_STORE_MARKETING_SLIDES: InStoreMarketingSlide[] = [
  {
    id: "small-group-training",
    title: "Small-Group Training",
    description: "$100/hour total for up to 4 people. Native 16:9 remake of the marketing graphic.",
    src: "/marketing/in-store-tv/small-group-training.png",
  },
  {
    id: "fitness-assessment",
    title: "Fitness Assessment",
    description: "Movement, mobility, and strength baseline for smarter training.",
    src: "/marketing/in-store-tv/fitness-assessment.svg",
  },
  {
    id: "pnf-stretching",
    title: "Proprioceptive Neuromuscular Facilitation",
    description: "$50 full body session. Mobility expanding stretching for athletes and those who move.",
    src: "/marketing/in-store-tv/pnf-stretching.svg",
  },
];
