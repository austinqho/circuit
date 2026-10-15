// A stand-in for a form library (outside the first-party rule: vendor/ is
// excluded, so none of this is instrumented). Like real form libraries it
// validates asynchronously and only then calls the app's callback, from a
// promise continuation created during the submit dispatch.
export function handleSubmit(onValid) {
  return function onSubmitEvent(event) {
    event.preventDefault();
    const values = Object.fromEntries(new FormData(event.currentTarget));
    return Promise.resolve(values).then(checked => (checked.name ? onValid(checked) : undefined));
  };
}
