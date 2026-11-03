// CC-044: the GPL source offer. The page links to the public mirror at the running version's tag.
export const PUBLIC_REPO = "https://github.com/ildruido/chess-coach-app";

export function sourceUrl(version: string): string {
  return `${PUBLIC_REPO}/tree/v${version}`;
}
