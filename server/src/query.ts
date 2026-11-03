// Builds the SQL for POST /api/db/query. Every value is a bound parameter; field names are
// restricted to a safe charset and passed as a text[] path, never spliced into the SQL.

const FIELD = /^[A-Za-z0-9_-]{1,64}$/;
const MAX_FIELD_DEPTH = 4;
const MAX_WHERE = 5;
const MAX_IN = 50;
const MAX_LIMIT = 1000;

export class QueryError extends Error {}

export interface QueryRequest {
  where?: { field: string; op: string; value: unknown }[];
  orderBy?: { field: string; dir?: "asc" | "desc" };
  limit?: number;
}

const COMPARE: Record<string, string> = {
  "==": "=",
  "=": "=",
  "!=": "<>",
  "<": "<",
  "<=": "<=",
  ">": ">",
  ">=": ">=",
};

function fieldPath(field: unknown): string[] {
  if (typeof field !== "string") throw new QueryError("field must be a string");
  const parts = field.split(".");
  if (parts.length > MAX_FIELD_DEPTH || parts.some((p) => !FIELD.test(p))) {
    throw new QueryError("invalid field name");
  }
  return parts;
}

/** Documents missing a filtered or ordered field never match (the rule the page's db interface expects, docs/API.md). */
export function buildQuery(parent: string, q: QueryRequest): { text: string; values: unknown[] } {
  const values: unknown[] = [parent];
  const param = (v: unknown) => {
    values.push(v);
    return `$${values.length}`;
  };
  const conds = ["parent = $1"];

  const where = q.where ?? [];
  if (!Array.isArray(where) || where.length > MAX_WHERE)
    throw new QueryError("too many where clauses");
  for (const w of where) {
    if (typeof w !== "object" || w === null) throw new QueryError("invalid where clause");
    const col = `data #> ${param(fieldPath(w.field))}::text[]`;
    if (Object.hasOwn(COMPARE, w.op)) {
      if (w.value === undefined) throw new QueryError("where needs a value");
      const value = param(JSON.stringify(w.value));
      conds.push(`${col} ${COMPARE[w.op]} ${value}::jsonb`);
      // Ranges only compare like with like (jsonb would otherwise rank every string below every number).
      if (!["==", "=", "!="].includes(w.op))
        conds.push(`jsonb_typeof(${col}) = jsonb_typeof(${value}::jsonb)`);
    } else if (w.op === "in") {
      if (!Array.isArray(w.value) || w.value.length > MAX_IN)
        throw new QueryError("in needs a short array");
      conds.push(`${col} = ANY(${param(w.value.map((v) => JSON.stringify(v)))}::jsonb[])`);
    } else if (w.op === "array-contains") {
      conds.push(`${col} @> ${param(JSON.stringify([w.value]))}::jsonb`);
    } else {
      throw new QueryError("unsupported operator");
    }
  }

  let order = "id ASC";
  if (q.orderBy !== undefined) {
    if (typeof q.orderBy !== "object" || q.orderBy === null)
      throw new QueryError("invalid orderBy");
    const dir = q.orderBy.dir === "desc" ? "DESC" : "ASC";
    if (q.orderBy.dir !== undefined && q.orderBy.dir !== "asc" && q.orderBy.dir !== "desc") {
      throw new QueryError("dir must be asc or desc");
    }
    const col = `data #> ${param(fieldPath(q.orderBy.field))}::text[]`;
    conds.push(`${col} IS NOT NULL`);
    order = `${col} ${dir}, id ASC`;
  }

  const limit = q.limit ?? MAX_LIMIT;
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_LIMIT)
    throw new QueryError("limit must be 1 to 1000");

  return {
    text: `SELECT id, data FROM documents WHERE ${conds.join(" AND ")} ORDER BY ${order} LIMIT ${limit}`,
    values,
  };
}
