import { ddpReducer } from './ddpReducer.js';
import { ddpReactiveDocument } from './ddpReactiveDocument.js';
import { ddpOnChange } from './ddpOnChange.js';
import { ddpCollection } from './ddpCollection';

/**
 * A reactive collection class.
 */

export class ddpReactiveCollection<T>
{
	private _skip: number;
	private _limit: number;
	private _sort: false | ((a: any, b: any) => number);
	private _length: { result: number } = { result: 0 };
	private _data: any[] = [];
	private _rawData: any[] = [];
	private _reducers: ddpReducer<any, any, any, T>[] = [];
	private _tickers: any[] = [];
	private _ones: any[] = [];
	private _first = {};
	private _syncFunc: (skip: number | undefined, limit: number | undefined, sort: ((a: any, b: any) => number) | false) => any;
	private _changeHandler;
	private started: boolean;

	constructor(ddpCollectionInstance: ddpCollection<T>, settings?: { skip?: number; limit?: number; sort?: false | ((a: T, b: T) => number) }, filter?: boolean | ((value: T, index: number, array: T[]) => any))
	{
		this._skip = settings && typeof settings.skip === 'number' ? settings.skip : 0;
		this._limit = settings && typeof settings.limit === 'number' ? settings.limit : Infinity;
		this._sort = settings && typeof settings.sort === 'function' ? settings.sort : false;

		this._syncFunc = function (skip: number | undefined, limit: number | undefined, sort: ((a: any, b: any) => number) | boolean)
		{
			const options: {
        skip?: number,
        limit?: number,
        sort?: ((a: any, b: any) => number) | boolean
      } = {};
			if (typeof skip === 'number') options.skip = skip;
			if (typeof limit === 'number') options.limit = limit;
			if (sort)
			{
				options.sort = sort;
			}
			return ddpCollectionInstance.fetch.call(ddpCollectionInstance, options);
		};

		// @ts-ignore
		// @ts-ignore
		this._changeHandler = ddpCollectionInstance.onChange(({ prev, next, predicatePassed }) =>
		{
			if (prev && next)
			{
				if (predicatePassed[0] == 0 && predicatePassed[1] == 1)
				{
					// prev falling, next passing filter, adding new element with sort
					this._smartUpdate(next);
				}
				else if (predicatePassed[0] == 1 && predicatePassed[1] == 0)
				{
					// prev passing, next falling filter, removing old element
					const i = this._rawData.findIndex((obj) => obj._id == prev._id);
					this._removeItem(i);
				}
				else if (predicatePassed[0] == 1 && predicatePassed[1] == 1)
				{
					// both passing, should delete previous and add new
					const i = this._rawData.findIndex((obj) => obj._id == prev._id);
					this._smartUpdate(next, i);
				}
			}
			else if (!prev && next)
			{
				// element was added and is passing the filter
				// adding new element with sort
				this._smartUpdate(next);
			}
			else if (prev && !next)
			{
				// element was removed and is passing the filter, so it was in newCollection
				// removing old element
				const i = this._rawData.findIndex((obj) => obj._id == prev._id);
				this._removeItem(i);
			}
			this._length.result = this._data.length;

			this._reducers.forEach((reducer) =>
			{
				reducer.doReduce();
			});

			if (this._data[0] !== this._first)
			{
				this._updateReactiveObjects();
			}

			this._first = this._data[0];

			this._tickers.forEach((ticker) =>
			{
				ticker(this.data());
			});
			// @ts-ignore
		}, filter || ((_) => 1));

		this.started = false;

		this.start();
	}

	/**
   * Removes document from the local collection copies.
   */
	private _removeItem(i: number)
	{
		this._rawData.splice(i, 1);

		if (i >= this._skip && i < this._skip + this._limit)
		{
			this._data.splice(i - this._skip, 1);

			if (this._rawData.length >= this._skip + this._limit)
			{
				this._data.push(this._rawData[this._skip + this._limit - 1]);
			}
		}
		else if (i < this._skip)
		{
			this._data.shift();
			if (this._rawData.length >= this._skip + this._limit)
			{
				this._data.push(this._rawData[this._skip + this._limit - 1]);
			}
		}
	}

	/**
   * Adds document to local the collection this._rawData according to used sorting if specified.
   */
	private _smartUpdate(newEl: {}, j?: number): void
	{
		let placement;
		if (!this._rawData.length)
		{
			placement = this._rawData.push(newEl) - 1;
			if (placement >= this._skip && placement < this._skip + this._limit)
			{
				this._data.push(newEl);
			}
			return;
		}

		if (this._sort)
		{
			for (let i = 0; i < this._rawData.length; i++)
			{
				if (this._sort(newEl, this._rawData[i]) < 1)
				{
					placement = i;
					if (i == j)
					{
						// new position is the the same
						this._rawData[i] = newEl;
						if (j >= this._skip && j < this._skip + this._limit)
						{
							this._data[j - this._skip] = newEl;
						}
					}
					else
					{
						// new position is different
						// removing old element and adding new
						this._removeItem(j as number);
						this._rawData.splice(i, 0, newEl);
						if (i >= this._skip && i < this._skip + this._limit)
						{
							this._data.splice(i - this._skip, 0, newEl);
							this._data.splice(this._limit);
						}
					}
					break;
				}
				if (i == this._rawData.length - 1)
				{
					placement = this._rawData.push(newEl) - 1;
					if (placement >= this._skip && placement < this._skip + this._limit)
					{
						this._data.push(newEl);
					}
					break;
				}
			}
		}
		else
		{
			// no sorting, trying to change existing
			if (typeof j === 'number')
			{
				placement = j;
				this._rawData[j] = newEl;
				if (j >= this._skip && j < this._skip + this._limit)
				{
					this._data[j - this._skip] = newEl;
				}
			}
			else
			{
				placement = this._rawData.push(newEl) - 1;
				if (placement >= this._skip && placement < this._skip + this._limit)
				{
					this._data.push(newEl);
				}
			}
		}
	}

	/**
   * Adds reducer.
   */
	private _activateReducer<RArgs extends [any[], any, number, any[]], RResult, RInit>(reducer: ddpReducer<RArgs, RResult, RInit, T>)
	{
		this._reducers.push(reducer);
	}

	/**
   * Adds reactive object.
   */
	private _activateReactiveObject(o: any)
	{
		this._ones.push(o);
	}

	/**
   * Removes reducer.
   */
	private _deactivateReducer<RArgs extends [any[], any, number, any[]], RResult, RInit>(reducer: ddpReducer<RArgs, RResult, RInit, T>)
	{
		const i = this._reducers.indexOf(reducer);
		if (i > -1)
		{
			this._reducers.splice(i, 1);
		}
	}

	/**
   * Removes reactive object.
   */
	private _deactivateReactiveObject<RArgs extends [any[], any, number, any[]], RResult, RInit>(o: ddpReducer<RArgs, RResult, RInit, T>)
	{
		const i = this._ones.indexOf(o);
		if (i > -1)
		{
			this._ones.splice(i, 1);
		}
	}

	/**
   * Sends new object state for every associated reactive object.
   */
	public _updateReactiveObjects()
	{
		this._ones.forEach((ro) =>
		{
			ro._update(this.data()[0]);
		});
	}

	/**
   * Updates ddpReactiveCollection settings.
   */
	public settings(settings: { skip?: number; limit?: typeof Infinity; sort?: false | ((a: T, b: T) => number); }): this
	{
		let skip; let limit; let
			sort;

		if (settings)
		{
			skip = settings.skip;
			limit = settings.limit;
			sort = settings.sort;
		}

		this._skip = skip !== undefined ? skip : this._skip;
		this._limit = limit !== undefined ? limit : this._limit;
		this._sort = sort !== undefined ? sort : this._sort;

		this._data.splice(0, this._data.length, ...this._syncFunc(this._skip, this._limit, this._sort));
		this._updateReactiveObjects();
		return this;
	}

	/**
   * Updates the skip parameter only.
   */
	public skip(n: number): this
	{
		return this.settings({ skip: n });
	}

	/**
   * Updates the limit parameter only.
   */
	public limit(n: number): this
	{
		return this.settings({ limit: n });
	}

	/**
   * Stops reactivity. Also stops associated reactive objects.
   */
	public stop()
	{
		if (this.started)
		{
			this._changeHandler.stop();
			this.started = false;
		}
	}

	/**
   * Starts reactivity. This method is being called on instance creation.
   * Also starts every associated reactive object.
   */
	public start()
	{
		if (!this.started)
		{
			this._rawData.splice(0, this._rawData.length, ...this._syncFunc(0, 0, this._sort));
			this._data.splice(0, this._data.length, ...this._syncFunc(this._skip, this._limit, this._sort));
			this._updateReactiveObjects();
			this._changeHandler.start();
			this.started = true;
		}
	}

	/**
   * Sorts local collection according to specified function.
   * Specified function form {@link https://developer.mozilla.org/docs/Web/JavaScript/Reference/Global_Objects/Array/sort}.
   * @public
   * @param {Function} f - A function used for sorting.
   * @return {this}
   */
	sort(f: false | ((a: T, b: T) => number)): this
	{
		this._sort = f;
		if (this._sort)
		{
			this._rawData.splice(0, this._rawData.length, ...this._syncFunc(0, 0, this._sort));
			this._data.splice(0, this._data.length, ...this._syncFunc(this._skip, this._limit, this._sort));
			this._updateReactiveObjects();
		}
		return this;
	}

	/**
   * Returns reactive local collection with applied sorting, skip and limit.
   * This returned array is being mutated within this class instance.
   * @public
   * @return {Array} - Local collection with applied sorting, skip and limit.
   */
	data(): Array<any>
	{
		return this._data;
	}

	/**
   * Runs a function every time a change occurs.
   * @param {Function} f - Function which recieves new collection at each change.
   * @public
   */
	onChange(f: {})
	{
		const self = this as unknown as { [x: string]: any[] };
		return ddpOnChange(f, self, '_tickers');
	}

	/**
   * Maps reactive local collection to another reactive array.
   * Specified function form {@link https://developer.mozilla.org/docs/Web/JavaScript/Reference/Global_Objects/Array/map}.
   * @public
   */
	// @ts-ignore
	map<T, R>(f: (arg0: T, arg1?: number, arg2?: T[]) => R)
	{
		return new ddpReducer(this, ((accumulator, el, i, a) => accumulator.concat(f(el, i, a))), []);
	}

	/**
   * Reduces reactive local collection.
   * Specified function form {@link https://developer.mozilla.org/docs/Web/JavaScript/Reference/Global_Objects/Array/Reduce}.
   */
	public reduce(f: (args_0: any[], args_1: any, args_2: number, args_3: any[]) => unknown, initialValue: any)
	{
		return new ddpReducer(this, f, initialValue);
	}

	/**
   * Reactive length of the local collection.
   */
	public count(): object
	{
		return this._length;
	}

	/**
   * Returns a reactive object which fields are always the same as the first object in the collection.
   */
	public one(settings: { preserve: any; } | null): ddpReactiveDocument<T>
	{
		return new ddpReactiveDocument<T>(this, settings);
	}
}
