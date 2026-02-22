import { useEffect } from "react";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type { FactoryEventMap } from "../lib/events";

export function useTauriEvent<K extends keyof FactoryEventMap>(
  eventName: K,
  handler: (payload: FactoryEventMap[K]) => void,
) {
  useEffect(() => {
    let unlisten: UnlistenFn | undefined;

    listen<FactoryEventMap[K]>(eventName, (event) => {
      handler(event.payload);
    }).then((fn) => {
      unlisten = fn;
    });

    return () => {
      unlisten?.();
    };
  }, [eventName, handler]);
}
