import EJSON from 'ejson';
import DDP, { PUBLIC_EVENTS } from './ddp/ddp';

import { isEqual } from './helpers/isEqual.js';
import { fullCopy } from './helpers/fullCopy.js';
import ws from 'ws';

import { ddpEventListener } from './classes/ddpEventListener.js';
import { ddpSubscription } from './classes/ddpSubscription.js';
import { ddpCollection } from './classes/ddpCollection.js';

export { ddpEventListener, ddpSubscription, ddpCollection };

function uniqueIdFuncGen()
{
	let idCounter = 0;

	return function ()
	{
		return idCounter++;
	};
}

const simpleDDPcounter = uniqueIdFuncGen();

function connectPlugins(plugins?: any[], ...places: any[])
{
	if(plugins && Array.isArray(plugins))
	{
		plugins.forEach((p) =>
		{
			places.forEach((place) =>
			{
				if (p[place])
				{
					// @ts-ignore
					p[place].call(this);
				}
			});
		});
	}
}

export type MeteorError = {
	error: number;
	reason: string;
	message: string;
	errorType: 'Meteor.Error';
	isClientSafe?: boolean;
};

export type DDPMessage =
{
	collection: PropertyKey;
	id: any; fields: {};
	cleared: any[];
	f:
	(p: { removed: boolean; added: any; changed: boolean }) => any;
	msg: string;
	name: string;
	params: any[];
	result: any;
	sub: any;
	subs: string | string[]
	filter: (newObjFullCopy: { _id: any }, number: number, collection1: any[]) => any;
	error?: Error
};

export type SimpleDDPConnectOptions =
{
	endpoint: string,
	SocketConstructor: typeof WebSocket | typeof ws,
	autoConnect?: boolean,
	autoReconnect?: boolean,
	reconnectInterval?: number,
	clearDataOnReconnection?: boolean,
	maxTimeout?: number,
	cleanQueue?: boolean,
	plugins?: any[],
	ddpVersion?: string,
};

export type LoginParams =
{
	password: string;
	user: { username: string };
}

export type User =
{
	id: string;
	token: string;
	tokenExpires: Date,
	type: 'password' | 'resume';
}

/**
 * Creates an instance of DDPServerConnection class. After being constructed, the instance will
 * establish a connection with the DDP server and will try to maintain it open.
 */
class DDPClient
{
	private _id = simpleDDPcounter();
	private _opGenId = uniqueIdFuncGen();
	private _opts: SimpleDDPConnectOptions;
	ddpConnection: DDP;
	subs: ddpSubscription[] = [];
	/**
	 All collections data received from server.
	 */
	collections: {
		[key: PropertyKey]: any[]
	} = {};

	onChangeFuncs: DDPMessage[] = [];
	connected: boolean = false;
	maxTimeout: number | undefined;
	clearDataOnReconnection: boolean;
	tryingToConnect: boolean;
	tryingToDisconnect = false;
	willTryToReconnect: boolean;
	connectedEvent: { stop: () => void; start: () => void };
	connectedEventRestartSubs: { stop: () => void; start: () => void };
	disconnectedEvent: { stop: () => void; start: () => void };
	addedEvent: { stop: () => void; start: () => void };
	changedEvent: { stop: () => void; start: () => void };
	removedEvent: { stop: () => void; start: () => void };
	userId: string | undefined;
	 loggedIn = false;
	token: string | undefined;

	/**
	 * @example
	 * var opts = {
	 *	endpoint: "ws://someserver.com/websocket",
	 *	SocketConstructor: WebSocket,
	 *	reconnectInterval: 5000
	 * };
	 * var server = new simpleDDP(opts);
	 */
	constructor(opts: SimpleDDPConnectOptions, plugins?: any[])
	{
		this._opts = opts;
		this.ddpConnection = new DDP(opts);

		this.maxTimeout = opts.maxTimeout;
		this.clearDataOnReconnection = opts.clearDataOnReconnection === undefined ? true : opts.clearDataOnReconnection;
		this.tryingToConnect = opts.autoConnect === undefined ? true : opts.autoConnect;
		this.willTryToReconnect = opts.autoReconnect === undefined ? true : opts.autoReconnect;

		const pluginConnector = connectPlugins.bind(this, plugins);

		// plugin init section
		pluginConnector('init', 'beforeConnected');

		this.connectedEvent = this.on('connected', () =>
		{
			this.connected = true;
			this.tryingToConnect = false;
		});

		pluginConnector('afterConnected', 'beforeSubsRestart');

		this.connectedEventRestartSubs = this.on('connected', () =>
		{
			if (this.clearDataOnReconnection)
			{
				// we have to clean local collections
				this.clearData().then(() =>
				{
					this.ddpConnection.emit('clientReady');
					this.restartSubs();
				});
			}
			else
			{
				this.ddpConnection.emit('clientReady');
				this.restartSubs();
			}
		});

		pluginConnector('afterSubsRestart', 'beforeDisconnected');

		this.disconnectedEvent = this.on('disconnected', () =>
		{
			this.connected = false;
			this.tryingToDisconnect = false;
			this.tryingToConnect = this.willTryToReconnect;
		});

		pluginConnector('afterDisconnected', 'beforeAdded');

		this.addedEvent = this.on('added', (m: DDPMessage) => this.dispatchAdded(m));
		pluginConnector('afterAdded', 'beforeChanged');
		this.changedEvent = this.on('changed', (m: DDPMessage) => this.dispatchChanged(m));
		pluginConnector('afterChanged', 'beforeRemoved');
		this.removedEvent = this.on('removed', (m: DDPMessage) => this.dispatchRemoved(m));
		pluginConnector('afterRemoved', 'after');
	}

	public login(obj: LoginParams): Promise<User>
	{
		var atStart = arguments.length > 1 && arguments[1] !== undefined ? arguments[1] : false;

		return new Promise((resolve: (m: User) => void, reject: (m: MeteorError) => void) =>
		{
			this.apply('login', [obj], atStart).then((m: User | MeteorError) =>
			{
				if (m && 'id' in m)
				{
					this.userId = m.id;
					this.token = m.token;
					this.loggedIn = true;
					if (m.type == 'resume')
					{
						this.ddpConnection.emit('loginResume', m);
					}
					else
					{
						this.ddpConnection.emit('login', m);
					}
					resolve(m);
				}
				else
				{
					reject(m);
				}
			}, reject);
		});
	};

	public logout(): Promise<void>
	{
		return new Promise((resolve, reject) =>
		{
			if (this.loggedIn)
			{
				this.apply('logout').then(() =>
				{
					this.userId = undefined;
					this.token = undefined;
					this.loggedIn = false;
					this.ddpConnection.emit('logout');
					resolve();
				}, reject);
			}
			else
			{
				resolve();
			}
		});
	};

	private restartSubs()
	{
		this.subs.forEach((sub) =>
		{
			if (sub.isOn())
			{
				sub.restart();
			}
		});
	}

	/**
	 * Use this for fetching the subscribed data and for reactivity inside the collection.
	 */
	public collection<T>(name: string): ddpCollection<T>
	{
		return new ddpCollection<T>(name, this);
	}

	/**
	 * Dispatcher for ddp added messages.
	 */
	private dispatchAdded(m: DDPMessage)
	{
		// m везде одинаковое, стоит наверное копировать
		// m is always the same, it is probably worth copying
		if (this.collections.hasOwnProperty(m.collection))
		{
			const i = this.collections[m.collection].findIndex((obj) => obj._id == m.id);
			if (i > -1)
			{
				// new sub knows nothing about old sub
				this.collections[m.collection].splice(i, 1);
			}
		}
		if (!this.collections.hasOwnProperty(m.collection)) this.collections[m.collection] = [];
		const newObj = { _id: m.id, ...m.fields };
		const i = this.collections[m.collection].push(newObj);
		const fields: {
		[key: string]: number;
	} = {};
		if (m.fields)
		{
			Object.keys(m.fields).map((p) =>
			{
				fields[p] = 1;
			});
		}
		this.onChangeFuncs.forEach((l: DDPMessage) =>
		{
			if (l.collection == m.collection)
			{
				const hasFilter = l.hasOwnProperty('filter');
				const newObjFullCopy = fullCopy(newObj);
				if (!hasFilter)
				{
					l.f({ changed: false, added: newObjFullCopy, removed: false });
				}
				else if (hasFilter && l.filter(newObjFullCopy, i - 1, this.collections[m.collection]))
				{
					// @ts-ignore
					l.f({ prev: false, next: newObjFullCopy, fields, fieldsChanged: newObjFullCopy, fieldsRemoved: [] });
				}
			}
		});
	}

	/**
	 * Dispatcher for ddp changed messages.
	 */
	private dispatchChanged(m: DDPMessage)
	{
		if (!this.collections.hasOwnProperty(m.collection)) this.collections[m.collection] = [];
		const i = this.collections[m.collection].findIndex((obj) => obj._id == m.id);
		if (i > -1)
		{
			const t = this.collections[m.collection][i];
			const prev: typeof t = fullCopy(this.collections[m.collection][i]);
			const fields: {
			[key: string]: number;
		} = {}; let fieldsChanged = {}; let
				fieldsRemoved: any[] = [];
			if (m.fields)
			{
				fieldsChanged = m.fields;
				Object.keys(m.fields).map((p) =>
				{
					fields[p] = 1;
				});
				Object.assign(this.collections[m.collection][i], m.fields);
			}
			if (m.cleared)
			{
				fieldsRemoved = m.cleared;
				m.cleared.forEach((fieldName) =>
				{
					fields[fieldName] = 0;
					delete this.collections[m.collection][i][fieldName];
				});
			}
			const next = this.collections[m.collection][i];
			this.onChangeFuncs.forEach((l) =>
			{
				if (l.collection == m.collection)
				{
					// perhaps add a parameter inside l object to choose if full copy should occur
					const hasFilter = l.hasOwnProperty('filter');
					if (!hasFilter)
					{
						l.f({
							// @ts-ignore
							changed: { prev, next: fullCopy(next), fields, fieldsChanged, fieldsRemoved },
							added: false,
							removed: false
						});
					}
					else
					{
						const fCopyNext = fullCopy(next);
						const prevFilter = l.filter(prev, i, this.collections[m.collection]);
						const nextFilter = l.filter(fCopyNext, i, this.collections[m.collection]);
						if (prevFilter || nextFilter)
						{
							l.f({
								// @ts-ignore
								prev,
								next: fCopyNext,
								fields,
								fieldsChanged,
								fieldsRemoved,
								predicatePassed: [prevFilter, nextFilter]
							});
						}
					}
				}
			});
		}
		else
		{
			this.dispatchAdded(m);
		}
	}

	/**
	 * Dispatcher for ddp removed messages.
	 */
	private dispatchRemoved(m: DDPMessage)
	{
		if (!this.collections.hasOwnProperty(m.collection)) this.collections[m.collection] = [];
		const i = this.collections[m.collection].findIndex((obj) => obj._id == m.id);
		if (i > -1)
		{
			const removedObj = this.collections[m.collection].splice(i, 1)[0];
			this.onChangeFuncs.forEach((l) =>
			{
				if (l.collection == m.collection)
				{
					const hasFilter = l.hasOwnProperty('filter');
					if (!hasFilter)
					{
						// возможно стоит сделать fullCopy, чтобы было как в случае dispatchAdded и dispatchChanged
						// perhaps you should make a fullCopy so that it is like in the case of dispatchAdded and dispatchChanged
						l.f({ changed: false, added: false, removed: removedObj });
					}
					else
						if (l.filter(removedObj, i, this.collections[m.collection]))
						{
							// @ts-ignore
							l.f({ prev: removedObj, next: false });
						}
				}
			});
		}
	}

	/**
	 * Connects to the ddp server. The method is called automatically by the class constructor if the autoConnect option is set to true (default behavior).
	 * @public
	 * @return {Promise} - Promise which resolves when connection is established.
	 */
	connect(): Promise<any>
	{
		this.willTryToReconnect = this._opts.autoReconnect === undefined ? true : this._opts.autoReconnect;
		return new Promise<void>((resolve, reject) =>
		{
			if (!this.tryingToConnect)
			{
				this.ddpConnection.connect();
				this.tryingToConnect = true;
			}
			if (!this.connected)
			{
				let stoppingInterval: ReturnType<typeof setTimeout> | undefined;

				const connectionHandler = this.on('connected', () =>
				{
					clearTimeout(stoppingInterval);
					connectionHandler.stop();
					this.tryingToConnect = false;
					resolve();
				});

				if (this.maxTimeout)
				{
					stoppingInterval = setTimeout(() =>
					{
						connectionHandler.stop();
						this.tryingToConnect = false;
						reject(new Error('MAX_TIMEOUT_REACHED'));
					}, this.maxTimeout);
				}
			}
			else
			{
				resolve();
			}
		});
	}

	/**
	 * Disconnects from the ddp server by closing the WebSocket connection. You can listen on the disconnected event to be notified of the disconnection.
	 */
	public disconnect(): Promise<any>
	{
		this.willTryToReconnect = false;
		return new Promise<void>((resolve, reject) =>
		{
			if (!this.tryingToDisconnect)
			{
				this.ddpConnection.disconnect();
				this.tryingToDisconnect = true;
			}
			if (this.connected)
			{
				const connectionHandler = this.on('disconnected', () =>
				{
					connectionHandler.stop();
					this.tryingToDisconnect = false;
					resolve();
				});
			}
			else
			{
				resolve();
			}
		});
	}

	/**
	 * Calls a remote method with arguments passed in array.
	 * @example
	 * server.apply("method1").then(function(result) {
	 *	console.log(result); //show result message in console
	 *	if (result.someId) {
	 *			//server sends us someId, lets call next method using this id
	 *			return server.apply("method2",[result.someId]);
	 *	} else {
	 *			//we didn't recieve an id, lets throw an error
	 *			throw "no id sent";
	 *	}
	 * }).then(function(result) {
	 *	console.log(result); //show result message from second method
	 * }).catch(function(error) {
	 *	console.log(result); //show error message in console
	 * });
	 */
	public apply<T extends any[], R>(method: string, args?: T, atBeginning: boolean = false): Promise<any>
	{
		return new Promise((resolve, reject) =>
		{
			const methodId = this.ddpConnection.method(method, args || [], atBeginning);
			const _self = this;

			let stoppingInterval: ReturnType<typeof setTimeout> | undefined;

			function onMethodResult(message: { id: string; error: any; result: unknown; })
			{
				if (message.id == methodId)
				{
					clearTimeout(stoppingInterval);
					if (!message.error)
					{
						resolve(message.result);
					}
					else
					{
						reject(message.error);
					}
					_self.ddpConnection.removeListener('result', onMethodResult);
				}
			}

			this.ddpConnection.on('result', onMethodResult);

			if (this.maxTimeout)
			{
				stoppingInterval = setTimeout(() =>
				{
					this.ddpConnection.removeListener('result', onMethodResult);
					reject(new Error('MAX_TIMEOUT_REACHED'));
				}, this.maxTimeout);
			}
		});
	}

	/**
	 * Calls a remote method with arguments passed after the first argument.
	 * Syntactic sugar for @see apply.
	 */
	public call<TArgs extends any[], R = unknown>(method: string, ...args: TArgs): Promise<R>
	{
		return this.apply(method, args) as Promise<R>;
	}

	/**
	 * Tries to subscribe to a specific publication on server.
	 * Starts the subscription if the same subscription exists.
	 */
	public sub(pubname: string, args: any[]): ddpSubscription
	{
		const hasSuchSub = this.subs.find((sub) => sub.pubname == pubname && isEqual(sub.args, Array.isArray(args) ? args : []));
		if (!hasSuchSub)
		{
			const i = this.subs.push(new ddpSubscription(pubname, Array.isArray(args) ? args : [], this));
			return this.subs[i - 1];
		}
		if (hasSuchSub.isStopped()) hasSuchSub.start();
		return hasSuchSub;
	}

	/**
	 * Tries to subscribe to a specific publication on server.
	 * Syntactic sugar for @see sub.
	 */
	public subscribe(pubname: string, ...args: any[]): ddpSubscription
	{
		return this.sub(pubname, args);
	}

	/**
	 * Starts listening server for basic DDP event running f each time the message arrives.
	 * Default suppoted events @see PUBLIC_EVENTS const.
	 * @example
	 * server.on('connected', () => {
	 *	 // you can show a success message here
	 * });
	 *
	 * server.on('disconnected', () => {
	 *	 // you can show a reconnection message here
	 * });
	 */
	public on<T extends typeof PUBLIC_EVENTS[number] = typeof PUBLIC_EVENTS[number]>(event: T, f: T extends 'login' ? (user: User) => void : (message: DDPMessage, id: string) => void): ReturnType<typeof ddpEventListener>
	{
		return ddpEventListener<T>(event, f, this);
	}

	/**
	 * Stops all reactivity.
	 */
	stopChangeListeners()
	{
		this.onChangeFuncs = [];
	}

	/**
	 * Removes all documents like if it was removed by the server publication.
	 */
	public clearData(): Promise<any>
	{
		return new Promise<void>((resolve, reject) =>
		{
			let totalDocuments = 0;
			Object.keys(this.collections).forEach((collection) =>
			{
				totalDocuments += Array.isArray(this.collections[collection]) ? this.collections[collection].length : 0;
			});

			if (totalDocuments === 0)
			{
				resolve();
			}
			else
			{
				let counter = 0;
				const uniqueId = `${this._id}-${this._opGenId()}`;

				const listener = this.on('removed', (m, id) =>
				{
					if (id == uniqueId)
					{
						counter++;
						if (counter == totalDocuments)
						{
							listener.stop();
							resolve();
						}
					}
				});

				Object.keys(this.collections).forEach((collection) =>
				{
					this.collections[collection].forEach((doc) =>
					{
						this.ddpConnection.emit('removed', {
							msg: 'removed',
							id: doc.id,
							collection
						}, uniqueId);
					});
				});
			}
		});
	}

	/**
	 * Imports the data like if it was published by the server.
	 */
	public importData(data: string | object): Promise<any>
	{
		return new Promise<void>((resolve, reject) =>
		{
			const c = typeof data === 'string' ? EJSON.parse(data) : data;

			let totalDocuments = 0;
			Object.keys(c).forEach((collection) =>
			{
				totalDocuments += Array.isArray(c[collection]) ? c[collection].length : 0;
			});

			let counter = 0;
			const uniqueId = `${this._id}-${this._opGenId()}`;

			const listener = this.on('added', (m, id) =>
			{
				if (id == uniqueId)
				{
					counter++;
					if (counter == totalDocuments)
					{
						listener.stop();
						resolve();
					}
				}
			});

			Object.keys(c).forEach((collection) =>
			{
				c[collection].forEach((doc: { id: any; }) =>
				{
					const docFields = { ...doc };
					delete docFields.id;

					this.ddpConnection.emit('added', {
						msg: 'added',
						id: doc.id,
						collection,
						fields: docFields
					}, uniqueId);
				});
			});
		});
	}

	/**
	 * Exports the data
	 */
	public exportData(format?: string): object | string | undefined
	{
		if (format === undefined || format == 'string')
		{
			return EJSON.stringify(this.collections);
		} if (format == 'raw')
		{
			return fullCopy(this.collections);
		}

		return undefined;
	}

	/**
	 * Marks every passed @see ddpSubscription object as ready like if it was done by the server publication.
	 */
	public markAsReady(subs: any[]): Promise<any>
	{
		return new Promise<void>((resolve, reject) =>
		{
			const uniqueId = `${this._id}-${this._opGenId()}`;

			this.ddpConnection.emit('ready', {
				msg: 'ready',
				subs: subs.map((sub) => sub._getId())
			}, uniqueId);

			const listener = this.on('ready', (_m, id) =>
			{
				if (id == uniqueId)
				{
					listener.stop();
					resolve();
				}
			});
		});
	}
}

export default DDPClient;
