import { useEffect, useState } from "react";
import { isDark } from "@/lib/appearance";

/** Whether the app is showing its dark theme; follows the system and the Appearance setting. */
export function useDarkMode() {
  const [dark, setDark] = useState(isDark);
  useEffect(() => {
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const on = () => setDark(isDark());
    mq.addEventListener("change", on);
    window.addEventListener("noted-appearance", on);
    return () => {
      mq.removeEventListener("change", on);
      window.removeEventListener("noted-appearance", on);
    };
  }, []);
  return dark;
}
