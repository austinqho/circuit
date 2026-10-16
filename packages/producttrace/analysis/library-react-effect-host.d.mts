import type {createHostEventBoundary} from './library-host-events.mjs';
export interface LibraryHostEventAdapter {
  protocol:'react_effect_lifecycle'; phase:'passive'|'layout'|'insertion';
  invoke(options:{boundary:ReturnType<typeof createHostEventBoundary>;producer:Function;args:unknown[];receiver?:unknown}):unknown;
}
export function createReactEffectEventHost(React:unknown,options?:{phase?:'passive'|'layout'|'insertion'}):LibraryHostEventAdapter;
