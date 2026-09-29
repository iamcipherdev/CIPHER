// Unit tests for the deterministic LocalCommandRouter (no-LLM mode).

import { describe, it, expect } from "vitest";
import {
  routeLocalCommand,
  normalizeCommand,
  formatLocalResult,
  NEEDS_AI_MESSAGE,
  type LocalIntent,
} from "../localRouter";

function toolOf(route: ReturnType<typeof routeLocalCommand>): string | null {
  if (route.kind !== "intent") return null;
  switch (route.intent.kind) {
    case "open_app":
      return "open_app";
    case "open_folder":
      return "open_file";
    case "system_info":
      return "get_system_info";
    case "memory_info":
      return "get_memory_info";
    case "disk_info":
      return "get_disk_info";
    case "battery_info":
      return "get_battery_info";
    case "running_apps":
      return "list_running_apps";
    case "windows_settings":
      return "open_windows_settings";
  }
}

describe("normalizeCommand", () => {
  it("lowercases, collapses whitespace and strips punctuation", () => {
    expect(normalizeCommand("  Open   Chrome! ")).toBe("open chrome");
    expect(normalizeCommand("PLEASE, open notepad.")).toBe("open notepad");
    expect(normalizeCommand('hey cipher please "open calc"')).toBe("open calc");
  });
});

describe("router: supported commands (Phase 15)", () => {
  it('"open chrome" → open_app chrome', () => {
    const r = routeLocalCommand("open chrome");
    expect(r.kind).toBe("intent");
    if (r.kind === "intent" && r.intent.kind === "open_app") {
      expect(r.intent.app).toBe("chrome");
      expect(r.intent.display).toBe("Google Chrome");
    }
    expect(toolOf(r)).toBe("open_app");
  });

  it('"launch calculator" → open_app calculator', () => {
    const r = routeLocalCommand("launch calculator");
    expect(r.kind).toBe("intent");
    if (r.kind === "intent" && r.intent.kind === "open_app") {
      expect(r.intent.app).toBe("calculator");
    }
  });

  it('"start notepad" and bare "notepad" both open notepad', () => {
    expect(toolOf(routeLocalCommand("start notepad"))).toBe("open_app");
    const bare = routeLocalCommand("notepad");
    if (bare.kind === "intent" && bare.intent.kind === "open_app") {
      expect(bare.intent.app).toBe("notepad");
    }
    expect(toolOf(bare)).toBe("open_app");
  });

  it('"show system info" / "pc info" / "what cpu do i have" variants → get_system_info', () => {
    expect(toolOf(routeLocalCommand("show system info"))).toBe("get_system_info");
    expect(toolOf(routeLocalCommand("pc info"))).toBe("get_system_info");
    expect(toolOf(routeLocalCommand("cpu info"))).toBe("get_system_info");
    expect(toolOf(routeLocalCommand("what is my computer info"))).toBe("get_system_info");
  });

  it('"show ram usage" / "memory" → memory tool', () => {
    expect(toolOf(routeLocalCommand("show ram usage"))).toBe("get_memory_info");
    expect(toolOf(routeLocalCommand("memory"))).toBe("get_memory_info");
    expect(toolOf(routeLocalCommand("show memory"))).toBe("get_memory_info");
  });

  it('"show disk space" / "storage" → disk tool', () => {
    expect(toolOf(routeLocalCommand("show disk space"))).toBe("get_disk_info");
    expect(toolOf(routeLocalCommand("storage"))).toBe("get_disk_info");
  });

  it('"what is my battery" → battery tool', () => {
    expect(toolOf(routeLocalCommand("what is my battery"))).toBe("get_battery_info");
    expect(toolOf(routeLocalCommand("battery status"))).toBe("get_battery_info");
  });

  it('"show running apps" → list_running_apps', () => {
    expect(toolOf(routeLocalCommand("show running apps"))).toBe("list_running_apps");
    expect(toolOf(routeLocalCommand("what's running"))).toBe("list_running_apps");
  });

  it('"open downloads" / bare "downloads" → open_file on the user folder', () => {
    for (const cmd of ["open downloads", "downloads", "open documents", "open pictures"]) {
      expect(toolOf(routeLocalCommand(cmd))).toBe("open_file");
    }
    const r = routeLocalCommand("open downloads");
    if (r.kind === "intent" && r.intent.kind === "open_folder") {
      expect(r.intent.folder).toBe("downloads");
    }
  });

  it('"open settings" / "windows settings" → open_windows_settings', () => {
    expect(toolOf(routeLocalCommand("open settings"))).toBe("open_windows_settings");
    expect(toolOf(routeLocalCommand("windows settings"))).toBe("open_windows_settings");
  });

  it('"open task manager" → open_app taskmgr', () => {
    const r = routeLocalCommand("open task manager");
    if (r.kind === "intent" && r.intent.kind === "open_app") {
      expect(r.intent.app).toBe("taskmgr");
    }
    expect(toolOf(r)).toBe("open_app");
  });

  it('"open file explorer" → open_app explorer', () => {
    const r = routeLocalCommand("open file explorer");
    if (r.kind === "intent" && r.intent.kind === "open_app") {
      expect(r.intent.app).toBe("explorer");
    }
  });

  it('generic explicit app names work: "open vlc"', () => {
    const r = routeLocalCommand("open vlc");
    if (r.kind === "intent" && r.intent.kind === "open_app") {
      expect(r.intent.app).toBe("vlc");
    }
    expect(toolOf(r)).toBe("open_app");
  });
});

describe("router: unsupported / destructive (Phase 15)", () => {
  it('"research the best laptop for me" → NeedsAI', () => {
    expect(routeLocalCommand("research the best laptop for me").kind).toBe("needs_ai");
  });

  it('"write a complete business plan for a software company" → NeedsAI', () => {
    expect(
      routeLocalCommand("write a complete business plan for a software company").kind
    ).toBe("needs_ai");
  });

  it('"clean everything" → refused (never executed destructively)', () => {
    expect(routeLocalCommand("clean everything").kind).toBe("refused");
  });

  it('"delete my downloads folder" → refused', () => {
    expect(routeLocalCommand("delete my downloads folder").kind).toBe("refused");
  });

  it('"organize my computer and remove unnecessary files" → refused/needs_ai, never executed', () => {
    const r = routeLocalCommand("organize my computer and remove unnecessary files");
    expect(["refused", "needs_ai"]).toContain(r.kind);
  });

  it('"shutdown the pc" → refused', () => {
    expect(routeLocalCommand("shutdown the pc").kind).toBe("refused");
  });

  it('unknown bare words do NOT become app opens', () => {
    expect(routeLocalCommand("thanks").kind).toBe("needs_ai");
  });
});

describe("deterministic result formatting (Phase 10)", () => {
  const base = { evidence: null, risk: "safe" };

  it("open success reads naturally", () => {
    const intent: LocalIntent = { kind: "open_app", app: "chrome", display: "Google Chrome" };
    const out = formatLocalResult(intent, [
      { tool: "open_app", ok: true, error: null, data: { launched_from: "C:\\chrome.exe" }, ...base },
    ]);
    expect(out).toContain("Opened Google Chrome");
    expect(out).toContain("C:\\chrome.exe");
  });

  it("ambiguity lists choices instead of opening a random app (Phase 12)", () => {
    const intent: LocalIntent = { kind: "open_app", app: "studio", display: "Studio" };
    const out = formatLocalResult(intent, [
      {
        tool: "find_installed_app",
        ok: true,
        error: null,
        data: { choices: ["Visual Studio Code", "Android Studio"] },
        ...base,
      },
    ]);
    expect(out).toContain("I found multiple matches:");
    expect(out).toContain("1. Visual Studio Code");
    expect(out).toContain("2. Android Studio");
    expect(out).toContain("Specify which one to open.");
    // must NOT claim something was opened
    expect(out).not.toContain("Opened");
  });

  it("failures are reported honestly", () => {
    const intent: LocalIntent = { kind: "open_app", app: "nope", display: "Nope" };
    const out = formatLocalResult(intent, [
      { tool: "open_app", ok: false, error: "Couldn't find an installed application matching", data: {}, ...base },
    ]);
    expect(out).toContain("Couldn't do that");
  });

  it("system info formats human-readable lines", () => {
    const intent: LocalIntent = { kind: "system_info" };
    const out = formatLocalResult(intent, [
      {
        tool: "get_system_info",
        ok: true,
        error: null,
        data: { hostname: "DESKTOP-XXXX", os: "Windows 10 Pro", cpu: "Intel i7", ram: "8.0 GB" },
        ...base,
      },
    ]);
    expect(out).toContain("DESKTOP-XXXX");
    expect(out).toContain("Windows 10 Pro");
    expect(out).toContain("RAM: 8.0 GB");
  });

  it("no battery on desktops is honest", () => {
    const intent: LocalIntent = { kind: "battery_info" };
    const out = formatLocalResult(intent, [
      { tool: "get_battery_info", ok: true, error: null, data: { present: false }, ...base },
    ]);
    expect(out).toContain("No battery");
  });

  it("NeedsAI message explains offline capabilities concisely (Phase 6)", () => {
    const msg = NEEDS_AI_MESSAGE("organize my computer");
    expect(msg).toContain("needs an AI model");
    expect(msg).toContain("Settings → AI");
    expect(msg).toContain("show system info");
  });
});
