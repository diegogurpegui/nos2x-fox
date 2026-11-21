export class LRUCache<K, V> {
  private maxSize: number;
  private map: Map<K, V>;
  private keys: K[];

  constructor(maxSize: number) {
    this.maxSize = maxSize;
    this.map = new Map();
    this.keys = [];
  }

  private zeroizeValue(val: V | undefined) {
    if (val instanceof Uint8Array) {
      val.fill(0);
    }
  }

  clear() {
    for (const val of this.map.values()) {
      this.zeroizeValue(val);
    }
    this.map.clear();
    this.keys = [];
  }

  has(k: K): boolean {
    return this.map.has(k);
  }

  get(k: K): V | undefined {
    const v = this.map.get(k);

    if (v !== undefined) {
      const idx = this.keys.indexOf(k);
      if (idx !== -1) {
        this.keys.splice(idx, 1);
      }
      this.keys.push(k);
    }

    return v;
  }

  set(k: K, v: V) {
    if (this.map.has(k)) {
      const existing = this.map.get(k);
      if (existing !== v) {
        this.zeroizeValue(existing);
      }
      const idx = this.keys.indexOf(k);
      if (idx !== -1) {
        this.keys.splice(idx, 1);
      }
    }

    this.map.set(k, v);
    this.keys.push(k);

    while (this.map.size > this.maxSize && this.keys.length > 0) {
      const oldest = this.keys.shift() as K;
      const evicted = this.map.get(oldest);
      this.zeroizeValue(evicted);
      this.map.delete(oldest);
    }
  }
}
