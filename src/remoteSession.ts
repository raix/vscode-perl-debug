import * as net from 'net';
import {spawn} from 'child_process';
import { Readable, Writable } from 'stream';
import { EventEmitter } from 'events';
import { DebugSession, LaunchOptions } from './session';
import { debuggerSignature } from './regExp';

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
				socket.destroy('Remote debugger already connected!');
			}

			socket.on('data', data => {
				// const str = data.toString('utf8');
				// const signature = str.split('\n').pop();
				// xxx: We should figure out a more stable way of differentiating between
				// command result and application output
				this.stderr.push(data); // xxx: For now we don't forward application output
				/*  if (debuggerSignature.test(signature)) {
					this.stderr.push(data);
				} else {
					this.stdout.push(data);
				}*/
			});

			socket.on('end', data => {
				this.stdout.push(`Connection closed by "${name}"`);
				this.event.emit('close', data);
				this.kill();
			});

			socket.on('error', data => {
				this.event.emit('error', data);
			});
		});

		server.listen(port, '0.0.0.0'); // Listen to port make it remotely available
		server.on('error', data => {
			this.event.emit('error', data);
			this.kill();
		});

		this.on = (type, callback) => this.event.on(type, callback);
		this.kill = () => {
			server.removeAllListeners();
			this.event.removeAllListeners();
			this.stdin.removeAllListeners();
			this.stdout.removeAllListeners();
			this.stderr.removeAllListeners();

			if (client) {
				client.destroy();
				client = null;
			}

			server.close();
		};
		this.title = () => `Running debug server for remote session to connect on port "${port}"`;
		this.dump = () => `debug server port ${port}`;
	}
}
