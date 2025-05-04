import { SimpleChannel, ChannelState } from "../src";
import { TryReceivedKind } from "../src/channel";
import { setTimeout } from "timers";

test("receive and then send", async () => {
  const ch = new SimpleChannel();
  const p1 = ch.receive().then((val) => expect(val).toBe(2));
  const p2 = ch.receive().then((val) => expect(val).toBe(4));
  expect(ch.state).toBe(ChannelState.receiver);
  ch.send(2);
  ch.send(4);
  await Promise.all([p1, p2]);
  expect(ch.state).toBe(ChannelState.empty);
});

test("send and then receive", async () => {
  const ch = new SimpleChannel();
  ch.send(2);
  ch.send(3);
  expect(ch.state).toBe(ChannelState.data);
  await ch.receive().then((val) => expect(val).toBe(2));
  expect(ch.tryReceive()).toStrictEqual({
    kind: TryReceivedKind.value,
    value: 3,
  });
  expect(ch.state).toBe(ChannelState.empty);
});

test("send and then receive in async iterator", async () => {
  const ch = new SimpleChannel();
  ch.send(2);
  ch.send(4);
  let iter = 0;
  for await (const data of ch) {
    if (iter === 0) {
      expect(data).toBe(2);
    } else {
      expect(data).toBe(4);
      break;
    }
    iter++;
  }
  expect(ch.state).toBe(ChannelState.empty);
});

test("send and close", async () => {
  const ch = new SimpleChannel();
  ch.send(200);
  ch.close();
  for await (const data of ch) {
    expect(data).toBe(200);
  }
});

test("done count works", async () => {
  const ch = new SimpleChannel<number>(3);
  expect(ch.state).toBe(ChannelState.empty);
  const p = Promise.all([
    ch.receive().then((v) => expect(v).toBe(1)),
    ch.receive().then((v) => expect(v).toBe(2)),
  ]);
  expect(ch.state).toBe(ChannelState.receiver);
  ch.done();
  expect(ch.state).toBe(ChannelState.receiver);
  ch.send(1);
  expect(ch.state).toBe(ChannelState.receiver);
  ch.done();
  expect(ch.state).toBe(ChannelState.receiver);
  ch.send(2);
  expect(ch.state).toBe(ChannelState.empty);
  await p;
  expect(ch.state).toBe(ChannelState.empty);
  ch.done(); // this should close the channel
  expect(ch.state).toBe(ChannelState.close);

  await expect(ch.receive()).rejects.toBeUndefined();
  expect(ch.tryReceive().kind).toBe(TryReceivedKind.close);

  expect(() => ch.send(3)).toThrow("sending on closed channel");
});

test("done count with async iterator", async () => {
  const ch = new SimpleChannel<number>(2);
  const promises: Promise<void>[] = [];

  const producer = async (val: number) => {
    await new Promise<void>((resolve) => setTimeout(resolve, 10)); // simulate work
    ch.send(val);
  };

  promises.push(producer(10));
  promises.push(producer(20));

  const results: number[] = [];
  promises.forEach(async (p) => {
    p.then(() => {
      ch.done();
    });
  });
  for await (const data of ch) {
    results.push(data);
  }

  expect(results).toEqual([10, 20]);
  expect(ch.state).toBe(ChannelState.close);
});

test("calling done without doneCount throws", () => {
  const ch = new SimpleChannel<number>();
  expect(() => ch.done()).toThrow(
    "Cannot call done() on a channel without a doneCount"
  );
});
