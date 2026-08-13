import { describe, expect, it } from "vitest";

import { packCsr } from "../src/core/graph.ts";
import { type TraceEvent, TraceWriter } from "../src/core/trace.ts";
import { BASE_OPS_PER_SECOND } from "../src/harness/workClock.ts";
import { UNSETTLED } from "../src/harness/laneState.ts";
import { RaceScheduler } from "../src/harness/raceScheduler.ts";
import { TraceBuffer } from "../src/harness/traceBuffer.ts";

/** Encode events into trace chunks via TraceWriter. */
function chunksFromEvents(events: readonly TraceEvent[]): ReturnType<TraceWriter["takeChunks"]> {
  const writer = new TraceWriter();
  for (const event of events) {
    writer.append(event);
  }
  return writer.takeChunks();
}

function firstChunk(events: readonly TraceEvent[]): ReturnType<TraceWriter["takeChunks"]>[number] {
  const chunks = chunksFromEvents(events);
  const chunk = chunks[0];
  if (chunk === undefined) {
    throw new Error("expected at least one chunk from events");
  }
  return chunk;
}

describe("RaceScheduler constructor", () => {
  it("rejects laneCount 1 and 4", () => {
    const graph = packCsr(2, [], [0, 1], [0, 0]);
    expect(() => new RaceScheduler(graph, 1)).toThrow(/laneCount must be 2 or 3/);
    expect(() => new RaceScheduler(graph, 4)).toThrow(/laneCount must be 2 or 3/);
  });
});

describe("RaceScheduler shared seek", () => {
  it("keeps unfinished lanes aligned on billed work at shared seek T", () => {
    const graph = packCsr(3, [], [0, 1, 2], [0, 0, 0]);

    const lane0Events: TraceEvent[] = [
      { k: "settle", v: 0, order: 0, cost: 1 },
      { k: "settle", v: 1, order: 1, cost: 1 },
      { k: "settle", v: 2, order: 2, cost: 1 },
    ];
    const lane1Events: TraceEvent[] = [
      { k: "settle", v: 0, order: 0, cost: 1 },
      { k: "settle", v: 1, order: 1, cost: 1 },
    ];

    const race = new RaceScheduler(graph, 2);
    for (const chunk of chunksFromEvents(lane0Events)) {
      race.appendChunk(0, chunk);
    }
    for (const chunk of chunksFromEvents(lane1Events)) {
      race.appendChunk(1, chunk);
    }

    expect(race.laneTotalWork(0)).toBe(3);
    expect(race.laneTotalWork(1)).toBe(2);
    expect(race.streamCap).toBe(2);

    race.seek(2);
    expect(race.appliedCursor).toBe(2);
    expect(race.laneState(0).work).toBe(2);
    expect(race.laneState(1).work).toBe(2);
    expect(race.laneState(0).eventIndex).toBe(2);
    expect(race.laneState(1).eventIndex).toBe(2);

    race.markLaneComplete(1);
    expect(race.streamCap).toBe(3);
    race.seek(3);
    expect(race.laneState(0).work).toBe(3);
    expect(race.laneState(1).work).toBe(2);
  });
});

describe("RaceScheduler stream-while-generating", () => {
  it("clamps applied work until both lanes have chunks; streamCap follows incomplete lane", () => {
    const graph = packCsr(2, [], [0, 1], [0, 0]);
    const race = new RaceScheduler(graph, 2);

    race.play();
    race.advance(1);
    expect(race.clock.cursor).toBe(BASE_OPS_PER_SECOND);
    expect(race.appliedCursor).toBe(0);
    expect(race.streamCap).toBe(0);

    const lane0First = firstChunk([{ k: "settle", v: 0, order: 0, cost: 1 }]);
    race.appendChunk(0, lane0First);
    expect(race.streamCap).toBe(0);
    expect(race.appliedCursor).toBe(0);

    const lane1First = firstChunk([{ k: "settle", v: 0, order: 0, cost: 1 }]);
    race.appendChunk(1, lane1First);
    expect(race.streamCap).toBe(1);
    expect(race.appliedCursor).toBe(1);
    expect(race.laneState(0).work).toBe(1);
    expect(race.laneState(1).work).toBe(1);

    const lane1Tail = firstChunk([{ k: "settle", v: 1, order: 1, cost: 1 }]);
    race.appendChunk(1, lane1Tail);
    expect(race.streamCap).toBe(1);
    expect(race.appliedCursor).toBe(1);

    race.markLaneComplete(0);
    expect(race.streamCap).toBe(2);
    race.seek(race.clock.cursor);
    expect(race.appliedCursor).toBe(2);
    expect(race.laneState(1).work).toBe(2);
    expect(race.laneState(0).work).toBe(1);
  });
});

describe("RaceScheduler unequal finish", () => {
  it("clamps seek to maxTotalWork and marks shorter lane finished first", () => {
    const graph = packCsr(2, [], [0, 1], [0, 0]);

    const lane0Events: TraceEvent[] = [
      { k: "settle", v: 0, order: 0, cost: 1 },
      { k: "settle", v: 1, order: 1, cost: 1 },
    ];
    const lane1Events: TraceEvent[] = [
      { k: "settle", v: 0, order: 0, cost: 1 },
      { k: "heap", op: "push", cmps: 2 },
      { k: "settle", v: 1, order: 1, cost: 1 },
      { k: "heap", op: "push", cmps: 1 },
    ];

    const race = new RaceScheduler(graph, 2);
    for (const chunk of chunksFromEvents(lane0Events)) {
      race.appendChunk(0, chunk);
    }
    for (const chunk of chunksFromEvents(lane1Events)) {
      race.appendChunk(1, chunk);
    }

    expect(race.laneTotalWork(0)).toBe(2);
    expect(race.laneTotalWork(1)).toBe(5);

    race.markLaneComplete(0);
    race.markLaneComplete(1);

    race.seek(10);
    expect(race.clock.cursor).toBe(5);
    expect(race.appliedCursor).toBe(5);
    expect(race.laneFinished(0)).toBe(true);
    expect(race.laneState(0).work).toBe(2);
    expect(race.laneState(1).work).toBe(5);
    expect(race.laneFinished(1)).toBe(true);
  });
});

describe("RaceScheduler bidirectional seek", () => {
  it("matches independent TraceBuffer seekWork after scrubbing back and forth", () => {
    const graph = packCsr(3, [], [0, 1, 2], [0, 0, 0]);
    const events: TraceEvent[] = [
      { k: "settle", v: 0, order: 0, cost: 1 },
      { k: "heap", op: "push", cmps: 2 },
      { k: "settle", v: 1, order: 1, cost: 1 },
      { k: "settle", v: 2, order: 2, cost: 1 },
    ];
    const chunks = chunksFromEvents(events);

    const race = new RaceScheduler(graph, 2);
    for (const chunk of chunks) {
      race.appendChunk(0, chunk);
      race.appendChunk(1, chunk);
    }
    race.markLaneComplete(0);
    race.markLaneComplete(1);

    const ref0 = new TraceBuffer(graph, chunks);
    const ref1 = new TraceBuffer(graph, chunks);

    const mid = 3;
    race.seek(mid);
    ref0.seekWork(mid);
    ref1.seekWork(mid);

    expect(race.laneState(0).eventIndex).toBe(ref0.state.eventIndex);
    expect(race.laneState(0).work).toBe(ref0.state.work);
    expect(race.laneState(0).settleOrder[0]).toBe(ref0.state.settleOrder[0]);
    expect(race.laneState(0).settleOrder[1]).toBe(ref0.state.settleOrder[1]);

    race.seek(0);
    ref0.seekWork(0);
    ref1.seekWork(0);
    expect(race.laneState(0).eventIndex).toBe(0);
    expect(race.laneState(1).eventIndex).toBe(0);

    race.seek(mid);
    ref0.seekWork(mid);
    ref1.seekWork(mid);
    expect(race.laneState(0).eventIndex).toBe(ref0.state.eventIndex);
    expect(race.laneState(1).eventIndex).toBe(ref1.state.eventIndex);
    expect(race.laneState(0).work).toBe(ref0.state.work);
    expect(race.laneState(1).work).toBe(ref1.state.work);
  });
});

describe("RaceScheduler.stepOp", () => {
  it("increments applied work by 1 when work is available", () => {
    const graph = packCsr(2, [], [0, 1], [0, 0]);
    const events: TraceEvent[] = [
      { k: "settle", v: 0, order: 0, cost: 1 },
      { k: "heap", op: "push", cmps: 3 },
      { k: "settle", v: 1, order: 1, cost: 1 },
    ];
    const chunks = chunksFromEvents(events);

    const race = new RaceScheduler(graph, 2);
    for (const chunk of chunks) {
      race.appendChunk(0, chunk);
      race.appendChunk(1, chunk);
    }
    race.markLaneComplete(0);
    race.markLaneComplete(1);

    expect(race.appliedCursor).toBe(0);

    race.stepOp();
    expect(race.appliedCursor).toBe(1);
    expect(race.laneState(0).work).toBe(1);
    expect(race.laneState(0).eventIndex).toBe(1);

    race.stepOp();
    expect(race.appliedCursor).toBe(2);
    expect(race.laneState(0).eventIndex).toBe(1);

    race.stepOp();
    race.stepOp();
    expect(race.appliedCursor).toBe(4);
    expect(race.laneState(0).eventIndex).toBe(2);

    race.stepOp();
    expect(race.appliedCursor).toBe(5);
    expect(race.laneState(0).work).toBe(5);
  });
});

describe("RaceScheduler photo-finish freeze", () => {
  it("caps lane work at settleWork[finish] when finish vertex is set", () => {
    const graph = packCsr(3, [], [0, 1, 2], [0, 0, 0]);

    const lane0Events: TraceEvent[] = [
      { k: "settle", v: 0, order: 0, cost: 1 },
      { k: "settle", v: 1, order: 1, cost: 1 },
      { k: "settle", v: 2, order: 2, cost: 1 },
    ];
    const lane1Events: TraceEvent[] = [
      { k: "settle", v: 0, order: 0, cost: 1 },
      { k: "settle", v: 1, order: 1, cost: 1 },
    ];

    const race = new RaceScheduler(graph, 2);
    for (const chunk of chunksFromEvents(lane0Events)) {
      race.appendChunk(0, chunk);
    }
    for (const chunk of chunksFromEvents(lane1Events)) {
      race.appendChunk(1, chunk);
    }

    race.setFinishVertex(1);
    race.markLaneComplete(0);
    race.markLaneComplete(1);

    race.seek(10);

    const lane0 = race.laneState(0);
    const lane1 = race.laneState(1);
    expect(lane0.settleWork[1]).toBe(2);
    expect(lane1.settleWork[1]).toBe(2);
    expect(lane0.work).toBe(lane0.settleWork[1]);
    expect(lane1.work).toBe(lane1.settleWork[1]);
    expect(lane0.work).toBe(2);
    expect(lane0.work).not.toBe(race.laneTotalWork(0));
    expect(race.lanePhotoFrozen(0)).toBe(true);
    expect(race.lanePhotoFrozen(1)).toBe(true);
    expect(race.allPhotoFrozen()).toBe(true);
  });

  it("unfreezes finish vertex when scrubbing back before the settle", () => {
    const graph = packCsr(3, [], [0, 1, 2], [0, 0, 0]);

    const lane0Events: TraceEvent[] = [
      { k: "settle", v: 0, order: 0, cost: 1 },
      { k: "settle", v: 1, order: 1, cost: 1 },
      { k: "settle", v: 2, order: 2, cost: 1 },
    ];
    const lane1Events: TraceEvent[] = [
      { k: "settle", v: 0, order: 0, cost: 1 },
      { k: "settle", v: 1, order: 1, cost: 1 },
    ];

    const race = new RaceScheduler(graph, 2);
    for (const chunk of chunksFromEvents(lane0Events)) {
      race.appendChunk(0, chunk);
    }
    for (const chunk of chunksFromEvents(lane1Events)) {
      race.appendChunk(1, chunk);
    }

    race.setFinishVertex(1);
    race.markLaneComplete(0);
    race.markLaneComplete(1);
    race.seek(10);
    expect(race.allPhotoFrozen()).toBe(true);

    race.seek(0);
    expect(race.laneState(0).settleOrder[1]).toBe(UNSETTLED);
    expect(race.laneState(1).settleOrder[1]).toBe(UNSETTLED);
    expect(race.lanePhotoFrozen(0)).toBe(false);
    expect(race.lanePhotoFrozen(1)).toBe(false);
    expect(race.allPhotoFrozen()).toBe(false);
  });

  it("applies full traces when finish vertex is unset", () => {
    const graph = packCsr(2, [], [0, 1], [0, 0]);

    const lane0Events: TraceEvent[] = [
      { k: "settle", v: 0, order: 0, cost: 1 },
      { k: "settle", v: 1, order: 1, cost: 1 },
    ];
    const lane1Events: TraceEvent[] = [
      { k: "settle", v: 0, order: 0, cost: 1 },
      { k: "heap", op: "push", cmps: 2 },
      { k: "settle", v: 1, order: 1, cost: 1 },
      { k: "heap", op: "push", cmps: 1 },
    ];

    const race = new RaceScheduler(graph, 2);
    for (const chunk of chunksFromEvents(lane0Events)) {
      race.appendChunk(0, chunk);
    }
    for (const chunk of chunksFromEvents(lane1Events)) {
      race.appendChunk(1, chunk);
    }

    race.markLaneComplete(0);
    race.markLaneComplete(1);
    expect(race.finishVertex).toBeNull();

    race.seek(10);
    expect(race.clock.cursor).toBe(5);
    expect(race.appliedCursor).toBe(5);
    expect(race.laneState(0).work).toBe(2);
    expect(race.laneState(1).work).toBe(5);
    expect(race.laneFinished(0)).toBe(true);
    expect(race.laneFinished(1)).toBe(true);
    expect(race.allPhotoFrozen()).toBe(false);
  });

  it("rejects out-of-range finish vertex", () => {
    const graph = packCsr(2, [], [0, 1], [0, 0]);
    const race = new RaceScheduler(graph, 2);
    expect(() => race.setFinishVertex(-1)).toThrow(/finish vertex must be an integer/);
    expect(() => race.setFinishVertex(2)).toThrow(/finish vertex must be an integer/);
    expect(() => race.setFinishVertex(1.5)).toThrow(/finish vertex must be an integer/);
  });
});

describe("TraceBuffer.nextEventWork", () => {
  it("returns cumulative work of the next unapplied event", () => {
    const graph = packCsr(2, [], [0, 1], [0, 0]);
    const events: TraceEvent[] = [
      { k: "settle", v: 0, order: 0, cost: 1 },
      { k: "heap", op: "push", cmps: 2 },
    ];
    const chunks = chunksFromEvents(events);
    const buffer = new TraceBuffer(graph, chunks);

    expect(buffer.nextEventWork()).toBe(1);
    buffer.seekWork(1);
    expect(buffer.nextEventWork()).toBe(3);
    buffer.seekWork(3);
    expect(buffer.nextEventWork()).toBeNull();
  });
});
