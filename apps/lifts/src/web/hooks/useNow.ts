import { useEffect, useState } from "react";

/** The time now, as epoch milliseconds, refreshed every second for clocks that count. */
export const useNow = (): number => {
  const [now, setNow] = useState(Date.now);

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  return now;
};
