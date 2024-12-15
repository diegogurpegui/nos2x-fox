export class LRUCache<K, V> {
  private maxSize: number;
  private map: Map<K, V>;
  private keys: any[];

  constructor(maxSize: number) {
    this.maxSize = maxSize;
    this.map = new Map();
    this.keys = [];
  }

  clear() {
    this.map.clear();
  }

  has(k: K): boolean {
    return this.map.has(k);
  }

  get(k: K): V | undefined {
    const v = this.map.get(k);

    if (v !== undefined) {
      this.keys.push(k);

      if (this.keys.length > this.maxSize * 2) {
        this.keys.splice(-this.maxSize);
      }
    }

    return v;
  }

  set(k: K, v: V) {
    this.map.set(k, v);
    this.keys.push(k);

    if (this.map.size > this.maxSize) {
      this.map.delete(this.keys.shift());
    }
  }
}
