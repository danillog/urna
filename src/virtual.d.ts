/** Data pieces from site-data.ts: name → dynamic import of the piece. */
declare module "virtual:site-data" {
  const loaders: Record<string, () => Promise<{ default: unknown }>>;
  export default loaders;
}
