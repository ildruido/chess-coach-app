-- One generic table of JSON documents; the path is the primary key.
-- `parent` is the collection path (everything before the last segment), `id` the last segment.
CREATE TABLE documents (
  path       text PRIMARY KEY,
  parent     text NOT NULL,
  id         text NOT NULL,
  data       jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX documents_parent_idx ON documents (parent);
