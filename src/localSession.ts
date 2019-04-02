import { spawn } from 'child_process';
import { Readable, Writable } from 'stream';
import { EventEmitter } from 'events';
import { DebugSession } from './session';
import { LaunchRequestArguments } from './perlDebug';

export class LocalSession extends EventEmitter implements DebugSession {
	public stdin: Writable;
	public stdout: Readable;
	public stderr: Readable;
	public kill: Function;
	public title: Function;
	public port: Number | null;

	constructor(launchArgs: LaunchRequestArguments) {

		super();

		const perlCommand = launchArgs.exec || 'perl';
		const commandArgs = [
			...( launchArgs.execArgs || [] ),
			'-d',
			launchArgs.program,
			...( launchArgs.args || [] )
		];

		const spawnOptions = {
			detached: true,
			cwd: launchArgs.root || undefined,
			env: {
				COLUMNS: 80,
				LINES: 25,
				TERM: 'dumb',
				...launchArgs.env,
			},
		};

		const session = spawn(perlCommand, commandArgs, spawnOptions);
		this.stdin = session.stdin;
		this.stdout = session.stdout;
		this.stderr = session.stderr;
		this.kill = () => {
			this.removeAllListeners();
			session.kill();
		};
		this.title = () => `spawn(${perlCommand}, ${JSON.stringify(commandArgs)}, ${JSON.stringify(spawnOptions)});`;
	}
}
