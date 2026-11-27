import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { moonlightBridge } from "./components/EmbedFrame";
import { AmbientDock, PendingActionModal, RememberedShimmerBadge, UndoToastBar } from "./components/Modals";
import { Boot, Conversation, Naming, Preflight, Setup, Waking, presenceFor } from "./screens/Screens";
import { StartupSequence } from "./screens/StartupSequence";
import { sound } from "./sound";
import { AppsSurface } from "./surfaces/AppsSurface";
import { AtlasSurface } from "./surfaces/AtlasSurface";
import { CanvasSurface } from "./surfaces/CanvasSurface";
import { HerComputerSurface, YourComputerSurface } from "./surfaces/ComputerSurfaces";
import { HomeSurface, SwarmSurface } from "./surfaces/HomeAndSwarm";
import { InboxSurface } from "./surfaces/InboxSurface";
import { ConnectorsSurface, MemorySurface, VoiceSurface } from "./surfaces/SettingsSurfaces";
import type { ActiveSurface, Os1BusState, Os1Config, Os1State, Surface } from "./types";
import { createUaoApi } from "./uao/api";
import { INITIAL_BUS, useOs1 } from "./useOs1";

export type { Surface };

const ACTIVE_SURFACES: ActiveSurface[] = [
  "conversation",
  "home",
  "inbox_cascade",
  "your_computer",
  "her_computer",
  "swarm",
  "made_just_now",
  "connectors",
  "voice_picker",
  "memory",
  "apps",
  "atlas",
];

export function surfaceFor(state: Os1State, busSurface: ActiveSurface = "conversation"): Exclude<Surface, "startup"> {
  // An unknown surface name from the server would otherwise render a blank screen.
  if (!ACTIVE_SURFACES.includes(busSurface)) busSurface = "conversation";
  if (state.connection !== "connected") return "preflight";
  switch (state.phase) {
    case "preflight":
    case "operator_welcome":
      return "boot";
    case "operator_q1":
    case "operator_q1_hesitance":
    case "operator_q2":
    case "operator_q3":
      return "setup";
    case "initiating":
      return "waking";
    default:
      if (state.chips.includes("I love it")) return "naming";
      return busSurface;
  }
}

/** Dev-only: `#preview=<phase-or-surface>` renders any Paper screen with rich sample state, no LiveKit needed. */
function previewFixtures(): { state: Os1State; bus: Os1BusState } | null {
  const m = /preview=([a-z_0-9]+)/.exec(window.location.hash);
  if (!m) return null;
  const key = m[1];
  const isSurface = ACTIVE_SURFACES.includes(key as ActiveSurface);
  const naming = key === "naming";
  const phase = (isSurface || naming || key === "modal_forget" ? "active" : key) as Os1State["phase"];

  const state: Os1State = {
    connection: "connected",
    phase,
    agentState: phase === "active" ? "speaking" : "listening",
    chips: naming
      ? ["I love it", "Let's pick another"]
      : phase === "operator_q2"
        ? ["Female", "Male", "Surprise me"]
        : ["Show me", "Hold on a sec", "Goodnight, Samantha"],
    work: [
      { id: "run_101", label: "Clean up inbox newsletters", status: "running" },
      { id: "run_102", label: "Compare ferries to Sausalito", status: "running" },
      { id: "run_103", label: "Check SF weather", status: "done" },
    ],
    voice: "voice_1_warm",
    agentLine: naming
      ? "Samantha. I just picked it. Do you like it?"
      : phase === "operator_q2"
        ? "Next. Which voice should yours have: female or male?"
        : "I already went through it. Most of it was newsletters you never open. I kept the ones that made me laugh.",
    userLine: naming
      ? "What do I call you?"
      : phase === "operator_q2"
        ? "Female, I think."
        : "Can you look through my email for me?",
  };

  const bus: Os1BusState = {
    ...INITIAL_BUS,
    connected: true,
    activeSurface: isSurface ? (key as ActiveSurface) : "conversation",
    runs: state.work,
    inbox: [
      {
        id: "m1",
        number: 1,
        sender: "Mom",
        subject: "Sunday dinner in North Beach?",
        snippet: "Thinking of making that lemon pasta you love if you're free around six.",
        received_at: "10m ago",
        keeper_score: 0.96,
        is_vip: true,
        category: "personal",
        status: "active",
      },
      {
        id: "m2",
        number: 2,
        sender: "Erin · Studio",
        subject: "Final print proofs for the book",
        snippet: "Attached the warm cream stock samples — let me know which paper feels right.",
        received_at: "1h ago",
        keeper_score: 0.88,
        is_vip: true,
        category: "work",
        status: "active",
      },
      {
        id: "m3",
        number: 3,
        sender: "Golden Gate Ferry",
        subject: "Weekend timetable update",
        snippet: "10:30 AM and 1:45 PM sailings confirmed from Ferry Building Gate B.",
        received_at: "2h ago",
        keeper_score: 0.68,
        is_vip: false,
        category: "work",
        status: "active",
      },
      {
        id: "m4",
        number: 4,
        sender: "Daily Tech Digest",
        subject: "47 things you missed this week — unsubscribe",
        snippet: "Sponsored roundup and flash sale ending tonight.",
        received_at: "3h ago",
        keeper_score: 0.12,
        is_vip: false,
        category: "newsletter",
        status: "active",
      },
    ],
    memories: [
      {
        id: "mem_1",
        category: "places",
        summary: "Watches the fog roll over Ocean Beach when thinking through big decisions.",
        detail: "Prefers late afternoon with hot coffee.",
        source: "voice",
        created_at: Date.now() / 1000 - 86400 * 3,
      },
      {
        id: "mem_2",
        category: "people",
        summary: "Mom makes lemon pasta on Sunday nights in North Beach.",
        detail: "Always mark her emails VIP.",
        source: "onboarding",
        created_at: Date.now() / 1000 - 86400 * 5,
      },
      {
        id: "mem_3",
        category: "promises",
        summary: "Finish sending Erin feedback on the book proofs before Friday.",
        detail: "",
        source: "voice",
        created_at: Date.now() / 1000 - 3600 * 4,
      },
    ],
    connectors: [
      { slug: "gmail", label: "Mail", policy: "ask_before_write", connected: true, account_label: "nick@os1.local", spoken_status: "Mail · asks before sending" },
      { slug: "googlecalendar", label: "Calendar", policy: "full_access", connected: true, account_label: "Primary", spoken_status: "Calendar · full access" },
      { slug: "googledrive", label: "Files", policy: "read_only", connected: true, account_label: "Drive", spoken_status: "Files · read only" },
      { slug: "spotify", label: "Music", policy: "full_access", connected: false, account_label: "", spoken_status: "Music · not connected" },
      { slug: "stripe", label: "Payments", policy: "ask_every_time", connected: false, account_label: "", spoken_status: "Payments · asks every time" },
    ],
    canvas: {
      title: "Two ferries to Sausalito",
      subtitle: "Sunny forecast · light breeze",
      cards: [
        {
          kind: "ChoicePairCard",
          id: "ferry",
          prompt: "Which boat feels better for Saturday?",
          left: { title: "10:30 AM", detail: "Quiet morning crossing · coffee on deck", speakablePhrase: "The 10:30" },
          right: { title: "1:45 PM", detail: "Unhurried morning · golden light back", speakablePhrase: "The 1:45" },
        },
        {
          kind: "AudioSketchCard",
          id: "sketch",
          title: "Late Afternoon on the Bay",
          mood: "Warm piano · 76 bpm",
          duration: "0:48",
          actions: [
            { label: "Play it", speakablePhrase: "Play it", tone: "primary" },
            { label: "Softer", speakablePhrase: "A little softer" },
          ],
        },
      ],
    },
    herComputer: {
      online: true,
      resolution: "1920x1080",
      recentActivity: [
        { id: "a1", source: "her_computer", title: "Sorted 34 newsletters", detail: "Kept 3 essays you usually read", status: "done", created_at: Date.now() / 1000 - 900 },
        { id: "a2", source: "her_computer", title: "Checked Sausalito ferry times", detail: "Found 10:30 and 1:45 openings", status: "done", created_at: Date.now() / 1000 - 300 },
      ],
    },
    cua: {
      ...INITIAL_BUS.cua,
      connected: true,
      status: "ready",
      recentActivity: [
        { id: "c1", source: "your_computer", title: "Opened Notes · Book Proofs", detail: "Read-only lookup in ~/Documents", status: "done", created_at: Date.now() / 1000 - 240 },
      ],
    },
    pendingAction:
      key === "modal_forget"
        ? {
            id: "pa_preview",
            source: "memory",
            title: "Forget this permanently?",
            summaryLines: ["Places: Watches the fog roll over Ocean Beach."],
            stakes: "forget",
            options: [
              { phrase: "Yes, forget it", choice: "forget" },
              { phrase: "Keep it", choice: "cancel" },
            ],
          }
        : null,
  };
  return { state, bus };
}

/** Quiet cues that follow what's happening (all synthesized; see sound.ts). */
function useSoundCues(state: Os1State) {
  const prev = useRef(state);
  useEffect(() => {
    const p = prev.current;
    prev.current = state;
    if (p.connection !== "connected" && state.connection === "connected" && state.phase === "active") sound.listen();
    if (p.connection === "connected" && state.connection !== "connected") sound.disconnect();
    if (p.phase !== "asleep" && state.phase === "asleep") sound.sleep();
    if (p.phase === "asleep" && state.phase === "active") sound.wakeUp();
    const running = (w: Os1State["work"]) => new Set(w.filter((x) => x.status === "running").map((x) => x.id));
    const before = running(p.work);
    const now = running(state.work);
    if ([...now].some((id) => !before.has(id))) sound.workStart();
    if (state.work.some((w) => w.status === "done" && before.has(w.id))) sound.workDone();
  }, [state]);
}

export function App({ config }: { config: Os1Config }) {
  const live = useOs1(config);
  const preview = previewFixtures();
  const { levels, connect, say } = live;
  const state = preview?.state ?? live.state;
  const bus = preview?.bus ?? live.bus;
  const [previewSurface, setPreviewSurface] = useState<ActiveSurface | null>(preview ? preview.bus.activeSurface : null);
  const [booted, setBooted] = useState(() => Boolean(preview) && !window.location.hash.includes("preview=startup"));
  const [toast, setToast] = useState<string | null>(null);
  const [openAppId, setOpenAppId] = useState<string | null>(null);
  const [appsRefreshKey, setAppsRefreshKey] = useState(0);
  const uaoApi = useMemo(() => createUaoApi(live.apiFetch), [live.apiFetch]);
  const loadAtlasMemory = useCallback(async () => {
    const r = await live.apiFetch("/os1/memories");
    if (!r.ok) return [];
    const d = (await r.json()) as { atlas?: { id: string; text: string; agentName: string }[] };
    return d.atlas ?? [];
  }, [live.apiFetch]);
  useSoundCues(state);

  // Voice: "Open Jellyfin" → orchestrator switches to Apps & services and tells us which app.
  useEffect(
    () =>
      live.onEvent((ev) => {
        if (ev.type === "open_app" && typeof ev.appId === "string") setOpenAppId(ev.appId);
        else if (ev.type === "refresh_apps") setAppsRefreshKey((k) => k + 1);
        else if (ev.type === "moonlight_stream") void moonlightBridge()?.stream();
      }),
    [live.onEvent],
  );

  const showToast = (msg: string) => {
    setToast(msg);
    window.setTimeout(() => setToast(null), 1800);
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key.toLowerCase() === "m") {
        sound.muted = !sound.muted;
        showToast(sound.muted ? "Sound off" : "Sound on");
      }
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key === "Escape") {
        void live.revokeCua();
        showToast("Let me drive · all computer access revoked");
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [live]);

  const activeBusSurface = previewSurface ?? bus.activeSurface;
  const surface: Surface = booted ? surfaceFor(state, activeBusSurface) : "startup";

  // Leaving Apps & services closes the open app; coming back shows the catalogue.
  useEffect(() => {
    if (surface !== "apps") setOpenAppId(null);
  }, [surface]);

  const onSelectSurface = (next: ActiveSurface) => {
    sound.tap();
    if (preview) setPreviewSurface(next);
    else live.setSurface(next);
  };

  const onSay = (phrase: string) => {
    sound.tap();
    void say(phrase);
  };

  const mergedRuns = bus.runs.length > 0 ? bus.runs : state.work;
  const presence = presenceFor(state.agentState, state.phase, mergedRuns);
  const isPostOnboarding = ACTIVE_SURFACES.includes(surface as ActiveSurface);

  return (
    <main className="os1-coral" data-surface={surface} data-phase={state.phase}>
      {surface === "startup" && <StartupSequence onDone={() => setBooted(true)} />}

      {surface !== "startup" && (
        <div key={surface} className="os1-surface">
          {surface === "preflight" && (
            <Preflight onBegin={(name) => void connect(name)} busy={state.connection === "connecting"} error={state.error} />
          )}
          {surface === "boot" && <Boot levels={levels} />}
          {surface === "setup" && <Setup state={state} levels={levels} onSay={onSay} />}
          {surface === "waking" && <Waking levels={levels} />}
          {surface === "naming" && <Naming state={state} onSay={onSay} />}

          {surface === "conversation" && <Conversation state={{ ...state, work: mergedRuns }} levels={levels} onSay={onSay} />}
          {surface === "home" && (
            <HomeSurface
              runs={mergedRuns}
              mood={bus.mood}
              presence={presence}
              levels={levels}
              onOpenSurface={onSelectSurface}
              onSay={onSay}
            />
          )}
          {surface === "swarm" && (
            <SwarmSurface runs={mergedRuns} onSay={onSay} onBack={() => onSelectSurface("conversation")} />
          )}
          {surface === "inbox_cascade" && (
            <InboxSurface
              items={bus.inbox}
              compact={bus.mood.compactMode}
              onAction={(action, payload) => void live.dispatchAction({ target: "inbox", action, payload })}
              onBack={() => onSelectSurface("conversation")}
            />
          )}
          {surface === "your_computer" && (
            <YourComputerSurface
              cua={bus.cua}
              onRevoke={() => {
                void live.revokeCua();
                showToast("Let me drive · revoked");
              }}
              onBack={() => onSelectSurface("conversation")}
            />
          )}
          {surface === "her_computer" && (
            <HerComputerSurface
              herComputer={bus.herComputer}
              config={config}
              fetchVncSession={live.fetchVncSession}
              suspended={Boolean(bus.pendingAction)}
              uaoApi={uaoApi}
              onBack={() => onSelectSurface("conversation")}
            />
          )}
          {surface === "made_just_now" && (
            <CanvasSurface
              canvas={bus.canvas}
              compact={bus.mood.compactMode}
              onSay={(phrase) => {
                sound.tap();
                void live.dispatchAction({ phrase, target: "canvas", action: phrase });
                void say(phrase);
              }}
              onBack={() => onSelectSurface("conversation")}
            />
          )}
          {surface === "connectors" && (
            <ConnectorsSurface
              connectors={bus.connectors}
              onUpdate={(slug, patch) => void live.updateConnector(slug, patch)}
              onConnect={live.connectConnector}
              onBack={() => onSelectSurface("conversation")}
            />
          )}
          {surface === "voice_picker" && (
            <VoiceSurface
              voice={bus.voice}
              onUpdate={(patch) => void live.updateVoice(patch)}
              onSay={onSay}
              onBack={() => onSelectSurface("conversation")}
            />
          )}
          {surface === "apps" && (
            <AppsSurface
              api={uaoApi}
              openAppId={openAppId}
              onOpenApp={(id) => {
                sound.tap();
                setOpenAppId(id);
              }}
              refreshKey={appsRefreshKey}
              suspended={Boolean(bus.pendingAction)}
              onBack={() => onSelectSurface("conversation")}
            />
          )}
          {surface === "atlas" && <AtlasSurface api={uaoApi} onBack={() => onSelectSurface("conversation")} />}
          {surface === "memory" && (
            <MemorySurface
              memories={bus.memories}
              onAdd={(category, summary) => void live.addMemory(category, summary)}
              onForget={(id) => void live.requestForgetMemory(id)}
              onBack={() => onSelectSurface("conversation")}
              loadAtlas={loadAtlasMemory}
            />
          )}
        </div>
      )}

      {isPostOnboarding && <AmbientDock active={surface as ActiveSurface} onSelect={onSelectSurface} />}

      {bus.pendingAction && (
        <PendingActionModal
          action={bus.pendingAction}
          onRespond={(id, choice) => {
            sound.tap();
            void live.respondApproval(id, choice);
          }}
        />
      )}

      {bus.undoToast && (
        <UndoToastBar
          toast={bus.undoToast}
          onUndo={(id) => {
            sound.tap();
            void live.undo(id);
            showToast("Undone");
          }}
        />
      )}

      {bus.rememberedShimmer && !toast && <RememberedShimmerBadge shimmer={bus.rememberedShimmer} />}
      {toast && <div className="os1-toast">{toast}</div>}
    </main>
  );
}
