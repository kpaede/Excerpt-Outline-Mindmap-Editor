/** Bound cached source keys by size as well as count, even for very long nodes. */
export class MeasurementCache<T> extends Map<string, T> {
  private characters = 0;
  constructor(private readonly maxCharacters = 2_000_000, private readonly maxEntries = 1000) { super(); }
  set(key: string, value: T): this {
    this.delete(key);
    if (key.length > this.maxCharacters) return this;
    super.set(key, value);
    this.characters += key.length;
    while (this.characters > this.maxCharacters || this.size > this.maxEntries) {
      const oldest = this.keys().next().value;
      if (oldest === undefined) break;
      this.delete(oldest);
    }
    return this;
  }
  delete(key: string): boolean {
    if (!super.delete(key)) return false;
    this.characters -= key.length;
    return true;
  }
  clear(): void { super.clear(); this.characters = 0; }
}
