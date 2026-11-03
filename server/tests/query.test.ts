import { describe, expect, it } from "vitest";
import { QueryError, buildQuery } from "../src/query.js";

describe("buildQuery", () => {
  it("binds every value and never splices input into the SQL", () => {
    const q = buildQuery("c/x/y", {
      where: [{ field: "a.b", op: "==", value: "'; DROP TABLE documents; --" }],
      orderBy: { field: "createdAt", dir: "desc" },
      limit: 5,
    });
    expect(q.text).not.toContain("DROP");
    expect(q.text).toContain("DESC");
    expect(q.values[0]).toBe("c/x/y");
    expect(q.values).toContainEqual(["a", "b"]);
  });

  it("rejects bad input", () => {
    const bad = [
      { where: [{ field: "a;b", op: "==", value: 1 }] },
      { where: [{ field: "a", op: "LIKE", value: 1 }] },
      { where: [{ field: "a", op: "in", value: "x" }] },
      { where: Array(6).fill({ field: "a", op: "==", value: 1 }) },
      { orderBy: { field: "a", dir: "sideways" as "asc" } },
      { where: [{ field: "a", op: "constructor", value: 1 }] },
      { where: [{ field: "a", op: "__proto__", value: 1 }] },
      { orderBy: null as unknown as undefined },
      { limit: 0 },
      { limit: 1001 },
      { limit: 1.5 },
    ];
    for (const q of bad) expect(() => buildQuery("c", q), JSON.stringify(q)).toThrow(QueryError);
  });
});
