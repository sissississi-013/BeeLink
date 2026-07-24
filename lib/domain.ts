export type ParticipantRole = "beekeeper" | "grower";
export type InterviewStatus = "draft" | "review" | "confirmed" | "sourced";

export type TranscriptLine = {
  speaker: "participant" | "agent";
  text: string;
  at: string;
};

export type SourcedFact = {
  value: string | number;
  source: "live_interview" | "inspection" | "document" | "public_web";
  sourceUrl?: string;
  evidence: string;
  confidence: "low" | "medium" | "high";
  capturedAt: string;
};

export type ProfileFacts = Record<string, SourcedFact>;

export type Participant = {
  id: string;
  role: ParticipantRole;
  displayName: string;
  operationName: string | null;
  location: string | null;
  contactPreference: string | null;
  seasonStart: string | null;
  seasonEnd: string | null;
  hiveCapacity: number | null;
  hivesNeeded: number | null;
  crop: string | null;
  acres: number | null;
  travelRadiusMiles: number | null;
  priceExpectation: string | null;
  requirements: string | null;
  profileJson: string;
  transcriptJson: string;
  interviewStatus: InterviewStatus;
  createdAt: string;
  updatedAt: string;
};

export type Observation = {
  id: string;
  participantId: string;
  category: string;
  note: string;
  evidenceType: "spoken" | "visual" | "measured" | "documented";
  confidence: "low" | "medium" | "high";
  panoramaYaw: number | null;
  panoramaPitch: number | null;
  createdAt: string;
};

export type MatchResult = {
  beekeeper: Participant;
  grower: Participant;
  score: number;
  knownSignals: Array<{ label: string; value: string; positive: boolean }>;
  unresolved: string[];
};

export function isMatchEligible(participant: Participant) {
  return (
    participant.interviewStatus === "confirmed" ||
    participant.interviewStatus === "sourced"
  );
}

function parseDate(value: string | null) {
  if (!value) return null;
  const parsed = new Date(`${value}T00:00:00`);
  return Number.isNaN(parsed.valueOf()) ? null : parsed;
}

function rangesOverlap(
  aStart: string | null,
  aEnd: string | null,
  bStart: string | null,
  bEnd: string | null,
) {
  const starts = [parseDate(aStart), parseDate(bStart)];
  const ends = [parseDate(aEnd), parseDate(bEnd)];
  if (starts.some((value) => !value) || ends.some((value) => !value)) return null;
  return starts[0]!.valueOf() <= ends[1]!.valueOf() &&
    starts[1]!.valueOf() <= ends[0]!.valueOf();
}

export function computeMatches(participants: Participant[]): MatchResult[] {
  const keepers = participants.filter(
    (participant) =>
      participant.role === "beekeeper" &&
      isMatchEligible(participant),
  );
  const growers = participants.filter(
    (participant) =>
      participant.role === "grower" &&
      isMatchEligible(participant),
  );

  return keepers
    .flatMap((beekeeper) =>
      growers.map((grower) => {
        let earned = 0;
        let possible = 0;
        const knownSignals: MatchResult["knownSignals"] = [];
        const unresolved: string[] = [];

        const overlap = rangesOverlap(
          beekeeper.seasonStart,
          beekeeper.seasonEnd,
          grower.seasonStart,
          grower.seasonEnd,
        );
        if (overlap === null) {
          unresolved.push("Confirm service-window overlap");
        } else {
          possible += 45;
          if (overlap) earned += 45;
          knownSignals.push({
            label: "Service window",
            value: overlap ? "Dates overlap" : "Dates conflict",
            positive: overlap,
          });
        }

        if (beekeeper.hiveCapacity && grower.hivesNeeded) {
          possible += 35;
          const capacityFit = Math.min(
            1,
            beekeeper.hiveCapacity / grower.hivesNeeded,
          );
          earned += 35 * capacityFit;
          knownSignals.push({
            label: "Hive capacity",
            value: `${beekeeper.hiveCapacity.toLocaleString()} available · ${grower.hivesNeeded.toLocaleString()} needed`,
            positive: capacityFit >= 1,
          });
        } else {
          unresolved.push("Confirm hive capacity and demand");
        }

        if (beekeeper.location && grower.location) {
          possible += 20;
          const exact =
            beekeeper.location.trim().toLowerCase() ===
            grower.location.trim().toLowerCase();
          const sameState =
            beekeeper.location.split(",").at(-1)?.trim().toLowerCase() ===
            grower.location.split(",").at(-1)?.trim().toLowerCase();
          const locationFit = exact ? 1 : sameState ? 0.75 : 0.45;
          earned += 20 * locationFit;
          knownSignals.push({
            label: "Location",
            value: sameState
              ? `${beekeeper.location} ↔ ${grower.location}`
              : "Distance still needs route verification",
            positive: sameState,
          });
          if (!sameState) unresolved.push("Verify route mileage and transport cost");
        } else {
          unresolved.push("Confirm both operating locations");
        }

        const score = possible ? Math.round((earned / possible) * 100) : 0;
        return { beekeeper, grower, score, knownSignals, unresolved };
      }),
    )
    .sort((a, b) => b.score - a.score);
}

export const PROFILE_FIELDS = [
  "displayName",
  "operationName",
  "location",
  "contactPreference",
  "seasonStart",
  "seasonEnd",
  "hiveCapacity",
  "hivesNeeded",
  "crop",
  "acres",
  "travelRadiusMiles",
  "priceExpectation",
  "requirements",
] as const;
