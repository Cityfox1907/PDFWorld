/**
 * Tiny, standards-aligned polyfills for the `Map.prototype.getOrInsert` proposal.
 *
 * pdf.js v6 calls `Map.prototype.getOrInsertComputed` internally while rendering.
 * It ships in current engines but is absent from slightly older Chromium / Safari /
 * Firefox builds, where its absence makes every page fail to render. These guarded
 * definitions add the methods only when missing, so rendering works everywhere and
 * stays a no-op on browsers that already provide them.
 */
interface MapPolyfill {
  has(key: unknown): boolean;
  get(key: unknown): unknown;
  set(key: unknown, value: unknown): unknown;
  getOrInsert?(key: unknown, value: unknown): unknown;
  getOrInsertComputed?(key: unknown, callback: (key: unknown) => unknown): unknown;
}

const proto = Map.prototype as unknown as MapPolyfill;

if (typeof proto.getOrInsertComputed !== 'function') {
  proto.getOrInsertComputed = function (this: MapPolyfill, key, callback) {
    if (this.has(key)) return this.get(key);
    const value = callback(key);
    this.set(key, value);
    return value;
  };
}

if (typeof proto.getOrInsert !== 'function') {
  proto.getOrInsert = function (this: MapPolyfill, key, value) {
    if (this.has(key)) return this.get(key);
    this.set(key, value);
    return value;
  };
}
