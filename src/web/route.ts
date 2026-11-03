// The web page's address: an invite link looks like `<site>/#/invite/<token>` (docs/API.md).

/** The invite token in a location hash, or null. */
export function inviteFromHash(hash: string): string | null {
  const m = /^#\/invite\/([A-Za-z0-9_-]{8,200})\/?$/.exec(hash);
  return m?.[1] ?? null;
}
