import { Signal, NullarySignal } from 'neuroglancer/util/signal';
import { RefCounted } from 'neuroglancer/util/disposable';

import { Observable, Observer} from "@reactivex/rxjs";

export function rxify<Callable extends Function, R, T extends ({changed: Signal<Callable>} & RefCounted)>(sig: T, f: (t: T) => R, options?: {prefire?: boolean, share?: boolean}): Observable<R>;
export function rxify<Callable extends Function, R, T extends {changed: Signal<Callable>}>(sig: {s: T, r: RefCounted}, f: (t: T) => R, options?: {prefire?: boolean, share?: boolean}): Observable<R>;
export function rxify<R, T extends {changed: NullarySignal}>(sig: (T & RefCounted) | {s: T, r: RefCounted}, f: (t: T) => R, options?: {prefire?: boolean, share?: boolean}): Observable<R> {
	const opts = {...{prefire: true, share: true}, ...options}
	const s = (sig instanceof RefCounted) ? sig : sig.s;
	const d = (sig instanceof RefCounted) ? sig : sig.r;
	const rx: Observable<R> = Observable.create((o: Observer<R>) => {
		if (opts.prefire) o.next(f(s));
		const rm = s.changed.add(() => {
			o.next(f(s));
		});
		const disp = d.registerDisposer(() => o.complete());
		return () => {rm(); d.unregisterDisposer(disp)};
	});
	if (opts.share) {
		if (opts.prefire) return rx.publishReplay(1).refCount(); //refCount does not call connect, only on 1st subscription
		else return rx.share();
	} else return rx;
}