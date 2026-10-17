/** Snapshot history. A pointer drag can call beginGroup / endGroup for one undo step. */
export class History<T> {
  private past: T[] = [];
  private future: T[] = [];
  private value: T;
  private grouped = false;
  private groupChanged = false;
  readonly capacity: number;

  constructor(initial: T, capacity = 100) {
    if (!Number.isInteger(capacity) || capacity < 1 || capacity > 1000) throw new RangeError('History capacity must be 1..1000');
    this.capacity = capacity; this.value = structuredClone(initial);
  }

  get current(): T { return structuredClone(this.value); }
  get canUndo(): boolean { return this.past.length > 0; }
  get canRedo(): boolean { return this.future.length > 0; }
  get undoCount(): number { return this.past.length; }
  get redoCount(): number { return this.future.length; }

  push(next: T): void {
    if (JSON.stringify(next) === JSON.stringify(this.value)) return;
    if (!this.grouped || !this.groupChanged) {
      this.past.push(structuredClone(this.value));
      if (this.past.length > this.capacity) this.past.shift();
    }
    this.value = structuredClone(next); this.future = []; this.groupChanged = this.grouped;
  }

  commit(next: T): void { this.push(next); }
  beginGroup(): void { if (this.grouped) throw new Error('History group already active'); this.grouped = true; this.groupChanged = false; }
  endGroup(): void { this.grouped = false; this.groupChanged = false; }

  undo(): T | undefined {
    this.endGroup(); const previous = this.past.pop(); if (previous === undefined) return undefined;
    this.future.push(structuredClone(this.value)); this.value = previous; return this.current;
  }

  redo(): T | undefined {
    this.endGroup(); const next = this.future.pop(); if (next === undefined) return undefined;
    this.past.push(structuredClone(this.value)); this.value = next; return this.current;
  }

  reset(initial: T): void { this.value = structuredClone(initial); this.past = []; this.future = []; this.endGroup(); }
}
