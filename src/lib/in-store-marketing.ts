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
    description: "$125/90 minute session. Goal consult, FMS, exercise analysis, optional VO2 max, and a 1-3 month plan.",
    src: "/marketing/in-store-tv/fitness-assessment.png",
  },
  {
    id: "pnf-stretching",
    title: "Proprioceptive Neuromuscular Facilitation",
    description: "$50 full body session. Mobility expanding stretching for athletes and those who move.",
    src: "/marketing/in-store-tv/pnf-stretching.png",
  },
];
