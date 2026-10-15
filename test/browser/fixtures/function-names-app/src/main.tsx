// Entry: react-query provider and wouter routes. Nothing here knows about Tracer.
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Link, Route, Switch } from 'wouter';
import Home from './routes/Home';
import { About } from './routes/About';
import { handlers, renderBadge, Tally } from './legacy/widgets.jsx';
import { counters } from './store';
import { Editor, List, Preview, destructuredCallee, importedCallee, setItems } from './callees';

const queryClient = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
const tally = new Tally();
Object.values(counters).forEach((reset) => reset());
export const calleeTotal = importedCallee() + destructuredCallee() + Editor() + Preview() + List({ setItems });

function Shell() {
  return (
    <QueryClientProvider client={queryClient}>
      <nav>
        <Link href="/">home</Link> <Link href="/about">about</Link>
        <button type="button" data-testid="ping" onClick={() => { tally.bump(); handlers.onPing(); }}>ping</button>
        {renderBadge(tally.total)}
      </nav>
      <Switch>
        <Route path="/" component={Home} />
        <Route path="/about" component={About} />
      </Switch>
    </QueryClientProvider>
  );
}

createRoot(document.getElementById('root')!).render(<Shell />);
