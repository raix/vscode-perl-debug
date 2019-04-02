import { Readable, Writable }  from 'stream';

export interface DebugSession {
	kill: Function,
	stderr: Readable,
	stdout: Readable,
	stdin: Writable,
	on: Function, // support "close", "error"
	title: Function,
	port: Number | null;
}
