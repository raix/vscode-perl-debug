import {spawn} from 'child_process';
import { Readable, Writable } from 'stream';
import { EventEmitter } from 'events';
import { DebugSession, LaunchOptions } from './session';

export class LocalSession extends EventEmitter implements DebugSession {
	public stdin: Writable;
	public stdout: Readable;
	public stderr: Readable;
	public kill: Function;
	public title: Function;
	public dump: Function;
	public port: Number | null;

	constructor(filename: string, cwd: string, args: string[] = [], options: LaunchOptions = {}) {

		super();

		const perlCommand = options.exec || 'perl';
		const programArguments = options.args || [];

		const commandArgs = [].concat(args, [ '-d', filename /*, '-emacs'*/], programArguments);

		const spawnOptions = {
			detached: true,
			cwd: cwd || undefined,
			env: {
				COLUMNS: 80,
				LINES: 25,
				TERM: 'dumb',
				...options.env,
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
		this.title = () => `${perlCommand} ${commandArgs.join(' ')}`;
		this.dump = () => `spawn(${perlCommand}, ${JSON.stringify(commandArgs)}, ${JSON.stringify(spawnOptions)});`;
	}
}
