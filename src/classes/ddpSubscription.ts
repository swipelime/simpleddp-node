/**
 * DDP subscription class.
 */
import DDPClient, { DDPMessage } from '../DDPClient';

export class ddpSubscription
{
	private _ddplink: DDPClient;
	args: any[];
	readonly pubname: string;
	private _nosub = false;
	private _started = false;
	private _ready = false;

	selfReadyEvent: {
    start: () => void
    stop(): void;
  } = {
			start: () =>
			{
			},
			stop: () =>
			{
			}
		};

	selfNosubEvent: {
    start: () => void
    stop(): void;
  } = {
			start: () =>
			{
			},
			stop: () =>
			{
			}
		};

	private subscriptionId!: string;

	constructor(pubname: string, args: any[], ddplink: DDPClient)
	{
		this._ddplink = ddplink;
		this.pubname = pubname;
		this.args = args;

		this.selfReadyEvent = ddplink.on('ready', (m: DDPMessage) =>
		{
			if (m.subs.includes(<string> this.subscriptionId))
			{
				this._ready = true;
				this._nosub = false;
			}
		});

		this.selfNosubEvent = ddplink.on('nosub', (m: DDPMessage) =>
		{
			if (m.id == this.subscriptionId)
			{
				this._ready = false;
				this._nosub = true;
				this._started = false;
			}
		});

		this.start();
	}

	/**
   * Runs everytime when `nosub` message corresponding to the subscription comes from the server.
   */
	public onNosub(f: (m?: DDPMessage) => void): { start: () => void; stop: () => void; }
	{
		if(this.isStopped())
		{
			f();
		}

		return this._ddplink.on('nosub', (m: DDPMessage) =>
		{
			if (m.id == this.subscriptionId)
			{
				if(m.error) throw new Error(m.error.message);

				f(m);
			}
		});
	}

	/**
   * Runs everytime when `ready` message corresponding to the subscription comes from the server.
   */
	public onReady(f: () => void): { start: () => void; stop: () => void; }
	{
		// может приходить несколько раз, нужно ли сохранять куда-то?
		if(this.isReady())
		{
			f();
		}

		return this._ddplink.on('ready', (m: DDPMessage) =>
		{
			if (m.subs.includes(this.subscriptionId))
			{
				f();
			}
		});
	}

	/**
   * Returns true if subsciprtion is ready otherwise false.
   */
	public isReady(): boolean
	{
		return this._ready;
	}

	/**
   * Returns true if subscription is stopped otherwise false.
   */
	public isStopped(): boolean
	{
		return this._nosub;
	}

	/**
   * Returns a promise which resolves when subscription is ready or rejects when `nosub` message arrives.
   */
	public ready(): Promise<void>
	{
		return new Promise<void>((resolve, reject) =>
		{
			if (this.isReady())
			{
				resolve();
			}
			else
			{
				const onReady = this._ddplink.on('ready', (m: DDPMessage) =>
				{
					if (m.subs.includes(this.subscriptionId))
					{
						onReady.stop();
						onNosub.stop();
						resolve();
					}
				});
				let onNosub = this._ddplink.on('nosub', (m: DDPMessage) =>
				{
					if (m.id == this.subscriptionId)
					{
						onNosub.stop();
						onReady.stop();
						reject(m.error || m);
					}
				});
			}
		});
	}

	/**
   * Returns a promise which resolves when corresponding `nosub` message arrives.
   * Rejects when `nosub` comes with error.
   */
	public nosub(): Promise<void>
	{
		return new Promise<void>((resolve, reject) =>
		{
			if (this.isStopped())
			{
				resolve();
			}
			else
			{
				const onNosub = this._ddplink.on('nosub', (m: DDPMessage) =>
				{
					if (m.id == this.subscriptionId)
					{
						this._nosub = true;

						onNosub.stop();
						if (m.error)
						{
							reject(m.error);
						}
						else
						{
							resolve();
						}
					}
				});
			}
		});
	}

	/**
   * Returns true if subscription is active otherwise false.
   */
	public isOn(): boolean
	{
		return this._started;
	}

	/**
   * Completly removes subscription.
   */
	public remove(): void
	{
		// stopping nosub listener
		this.selfNosubEvent.stop();
		// stopping the subscription and ready listener
		this.stop();
		// removing from sub list inside simpleDDP instance
		const i = this._ddplink.subs.indexOf(this);
		if (i > -1)
		{
			this._ddplink.subs.splice(i, 1);
		}
	}

	/**
   * Stops subscription and return a promise which resolves when subscription is stopped.
   */
	public stop(): Promise<any>
	{
		if (this._started)
		{
			// stopping ready listener
			this.selfReadyEvent.stop();
			// unsubscribing
			if (!this._nosub) this._ddplink.ddpConnection.unsub(this.subscriptionId);
			this._started = false;
			this._ready = false;
		}
		return this.nosub();
	}

	/**
   * Start the subscription. Runs on class creation.
   * Returns a promise which resolves when subscription is ready.
   */
	public start(args ?: any[]): Promise<any>
	{
		if (!this._started)
		{
			// starting ready listener
			this.selfReadyEvent.start();
			// subscribing
			if (Array.isArray(args)) this.args = args;
			this.subscriptionId = this._ddplink.ddpConnection.sub(this.pubname, this.args);
			this._started = true;
		}
		return this.ready();
	}

	/**
   * Restart the subscription. You can also change subscription arguments.
   * Returns a promise which resolves when subscription is ready.
   */
	public restart(args?: any[]): Promise<any>
	{
		return new Promise<void>((resolve, reject) =>
		{
			this.stop().then(() =>
			{
				this.start(args).then(() =>
				{
					resolve();
				}).catch((e) =>
				{
					reject(e);
				});
			}).catch((e) =>
			{
				reject(e);
			});
		});
	}
}
