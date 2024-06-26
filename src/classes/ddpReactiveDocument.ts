import { ddpOnChange } from './ddpOnChange.js';
import { ddpReactiveCollection } from './ddpReactiveCollection';

/**
 * A reactive document class.
 * reactive object won't change when corresponding object is being deleted.
 */

export class ddpReactiveDocument<T>
{
	private _ddpReactiveCollectionInstance: any;
	private _started: boolean;
	private readonly _data: {};
	private _tickers: any[];
	private _preserve: boolean;

	constructor(ddpReactiveCollectionInstance: ddpReactiveCollection<T>, settings: { preserve: any; } | null)
	{
		this._ddpReactiveCollectionInstance = ddpReactiveCollectionInstance;
		this._started = false;
		this._data = {};
		this._tickers = [];
		this._preserve = false;
		if (typeof settings === 'object' && settings !== null) this.settings(settings);
		this.start();
	}

	/**
   * Updates reactive object from local collection copies.
   */
	private _update<T>(newState: T)
	{
		if (newState)
		{
			// clean object
			Object.keys(this._data).forEach((key) =>
			{
				// @ts-ignore
				delete this._data[key];
			});
			// assign new state
			Object.assign(this._data, newState);
		}
		else
		{
			// no object clean if not preserved
			if (!this._preserve)
			{
				Object.keys(this._data).forEach((key) =>
				{
					// @ts-ignore
					delete this._data[key];
				});
			}
		}

		this._tickers.forEach((ticker) =>
		{
			ticker(this.data());
		});
	}

	/**
   * Starts reactiveness for the document. This method is being called on instance creation.
   */
	public start()
	{
		if (!this._started)
		{
			this._update(this._ddpReactiveCollectionInstance.data()[0]);
			this._ddpReactiveCollectionInstance._activateReactiveObject(this);
			this._started = true;
		}
	}

	/**
   * Stops reactiveness for the document.
   */
	public stop()
	{
		if (this._started)
		{
			this._ddpReactiveCollectionInstance._deactivateReactiveObject(this);
			this._started = false;
		}
	}

	/**
   * Returns reactive document.
   */
	public data(): T
	{
		return this._data as T;
	}

	/**
   * Runs a function every time a change occurs.
   */
	public onChange(f: {})
	{
		const self = this as unknown as { [x: string]: any[] };
		return ddpOnChange(f, self, '_tickers');
	}

	/**
   * Change reactivity settings.
   * @param {boolean} settings.preserve - When preserve is true,reactive object won't change when corresponding object is being deleted.
   */
	public settings({ preserve }: { preserve: boolean; })
	{
		this._preserve = !!preserve;
	}
}
