/**
 * DDP event listener
 */
import DDPClient, { DDPMessage, User } from '../DDPClient';
import { PUBLIC_EVENTS } from '../ddp/ddp';

export function ddpEventListener<T extends typeof PUBLIC_EVENTS[number] = typeof PUBLIC_EVENTS[number]>(eventname: string, f: T extends 'login' ? (user: User) => void : (message: DDPMessage, id: string) => void, ddplink: DDPClient)
{
	let _started = false;
	const start = () =>
	{
		if (!_started)
		{
			ddplink.ddpConnection.on(eventname, f);
			_started = true;
		}
	};

	const stop = () =>
	{
		if (_started)
		{
			ddplink.ddpConnection.removeListener(eventname, f);
			_started = false;
		}
	};

	start();
	return { start, stop };
}
