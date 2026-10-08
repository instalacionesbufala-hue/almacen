import { useSyncExternalStore } from 'react';

/** Almacén mínimo con suscripción para React. El valor se muta y luego se llama a `emit()`. */
export function crearStore<T>(inicial: T) {
  let valor = inicial, version = 0;
  const subs = new Set<() => void>();
  const subscribe = (f: () => void) => { subs.add(f); return () => subs.delete(f); };
  return {
    get: () => valor,
    subscribe,
    set(nuevo: T) { valor = nuevo; version++; subs.forEach(f => f()); },
    emit() { version++; subs.forEach(f => f()); },
    use(): T { useSyncExternalStore(subscribe, () => version, () => version); return valor; },
  };
}
