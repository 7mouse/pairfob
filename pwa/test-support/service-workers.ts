/**
 * A browser's service worker registrations as push sees them: one registration
 * per scope, each holding at most one subscription bound to the key it was made
 * with. Registering a new scope installs and then activates its worker.
 */

export type FakeSubscription = PushSubscription & { key: number };
export type FakeRegistration = ServiceWorkerRegistration & {
  subscription: FakeSubscription | null;
  updates: number;
  subscribes: number;
};

export type FakeServiceWorkers = {
  app: FakeRegistration;
  registrations: FakeRegistration[];
  /** The registration at exactly this path, if any. */
  at: (path: string) => FakeRegistration | undefined;
  /** Give a registration a subscription made with one key byte, as an earlier tap would. */
  subscribe: (registration: FakeRegistration, key: number) => FakeSubscription;
  registerCalls: string[];
  failRegister: Error | null;
  restore: () => void;
};

let endpoints = 0;

function makeSubscription(registration: FakeRegistration, key: number): FakeSubscription {
  const endpoint = `https://push.example/${++endpoints}`;
  return {
    key,
    endpoint,
    options: { applicationServerKey: new Uint8Array([key]).buffer, userVisibleOnly: true },
    toJSON: () => ({ endpoint }),
    unsubscribe: async () => {
      if (registration.subscription?.endpoint === endpoint) registration.subscription = null;
      return true;
    },
  } as unknown as FakeSubscription;
}

function makeWorker(): ServiceWorker {
  const listeners: Array<() => void> = [];
  const worker = {
    state: "installing",
    addEventListener: (_type: string, listener: () => void) => { listeners.push(listener); },
    activate: () => {
      worker.state = "activated";
      for (const listener of listeners) listener();
    },
  };
  return worker as unknown as ServiceWorker;
}

/** `appPath` is the page's own registration, as `getRegistration()` answers it. */
export function installFakeServiceWorkers(appPath = "/pair"): FakeServiceWorkers {
  const registrations: FakeRegistration[] = [];
  const fake: FakeServiceWorkers = {
    app: undefined as unknown as FakeRegistration,
    registrations,
    at: path => registrations.find(registration => registration.scope === new URL(path, location.origin).href),
    subscribe: (registration, key) => (registration.subscription = makeSubscription(registration, key)),
    registerCalls: [],
    failRegister: null,
    restore: () => undefined,
  };
  const make = (path: string, active: boolean): FakeRegistration => {
    const registration = {
      scope: new URL(path, location.origin).href,
      active: active ? makeWorker() : null,
      installing: null as ServiceWorker | null,
      waiting: null,
      subscription: null,
      updates: 0,
      subscribes: 0,
      pushManager: {
        getSubscription: async () => registration.subscription,
        subscribe: async ({ applicationServerKey }: PushSubscriptionOptionsInit) => {
          if (!registration.active) throw new DOMException("no active worker", "InvalidStateError");
          registration.subscribes++;
          registration.subscription = makeSubscription(registration as unknown as FakeRegistration,
            new Uint8Array(applicationServerKey as ArrayBuffer)[0]!);
          return registration.subscription;
        },
      },
      update: async () => { registration.updates++; },
      unregister: async () => {
        registrations.splice(registrations.indexOf(registration as unknown as FakeRegistration), 1);
        registration.subscription = null;
        return true;
      },
    } as unknown as FakeRegistration & { installing: ServiceWorker | null; active: ServiceWorker | null };
    registrations.push(registration);
    return registration;
  };
  fake.app = make(appPath, true);
  const container = {
    ready: Promise.resolve(fake.app),
    getRegistration: async () => fake.app,
    getRegistrations: async () => [...registrations],
    register: async (_script: string, options: RegistrationOptions) => {
      fake.registerCalls.push(options.scope!);
      if (fake.failRegister) throw fake.failRegister;
      const existing = fake.at(options.scope!);
      if (existing) return existing;
      const registration = make(options.scope!, false) as FakeRegistration & { installing: ServiceWorker | null; active: ServiceWorker | null };
      const worker = makeWorker();
      registration.installing = worker;
      setTimeout(() => {
        registration.installing = null;
        registration.active = worker;
        (worker as unknown as { activate: () => void }).activate();
      }, 0);
      return registration;
    },
  };
  const previous = Object.getOwnPropertyDescriptor(navigator, "serviceWorker");
  Object.defineProperty(navigator, "serviceWorker", { configurable: true, value: container });
  fake.restore = () => {
    if (previous) Object.defineProperty(navigator, "serviceWorker", previous);
    else Reflect.deleteProperty(navigator, "serviceWorker");
  };
  return fake;
}
