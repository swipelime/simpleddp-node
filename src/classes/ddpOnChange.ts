/**
 * DDP change listener class.
 * @constructor
 */

export function ddpOnChange<T extends { [x: string]: any[] }>(obj: {}, inst: T, listenersArray: any = 'onChangeFuncs')
{
	let _isStopped = true;
	const start = () =>
	{
		if (_isStopped)
		{
			inst[listenersArray].push(obj);
			_isStopped = false;
		}
	};

	const stop = () =>
	{
		const index = inst[listenersArray].indexOf(obj);
		if (index > -1)
		{
			inst[listenersArray].splice(index, 1);
			_isStopped = true;
		}
	};

	start();
	return { start, stop };
}
