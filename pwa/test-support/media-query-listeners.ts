import type { Window } from "happy-dom";

/**
 * Happy DOM 20.11 stores a query's resize disposer on the caller's callback.
 * Sharing that callback across queries overwrites the disposer, leaking every
 * earlier query on the window. Give each query its own callback identity while
 * preserving the real query evaluation and change events.
 */
export function isolateMediaQueryListeners(realm: Window): void {
  const matchMedia = realm.matchMedia.bind(realm);
  realm.matchMedia = query => {
    const list = matchMedia(query);
    type Listener = Parameters<typeof list.addEventListener>[1];
    const listeners = new Map<Listener, Listener>();
    const add = list.addEventListener.bind(list);
    const remove = list.removeEventListener.bind(list);
    list.addEventListener = (type, listener) => {
      if (type !== "change") return add(type, listener);
      if (listeners.has(listener)) return;
      const wrapped: Listener = event => {
        if (typeof listener === "function") listener.call(list, event);
        else listener.handleEvent(event);
      };
      listeners.set(listener, wrapped);
      add(type, wrapped);
    };
    list.removeEventListener = (type, listener) => {
      if (type !== "change") return remove(type, listener);
      const wrapped = listeners.get(listener);
      if (!wrapped) return;
      remove(type, wrapped);
      listeners.delete(listener);
    };
    return list;
  };
}
