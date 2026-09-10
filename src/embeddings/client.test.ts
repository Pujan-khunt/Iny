import { describe, it, expect } from "vitest";
import { cosineSimilarity } from "./client.js";

describe("cosineSimilarity", () => {
  it("Identical vectors return 1.0", () => {
    expect(cosineSimilarity([1, 2, 3], [1, 2, 3])).toBeCloseTo(1.0);
  });

  it("Orthogonal vectors return 0.0", () => {
    expect(cosineSimilarity([1, 0, 0], [0, 1, 0])).toBeCloseTo(0.0);
  });

  it("Anti-parallel vectors return -1.0", () => {
    expect(cosineSimilarity([1, 1], [-1, -1])).toBeCloseTo(-1.0);
  });

  it("Zero vector returns 0", () => {
    expect(cosineSimilarity([0, 0], [1, 1])).toBe(0);
    expect(cosineSimilarity([1, 1], [0, 0])).toBe(0);
  });

  it("Known similarity value", () => {
    expect(cosineSimilarity([1, 0], [1, 1])).toBeCloseTo(0.7071);
  });

  it("Different length vectors (edge case)", () => {
    const res = cosineSimilarity([1, 0], [1, 0, 1]); 
    expect(res).toBeCloseTo(1.0);
  });
});
