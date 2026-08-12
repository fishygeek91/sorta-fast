import { describe, expect, it } from "vitest";

import { packCsr } from "../src/core/graph.ts";
import { type TraceEvent, TraceWriter } from "../src/core/trace.ts";
import { Playback } from "../src/harness/playback.ts";

/** Encode events into trace chunks via TraceWriter. */
function chunksFromEvents(events: readonly TraceEvent[]): ReturnType<TraceWriter["takeChunks"]> {
  const writer = new TraceWriter();
  for (const event of events) {
    writer.append(event);
  }
  return writer.takeChunks();
}

describe("Playback.stepOp", () => {
  it("advances clock cursor by one billed op through multi-cost heap events", () => {
    const graph = packCsr(2, [], [0, 1], [0, 0]);
    const events: TraceEvent[] = [
      { k: "settle", v: 0, order: 0, cost: 1 },
      { k: "heap", op: "push", cmps: 3 },
      { k: "settle", v: 1, order: 1, cost: 1 },
    ];
    const chunks = chunksFromEvents(events);

    expect(new Playback(graph, chunks).totalWork).toBe(5);
    expect(new Playback(graph, chunks).totalEvents).toBe(3);

    const pb = new Playback(graph, chunks);

    let prevCursor = pb.clock.cursor;
    for (let i = 0; i < 5; i++) {
      pb.stepOp();
      expect(pb.clock.cursor).toBeGreaterThan(prevCursor);
      prevCursor = pb.clock.cursor;
    }
    expect(pb.state.eventIndex).toBe(3);

    const stepped = new Playback(graph, chunks);

    stepped.stepOp();
    expect(stepped.state.eventIndex).toBe(1);
    expect(stepped.state.work).toBe(1);
    expect(stepped.clock.cursor).toBe(1);

    stepped.stepOp();
    expect(stepped.clock.cursor).toBe(2);
    expect(stepped.state.eventIndex).toBe(1);

    stepped.stepOp();
    stepped.stepOp();
    expect(stepped.state.eventIndex).toBe(2);
    expect(stepped.state.work).toBe(4);
    expect(stepped.clock.cursor).toBe(4);

    stepped.stepOp();
    expect(stepped.state.eventIndex).toBe(3);
    expect(stepped.state.work).toBe(5);
    expect(stepped.clock.cursor).toBe(5);

    const atEnd = stepped.clock.cursor;
    stepped.stepOp();
    expect(stepped.clock.cursor).toBe(atEnd);
    expect(stepped.clock.cursor).toBe(5);
  });
});
