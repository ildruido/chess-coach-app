// In-memory stand-in for the db capability: documents by path, collection
// queries with orderBy and limit. `failNext` makes the next calls reject.
export function fakeDb() {
  const docs = new Map<string, Record<string, unknown>>();
  const failNext: string[] = [];
  const maybeFail = async () => {
    const code = failNext.shift();
    if (code) throw { code, message: code };
  };
  const snapshot = (path: string): DbDocumentSnapshot => {
    const d = docs.get(path);
    return {
      id: path.split("/").at(-1)!,
      exists: !!d,
      data: () => (d ? structuredClone(d) : undefined),
    };
  };
  const doc = (path: string): DbDocumentReference => ({
    id: path.split("/").at(-1)!,
    path,
    get: async () => {
      await maybeFail();
      return snapshot(path);
    },
    set: async (data) => {
      await maybeFail();
      docs.set(path, structuredClone(data));
    },
    delete: async () => {
      await maybeFail();
      docs.delete(path);
    },
    collection: (sub) => collection(`${path}/${sub}`),
  });
  const query = (
    path: string,
    order?: { field: string; dir: "asc" | "desc" },
    max = 1000,
  ): DbQuery => ({
    where: () => {
      throw new Error("not faked");
    },
    orderBy: (field, dir = "asc") => query(path, { field, dir }, max),
    limit: (n) => query(path, order, n),
    get: async () => {
      await maybeFail();
      const depth = path.split("/").length + 1;
      let paths = [...docs.keys()].filter(
        (p) => p.startsWith(`${path}/`) && p.split("/").length === depth,
      );
      paths.sort();
      if (order) {
        const key = (p: string) => String(docs.get(p)![order.field] ?? "");
        paths.sort((a, b) => key(a).localeCompare(key(b)) * (order.dir === "asc" ? 1 : -1));
      }
      paths = paths.slice(0, max);
      const list = paths.map(snapshot);
      return { docs: list, size: list.length, empty: !list.length };
    },
  });
  const collection = (path: string): DbCollectionReference => ({
    ...query(path),
    path,
    doc: (id = Math.random().toString(36).slice(2)) => doc(`${path}/${id}`),
  });
  const db: DbApi = { doc, collection };
  return { db, docs, failNext };
}
