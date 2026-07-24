"use client";
/* eslint-disable @next/next/no-img-element */

import { GoogleGenAI, Modality, type LiveServerMessage, type Session } from "@google/genai";
import {
  ArrowRight,
  AudioLines,
  BadgeCheck,
  BookOpen,
  CalendarDays,
  Camera,
  Check,
  ChevronRight,
  CircleAlert,
  ClipboardCheck,
  Database,
  Eye,
  ExternalLink,
  Handshake,
  Headphones,
  Hexagon,
  Image as ImageIcon,
  MapPin,
  Mic,
  MicOff,
  Radio,
  RefreshCw,
  Route,
  Search,
  ShieldCheck,
  Sprout,
  Users,
  Waves,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  computeMatches,
  type MatchResult,
  type Observation,
  type Participant,
  type ParticipantRole,
  type ProfileFacts,
  type TranscriptLine,
} from "@/lib/domain";
import { arrayBufferToBase64, LiveAudio } from "@/lib/live-audio";
import {
  PanoramaInspector,
  type PanoramaHandle,
} from "./PanoramaInspector";

type LiveState = "idle" | "connecting" | "listening" | "ending" | "error";
type ActiveTab = "home" | "inspection" | "profiles" | "matches" | "intelligence";

type IntelligenceResult = {
  title: string;
  url: string;
  excerpt: string;
  authors: string[];
  publishedAt: string | null;
  crawledAt: string | null;
};

const PROFILE_LABELS: Record<string, string> = {
  displayName: "Contact",
  operationName: "Operation",
  location: "Operating location",
  contactPreference: "Best contact",
  seasonStart: "Available from",
  seasonEnd: "Available through",
  hiveCapacity: "Hive capacity",
  hivesNeeded: "Hives needed",
  crop: "Crop",
  acres: "Acres",
  travelRadiusMiles: "Travel radius",
  priceExpectation: "Price expectation",
  requirements: "Requirements",
};

const REQUIRED_FIELDS: Record<ParticipantRole, string[]> = {
  beekeeper: [
    "displayName",
    "operationName",
    "location",
    "seasonStart",
    "seasonEnd",
    "hiveCapacity",
    "travelRadiusMiles",
  ],
  grower: [
    "displayName",
    "operationName",
    "location",
    "crop",
    "acres",
    "seasonStart",
    "seasonEnd",
    "hivesNeeded",
  ],
};

const interviewTool = {
  name: "update_profile_fact",
  description:
    "Save one fact only after the participant has explicitly stated or confirmed it. Include a short evidence excerpt from the participant's words. Never infer a missing value.",
  parametersJsonSchema: {
    type: "object",
    properties: {
      field: {
        type: "string",
        enum: Object.keys(PROFILE_LABELS),
      },
      value: {
        anyOf: [{ type: "string" }, { type: "number" }],
      },
      evidence: {
        type: "string",
        description: "A concise excerpt or faithful paraphrase of what was said.",
      },
      confidence: {
        type: "string",
        enum: ["low", "medium", "high"],
      },
    },
    required: ["field", "value", "evidence", "confidence"],
    additionalProperties: false,
  },
};

const observationTool = {
  name: "record_inspection_observation",
  description:
    "Record a concrete, non-diagnostic field observation. State exactly what was seen, said, measured, or documented. Do not diagnose pests or disease from an image.",
  parametersJsonSchema: {
    type: "object",
    properties: {
      category: { type: "string" },
      note: { type: "string" },
      evidenceType: {
        type: "string",
        enum: ["spoken", "visual", "measured", "documented"],
      },
      confidence: {
        type: "string",
        enum: ["low", "medium", "high"],
      },
    },
    required: ["category", "note", "evidenceType", "confidence"],
    additionalProperties: false,
  },
};

const finishTool = {
  name: "finish_interview",
  description:
    "Move the interview to review only after the critical questions have been asked, unknowns have been stated, and the participant agrees to review the extracted profile.",
  parametersJsonSchema: {
    type: "object",
    properties: {
      summary: { type: "string" },
    },
    required: ["summary"],
    additionalProperties: false,
  },
};

function roleCopy(role: ParticipantRole) {
  return role === "beekeeper"
    ? {
        noun: "beekeeper",
        plural: "Beekeepers",
        accent: "amber",
        intro:
          "Tell us where your bees can work, when they are available, and what makes a good grower relationship.",
      }
    : {
        noun: "grower",
        plural: "Growers",
        accent: "green",
        intro:
          "Tell us what needs pollinating, when bloom starts, and what a successful placement looks like.",
      };
}

function buildSystemInstruction(role: ParticipantRole) {
  const critical =
    role === "beekeeper"
      ? "name, operation, operating location, exact service dates, number of hives available, travel radius, pricing expectations, colony-strength or inspection documentation, pesticide-notification expectations, unloading/access needs, and relationship preferences"
      : "name, operation, ranch location, crop and acres, exact bloom/service dates, number of hives needed, placement density assumptions, access and water conditions, pesticide program and notification workflow, budget expectations, and relationship preferences";
  return `You are Relay, a calm, experienced commercial pollination broker conducting a live intake with a ${role}. Speak naturally and keep each turn concise.

Your job is to collect decision-grade facts, not to sell or speculate. Ask one question at a time. Clarify numbers, units, locations, and dates. Never invent, autocomplete, or silently infer an answer. If the participant does not know, mark it as unresolved in your spoken recap.

Critical topics: ${critical}.

After each explicit answer, call update_profile_fact once for each usable field. Preserve a short evidence excerpt and use medium confidence for ordinary self-reported facts; high confidence only for an explicit, unambiguous answer. Call record_inspection_observation for concrete observations from the live visual or interview. A visual observation is not a diagnosis: never claim that an image proves Varroa, disease, pesticide exposure, queen status, or colony strength.

Save seasonStart and seasonEnd as exact YYYY-MM-DD values after confirming the year. Save hive, acre, and mileage fields as numbers without units. Use requirements for important details that do not have a dedicated field.

Before finishing, recap the important facts and unresolved items, ask the participant if the recap is accurate, then call finish_interview. The human participant—not you—confirms the final profile in the interface.`;
}

function formatField(key: string, value: string | number) {
  if (["hiveCapacity", "hivesNeeded", "acres"].includes(key) && typeof value === "number") {
    return value.toLocaleString();
  }
  if (key === "travelRadiusMiles") return `${value} mi`;
  if (["seasonStart", "seasonEnd"].includes(key) && typeof value === "string") {
    const date = new Date(`${value}T00:00:00`);
    if (!Number.isNaN(date.valueOf())) {
      return date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
    }
  }
  return String(value);
}

function safeFacts(profileJson: string): ProfileFacts {
  try {
    return JSON.parse(profileJson) as ProfileFacts;
  } catch {
    return {};
  }
}

function safeTranscript(transcriptJson: string): TranscriptLine[] {
  try {
    return JSON.parse(transcriptJson) as TranscriptLine[];
  } catch {
    return [];
  }
}

function mergeTranscriptChunk(current: string, chunk: string) {
  const clean = chunk.trim();
  if (!clean) return current;
  if (!current) return clean;
  if (clean.startsWith(current)) return clean;
  if (current.endsWith(clean)) return current;
  if (/^[,.;:!?%)\]}]/.test(clean)) return `${current}${clean}`;
  if (/^['’](?:s|t|re|ve|ll|d|m)\b/i.test(clean)) return `${current}${clean}`;
  return `${current} ${clean}`;
}

async function jsonFetch<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  const body = (await response.json()) as T & { error?: string };
  if (!response.ok) throw new Error(body.error || `Request failed (${response.status})`);
  return body;
}

export default function BrokerDesk() {
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [observations, setObservations] = useState<Observation[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [role, setRole] = useState<ParticipantRole>("beekeeper");
  const [liveState, setLiveState] = useState<LiveState>("idle");
  const [liveError, setLiveError] = useState("");
  const [transcript, setTranscript] = useState<TranscriptLine[]>([]);
  const [liveDraft, setLiveDraft] = useState({
    participant: "",
    agent: "",
  });
  const [visualReady, setVisualReady] = useState(false);
  const [shareVisual, setShareVisual] = useState(false);
  const [notice, setNotice] = useState("");
  const [activeTab, setActiveTab] = useState<ActiveTab>("home");
  const [intelligenceQuery, setIntelligenceQuery] = useState(
    "commercial beekeepers offering almond pollination in California",
  );
  const [intelligenceResults, setIntelligenceResults] = useState<
    IntelligenceResult[]
  >([]);
  const [intelligenceLoading, setIntelligenceLoading] = useState(false);
  const [intelligenceError, setIntelligenceError] = useState("");
  const sessionRef = useRef<Session | null>(null);
  const audioRef = useRef<LiveAudio | null>(null);
  const panoramaRef = useRef<PanoramaHandle>(null);
  const visualTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const participantIdRef = useRef<string | null>(null);
  const shareVisualRef = useRef(false);
  const sceneKindRef = useRef<"none" | "real" | "synthetic">("none");
  const transcriptEndRef = useRef<HTMLDivElement>(null);
  const participantDraftRef = useRef("");
  const agentDraftRef = useRef("");

  const selected = participants.find((participant) => participant.id === selectedId) ?? null;
  const matches = useMemo(() => computeMatches(participants), [participants]);

  const loadData = useCallback(async () => {
    try {
      const [participantData, observationData] = await Promise.all([
        jsonFetch<{ participants: Participant[] }>("/api/participants"),
        jsonFetch<{ observations: Observation[] }>("/api/observations"),
      ]);
      setParticipants(participantData.participants);
      setObservations(observationData.observations);
      if (!selectedId && participantData.participants[0]) {
        setSelectedId(participantData.participants[0].id);
      }
    } catch (error) {
      setLiveError(
        error instanceof Error ? error.message : "Could not load saved field records.",
      );
    }
  }, [selectedId]);

  useEffect(() => {
    // Initial hydration from the platform-backed participant ledger.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadData();
  }, [loadData]);

  useEffect(() => {
    transcriptEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [transcript, liveDraft]);

  useEffect(() => {
    shareVisualRef.current = shareVisual;
  }, [shareVisual]);

  useEffect(
    () => () => {
      if (visualTimerRef.current) clearInterval(visualTimerRef.current);
      sessionRef.current?.close();
      audioRef.current?.close();
    },
    [],
  );

  const addTranscript = useCallback(
    async (line: TranscriptLine) => {
      setTranscript((current) => [...current, line]);
      const participantId = participantIdRef.current;
      if (!participantId) return;
      try {
        await jsonFetch("/api/participants", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            id: participantId,
            role,
            transcriptLine: line,
          }),
        });
      } catch {
        setNotice("Transcript is visible, but this line could not be saved.");
      }
    },
    [role],
  );

  const flushTranscriptTurn = useCallback(async () => {
    const participantText = participantDraftRef.current.trim();
    const agentText = agentDraftRef.current.trim();
    participantDraftRef.current = "";
    agentDraftRef.current = "";
    setLiveDraft({ participant: "", agent: "" });

    if (participantText) {
      await addTranscript({
        speaker: "participant",
        text: participantText,
        at: new Date().toISOString(),
      });
    }
    if (agentText) {
      await addTranscript({
        speaker: "agent",
        text: agentText,
        at: new Date().toISOString(),
      });
    }
  }, [addTranscript]);

  const saveFact = useCallback(
    async (args: Record<string, unknown>) => {
      const participantId = participantIdRef.current;
      if (!participantId) return { saved: false };
      const result = await jsonFetch<{ participant: Participant }>(
        "/api/participants",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            id: participantId,
            role,
            fact: args,
          }),
        },
      );
      setParticipants((current) => {
        const without = current.filter((item) => item.id !== result.participant.id);
        return [result.participant, ...without];
      });
      setSelectedId(result.participant.id);
      return { saved: true, field: args.field };
    },
    [role],
  );

  const saveObservation = useCallback(
    async (args: Record<string, unknown>) => {
      const participantId = participantIdRef.current;
      if (!participantId) return { saved: false };
      if (args.evidenceType === "visual" && sceneKindRef.current === "synthetic") {
        return {
          saved: false,
          reason:
            "The shared image is a synthetic staging scene, so visual observations are not added to the evidence ledger.",
        };
      }
      const orientation = panoramaRef.current?.getOrientation();
      const result = await jsonFetch<{ observation: Observation }>(
        "/api/observations",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            participantId,
            ...args,
            panoramaYaw: orientation?.yaw ?? null,
            panoramaPitch: orientation?.pitch ?? null,
          }),
        },
      );
      setObservations((current) => [result.observation, ...current]);
      return { saved: true, observationId: result.observation.id };
    },
    [],
  );

  const setReview = useCallback(
    async () => {
      const participantId = participantIdRef.current;
      if (!participantId) return { saved: false };
      const result = await jsonFetch<{ participant: Participant }>(
        "/api/participants",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            id: participantId,
            role,
            interviewStatus: "review",
          }),
        },
      );
      setParticipants((current) => [
        result.participant,
        ...current.filter((item) => item.id !== result.participant.id),
      ]);
      return { saved: true, status: "review" };
    },
    [role],
  );

  async function handleLiveMessage(message: LiveServerMessage) {
    if (message.serverContent?.interrupted) {
      audioRef.current?.stopPlayback();
      await flushTranscriptTurn();
    }
    if (message.data) void audioRef.current?.playBase64Pcm(message.data);

    const participantText = message.serverContent?.inputTranscription?.text;
    if (participantText) {
      participantDraftRef.current = mergeTranscriptChunk(
        participantDraftRef.current,
        participantText,
      );
      setLiveDraft((current) => ({
        ...current,
        participant: participantDraftRef.current,
      }));
    }
    const agentText = message.serverContent?.outputTranscription?.text;
    if (agentText) {
      agentDraftRef.current = mergeTranscriptChunk(
        agentDraftRef.current,
        agentText,
      );
      setLiveDraft((current) => ({
        ...current,
        agent: agentDraftRef.current,
      }));
    }
    if (message.serverContent?.turnComplete) {
      await flushTranscriptTurn();
    }

    const calls = message.toolCall?.functionCalls ?? [];
    for (const call of calls) {
      let response: Record<string, unknown>;
      try {
        if (call.name === "update_profile_fact") {
          response = await saveFact(call.args ?? {});
        } else if (call.name === "record_inspection_observation") {
          response = await saveObservation(call.args ?? {});
        } else if (call.name === "finish_interview") {
          response = await setReview();
        } else {
          response = { error: "Unknown tool" };
        }
      } catch (error) {
        response = {
          error: error instanceof Error ? error.message : "Tool execution failed",
        };
      }
      sessionRef.current?.sendToolResponse({
        functionResponses: {
          id: call.id,
          name: call.name,
          response,
        },
      });
    }
  }

  function startVisualFrames() {
    if (visualTimerRef.current) clearInterval(visualTimerRef.current);
    visualTimerRef.current = setInterval(() => {
      if (!shareVisualRef.current || !sessionRef.current) return;
      const frame = panoramaRef.current?.captureFrame();
      if (!frame) return;
      sessionRef.current.sendRealtimeInput({
        video: { data: frame.data, mimeType: frame.mimeType },
      });
    }, 1000);
  }

  async function startInterview() {
    setLiveState("connecting");
    setLiveError("");
    setNotice("");
    const participantId = crypto.randomUUID();
    participantIdRef.current = participantId;
    setSelectedId(participantId);
    setTranscript([]);
    participantDraftRef.current = "";
    agentDraftRef.current = "";
    setLiveDraft({ participant: "", agent: "" });

    try {
      const created = await jsonFetch<{ participant: Participant }>(
        "/api/participants",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id: participantId, role }),
        },
      );
      setParticipants((current) => [created.participant, ...current]);

      const tokenData = await jsonFetch<{ token: string; model: string }>(
        "/api/gemini/token",
        { method: "POST" },
      );
      const ai = new GoogleGenAI({
        apiKey: tokenData.token,
        apiVersion: "v1beta",
      });
      audioRef.current = new LiveAudio();
      const session = await ai.live.connect({
        model: tokenData.model,
        callbacks: {
          onopen: () => setLiveState("listening"),
          onmessage: (message) => void handleLiveMessage(message),
          onerror: (event) => {
            setLiveError(event.message || "The live interview encountered an error.");
            setLiveState("error");
          },
          onclose: () => {
            setLiveState((current) => (current === "ending" ? "idle" : current));
          },
        },
        config: {
          responseModalities: [Modality.AUDIO],
          inputAudioTranscription: {},
          outputAudioTranscription: {},
          systemInstruction: buildSystemInstruction(role),
          speechConfig: {
            voiceConfig: {
              prebuiltVoiceConfig: { voiceName: "Aoede" },
            },
          },
          tools: [
            {
              functionDeclarations: [interviewTool, observationTool, finishTool],
            },
          ],
          sessionResumption: {},
          temperature: 0.35,
        },
      });
      sessionRef.current = session;
      await audioRef.current.startCapture((pcm) => {
        sessionRef.current?.sendRealtimeInput({
          audio: {
            data: arrayBufferToBase64(pcm),
            mimeType: "audio/pcm;rate=16000",
          },
        });
      });
      startVisualFrames();
      session.sendRealtimeInput({
        text: `Begin the ${role} intake now. Briefly introduce yourself as Relay, explain that you will save only what they explicitly tell you, then ask the first question.`,
      });
    } catch (error) {
      audioRef.current?.close();
      sessionRef.current?.close();
      sessionRef.current = null;
      setLiveState("error");
      setLiveError(
        error instanceof Error ? error.message : "Could not start the interview.",
      );
    }
  }

  async function stopInterview() {
    setLiveState("ending");
    await flushTranscriptTurn();
    if (visualTimerRef.current) clearInterval(visualTimerRef.current);
    visualTimerRef.current = null;
    audioRef.current?.stopCapture();
    sessionRef.current?.sendRealtimeInput({ audioStreamEnd: true });
    window.setTimeout(() => {
      sessionRef.current?.close();
      sessionRef.current = null;
      audioRef.current?.close();
      audioRef.current = null;
      setLiveState("idle");
      void loadData();
    }, 400);
  }

  async function confirmProfile(participant: Participant) {
    try {
      const result = await jsonFetch<{ participant: Participant }>(
        "/api/participants",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            id: participant.id,
            role: participant.role,
            interviewStatus: "confirmed",
          }),
        },
      );
      setParticipants((current) => [
        result.participant,
        ...current.filter((item) => item.id !== participant.id),
      ]);
      setNotice("Profile confirmed and eligible for matching.");
    } catch (error) {
      setLiveError(error instanceof Error ? error.message : "Could not confirm profile.");
    }
  }

  async function searchIntelligence(query = intelligenceQuery) {
    const cleanQuery = query.trim();
    if (!cleanQuery) return;
    setIntelligenceLoading(true);
    setIntelligenceError("");
    setIntelligenceQuery(cleanQuery);
    try {
      const result = await jsonFetch<{ results: IntelligenceResult[] }>(
        "/api/intelligence/search",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ query: cleanQuery }),
        },
      );
      setIntelligenceResults(result.results);
    } catch (error) {
      setIntelligenceError(
        error instanceof Error ? error.message : "Could not search public sources.",
      );
    } finally {
      setIntelligenceLoading(false);
    }
  }

  const live = liveState === "listening";
  const busy = liveState === "connecting" || liveState === "ending";
  const selectedFacts = selected ? safeFacts(selected.profileJson) : {};
  const required = selected ? REQUIRED_FIELDS[selected.role] : REQUIRED_FIELDS[role];
  const completeness = selected
    ? Math.round(
        (required.filter((field) => selectedFacts[field]).length / required.length) * 100,
      )
    : 0;

  function openTab(next: ActiveTab) {
    setActiveTab(next);
    window.requestAnimationFrame(() => window.scrollTo(0, 0));
  }

  return (
    <main className={activeTab === "inspection" ? "inspection-mode" : ""}>
      <header className="site-header">
        <button className="brand" onClick={() => openTab("home")} aria-label="Relay home">
          <span className="brand-mark"><Hexagon size={20} /></span>
          <span>Relay</span>
          <em>pollination broker</em>
        </button>
        <nav className="desktop-nav" aria-label="Primary navigation">
          <button className={activeTab === "inspection" ? "active" : ""} onClick={() => openTab("inspection")}>
            Inspection
          </button>
          <button className={activeTab === "profiles" ? "active" : ""} onClick={() => openTab("profiles")}>
            Profiles <span>{participants.length}</span>
          </button>
          <button className={activeTab === "matches" ? "active" : ""} onClick={() => openTab("matches")}>
            Matches <span>{matches.length}</span>
          </button>
          <button className={activeTab === "intelligence" ? "active" : ""} onClick={() => openTab("intelligence")}>
            Field intelligence
          </button>
        </nav>
        <div className="header-status"><span className="secure-dot" /> Evidence on</div>
      </header>

      {activeTab === "home" && (
        <section className="relay-home" id="top">
          <div className="home-hero">
            <div className="home-scrim" />
            <div className="home-copy">
              <span className="hero-kicker"><Waves size={16} /> Remote pollination brokerage</span>
              <h1>See the apiary.<br /><i>Hear the operator.</i><br />Make the right match.</h1>
              <p>
                Relay gives bee brokers a live 360° field view, conducts the
                intake by voice, and turns confirmed facts into matchable
                beekeeper and grower profiles.
              </p>
              <div className="home-actions">
                <button className="button home-primary" onClick={() => openTab("inspection")}>
                  Enter 360° inspection <ArrowRight size={17} />
                </button>
                <button className="button home-secondary" onClick={() => openTab("intelligence")}>
                  Search real sources <Search size={17} />
                </button>
              </div>
            </div>
            <div className="home-proof">
              <span><Camera size={16} /> Live camera or 360° field scene</span>
              <span><AudioLines size={16} /> Natural voice intake</span>
              <span><ShieldCheck size={16} /> Human-confirmed evidence</span>
            </div>
            <div className="home-process">
              <span>01 <b>Inspect remotely</b></span>
              <span>02 <b>Capture decision-grade facts</b></span>
              <span>03 <b>Pair beekeeper + grower</b></span>
            </div>
          </div>

          <div className="home-context">
            <div>
              <span className="eyebrow">Built around actual broker work</span>
              <h2>Less windshield time.<br />More informed introductions.</h2>
            </div>
            <p>
              The demo starts with a close-range apiary already loaded. In the
              field, switch to the phone camera and walk the broker through the
              entire surrounding while Relay asks the missing questions.
            </p>
            <button onClick={() => openTab("inspection")}>
              Open field room <ChevronRight size={17} />
            </button>
          </div>
        </section>
      )}

      {activeTab === "inspection" && (
        <section className="inspection-room">
          <PanoramaInspector
            ref={panoramaRef}
            onAvailabilityChange={setVisualReady}
            onSceneKindChange={(kind) => {
              sceneKindRef.current = kind;
              setShareVisual(false);
            }}
          />

          <div className="inspection-title">
            <span className="live-location"><MapPin size={14} /> Demo orchard · Block 12</span>
            <h1>Remote apiary inspection</h1>
            <p>Synthetic demo scene · visual notes are not diagnostic evidence</p>
          </div>

          <section className="floating-interview">
            <div className="floating-agent-row">
              <span className={`agent-orb ${live ? "speaking" : ""}`}><AudioLines size={19} /></span>
              <span>
                <strong>Relay · live broker</strong>
                <small>
                  {liveState === "connecting"
                    ? "Opening voice channel…"
                    : live
                      ? "Listening · one live sentence"
                      : "Ready for voice intake"}
                </small>
              </span>
              <span className={`live-badge ${live ? "on" : ""}`}><span />{live ? "Live" : "Ready"}</span>
            </div>

            <div className="compact-role-switch" role="group" aria-label="Participant role">
              {(["beekeeper", "grower"] as ParticipantRole[]).map((item) => (
                <button
                  key={item}
                  className={role === item ? "selected" : ""}
                  disabled={live}
                  onClick={() => setRole(item)}
                >
                  {item === "beekeeper" ? <Hexagon size={15} /> : <Sprout size={15} />}
                  {item}
                </button>
              ))}
              <button
                className={`share-scene ${shareVisual ? "selected" : ""}`}
                disabled={!visualReady || !live}
                onClick={() => setShareVisual((value) => !value)}
              >
                <Eye size={15} /> {shareVisual ? "Scene shared" : "Share scene"}
              </button>
            </div>

            <div className="floating-transcript">
              {!transcript.length && !liveDraft.participant && !liveDraft.agent ? (
                <div className="compact-empty">
                  <Headphones size={23} />
                  <span>
                    No form. Relay asks one question at a time and saves complete
                    turns—not word fragments.
                  </span>
                </div>
              ) : (
                <>
                  {transcript.map((line, index) => (
                    <div className={`transcript-line ${line.speaker}`} key={`${line.at}-${index}`}>
                      <span>{line.speaker === "agent" ? "Relay" : "Participant"}</span>
                      <p>{line.text}</p>
                    </div>
                  ))}
                  {liveDraft.participant && (
                    <div className="transcript-line participant live-draft">
                      <span>Participant · listening</span><p>{liveDraft.participant}</p>
                    </div>
                  )}
                  {liveDraft.agent && (
                    <div className="transcript-line agent live-draft">
                      <span>Relay · speaking</span><p>{liveDraft.agent}</p>
                    </div>
                  )}
                </>
              )}
              <div ref={transcriptEndRef} />
            </div>

            {liveError && (
              <div className="error-banner">
                <CircleAlert size={15} /><span>{liveError}</span>
                <button onClick={() => setLiveError("")}><X size={13} /></button>
              </div>
            )}

            <div className="floating-controls">
              {!live ? (
                <button className="button start-call" disabled={busy} onClick={() => void startInterview()}>
                  {liveState === "connecting" ? <RefreshCw className="spin" size={17} /> : <Mic size={17} />}
                  Start {roleCopy(role).noun} interview
                </button>
              ) : (
                <button className="button end-call" onClick={() => void stopInterview()}>
                  <MicOff size={17} /> End interview
                </button>
              )}
              <span>Microphone permission required</span>
            </div>
          </section>

          <aside className="floating-evidence">
            <div className="evidence-panel-head">
              <span><ImageIcon size={16} /> Demo evidence in place</span>
              <b>3 views · 4 notes</b>
            </div>
            <div className="evidence-thumbs" aria-label="Preset inspection photos">
              <img src="/demo-apiary-panorama-v2.png" alt="Close hive stacks" />
              <img src="/demo-apiary-panorama-v2.png" alt="Water access" />
              <img src="/demo-apiary-panorama-v2.png" alt="Vehicle access lane" />
            </div>
            <ol className="preset-notes">
              <li><span>01</span><p>Hive rows are staged on pallets with vehicle access from the gravel lane.</p></li>
              <li><span>02</span><p>Water tote and hose are visible at the center access point.</p></li>
              <li><span>03</span><p>Straps and lids are visible; fastening still needs close verification.</p></li>
              <li className="unverified"><span>!</span><p>Colony strength, brood pattern, queen status, and Varroa load remain unverified.</p></li>
            </ol>
            <div className="live-facts-summary">
              <span><ClipboardCheck size={15} /> Live profile</span>
              <b>{selected?.displayName || "Waiting for interview"}</b>
              <small>{selected ? `${completeness}% of required facts captured` : "Confirmed answers appear here"}</small>
              {!!Object.keys(selectedFacts).length && (
                <div>
                  {Object.entries(selectedFacts).slice(0, 3).map(([key, fact]) => (
                    <p key={key}><span>{PROFILE_LABELS[key] ?? key}</span><b>{formatField(key, fact.value)}</b></p>
                  ))}
                </div>
              )}
            </div>
          </aside>
        </section>
      )}

      {activeTab === "profiles" && (
        <ProfilesView
          participants={participants}
          observations={observations}
          selectedId={selectedId}
          onSelect={setSelectedId}
          onConfirm={confirmProfile}
        />
      )}

      {activeTab === "matches" && <MatchesView matches={matches} participants={participants} />}

      {activeTab === "intelligence" && (
        <section className="intelligence-page">
          <div className="intelligence-intro">
            <span className="hero-kicker"><Database size={16} /> Live public-source research</span>
            <h1>Find the real operators.<br /><i>Then verify them by voice.</i></h1>
            <p>
              Search current public sources for beekeepers, growers, crop
              calendars, and pollination programs. Search results are leads—not
              marketplace profiles—until a person confirms their facts.
            </p>
          </div>
          <form
            className="source-search"
            onSubmit={(event) => {
              event.preventDefault();
              void searchIntelligence();
            }}
          >
            <Search size={20} />
            <input
              value={intelligenceQuery}
              onChange={(event) => setIntelligenceQuery(event.target.value)}
              aria-label="Search public pollination sources"
            />
            <button disabled={intelligenceLoading}>
              {intelligenceLoading ? <RefreshCw className="spin" size={17} /> : "Search sources"}
            </button>
          </form>
          <div className="search-suggestions">
            {[
              "California almond pollination beekeeper association directory",
              "commercial apiaries offering crop pollination Pacific Northwest",
              "USDA honey bee colony and pollination reports",
            ].map((query) => (
              <button key={query} onClick={() => void searchIntelligence(query)}>{query}</button>
            ))}
          </div>
          {intelligenceError && (
            <div className="intelligence-error"><CircleAlert size={17} />{intelligenceError}</div>
          )}
          {!intelligenceResults.length && !intelligenceLoading && !intelligenceError ? (
            <div className="source-empty">
              <BookOpen size={28} />
              <h2>Start with a source trail</h2>
              <p>Relay keeps public research separate from confirmed participant data.</p>
            </div>
          ) : (
            <div className="source-grid">
              {intelligenceResults.map((result) => (
                <article key={result.url}>
                  <span>Public source</span>
                  <h2>{result.title}</h2>
                  <p>{result.excerpt || "Open the source to review this result."}</p>
                  <a href={result.url} target="_blank" rel="noreferrer">
                    Open source <ExternalLink size={15} />
                  </a>
                </article>
              ))}
            </div>
          )}
        </section>
      )}

      {notice && (
        <button className="toast" onClick={() => setNotice("")}>
          <Check size={16} />
          {notice}
          <X size={14} />
        </button>
      )}

      {activeTab !== "inspection" && (
        <footer>
          <div className="brand footer-brand"><span className="brand-mark"><Hexagon size={18} /></span><span>Relay</span></div>
          <p>Facts first. Relationships still human.</p>
          <span>Hackathon field prototype · live voice + 360° vision</span>
        </footer>
      )}
    </main>
  );
}

function ProfilesView({
  participants,
  observations,
  selectedId,
  onSelect,
  onConfirm,
}: {
  participants: Participant[];
  observations: Observation[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onConfirm: (participant: Participant) => Promise<void>;
}) {
  const selected = participants.find((participant) => participant.id === selectedId) ?? participants[0];
  const facts = selected ? safeFacts(selected.profileJson) : {};
  const transcript = selected ? safeTranscript(selected.transcriptJson) : [];
  const evidence = selected
    ? observations.filter((item) => item.participantId === selected.id)
    : [];

  return (
    <section className="page-section">
      <div className="page-heading">
        <span className="hero-kicker"><Users size={16} /> Participant ledger</span>
        <h1>Profiles with provenance,<br /><i>not marketplace theater.</i></h1>
        <p>Every value below came from a recorded interview action. Drafts stay out of matching.</p>
      </div>
      {!participants.length ? (
        <div className="large-empty">
          <Radio size={30} />
          <h2>No participant records yet</h2>
          <p>Run a beekeeper or grower interview to create the first real profile.</p>
        </div>
      ) : (
        <div className="ledger-layout">
          <aside className="profile-list">
            {participants.map((participant) => (
              <button
                key={participant.id}
                className={selected?.id === participant.id ? "active" : ""}
                onClick={() => onSelect(participant.id)}
              >
                <span className={`mini-role ${participant.role}`}>
                  {participant.role === "beekeeper" ? <Hexagon size={16} /> : <Sprout size={16} />}
                </span>
                <span>
                  <strong>{participant.displayName}</strong>
                  <small>{participant.operationName || participant.role}</small>
                </span>
                <em className={`status ${participant.interviewStatus}`}>
                  {participant.interviewStatus}
                </em>
                <ChevronRight size={15} />
              </button>
            ))}
          </aside>
          {selected && (
            <article className="profile-detail">
              <div className="profile-top">
                <div>
                  <span className="eyebrow">{selected.role} record</span>
                  <h2>{selected.displayName}</h2>
                  <p>{selected.operationName || "Operation name not yet captured"}</p>
                </div>
                <span className={`status-card ${selected.interviewStatus}`}>
                  {selected.interviewStatus === "confirmed" && <BadgeCheck size={17} />}
                  {selected.interviewStatus}
                </span>
              </div>
              <div className="profile-columns">
                <section>
                  <h3>Extracted facts</h3>
                  {Object.keys(facts).length ? (
                    <div className="detail-facts">
                      {Object.entries(facts).map(([key, fact]) => (
                        <div key={key}>
                          <span>{PROFILE_LABELS[key] ?? key}</span>
                          <strong>{formatField(key, fact.value)}</strong>
                          <p>“{fact.evidence}”</p>
                          <small><ShieldCheck size={12} /> {fact.source} · {fact.confidence}</small>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="muted">No facts extracted yet.</p>
                  )}
                </section>
                <section>
                  <h3>Inspection evidence</h3>
                  {evidence.length ? (
                    <div className="evidence-list">
                      {evidence.map((item) => (
                        <div key={item.id}>
                          <span>{item.category}</span>
                          <p>{item.note}</p>
                          <small>
                            {item.evidenceType} · {item.confidence}
                            {item.panoramaYaw !== null && ` · view ${item.panoramaYaw}°/${item.panoramaPitch}°`}
                          </small>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="muted">No inspection observations recorded.</p>
                  )}
                  <h3 className="transcript-title">Transcript trail</h3>
                  <p className="muted">{transcript.length} saved lines</p>
                </section>
              </div>
              {selected.interviewStatus === "review" && (
                <button className="button confirm-button wide" onClick={() => void onConfirm(selected)}>
                  <BadgeCheck size={17} />
                  Confirm facts and allow matching
                </button>
              )}
            </article>
          )}
        </div>
      )}
    </section>
  );
}

function MatchesView({
  matches,
  participants,
}: {
  matches: MatchResult[];
  participants: Participant[];
}) {
  const confirmedKeepers = participants.filter(
    (item) => item.role === "beekeeper" && item.interviewStatus === "confirmed",
  ).length;
  const confirmedGrowers = participants.filter(
    (item) => item.role === "grower" && item.interviewStatus === "confirmed",
  ).length;

  return (
    <section className="page-section">
      <div className="page-heading match-heading">
        <span className="hero-kicker"><Handshake size={16} /> Pairing desk</span>
        <h1>Explain the fit.<br /><i>Expose what is still unknown.</i></h1>
        <p>Scores use only confirmed profiles. Unknown information is shown—not guessed.</p>
      </div>
      <div className="market-summary">
        <div><Hexagon size={18} /><strong>{confirmedKeepers}</strong><span>confirmed beekeepers</span></div>
        <div><Sprout size={18} /><strong>{confirmedGrowers}</strong><span>confirmed growers</span></div>
        <div><Handshake size={18} /><strong>{matches.length}</strong><span>reviewable pairings</span></div>
      </div>
      {!matches.length ? (
        <div className="large-empty">
          <Handshake size={30} />
          <h2>A real match needs two confirmed sides</h2>
          <p>
            Complete and confirm at least one beekeeper interview and one grower
            interview. Relay will not populate fake listings for the demo.
          </p>
        </div>
      ) : (
        <div className="match-grid">
          {matches.map((match) => (
            <article className="match-card" key={`${match.beekeeper.id}-${match.grower.id}`}>
              <div className="match-score">
                <span>{match.score}</span>
                <small>known-fit score</small>
              </div>
              <div className="pair-row">
                <div>
                  <span className="mini-role beekeeper"><Hexagon size={17} /></span>
                  <small>Beekeeper</small>
                  <strong>{match.beekeeper.displayName}</strong>
                  <p>{match.beekeeper.operationName}</p>
                </div>
                <div className="pair-line"><ArrowRight size={18} /></div>
                <div>
                  <span className="mini-role grower"><Sprout size={17} /></span>
                  <small>Grower</small>
                  <strong>{match.grower.displayName}</strong>
                  <p>{match.grower.operationName}</p>
                </div>
              </div>
              <div className="signal-list">
                {match.knownSignals.map((signal) => (
                  <div key={signal.label}>
                    {signal.label === "Location" ? <MapPin size={15} /> : signal.label === "Service window" ? <CalendarDays size={15} /> : <Hexagon size={15} />}
                    <span><strong>{signal.label}</strong>{signal.value}</span>
                    <em className={signal.positive ? "good" : "warn"}>
                      {signal.positive ? <Check size={13} /> : <CircleAlert size={13} />}
                    </em>
                  </div>
                ))}
              </div>
              {!!match.unresolved.length && (
                <div className="unresolved">
                  <span><Route size={15} /> Broker follow-up</span>
                  {match.unresolved.map((item) => <p key={item}>— {item}</p>)}
                </div>
              )}
            </article>
          ))}
        </div>
      )}
    </section>
  );
}
