"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

export function BuildPoller({ active }: { active: boolean }) {
  const router = useRouter();

  useEffect(() => {
    if (!active) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;

    const tick = () => {
      router.refresh();
      if (!cancelled) timer = setTimeout(tick, 4_000);
    };
    timer = setTimeout(tick, 4_000);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [active, router]);

  return null;
}
