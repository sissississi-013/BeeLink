import { getDb } from "@/db";
import { participants } from "@/db/schema";
import type { ProfileFacts } from "@/lib/domain";

const CAPTURED_AT = "2026-07-23T00:00:00.000Z";

function publicFact(
  value: string | number,
  evidence: string,
  sourceUrl: string,
  confidence: "medium" | "high" = "high",
) {
  return {
    value,
    source: "public_web" as const,
    sourceUrl,
    evidence,
    confidence,
    capturedAt: CAPTURED_AT,
  };
}

const OAKLEY_URL = "https://www.oakleyapiaries.com/";
const CG_FARMS_URL = "https://www.candgfarms.com/";
const STEWART_JASPER_URL = "https://www.stewartandjasper.com/locations/";

const oakleyFacts: ProfileFacts = {
  displayName: publicFact("Oakley Apiaries", "Oakley Apiaries", OAKLEY_URL),
  operationName: publicFact(
    "Oakley Apiaries",
    "Family-owned apiary farm founded in 1985.",
    OAKLEY_URL,
  ),
  location: publicFact("Madera, CA", "Madera, California", OAKLEY_URL),
  crop: publicFact(
    "Almonds and other Central Valley crops",
    "Offers agricultural crop pollination for almond orchards, berry farms, and other Central Valley operations.",
    OAKLEY_URL,
  ),
  requirements: publicFact(
    "Public-source lead. Service dates, hive capacity, colony-strength documentation, pricing, and transport terms require direct confirmation.",
    "The public site confirms pollination services but does not publish current availability, capacity, or commercial terms.",
    OAKLEY_URL,
    "medium",
  ),
};

const cgFarmsFacts: ProfileFacts = {
  displayName: publicFact("C&G Farms", "C&G Farms", CG_FARMS_URL),
  operationName: publicFact(
    "C&G Farms",
    "A Central Valley family farming business.",
    CG_FARMS_URL,
  ),
  location: publicFact("Ripon, CA", "21602 S. Carrolton Rd, Ripon, CA", CG_FARMS_URL),
  crop: publicFact("Almonds", "California almond farming operation.", CG_FARMS_URL),
  acres: publicFact(
    2000,
    "The company says it farms over 2,000 acres of almonds.",
    CG_FARMS_URL,
  ),
  requirements: publicFact(
    "Public-source lead. Bloom dates, hive demand, placement conditions, pesticide notification, and budget require direct confirmation.",
    "The public site identifies the operation and acreage but does not publish current pollination requirements.",
    CG_FARMS_URL,
    "medium",
  ),
};

const stewartJasperFacts: ProfileFacts = {
  displayName: publicFact(
    "Stewart & Jasper Orchards",
    "Stewart & Jasper Orchards",
    STEWART_JASPER_URL,
  ),
  operationName: publicFact(
    "Stewart & Jasper Orchards",
    "A vertically integrated California almond operation.",
    STEWART_JASPER_URL,
  ),
  location: publicFact(
    "Newman, CA",
    "Main office at 3500 Shiells Road, Newman, California.",
    STEWART_JASPER_URL,
  ),
  crop: publicFact(
    "Almonds",
    "The company states that its almonds are grown in its orchards.",
    STEWART_JASPER_URL,
  ),
  requirements: publicFact(
    "Public-source lead. Orchard block, bloom dates, hive demand, placement conditions, pesticide notification, and budget require direct confirmation.",
    "The public site confirms an almond orchard operation but does not publish current pollination requirements.",
    STEWART_JASPER_URL,
    "medium",
  ),
};

const publicProfiles = [
  {
    id: "public-oakley-apiaries",
    role: "beekeeper" as const,
    displayName: "Oakley Apiaries",
    operationName: "Oakley Apiaries",
    location: "Madera, CA",
    crop: "Almonds and other Central Valley crops",
    requirements: String(oakleyFacts.requirements.value),
    profileJson: JSON.stringify(oakleyFacts),
    transcriptJson: "[]",
    interviewStatus: "sourced" as const,
    createdAt: CAPTURED_AT,
    updatedAt: CAPTURED_AT,
  },
  {
    id: "public-cg-farms",
    role: "grower" as const,
    displayName: "C&G Farms",
    operationName: "C&G Farms",
    location: "Ripon, CA",
    crop: "Almonds",
    acres: 2000,
    requirements: String(cgFarmsFacts.requirements.value),
    profileJson: JSON.stringify(cgFarmsFacts),
    transcriptJson: "[]",
    interviewStatus: "sourced" as const,
    createdAt: CAPTURED_AT,
    updatedAt: CAPTURED_AT,
  },
  {
    id: "public-stewart-jasper",
    role: "grower" as const,
    displayName: "Stewart & Jasper Orchards",
    operationName: "Stewart & Jasper Orchards",
    location: "Newman, CA",
    crop: "Almonds",
    requirements: String(stewartJasperFacts.requirements.value),
    profileJson: JSON.stringify(stewartJasperFacts),
    transcriptJson: "[]",
    interviewStatus: "sourced" as const,
    createdAt: CAPTURED_AT,
    updatedAt: CAPTURED_AT,
  },
];

export async function ensurePublicProfiles() {
  await getDb().insert(participants).values(publicProfiles).onConflictDoNothing();
}
