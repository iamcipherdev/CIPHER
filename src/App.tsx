import { useEffect } from "react";
import { useStore } from "./stores/store";
import { useEvents } from "./hooks/useEvents";
import { useVoice } from "./hooks/useVoice";
import { runAgent } from "./agent/loop";
import { MainScreen } from "./screens/MainScreen";
import { SettingsScreen } from "./screens/SettingsScreen";
import { Onboarding } from "./screens/Onboarding";

export default function App() {
  const screen = useStore((s) => s.screen);
  const settingsLoaded = useStore((s) => s.settingsLoaded);
  const onboarded = useStore((s) => s.settings.onboarded);
  const loadSettings = useStore((s) => s.loadSettings);
  const { start } = useVoice();

  useEvents(
    () => start(true),
    (text) => void runAgent(text)
  );

  useEffect(() => {
    void loadSettings();
  }, [loadSettings]);

  if (!settingsLoaded) {
    return (
      <div className="flex h-full items-center justify-center bg-cipher-bg">
        <span className="h-8 w-8 animate-spin rounded-full border-2 border-cipher-accent border-t-transparent" />
      </div>
    );
  }

  if (!onboarded) return <Onboarding />;
  if (screen === "settings") return <SettingsScreen />;
  return <MainScreen />;
}
