import { observe } from "../src";

test("simple notify on observable", async (done) => {
  const array = observe([0, 0]);
  const receiver = array.receiver();
  array.fill(4);
  array.notify();
  const call = jest.fn();
  for await (const value of receiver) {
    expect(value).toStrictEqual([4, 4]);
    call();
    break;
  }
  array.removeReceiver(receiver);
  expect(call).toBeCalledTimes(1);
  done();
});
