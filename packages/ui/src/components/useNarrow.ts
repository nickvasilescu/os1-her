import { createContext, useEffect, useState } from "react";

const QUERY = "(max-width: 760px)";

/** True on phone-width screens (the Android app, or a narrow window). */
export function useNarrow(): boolean {
  const [narrow, setNarrow] = useState(() => typeof window !== "undefined" && window.matchMedia(QUERY).matches);
  useEffect(() => {
    const mq = window.matchMedia(QUERY);
    const on = () => setNarrow(mq.matches);
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);
  return narrow;
}

export const NarrowContext = createContext(false);
