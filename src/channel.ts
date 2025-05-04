export enum State {
  empty = "empty",
  receiver = "receiver",
  data = "data",
  close = "close",
}

export enum TryReceivedKind {
  value = "value",
  notReceived = "no",
  close = "close",
}

export type TryReceived<T> =
  | { kind: TryReceivedKind.value; value: T }
  | { kind: TryReceivedKind.notReceived }
  | { kind: TryReceivedKind.close };

// Multi Producer Single Consumer Channel
export class SimpleChannel<T> {
  private receivers: [(t: T) => void, () => void][];
  private data: (T | null)[];
  private _state: State;
  private doneCount?: number;
  private currentDoneCount: number;

  get state(): State {
    return this._state;
  }

  constructor(doneCount?: number) {
    this.receivers = [];
    this.data = [];
    this._state = State.empty;
    this.doneCount = doneCount;
    this.currentDoneCount = 0;
  }

  tryReceive(): TryReceived<T> {
    // Check for closed state first
    if (this._state === State.close) {
      if (this.data.length > 0) {
        // Channel closed, but data remains from before close
        const data = this.data.shift()!; // Should not be null here
        // State remains close, data queue shrinks
        return { kind: TryReceivedKind.value, value: data };
      } else {
        // Channel closed, no data left
        return { kind: TryReceivedKind.close };
      }
    }

    // Original logic if not closed and data exists
    if (this._state == State.data) {
      const data = this.data.shift()!;
      // if (data === null) { // No longer possible with new close() logic
      //   this._state = State.close;
      //   return {kind: TryReceivedKind.close};
      // }
      if (this.data.length === 0) {
        this._state = State.empty;
      }
      return { kind: TryReceivedKind.value, value: data };
    } else {
      // State is empty or receiver - no data available now
      return { kind: TryReceivedKind.notReceived };
    }
  }

  receive(): Promise<T> {
    if (this._state === State.close) {
      return Promise.reject();
    } else if (this._state === State.data) {
      const data = this.data.shift() as T;
      if (data === null) {
        this._state = State.close;
        return Promise.reject();
      }
      if (this.data.length === 0) {
        this._state = State.empty;
      }
      return Promise.resolve(data);
    } else {
      return new Promise((resolve, reject) => {
        // executor runs before creating the Promise
        this.receivers.push([resolve, reject]);
        this._state = State.receiver;
      });
    }
  }

  send(data: T): void {
    if (this._state === State.close) {
      throw "sending on closed channel";
    } else if (this._state !== State.receiver) {
      // when no receiver
      this.data.push(data);
      this._state = State.data;
    } else {
      // at least one receiver is available
      const [resolve] = this.receivers.shift() as [(t: T) => void, () => void];
      resolve(data);
      if (this.receivers.length === 0) {
        this._state = State.empty;
      }
    }
  }

  close(): void {
    if (this._state === State.close) {
      // when already closed
      return;
    }
    // Store waiting receivers, set state to close, clear pending list
    const receiversToReject = [...this.receivers];
    this._state = State.close;
    this.receivers = [];

    // Reject receivers that were waiting
    for (const [, reject] of receiversToReject) {
      reject();
    }
    // Note: No longer pushing null. Remaining data can be consumed via tryReceive.
    // receive() will reject immediately due to state change.
  }

  done(): void {
    if (this.doneCount === undefined) {
      throw new Error("Cannot call done() on a channel without a doneCount");
    }
    if (this._state === State.close) {
      return; // Already closed or closing
    }
    this.currentDoneCount++;
    if (this.currentDoneCount >= this.doneCount) {
      this.close();
    }
  }

  async *[Symbol.asyncIterator](): AsyncIterableIterator<T> {
    try {
      while (true) {
        yield await this.receive();
      }
    } catch {
      // assume we're done with the channel
    }
  }
}

export interface SimpleReceiver<T> {
  receive: () => Promise<T>;
  tryReceive(): TryReceived<T>;
  [Symbol.asyncIterator]: () => AsyncIterableIterator<T>;
}

// Multi Producer Multi Consumer Channel
export class MultiReceiverChannel<T> {
  private chan: Set<SimpleChannel<T>>;
  constructor() {
    this.chan = new Set();
  }

  send(data: T): void {
    for (const chan of this.chan) {
      chan.send(data);
    }
  }

  close(): void {
    for (const chan of this.chan) {
      chan.close();
    }
  }

  receiver(): SimpleReceiver<T> {
    const chan = new SimpleChannel<T>();
    this.chan.add(chan);
    return chan;
  }

  removeReceiver(chan: SimpleReceiver<T>): void {
    this.chan.delete(chan as SimpleChannel<T>);
  }
}
