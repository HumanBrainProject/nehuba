import { Observable } from "@reactivex/rxjs/dist/cjs/Observable";

declare module "@reactivex/rxjs/dist/cjs/Observable" {
	export interface Observable<T> {
		notNull: typeof notNull;
		unseen: typeof unseen;
		ofType: typeof ofType;
	}
}

Observable.prototype.notNull = notNull;
Observable.prototype.unseen = unseen;
Observable.prototype.ofType = ofType;

function notNull<T>(this: Observable<T|null>) {
	return this.filter(it => !!it).map(it => it!);
}
/** Same as Observable.distinct() but does not hold references to values. Instead, it marks the values passing through with symbol
 *  and uses that marker to distinguish new values from the values already seen before. */
function unseen<T, K>(this: Observable<T>, keySelector?: (value: T) => K) {
	const marker = Symbol('marker');
	return this.filter(it => !(<any>(keySelector ? keySelector(it) : it))[marker])
	.map(it => {(<any>(keySelector ? keySelector(it) : it))[marker] = true; return it;});
}
/** Experimental and not tested. Use it at your own risk */ //TODO Ask at SO for advice
function ofType<T, R extends T>(this:Observable<T>, type:{new(...args: any[]): R}) {//
	return this.filter(it => it instanceof type).map(it => it as R);
}