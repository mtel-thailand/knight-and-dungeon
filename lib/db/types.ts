/** Animation catalog row shape (mirrors the animations table). */
export type AnimationRow = {
  key: string;
  label: string;
  image: string | null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  frameData: any | null;
  deriveFrom: string | null;
  reverse: boolean;
};

/** Per-character animation seed shape. */
export type CharacterSeed = Record<
  string,
  { animations: Record<string, { duration: number; loop: boolean }> }
>;
