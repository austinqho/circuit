// A second route: a component bound to a const, and a class-field handler.
import { useState } from 'react';
import { client } from '../api';

class Greeter {
  greeting = 'hello';
  greet = (name: string): string => `${this.greeting} ${name}`;
}

const greeter = new Greeter();

export const About = () => {
  const [text, setText] = useState('');
  const onGreet = async () => {
    const todos = await client.get<{ todos: string[] }>('/api/todos');
    setText(`${greeter.greet('you')} (${todos.todos.length})`);
  };
  return (
    <section>
      <button type="button" data-testid="greet" onClick={onGreet}>greet</button>
      <p role="note">{text}</p>
    </section>
  );
};
