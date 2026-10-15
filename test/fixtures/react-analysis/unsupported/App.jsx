function useState(value) {
  return [value, () => {}];
}

export function Dynamic({ actions, selected, buttonProps }) {
  const [open, setOpen] = useState(false);
  function fallback() {
    return 'fallback';
  }
  return (
    <section>
      <button onClick={actions[selected]}>Dynamic action</button>
      <button {...buttonProps}>Spread action</button>
      <button onClick={fallback} {...buttonProps}>Overridden action</button>
      <button onClick={() => setOpen(true)}>Local lookalike</button>
      {open ? <p>Not a React state binding</p> : null}
    </section>
  );
}
