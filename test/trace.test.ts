import { describe, expect, it } from "vitest";

import {
  allocateChunk,
  costOf,
  decodeAt,
  DEFAULT_CHUNK_CAPACITY,
  encode,
  encodeChecked,
  OP_COST,
  scanCosts,
  SENTINEL,
  sliceChunk,
  tally,
  transferables,
  type TraceChunk,
  type TraceEvent,
  TraceWriter,
} from "../src/core/trace.ts";

/** Encode a single event into a one-row chunk for round-trip tests. */
function encodeOne(event: TraceEvent): TraceChunk {
  const slab = allocateChunk(1);
  encode(slab, 0, event);
  return { ...slab, count: 1 };
}

describe("encode / decodeAt round-trip", () => {
  it("relax with improved true", () => {
    const original: TraceEvent = { k: "relax", e: 7, improved: true, cost: 1 };
    expect(decodeAt(encodeOne(original), 0)).toEqual({
      k: "relax",
      e: 7,
      improved: true,
      cost: 1,
    });
  });

  it("relax with improved false", () => {
    const original: TraceEvent = { k: "relax", e: 3, improved: false, cost: 1 };
    expect(decodeAt(encodeOne(original), 0)).toEqual({
      k: "relax",
      e: 3,
      improved: false,
      cost: 1,
    });
  });

  it("settle", () => {
    const original: TraceEvent = { k: "settle", v: 2, order: 5, cost: 1 };
    expect(decodeAt(encodeOne(original), 0)).toEqual({
      k: "settle",
      v: 2,
      order: 5,
      cost: 1,
    });
  });

  it("heap push with cmps", () => {
    const original: TraceEvent = { k: "heap", op: "push", cmps: 4 };
    expect(decodeAt(encodeOne(original), 0)).toEqual(original);
  });

  it("heap popmin with zero cmps", () => {
    const original: TraceEvent = { k: "heap", op: "popmin", cmps: 0 };
    expect(decodeAt(encodeOne(original), 0)).toEqual(original);
  });

  it("heap sift with cmps", () => {
    const original: TraceEvent = { k: "heap", op: "sift", cmps: 2 };
    expect(decodeAt(encodeOne(original), 0)).toEqual(original);
  });

  it("pivot", () => {
    const original: TraceEvent = { k: "pivot", v: 1, level: 3 };
    expect(decodeAt(encodeOne(original), 0)).toEqual(original);
  });

  it("batch start", () => {
    const original: TraceEvent = { k: "batch", phase: "start", level: 2, size: 16 };
    expect(decodeAt(encodeOne(original), 0)).toEqual(original);
  });

  it("batch end", () => {
    const original: TraceEvent = { k: "batch", phase: "end", level: 0, size: 0 };
    expect(decodeAt(encodeOne(original), 0)).toEqual(original);
  });

  it("recurse with finite bound", () => {
    const original: TraceEvent = { k: "recurse", dir: "in", level: 4, bound: 12.5 };
    expect(decodeAt(encodeOne(original), 0)).toEqual(original);
  });

  it("recurse with bound Infinity", () => {
    const original: TraceEvent = { k: "recurse", dir: "out", level: 1, bound: Infinity };
    expect(decodeAt(encodeOne(original), 0)).toEqual(original);
  });

  it("forest grow", () => {
    const original: TraceEvent = { k: "forest", op: "grow", e: 9, tree: 0 };
    expect(decodeAt(encodeOne(original), 0)).toEqual(original);
  });

  it("forest cut", () => {
    const original: TraceEvent = { k: "forest", op: "cut", e: 4, tree: 2 };
    expect(decodeAt(encodeOne(original), 0)).toEqual(original);
  });

  it("dstruct insert", () => {
    const original: TraceEvent = { k: "dstruct", op: "insert", n: 1, cmps: 3 };
    expect(decodeAt(encodeOne(original), 0)).toEqual(original);
  });

  it("dstruct batchPrepend", () => {
    const original: TraceEvent = { k: "dstruct", op: "batchPrepend", n: 8, cmps: 0 };
    expect(decodeAt(encodeOne(original), 0)).toEqual(original);
  });

  it("dstruct pull", () => {
    const original: TraceEvent = { k: "dstruct", op: "pull", n: 2, cmps: 5 };
    expect(decodeAt(encodeOne(original), 0)).toEqual(original);
  });

  it("dstruct merge", () => {
    const original: TraceEvent = { k: "dstruct", op: "merge", n: 6, cmps: 4 };
    expect(decodeAt(encodeOne(original), 0)).toEqual(original);
  });
});

describe("costOf and tally", () => {
  const mixedEvents: TraceEvent[] = [
    { k: "relax", e: 0, improved: true, cost: 1 },
    { k: "settle", v: 0, order: 0, cost: 1 },
    { k: "heap", op: "sift", cmps: 4 },
    { k: "pivot", v: 1, level: 0 },
    { k: "batch", phase: "start", level: 1, size: 4 },
    { k: "recurse", dir: "out", level: 2, bound: 10 },
    { k: "forest", op: "grow", e: 3, tree: 1 },
    { k: "dstruct", op: "pull", n: 3, cmps: 5 },
  ];

  function encodeAll(events: TraceEvent[]): TraceChunk {
    const slab = allocateChunk(events.length);
    for (let i = 0; i < events.length; i += 1) {
      const event = events[i];
      if (event === undefined) {
        throw new Error(`missing event at index ${i}`);
      }
      encode(slab, i, event);
    }
    return sliceChunk({ ...slab, count: events.length }, events.length);
  }

  it("costOf matches OP_COST for each event in a mixed sequence", () => {
    const expectedCosts = [1, 1, 4, 0, 0, 0, 0, 5];
    for (let i = 0; i < mixedEvents.length; i += 1) {
      const event = mixedEvents[i];
      const expected = expectedCosts[i];
      if (event === undefined || expected === undefined) {
        throw new Error(`missing fixture at index ${i}`);
      }
      expect(costOf(event)).toBe(expected);
    }
  });

  it("tally aggregates work and kind counts for a mixed sequence", () => {
    const chunk = encodeAll(mixedEvents);
    const result = tally(chunk);

    expect(result.work).toBe(11);
    expect(result.relaxations).toBe(1);
    expect(result.settles).toBe(1);
    expect(result.heapOps).toBe(1);
    expect(result.pivots).toBe(1);
    expect(result.batches).toBe(1);
    expect(result.recurses).toBe(1);
    expect(result.forests).toBe(1);
    expect(result.dstructOps).toBe(1);
  });

  it("scanCosts equals tally", () => {
    const chunk = encodeAll(mixedEvents);
    expect(scanCosts(chunk)).toEqual(tally(chunk));
  });

  it("encode writes cost from OP_COST table, not from event payload", () => {
    const slab = allocateChunk(1);
    encode(slab, 0, { k: "relax", e: 0, improved: false, cost: 1 });
    const cost = slab.cost[0];
    if (cost === undefined) {
      throw new Error("missing cost column");
    }
    expect(cost).toBe(OP_COST.relax);
    expect(cost).toBe(1);
  });
});

describe("encode validation", () => {
  it("rejects negative heap cmps", () => {
    const chunk = allocateChunk(1);
    expect(() => encodeChecked(chunk, 0, { k: "heap", op: "push", cmps: -1 })).toThrow(
      /cmps must be a non-negative integer/,
    );
  });

  it("rejects negative settle order", () => {
    const chunk = allocateChunk(1);
    expect(() => encodeChecked(chunk, 0, { k: "settle", v: 0, order: -1, cost: 1 })).toThrow(
      /order must be a non-negative integer/,
    );
  });

  it("rejects negative pivot level", () => {
    const chunk = allocateChunk(1);
    expect(() => encodeChecked(chunk, 0, { k: "pivot", v: 0, level: -2 })).toThrow(
      /level must be a non-negative integer/,
    );
  });

  it("rejects negative batch level and size", () => {
    const chunk = allocateChunk(2);
    expect(() =>
      encodeChecked(chunk, 0, { k: "batch", phase: "start", level: -1, size: 0 }),
    ).toThrow(/level must be a non-negative integer/);
    expect(() => encodeChecked(chunk, 1, { k: "batch", phase: "end", level: 0, size: -3 })).toThrow(
      /size must be a non-negative integer/,
    );
  });

  it("rejects negative dstruct n and cmps", () => {
    const chunk = allocateChunk(2);
    expect(() => encodeChecked(chunk, 0, { k: "dstruct", op: "insert", n: -1, cmps: 0 })).toThrow(
      /n must be a non-negative integer/,
    );
    expect(() => encodeChecked(chunk, 1, { k: "dstruct", op: "pull", n: 1, cmps: -2 })).toThrow(
      /cmps must be a non-negative integer/,
    );
  });

  it("rejects negative forest tree", () => {
    const chunk = allocateChunk(1);
    expect(() => encodeChecked(chunk, 0, { k: "forest", op: "cut", e: 0, tree: -1 })).toThrow(
      /tree must be a non-negative integer/,
    );
  });

  it("rejects recurse bound NaN", () => {
    const chunk = allocateChunk(1);
    expect(() =>
      encodeChecked(chunk, 0, { k: "recurse", dir: "in", level: 0, bound: Number.NaN }),
    ).toThrow(/bound must be finite or Infinity/);
  });

  it("rejects recurse bound -Infinity", () => {
    const chunk = allocateChunk(1);
    expect(() =>
      encodeChecked(chunk, 0, { k: "recurse", dir: "out", level: 0, bound: -Infinity }),
    ).toThrow(/bound must be finite or Infinity/);
  });
});

describe("decodeAt validation", () => {
  it("rejects out-of-range index", () => {
    const chunk = encodeOne({ k: "pivot", v: 0, level: 0 });
    expect(() => decodeAt(chunk, -1)).toThrow(/out of range/);
    expect(() => decodeAt(chunk, 1)).toThrow(/out of range/);
  });

  it("rejects unknown kind code", () => {
    const chunk = encodeOne({ k: "relax", e: 0, improved: true, cost: 1 });
    chunk.kind[0] = 99;
    expect(() => decodeAt(chunk, 0)).toThrow(/unknown trace kind 99/);
  });

  it("rejects detached chunk buffers", () => {
    const writer = new TraceWriter(2);
    writer.append({ k: "pivot", v: 0, level: 0 });
    const chunk = writer.takeChunks()[0];
    if (chunk === undefined) {
      throw new Error("missing chunk");
    }
    structuredClone(chunk, { transfer: transferables(chunk) });
    expect(() => decodeAt(chunk, 0)).toThrow(/chunk buffers detached/);
  });
});

describe("allocateChunk", () => {
  it("rejects capacity 0", () => {
    expect(() => allocateChunk(0)).toThrow(/capacity must be an integer >= 1/);
  });
});

/** Decode every event stored in one or more chunks (order preserved). */
function decodeAll(chunks: TraceChunk[]): TraceEvent[] {
  const events: TraceEvent[] = [];
  for (const chunk of chunks) {
    for (let i = 0; i < chunk.count; i += 1) {
      events.push(decodeAt(chunk, i));
    }
  }
  return events;
}

/** Sum row counts across chunks. */
function totalCount(chunks: TraceChunk[]): number {
  return chunks.reduce((sum, chunk) => sum + chunk.count, 0);
}

/** Assert every SoA column length matches {@link TraceChunk.count}. */
function expectChunkColumnsRightSized(chunk: TraceChunk): void {
  expect(chunk.kind.length).toBe(chunk.count);
  expect(chunk.vertex.length).toBe(chunk.count);
  expect(chunk.edge.length).toBe(chunk.count);
  expect(chunk.aux0.length).toBe(chunk.count);
  expect(chunk.aux1.length).toBe(chunk.count);
  expect(chunk.aux2.length).toBe(chunk.count);
  expect(chunk.auxF.length).toBe(chunk.count);
  expect(chunk.cost.length).toBe(chunk.count);
}

describe("TraceWriter", () => {
  it("defaults chunk capacity to DEFAULT_CHUNK_CAPACITY", () => {
    const writer = new TraceWriter();
    expect(DEFAULT_CHUNK_CAPACITY).toBe(65536);
    for (let i = 0; i < 3; i += 1) {
      writer.append({ k: "pivot", v: i, level: i });
    }
    const chunks = writer.takeChunks();
    expect(chunks).toHaveLength(1);
    const chunk = chunks[0];
    if (chunk === undefined) {
      throw new Error("missing chunk");
    }
    expect(chunk.count).toBe(3);
    expectChunkColumnsRightSized(chunk);
  });

  it("partial flush right-sizes column arrays to count", () => {
    const capacity = 8;
    const writer = new TraceWriter(capacity);
    for (let i = 0; i < 3; i += 1) {
      writer.append({ k: "pivot", v: i, level: i });
    }
    const chunk = writer.takeChunks()[0];
    if (chunk === undefined) {
      throw new Error("missing partial chunk");
    }
    expect(chunk.count).toBe(3);
    expectChunkColumnsRightSized(chunk);
  });

  it("full slab freeze keeps zero-copy capacity-length columns", () => {
    const capacity = 4;
    const writer = new TraceWriter(capacity);
    for (let i = 0; i < capacity; i += 1) {
      writer.append({ k: "heap", op: "push", cmps: i });
    }
    const chunk = writer.takeChunks()[0];
    if (chunk === undefined) {
      throw new Error("missing full chunk");
    }
    expect(chunk.count).toBe(capacity);
    expect(chunk.kind.length).toBe(capacity);
    expect(chunk.vertex.length).toBe(capacity);
    expect(chunk.edge.length).toBe(capacity);
    expect(chunk.aux0.length).toBe(capacity);
    expect(chunk.aux1.length).toBe(capacity);
    expect(chunk.aux2.length).toBe(capacity);
    expect(chunk.auxF.length).toBe(capacity);
    expect(chunk.cost.length).toBe(capacity);
  });

  it("rotates full slabs and keeps remainder when capacity is 3", () => {
    const writer = new TraceWriter(3);
    for (let i = 0; i < 7; i += 1) {
      writer.append({ k: "heap", op: "push", cmps: i });
    }
    const chunks = writer.takeChunks();
    const total = chunks.reduce((sum, c) => sum + c.count, 0);
    expect(total).toBe(7);
    expect(chunks.some((c) => c.count === 3)).toBe(true);
    expect(chunks.some((c) => c.count === 1)).toBe(true);
  });

  it("takeChunks on empty writer returns []", () => {
    const writer = new TraceWriter(3);
    expect(writer.takeChunks()).toEqual([]);
  });

  it("takeChunks twice returns only newly appended events", () => {
    const writer = new TraceWriter(3);
    writer.append({ k: "relax", e: 0, improved: true, cost: 1 });
    writer.append({ k: "relax", e: 1, improved: false, cost: 1 });
    const first = writer.takeChunks();
    expect(first.reduce((sum, c) => sum + c.count, 0)).toBe(2);

    writer.append({ k: "settle", v: 0, order: 0, cost: 1 });
    const second = writer.takeChunks();
    expect(second.reduce((sum, c) => sum + c.count, 0)).toBe(1);
    const secondChunk = second[0];
    if (secondChunk === undefined) {
      throw new Error("missing second chunk");
    }
    expect(decodeAt(secondChunk, 0)).toEqual({
      k: "settle",
      v: 0,
      order: 0,
      cost: 1,
    });
  });

  it("rejects chunkCapacity 0", () => {
    expect(() => new TraceWriter(0)).toThrow(/chunkCapacity must be an integer >= 1/);
  });

  it("transferables returns eight distinct ArrayBuffers per chunk", () => {
    const writer = new TraceWriter(2);
    writer.append({ k: "heap", op: "sift", cmps: 1 });
    writer.append({ k: "heap", op: "popmin", cmps: 0 });
    const chunk = writer.takeChunks()[0];
    if (chunk === undefined) {
      throw new Error("missing chunk");
    }
    const buffers = transferables(chunk);
    expect(buffers).toHaveLength(8);
    const unique = new Set(buffers);
    expect(unique.size).toBe(8);
  });

  it("still accepts appends after takeChunks and structuredClone transfer", () => {
    const writer = new TraceWriter(2);
    writer.append({ k: "pivot", v: 0, level: 0 });
    writer.append({ k: "pivot", v: 1, level: 1 });
    const chunks = writer.takeChunks();
    const chunk = chunks[0];
    if (chunk === undefined) {
      throw new Error("missing chunk");
    }
    const buffers = transferables(chunk);
    structuredClone(chunk, { transfer: buffers });

    writer.append({ k: "forest", op: "grow", e: 5, tree: 0 });
    const after = writer.takeChunks();
    expect(after.reduce((sum, c) => sum + c.count, 0)).toBe(1);
    const next = after[0];
    if (next === undefined) {
      throw new Error("missing chunk after transfer");
    }
    expect(decodeAt(next, 0)).toEqual({ k: "forest", op: "grow", e: 5, tree: 0 });
  });

  describe("drainCompleted", () => {
    it("returns [] for a partial slab and leaves takeChunks to flush it", () => {
      const capacity = 2;
      const writer = new TraceWriter(capacity);
      writer.append({ k: "heap", op: "push", cmps: 0 });

      expect(writer.drainCompleted()).toEqual([]);

      const remainder = writer.takeChunks();
      expect(remainder).toHaveLength(1);
      const chunk = remainder[0];
      if (chunk === undefined) {
        throw new Error("missing partial chunk");
      }
      expect(chunk.count).toBe(1);
      expect(decodeAt(chunk, 0)).toEqual({ k: "heap", op: "push", cmps: 0 });
    });

    it("returns only full slabs; takeChunks later yields the partial remainder", () => {
      const capacity = 2;
      const events: TraceEvent[] = [
        { k: "heap", op: "push", cmps: 0 },
        { k: "heap", op: "sift", cmps: 1 },
        { k: "heap", op: "popmin", cmps: 2 },
        { k: "heap", op: "push", cmps: 3 },
        { k: "heap", op: "sift", cmps: 4 },
      ];

      const writer = new TraceWriter(capacity);
      for (const event of events) {
        writer.append(event);
      }

      const drained = writer.drainCompleted();
      expect(drained).toHaveLength(2);
      for (const chunk of drained) {
        expect(chunk.count).toBe(capacity);
      }

      const remainder = writer.takeChunks();
      expect(remainder).toHaveLength(1);
      const partial = remainder[0];
      if (partial === undefined) {
        throw new Error("missing partial chunk");
      }
      expect(partial.count).toBe(1);

      const baseline = new TraceWriter(capacity);
      for (const event of events) {
        baseline.append(event);
      }
      const baselineChunks = baseline.takeChunks();

      expect(decodeAll([...drained, ...remainder])).toEqual(decodeAll(baselineChunks));
      expect(totalCount(drained) + totalCount(remainder)).toBe(totalCount(baselineChunks));
    });

    it("returns [] on a second drain when no new full slabs rotated", () => {
      const capacity = 2;
      const writer = new TraceWriter(capacity);
      writer.append({ k: "pivot", v: 0, level: 0 });
      writer.append({ k: "pivot", v: 1, level: 1 });

      const first = writer.drainCompleted();
      expect(first).toHaveLength(1);
      expect(first[0]?.count).toBe(capacity);

      expect(writer.drainCompleted()).toEqual([]);

      writer.append({ k: "pivot", v: 2, level: 2 });
      expect(writer.drainCompleted()).toEqual([]);

      const tail = writer.takeChunks();
      expect(totalCount(tail)).toBe(1);
    });
  });
});

describe("unused columns", () => {
  it("heap encode sets vertex and edge to SENTINEL", () => {
    const chunk = encodeOne({ k: "heap", op: "push", cmps: 2 });
    const vertex = chunk.vertex[0];
    const edge = chunk.edge[0];
    if (vertex === undefined || edge === undefined) {
      throw new Error("missing column at index 0");
    }
    expect(vertex).toBe(SENTINEL);
    expect(edge).toBe(SENTINEL);
  });
});
