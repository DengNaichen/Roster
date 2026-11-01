import { describe, expect, it } from "vitest";
import { createWriteQueue } from "./api";
describe("issue write queue", () => {
  it("serializes same-issue writes and continues after failure", async () => {
    const queue = createWriteQueue();
    const order: string[] = [];
    let release!: () => void;
    let started!: () => void;
    const began = new Promise<void>((r) => started = r);
    const gate = new Promise<void>((r) => release = r);
    const a = queue("a", async () => {
      order.push("first");
      started();
      await gate;
      throw Error("failed");
    });
    const b = queue("a", async () => {
      order.push("second");
      return 2;
    });
    await began;
    expect(order).toEqual(["first"]);
    release();
    await expect(a).rejects.toThrow("failed");
    await expect(b).resolves.toBe(2);
    expect(order).toEqual(["first", "second"]);
  });
  it("does not block another issue", async () => {
    const queue = createWriteQueue();
    let release!: () => void;
    const gate = new Promise<void>((r) => release = r);
    const a = queue("a", () => gate);
    await expect(queue("b", async () => 3)).resolves.toBe(3);
    release();
    await a;
  });
});
