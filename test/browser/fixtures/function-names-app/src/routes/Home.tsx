// The home route: TanStack mutations, the store, a memo row and a forwardRef
// input, a list rendered with map, and two handlers that throw ApiError.
import React, { forwardRef, useRef, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { client, ApiError, describeStatus } from '../api';
import { useTodos, type Todo } from '../store';
import countFilled, { titleCase, withRetry } from '../helpers';

const Row = React.memo(function Row({ todo, onRemove }: { todo: Todo; onRemove: (id: number) => void }) {
  return (
    <li>
      <span>{todo.text}</span>
      <button type="button" aria-label={`remove ${todo.text}`} onClick={() => onRemove(todo.id)}>remove</button>
    </li>
  );
});

const TextField = forwardRef((props: { label: string }, ref: React.Ref<HTMLInputElement>) => (
  <label>{props.label}<input ref={ref} aria-label={props.label} defaultValue="walk the dog" /></label>
));

function runLater(job: () => void): void {
  queueMicrotask(job);
}

function explode(): never {
  throw new ApiError(418, 'client-side failure');
}

export default function Home() {
  const input = useRef<HTMLInputElement>(null);
  const [status, setStatus] = useState('');
  const todos = useTodos((state) => state.todos);
  const addTodo = useTodos((state) => state.addTodo);
  const removeTodo = useTodos((state) => state.removeTodo);

  const saveMutation = useMutation({
    mutationFn: async function saveTodo(text: string) {
      return client.post<{ ok: boolean }>('/api/todos', { text });
    },
    onSuccess: () => setStatus('saved'),
  });
  const deleteMutation = useMutation({
    mutationFn: async (id: number) => client.post<{ ok: boolean }>(`/api/todos/${id}/delete`, {}),
  });

  function handleAdd() {
    const text = titleCase(input.current?.value || '');
    addTodo(text);
    saveMutation.mutate(text);
    runLater(() => setStatus('adding'));
  }

  const handleRemove = (id: number) => {
    removeTodo(id);
    deleteMutation.mutate(id);
  };

  async function handleFail() {
    await client.post('/api/fail', {});
  }

  const count = withRetry(() => countFilled(todos.map((todo) => todo.text)));

  return (
    <section>
      <TextField ref={input} label="New todo" />
      <button type="button" data-testid="add" onClick={handleAdd}>add</button>
      <button type="button" data-testid="explode" onClick={explode}>explode</button>
      <button type="button" data-testid="fail" onClick={handleFail}>fail</button>
      <button type="button" data-testid="status" onClick={() => setStatus(describeStatus(ApiClient_count()))}>status</button>
      <p role="status">{status} {count}</p>
      <ul>{todos.map((todo) => <Row key={todo.id} todo={todo} onRemove={handleRemove} />)}</ul>
    </section>
  );
}

function ApiClient_count(): number {
  return client.baseUrl.length;
}
