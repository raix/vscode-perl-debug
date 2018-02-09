import * as net from 'net';
import {spawn} from 'child_process';
import { Readable, Writable } from 'stream';
import { EventEmitter } from 'events';
import { DebugSession, LaunchOptions } from './session';

export class RemoteSession implements DebugSession {
	public stdin: Writable;
	public stdout: Readable;
	public stderr: Readable;
	public on: Function;
	public kill: Function;
	public title: Function;
	public dump: Function;
	private event = new EventEmitter();

	constructor(port: number) {
		// Keep track of the chat clients
		let client;

		this.stdin = new Writable({
			write(chunk, encoding, callback) {
				if (client) {
					client.write(chunk);
					callback();
				}
			},
		});

		this.stdout = new Readable({
			read() {},
		});
		this.stderr = new Readable({
			read() {},
		});

		const server = net.createServer((socket) => {
			const name = `${socket.remoteAddress}:${socket.remotePort}`;

			if (!client) {
				client = socket;
				this.stdout.push(`Remote debugger at "${name}" connected at port ${port}.`);
			} else {
				// Already have a client connected, lets close and notify user
				this.stdout.push(`Warning: Additional remote client tried to connect "${name}".`);
				socket.end('Remote debugger already connected!');
			}

			socket.on('data', data => this.stderr.push(data));

			socket.on('end', data => {
				client = null;
				this.stdout.push(`Connection closed by "${name}"`);
				this.event.emit('close', data);
			});

			socket.on('error', data => this.event.emit('error', data));
		});

		server.listen(port, '0.0.0.0'); // Listen to port make it remotely available
		server.on('error', data => this.event.emit('error', data));

		this.on = (type, callback) => this.event.on(type, callback);
		this.kill = () => {
			server.close();
			this.event.removeAllListeners();
			this.stdin.removeAllListeners();
			this.stdout.removeAllListeners();
			this.stderr.removeAllListeners();
		};
		this.title = () => `Running debug server for remote session to connect on port "${port}"`;
		this.dump = () => `debug server port ${port}`;
	}
}
