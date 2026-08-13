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

describe("Playback streaming append", () => {
  it("advance clamps at trace end while streaming; grows after appendChunk; pauses when complete", () => {
    const graph = packCsr(2, [], [0, 1], [0, 0]);
    const firstEvents: TraceEvent[] = [{ k: "settle", v: 0, order: 0, cost: 1 }];
    const firstChunks = chunksFromEvents(firstEvents);
    const firstChunk = firstChunks[0];
    if (firstChunk === undefined) {
      throw new Error("expected chunk from settle event");
    }

    const pb = new Playback(graph, [firstChunk]);
    expect(pb.totalWork).toBe(1);

    pb.beginStreaming();
    pb.play();
    pb.seek(pb.totalWork);

    pb.advance(1);
    expect(pb.clock.cursor).toBe(pb.totalWork);
    expect(pb.clock.playing).toBe(true);

    const tailEvents: TraceEvent[] = [{ k: "settle", v: 1, order: 1, cost: 1 }];
    const tailChunks = chunksFromEvents(tailEvents);
    const tailChunk = tailChunks[0];
    if (tailChunk === undefined) {
      throw new Error("expected chunk from tail settle event");
    }

    pb.appendChunk(tailChunk);
    expect(pb.totalWork).toBe(2);

    pb.advance(1);
    expect(pb.clock.cursor).toBe(2);
    expect(pb.clock.playing).toBe(true);
    expect(pb.state.eventIndex).toBe(2);
    expect(pb.state.settledCount).toBe(2);

    pb.markComplete();
    pb.advance(1);
    expect(pb.clock.cursor).toBe(2);
    expect(pb.clock.playing).toBe(false);
  });
});

describe("Playback findPivotsK", () => {
  it("forwards an explicit FindPivots k into TraceBuffer recurse-in state", () => {
    const graph = packCsr(5, [], [0, 1, 2, 3, 4], [0, 0, 0, 0, 0]);
    const chunks = chunksFromEvents([{ k: "recurse", dir: "in", level: 0, bound: 42 }]);
    const overrideK = 8;
    const pb = new Playback(graph, chunks, overrideK);

    pb.stepEvent();
    expect(pb.state.findPivotsK).toBe(overrideK);
  });
});
