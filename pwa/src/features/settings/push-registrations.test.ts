import { afterEach, beforeEach, expect, test } from "bun:test";
import { resetBoardTestDOM } from "../../../test-support/dom";
import { installFakeServiceWorkers, type FakeServiceWorkers } from "../../../test-support/service-workers";
import { t } from "../../lib/i18n";
import {
  computerPushScope, computerSubscription, forgetComputerPush, preparePushRegistration, subscribeComputer,
} from "./push-registrations";

// Each computer signs with its own key; one key byte stands for each.
const A = { id: "d_aaaaaaaaaaaaaaaaaaaa", key: "AA", byte: 0 };
const B = { id: "d_bbbbbbbbbbbbbbbbbbbb", key: "AQ", byte: 1 };
const C = { id: "d_cccccccccccccccccccc", key: "Ag", byte: 2 };

let workers: FakeServiceWorkers;

beforeEach(async () => {
  await resetBoardTestDOM();
  workers = installFakeServiceWorkers();
});

afterEach(() => workers.restore());

test("the first computer subscribes on the app's registration, as before", async () => {
  const subscription = await subscribeComputer(workers.app, A.id, A.key);
  expect(subscription).toBe(workers.app.subscription!);
  expect(workers.app.subscription!.key).toBe(A.byte);
  expect(workers.registerCalls).toEqual([]);
});

test("a second computer gets its own registration and leaves the first computer's subscription alone", async () => {
  const first = workers.subscribe(workers.app, A.byte);
  const subscription = await subscribeComputer(workers.app, B.id, B.key);
  const own = workers.at(computerPushScope(B.id))!;
  expect(own.subscription).toBe(subscription as typeof own.subscription);
  expect(own.subscription!.key).toBe(B.byte);
  expect(workers.app.subscription).toBe(first);
  expect(workers.registerCalls).toEqual([computerPushScope(B.id)]);
});

test("each computer finds only the subscription made with its key", async () => {
  const first = workers.subscribe(workers.app, A.byte);
  const second = await subscribeComputer(workers.app, B.id, B.key);
  expect(await computerSubscription(workers.app, A.id, A.key)).toBe(first);
  expect(await computerSubscription(workers.app, B.id, B.key)).toBe(second);
  expect(await computerSubscription(workers.app, C.id, C.key)).toBeNull();
});

test("an existing subscription is reused rather than made again", async () => {
  workers.subscribe(workers.app, A.byte);
  const second = await subscribeComputer(workers.app, B.id, B.key);
  expect(await subscribeComputer(workers.app, B.id, B.key)).toBe(second);
  expect(await subscribeComputer(workers.app, A.id, A.key)).toBe(workers.app.subscription!);
  expect(workers.at(computerPushScope(B.id))!.subscribes).toBe(1);
  expect(workers.app.subscribes).toBe(0);
});

test("a computer whose key changed replaces only its own stale subscription", async () => {
  const first = workers.subscribe(workers.app, A.byte);
  await subscribeComputer(workers.app, B.id, B.key);
  const own = workers.at(computerPushScope(B.id))!;
  const stale = own.subscription;
  const fresh = await subscribeComputer(workers.app, B.id, C.key);
  expect(fresh).not.toBe(stale!);
  expect(own.subscription!.key).toBe(C.byte);
  expect(workers.app.subscription).toBe(first);
});

test("a browser that cannot register another worker says so and keeps the first subscription", async () => {
  const first = workers.subscribe(workers.app, A.byte);
  const cause = new Error("SecurityError");
  workers.failRegister = cause;
  const error = await subscribeComputer(workers.app, B.id, B.key).catch((caught: Error) => caught);
  expect(error).toBeInstanceOf(Error);
  expect((error as Error).message).toBe(t("push.otherComputer"));
  expect((error as Error).cause).toBe(cause);
  expect(workers.app.subscription).toBe(first);
});

test("a computer without a usable id never touches another computer's subscription", async () => {
  const first = workers.subscribe(workers.app, A.byte);
  const error = await subscribeComputer(workers.app, "../evil", B.key).catch((caught: Error) => caught);
  expect((error as Error).message).toBe(t("push.otherComputer"));
  expect(workers.registerCalls).toEqual([]);
  expect(workers.app.subscription).toBe(first);
});

test("an enclosing scope is never mistaken for a computer's own registration", async () => {
  // getRegistration(url) would answer the app's registration for this scope.
  workers.subscribe(workers.app, B.byte);
  expect(await computerSubscription(workers.app, B.id, B.key)).toBe(workers.app.subscription!);
  await forgetComputerPush(B.id);
  expect(workers.registrations).toContain(workers.app);
  expect(workers.app.subscription!.key).toBe(B.byte);
});

test("preparation registers a worker only for a computer that cannot use the app's registration", async () => {
  await preparePushRegistration(workers.app, A.id, A.key);
  expect(workers.registerCalls).toEqual([]);
  workers.subscribe(workers.app, A.byte);
  await preparePushRegistration(workers.app, A.id, A.key);
  expect(workers.registerCalls).toEqual([]);
  await preparePushRegistration(workers.app, B.id, B.key);
  expect(workers.registerCalls).toEqual([computerPushScope(B.id)]);
  await preparePushRegistration(workers.app, B.id, B.key);
  expect(workers.registerCalls).toEqual([computerPushScope(B.id)]);
  expect(workers.at(computerPushScope(B.id))!.updates).toBe(1);
});

test("a prepared worker that is still installing is waited for before subscribing", async () => {
  workers.subscribe(workers.app, A.byte);
  await preparePushRegistration(workers.app, B.id, B.key);
  expect(workers.at(computerPushScope(B.id))!.active).toBeNull();
  const subscription = await subscribeComputer(workers.app, B.id, B.key);
  expect(subscription.endpoint).toBe(workers.at(computerPushScope(B.id))!.subscription!.endpoint);
});

test("forgetting a computer unregisters only its own worker", async () => {
  const first = workers.subscribe(workers.app, A.byte);
  await subscribeComputer(workers.app, B.id, B.key);
  await subscribeComputer(workers.app, C.id, C.key);
  await forgetComputerPush(B.id);
  expect(workers.at(computerPushScope(B.id))).toBeUndefined();
  expect(workers.at(computerPushScope(C.id))!.subscription!.key).toBe(C.byte);
  expect(workers.app.subscription).toBe(first);
});
