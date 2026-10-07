import type { NextRequest } from "next/server";
import { syncPlace } from "@/lib/reviews/sync";
import type { SyncEvent } from "@/lib/reviews/types";

export const maxDuration = 300;

/** Streams one time-boxed sync slice as NDJSON; the client repeats it until the event `done` says complete. */
export async function POST(req: NextRequest) {
  const id = req.nextUrl.searchParams.get("id") ?? "";
  const refresh = req.nextUrl.searchParams.get("refresh") === "1";
  const encoder = new TextEncoder();
  let aborted = false;
  req.signal.addEventListener("abort", () => {
    aborted = true;
  });

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const emit = (event: SyncEvent) => {
        if (aborted) return;
        try {
          controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
        } catch {
          // client went away
        }
      };
      try {
        await syncPlace(id, refresh, emit, () => aborted);
      } catch (err) {
        emit({ type: "error", message: err instanceof Error ? err.message : "Sync failed" });
      } finally {
        try {
          controller.close();
        } catch {
          // already closed
        }
      }
    },
    cancel() {
      aborted = true;
    },
  });

  return new Response(stream, {
    headers: { "Content-Type": "application/x-ndjson; charset=utf-8", "Cache-Control": "no-cache, no-transform", "X-Accel-Buffering": "no" },
  });
}
