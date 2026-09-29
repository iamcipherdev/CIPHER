// LocalCommandRouter — a deterministic, no-LLM command parser for the
// "no cloud key + no local model" mode. It intentionally recognizes a SMALL,
// SAFE grammar and maps every recognized command onto CIPHER's EXISTING tool
// calls, so permission classification, logging, cancellation and the executor
// all stay in the loop. It never pretends to reason and never interprets
// ambiguous or destructive requests — those are refused or marked NeedsAI.

export type FolderKey =
  | "downloads"
  | "documents"
  | "pictures"
  | "music"
  | "videos"
  | "desktop";

export type LocalIntent =
  | { kind: "open_app"; app: string; display: string }
  | { kind: "open_folder"; folder: FolderKey; display: string }
  | { kind: "system_info" }
  | { kind: "memory_info" }
  | { kind: "disk_info" }
  | { kind: "battery_info" }
  | { kind: "running_apps" }
  | { kind: "windows_settings" };

export type LocalRoute =
  | { kind: "intent"; intent: LocalIntent }
  | { kind: "needs_ai" }
  | { kind: "refused"; reason: string };

// ---------------------------------------------------------------------------
// Alias registry — structured tables, not scattered if-statements.
// ---------------------------------------------------------------------------

/** App aliases → launch name (resolved later against installed apps). */
export const APP_ALIASES: Record<string, string> = {
  chrome: "chrome",
  "google chrome": "chrome",
  browser: "chrome",
  edge: "msedge",
  "microsoft edge": "msedge",
  firefox: "firefox",
  calculator: "calculator",
  calc: "calculator",
  notepad: "notepad",
  "notepad++": "notepad++",
  paint: "mspaint",
  "ms paint": "mspaint",
  "file explorer": "explorer",
  explorer: "explorer",
  "task manager": "taskmgr",
  terminal: "wt",
  powershell: "powershell",
  cmd: "cmd",
  "command prompt": "cmd",
  vscode: "code",
  code: "code",
  "visual studio code": "code",
  word: "winword",
  excel: "excel",
  powerpoint: "powerpnt",
  outlook: "outlook",
  spotify: "spotify",
  discord: "discord",
  telegram: "telegram",
  whatsapp: "whatsapp",
  steam: "steam",
  slack: "slack",
  zoom: "zoom",
};

/** Display names for app aliases (used in friendly responses). */
export const APP_DISPLAY: Record<string, string> = {
  chrome: "Google Chrome",
  msedge: "Microsoft Edge",
  firefox: "Firefox",
  calculator: "Calculator",
  notepad: "Notepad",
  "notepad++": "Notepad++",
  mspaint: "Paint",
  explorer: "File Explorer",
  taskmgr: "Task Manager",
  wt: "Windows Terminal",
  powershell: "PowerShell",
  cmd: "Command Prompt",
  code: "Visual Studio Code",
  winword: "Microsoft Word",
  excel: "Microsoft Excel",
  powerpnt: "Microsoft PowerPoint",
  outlook: "Microsoft Outlook",
  spotify: "Spotify",
  discord: "Discord",
  telegram: "Telegram",
  whatsapp: "WhatsApp",
  steam: "Steam",
  slack: "Slack",
  zoom: "Zoom",
};

export const FOLDER_ALIASES: Record<string, FolderKey> = {
  downloads: "downloads",
  "download folder": "downloads",
  "my downloads": "downloads",
  documents: "documents",
  "my documents": "documents",
  pictures: "pictures",
  photos: "pictures",
  "my pictures": "pictures",
  music: "music",
  "my music": "music",
  videos: "videos",
  "my videos": "videos",
  desktop: "desktop",
};

export const FOLDER_DISPLAY: Record<FolderKey, string> = {
  downloads: "Downloads",
  documents: "Documents",
  pictures: "Pictures",
  music: "Music",
  videos: "Videos",
  desktop: "Desktop",
};

/** Polite lead-ins stripped before matching. Longest first. */
const POLITE_PREFIXES = [
  "hey cipher please",
  "hey cipher",
  "cipher please",
  "could you please",
  "could you",
  "can you please",
  "can you",
  "would you please",
  "would you",
  "please",
  "kindly",
  "hey",
  "hi cipher",
  "cipher",
];

/** Open verbs — stripped from the front of app commands. */
const OPEN_VERBS = ["open up", "open", "launch", "start", "run", "bring up", "go to"];

// Destructive / ambiguous verbs: never executed from deterministic parsing.
const DESTRUCTIVE_RE =
  /\b(delete|remove|clean|cleanup|clear|wipe|format|erase|uninstall|shutdown|shut\s*down|restart|reboot|kill|terminate|end\s+task|drop|empty|trash|reset|rm)\b/;

/** Words that make an app command ambiguous even if it parses ("open all"). */
const AMBIGUOUS_APP_RE = /\b(all|every|everything|any|some|multiple|both)\b/;

/** Request-shaped words that mean real AI planning, not a deterministic app launch. */
const NOISY_APP_RE =
  /\b(research|find|write|make|create|organize|plan|tell|explain|how|why|what|when|who|where|search|help|best|should|summarize|compare|install|download|buy|email|send|schedule|convert|fix|build|design)\b/;

// ---------------------------------------------------------------------------
// Normalization
// ---------------------------------------------------------------------------

export function normalizeCommand(raw: string): string {
  let s = raw.toLowerCase().trim();
  // collapse whitespace
  s = s.replace(/\s+/g, " ");
  // strip polite prefixes FIRST (quotes may wrap the command:
  // 'hey cipher please "open calc"')
  for (let i = 0; i < 3; i++) {
    let stripped = false;
    for (const p of POLITE_PREFIXES) {
      if (s === p) return "";
      // allow punctuation right after the prefix: "please, open notepad"
      const re = new RegExp(`^${p}[\\s,.!?:;]+`, "i");
      const m = s.match(re);
      if (m) {
        s = s.slice(m[0].length).trim();
        stripped = true;
      }
    }
    if (!stripped) break;
  }
  // strip surrounding quotes, then trailing punctuation
  s = s.replace(/^["'`]+/, "").replace(/["'`]+$/, "").trim();
  s = s.replace(/[.!?,;:]+$/g, "").trim();
  return s;
}

function stripVerb(s: string, verbs: string[]): string {
  for (const v of verbs) {
    if (s === v) return "";
    if (s.startsWith(v + " ")) {
      return s.slice(v.length).trim();
    }
  }
  return s;
}

function displayForApp(launch: string): string {
  return APP_DISPLAY[launch] ?? launch.charAt(0).toUpperCase() + launch.slice(1);
}

// ---------------------------------------------------------------------------
// Info intents — matched before "open <x>" so "show memory" never opens an app.
// Each entry: [regex, intent factory]. Order matters.
// ---------------------------------------------------------------------------

const INFO_PATTERNS: { re: RegExp; make: () => LocalIntent }[] = [
  {
    re: /^(show\s+|what('s| is)\s+)?(my\s+)?(system\s*info|system\s+information|pc\s*info|computer\s*info|cpu\s*info|processor\s*info|about\s+(this|my)\s+(pc|computer))$/,
    make: () => ({ kind: "system_info" }),
  },
  {
    re: /^(show\s+|what('s| is)\s+)?(my\s+)?(memory(\s*usage)?|ram(\s*usage)?|memory\s+info|ram\s+info)$/,
    make: () => ({ kind: "memory_info" }),
  },
  {
    re: /^(show\s+|what('s| is)\s+)?(my\s+)?(disk(\s*usage|\s*space)?|storage(\s*usage|\s*space)?|disk\s+info|storage\s+info|drives)$/,
    make: () => ({ kind: "disk_info" }),
  },
  {
    re: /^(show\s+|what('s| is)\s+)?(my\s+)?(battery(\s*(status|level|life))?|battery\s+info)$/,
    make: () => ({ kind: "battery_info" }),
  },
  {
    re: /^(show\s+|list\s+|what('s| is| are)\s+)?(all\s+)?(running\s+apps|running\s+applications|open\s+apps|open\s+programs|running\s+processes|active\s+apps|what('s| is)?\s+running)$/,
    make: () => ({ kind: "running_apps" }),
  },
  {
    re: /^(open\s+|show\s+)?(windows\s+)?settings$/,
    make: () => ({ kind: "windows_settings" }),
  },
];

const FOLDER_KEYS = Object.keys(FOLDER_ALIASES).sort((a, b) => b.length - a.length);

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

/**
 * Route a raw user command. Returns either a concrete intent that maps to
 * existing CIPHER tools, a refusal (destructive/ambiguous), or NeedsAI.
 */
export function routeLocalCommand(raw: string): LocalRoute {
  const s = normalizeCommand(raw);
  if (!s) return { kind: "needs_ai" };

  // 1) destructive or ambiguous → refuse deterministic execution entirely.
  //    These need an AI plan and the HIGH-risk confirmation flow, or a human.
  if (DESTRUCTIVE_RE.test(s)) {
    return {
      kind: "refused",
      reason:
        "That looks destructive or ambiguous, so CIPHER won't run it from a direct command. Configure an AI provider to plan this safely, and every destructive step will still ask you first.",
    };
  }

  // 2) info intents
  for (const p of INFO_PATTERNS) {
    if (p.re.test(s)) return { kind: "intent", intent: p.make() };
  }

  // 3) "open <folder>" / bare folder alias
  const afterOpen = stripVerb(s, OPEN_VERBS);
  const folderProbe = (afterOpen || s).trim();
  for (const key of FOLDER_KEYS) {
    if (folderProbe === key) {
      const folder = FOLDER_ALIASES[key];
      return { kind: "intent", intent: { kind: "open_folder", folder, display: FOLDER_DISPLAY[folder] } };
    }
  }

  // 4) "open <app>" / bare app alias
  const hadVerb = OPEN_VERBS.includes(s) || (afterOpen !== s && afterOpen.length > 0);
  const appProbe = (afterOpen || s).trim();
  if (appProbe && !AMBIGUOUS_APP_RE.test(appProbe)) {
    const launch = APP_ALIASES[appProbe];
    if (launch) {
      return { kind: "intent", intent: { kind: "open_app", app: launch, display: displayForApp(launch) } };
    }
    // A generic app name is only accepted when an open verb made the intent
    // explicit ("open vlc", "launch adobe photoshop"). Bare unknown words
    // ("research the best laptop for me") must NOT become fake app opens.
    const words = appProbe.split(" ").length;
    if (
      hadVerb &&
      afterOpen &&
      words <= 4 &&
      !NOISY_APP_RE.test(appProbe) &&
      !appProbe.includes(" and ")
    ) {
      return { kind: "intent", intent: { kind: "open_app", app: appProbe, display: displayForApp(appProbe) } };
    }
  }

  // 5) anything else needs real AI planning
  return { kind: "needs_ai" };
}

// ---------------------------------------------------------------------------
// Friendly deterministic output (no fake reasoning, no fake conversation)
// ---------------------------------------------------------------------------

export function fmtBytes(bytes: number): string {
  const gb = bytes / 1024 ** 3;
  if (gb >= 1) return `${gb.toFixed(1)} GB`;
  return `${(bytes / 1024 ** 2).toFixed(0)} MB`;
}

export function formatLocalResult(intent: LocalIntent, results: { tool: string; ok: boolean; error: string | null; data: Record<string, unknown>; evidence: string | null }[]): string {
  const r = results[results.length - 1];
  const fail = () =>
    `Couldn't do that: ${r?.error ?? "unknown failure"}`;

  if (!r?.ok) return fail();

  switch (intent.kind) {
    case "open_app": {
      // Ambiguity: multiple installed matches — ask instead of guessing.
      const choices = r.data.choices;
      if (Array.isArray(choices) && choices.length > 1) {
        return [
          `I found multiple matches:`,
          ...choices.map((c: unknown, i: number) => `${i + 1}. ${String(c)}`),
          ``,
          `Specify which one to open.`,
        ].join("\n");
      }
      const from = r.data.launched_from ? ` (from ${r.data.launched_from})` : "";
      const ev = r.evidence ? `\n\n${r.evidence}` : "";
      return `Opened ${intent.display}.${from}${ev}`;
    }
    case "open_folder": {
      const p = r.data.path ? ` (${r.data.path})` : "";
      return `Opened ${intent.display}${p}.`;
    }
    case "system_info": {
      const d = r.data;
      const lines = [
        String(d.hostname || "This PC"),
        String(d.os || "Windows"),
        d.cpu ? `CPU: ${d.cpu}` : null,
        d.ram ? `RAM: ${d.ram}` : null,
        d.uptime ? `Uptime: ${d.uptime}` : null,
      ].filter(Boolean);
      return lines.join("\n");
    }
    case "memory_info": {
      const d = r.data;
      return [
        `RAM: ${fmtBytes(Number(d.total ?? 0))} total`,
        `Used: ${fmtBytes(Number(d.used ?? 0))} (${d.usage_percent ?? "?"}%)`,
        `Free: ${fmtBytes(Number(d.available ?? 0))}`,
      ].join("\n");
    }
    case "disk_info": {
      const disks = Array.isArray(r.data.disks) ? r.data.disks : [];
      if (!disks.length) return "No drives detected.";
      return disks
        .map((d: Record<string, unknown>) => {
          const free = fmtBytes(Number(d.available ?? 0));
          const total = fmtBytes(Number(d.total ?? 0));
          return `${String(d.mount ?? "drive")}: ${free} free of ${total}${d.kind ? ` (${d.kind})` : ""}`;
        })
        .join("\n");
    }
    case "battery_info": {
      const d = r.data;
      if (d.present === false) return "No battery detected — this looks like a desktop PC.";
      return `Battery: ${d.percent ?? "?"}%${d.status ? ` (${d.status})` : ""}`;
    }
    case "running_apps": {
      const apps = Array.isArray(r.data.apps) ? r.data.apps : [];
      if (!apps.length) return "No user applications with windows are running right now.";
      const lines = apps.slice(0, 15).map((a: Record<string, unknown>, i: number) => {
        const t = a.window_title ? ` — "${String(a.window_title).slice(0, 60)}"` : "";
        return `${i + 1}. ${a.name}${t}`;
      });
      const rest = apps.length > 15 ? `\n…and ${apps.length - 15} more.` : "";
      return `${apps.length} running app(s):\n${lines.join("\n")}${rest}`;
    }
    case "windows_settings":
      return "Opened Windows Settings.";
  }
}

/** The NeedsAI explanation shown when no AI model is configured. */
export function NEEDS_AI_MESSAGE(request: string): string {
  const short = request.trim().slice(0, 60);
  return [
    `"${short}" needs an AI model for planning. You can configure a cloud provider in Settings → AI, or connect a local Ollama model.`,
    ``,
    `Without a model, CIPHER can still run direct commands such as:`,
    `• open chrome / open notepad / open calculator`,
    `• show system info · show memory · show disk space`,
    `• open downloads · open documents · open settings`,
    `• show running apps · what is my battery`,
  ].join("\n");
}
