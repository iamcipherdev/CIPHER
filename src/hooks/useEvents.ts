// Wire backend + window events into the store.
import { useEffect } from "react";
import { listen } from "@tauri-apps/api/event";
import { useStore } from "../stores/store";
import type { ActivityEntry } from "../lib/types";

export function useEvents(onTrayListen: () => void, onVoiceText: (text: string) => void) {
  useEffect(() => {
    const unlisten: (() => void)[] = [];

    const add = (p: Promise<() => void>) => {
      p.then((fn) => unlisten.push(fn)).catch(() => {});
    };

    add(
      listen<ActivityEntry>("cipher-action", (event) => {
        useStore.getState().pushActivity({ ...event.payload, kind: "action" });
      })
    );

    add(
      listen<{ paused: boolean }>("cipher-paused", (event) => {
        useStore.getState().setPaused(event.payload.paused);
      })
    );

    add(
      listen("cipher-open-settings", () => {
        useStore.getState().setScreen("settings");
      })
    );

    add(
      listen<{ text: string }>("cipher-palette-submit", (event) => {
        useStore.getState().setScreen("main");
        onVoiceText(event.payload.text);
      })
    );

    add(
      listen("cipher-tray-listen", () => {
        onTrayListen();
      })
    );

    return () => {
      unlisten.forEach((fn) => fn());
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}
