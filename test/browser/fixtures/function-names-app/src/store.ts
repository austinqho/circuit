// A zustand store: actions defined inside create(). Nothing here knows about Tracer.
import { create } from 'zustand';

export interface Todo { id: number; text: string }
interface TodoState {
  todos: Todo[];
  addTodo: (text: string) => void;
  removeTodo(id: number): void;
  clear: () => void;
}

let nextId = 1;

export const useTodos = create<TodoState>()((set) => ({
  todos: [],
  addTodo: (text: string) => set((state) => ({ todos: [...state.todos, { id: nextId++, text }] })),
  removeTodo(id: number) {
    set((state) => ({ todos: state.todos.filter((todo) => todo.id !== id) }));
  },
  clear: () => set({ todos: [] }),
}));

const dynamicKey = ['re', 'set'].join('');
export const counters = {
  [dynamicKey]() {
    return 0;
  },
};
