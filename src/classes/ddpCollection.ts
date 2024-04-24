import EJSON from 'ejson';
import { fullCopy } from '../helpers/fullCopy.js';
import { ddpOnChange } from './ddpOnChange.js';
import { ddpReactiveCollection } from './ddpReactiveCollection';
import DDPClient from '../DDPClient';

type Filter<T> = boolean | ((value: T, index: number, array: T[]) => any);

/**
 * DDP collection class.
 */
export class ddpCollection<T>
{
	private _filter: Filter<T> = false;
	private _name: string;
	private _server: any;
	private ddpConnection: any;

	constructor(name: string, server: DDPClient)
	{
		this._name = name;
		this._server = server;
	}

	/**
   * Allows to specify specific documents inside the collection for reactive data and fetching.
   * Important: if you change filter function it won't change for the already created reactive objects.
   */
	public filter<S extends any>(f: boolean | ((value: T, index: number, array: T[]) => S) = false): this
	{
		this._filter = f;
		return this;
	}

	/**
   * Imports data inside the collection and emits all relevant events.
   * Both string and JS object types are supported.
   */
	public importData(data: string | object)
	{
		const c = typeof data === 'string' ? EJSON.parse(data) : data;

		if (c[this._name])
		{
			c[this._name].forEach((doc: { _id: string; fields: {}; }, i: number, arr: { _id: string; fields: {}; }[]) =>
			{
				// @ts-ignore
				if (!this._filter || (this._filter && typeof this._filter === 'function' && this._filter(doc, i, arr)))
				{
					this.ddpConnection.emit('added', {
						msg: 'added',
						_id: doc._id,
						collection: this._name,
						fields: doc.fields
					});
				}
			});
		}
	}

	/**
   * Exports data from the collection.
   */
	public exportData(format: 'string' | 'raw' | undefined): string | object
	{
		const collectionCopy = { [this._name]: this.fetch() };

		if (format == 'raw')
		{
			return collectionCopy;
		}

		return EJSON.stringify(collectionCopy);
	}

	/**
   * Returns collection data based on filter and on passed settings. Supports skip, limit and sort.
   * Order is 'filter' then 'sort' then 'skip' then 'limit'.
   * sort is a standard js array sort function.
   */
	public fetch(settings?: { skip?: number; limit?: number; sort?: ((a: T, b: T) => number) | boolean }): T[]
	{
		let skip; let limit; let
			sort;

		if (settings)
		{
			skip = settings.skip;
			limit = settings.limit;
			sort = settings.sort;
		}

		const c = this._server.collections[this._name];
		let collectionCopy = c ? fullCopy(c) : [];
		if (this._filter) collectionCopy = collectionCopy.filter(this._filter);
		if (sort) collectionCopy.sort(sort);
		if (typeof skip === 'number') collectionCopy.splice(0, skip);
		if (typeof limit === 'number' || limit == Infinity) collectionCopy.splice(limit);
		return collectionCopy as T[];
	}

	/**
   * Returns reactive collection object.
   * @see ddpReactiveCollection
   */
	public reactive(settings?: { skip?: number | undefined; limit?: number | undefined; sort?: false | ((a: T, b: T) => number) | undefined; } | undefined): ddpReactiveCollection<T>
	{
		return new ddpReactiveCollection<T>(this, settings, this._filter);
	}

	/**
   * Returns change observer.
   * @see ddpOnChange
   */
	public onChange(f: <P extends { _id: string } & T, N extends { _id: string } & T, PP extends any[]>(args: { prev?: P, next?: N, predicatePassed: PP }) => any, filter?: Filter<T>): ReturnType<typeof ddpOnChange>
	{
		const obj = {
			collection: this._name,
			f,
			filter
		};

		if (this._filter) obj.filter = this._filter;
		if (filter) obj.filter = filter;

		return ddpOnChange(obj, this._server);
	}
}
