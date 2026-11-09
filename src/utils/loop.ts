import { logger } from "../logger";

/** Stops a loop started with `startLoop`. */
export type StopLoop = () => void;

/**
 * Runs a background job every `intervalMs`, the one way every Threadwise loop is started.
 * Only one tick runs at a time (a slow tick makes later ones skip, not pile up). A tick that
 * throws is logged and the loop carries on, so a database blip cannot crash the process.
 * The timer is unref'd so it never keeps Node alive on its own. Returns a stop function.
 */
export function startLoop(
  name: string,
  intervalMs: number,
  tick: () => unknown,
  options: { runImmediately?: boolean } = {}
): StopLoop {
  let running = false;
  const run = async () => {
    if (running) return;
    running = true;
    try {
      await tick();
    } catch (error) {
      logger.error(`${name} loop failed.`, { error: String(error) });
    } finally {
      running = false;
    }
  };
  if (options.runImmediately) void run();
  const timer = setInterval(() => void run(), intervalMs);
  timer.unref?.();
  return () => clearInterval(timer);
}
