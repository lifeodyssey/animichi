interface HeapNode<T> { value: T; priority: number; tie: string }

export class MinHeap<T> {
  private readonly nodes: HeapNode<T>[] = [];
  get size(): number { return this.nodes.length; }

  push(value: T, priority: number, tie = ""): void {
    this.nodes.push({ value, priority, tie });
    this.bubbleUp(this.nodes.length - 1);
  }

  pop(): T | undefined {
    const first = this.nodes[0];
    const last = this.nodes.pop();
    if (!first || !last) return first?.value;
    if (this.nodes.length) { this.nodes[0] = last; this.bubbleDown(0); }
    return first.value;
  }

  private less(left: number, right: number): boolean {
    const a = this.nodes.at(left);
    const b = this.nodes.at(right);
    if (!a || !b) return false;
    return a.priority < b.priority || (a.priority === b.priority && a.tie < b.tie);
  }

  private bubbleUp(index: number): void {
    const parent = Math.floor((index - 1) / 2);
    if (index === 0 || !this.less(index, parent)) return;
    this.swap(index, parent);
    this.bubbleUp(parent);
  }

  private bubbleDown(index: number): void {
    const child = this.smallerChild(index);
    if (child === -1 || !this.less(child, index)) return;
    this.swap(index, child);
    this.bubbleDown(child);
  }

  private smallerChild(index: number): number {
    const left = index * 2 + 1;
    const right = left + 1;
    if (left >= this.nodes.length) return -1;
    return right < this.nodes.length && this.less(right, left) ? right : left;
  }

  private swap(left: number, right: number): void {
    const a = this.nodes.at(left);
    const b = this.nodes.at(right);
    if (!a || !b) return;
    this.nodes[left] = b;
    this.nodes[right] = a;
  }
}
