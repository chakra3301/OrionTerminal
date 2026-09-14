export function serialQueue() {
  let tail: Promise<unknown> = Promise.resolve();
  return <T>(work: () => Promise<T>): Promise<T> => {
    const result = tail.then(work);
    // A failed operation must not prevent the next save or navigation.
    tail = result.catch(() => undefined);
    return result;
  };
}
